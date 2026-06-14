"""Spatial-omics expert.

Composes the SingleCellExpert (real GPU forward pass over SciBERT) with
spatial-coordinate analysis. Input is expected to contain a per-spot
matrix with either explicit (x, y) coordinates or coordinate-bearing
column names. We run the single-cell pipeline on the gene side, then
group spots by coordinate proximity (deterministic KMeans-style on
torch / GPU) so the response describes both biology AND geometry.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import torch

if TYPE_CHECKING:
    from .singlecell import SingleCellExpert


def _try_extract_coords(payload: str) -> list[tuple[float, float]] | None:
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    if not lines:
        return None
    header = lines[0].split()
    x_idx = next((i for i, h in enumerate(header) if h.lower() in {"x", "x_centroid", "spot_x", "row"}), None)
    y_idx = next((i for i, h in enumerate(header) if h.lower() in {"y", "y_centroid", "spot_y", "col"}), None)
    if x_idx is None or y_idx is None:
        return None
    coords: list[tuple[float, float]] = []
    for raw in lines[1:]:
        parts = raw.split()
        if len(parts) <= max(x_idx, y_idx):
            continue
        try:
            coords.append((float(parts[x_idx]), float(parts[y_idx])))
        except ValueError:
            continue
    return coords if len(coords) >= 4 else None


def _kmeans(points: torch.Tensor, k: int, iters: int = 25) -> tuple[torch.Tensor, torch.Tensor]:
    n = points.size(0)
    if k >= n:
        return torch.arange(n, device=points.device), points.clone()
    idx = torch.linspace(0, n - 1, k, device=points.device).long()
    centers = points[idx].clone()
    for _ in range(iters):
        dists = torch.cdist(points, centers)
        assignments = dists.argmin(dim=1)
        new_centers = torch.stack(
            [
                points[assignments == ci].mean(dim=0)
                if (assignments == ci).any()
                else centers[ci]
                for ci in range(k)
            ]
        )
        if torch.allclose(new_centers, centers, atol=1e-5):
            break
        centers = new_centers
    return assignments, centers


class SpatialExpert:
    def __init__(self, singlecell: "SingleCellExpert") -> None:
        self.singlecell = singlecell
        self.model_id = singlecell.model_id + " + spatial-kmeans"
        self.device = singlecell.device

    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        sc_text = self.singlecell.analyze(payload=payload, instruction=instruction, system=system)

        coords = _try_extract_coords(payload)
        if coords is None:
            return (
                sc_text
                + "\n\n[scibert-spatial] No (x, y) coordinate columns detected - spatial layer "
                  "skipped; biology layer above is from the SciBERT GPU pass."
            )

        points = torch.tensor(coords, device=self.device, dtype=torch.float32)
        k = max(2, min(4, points.size(0) // 3))
        assignments, centers = _kmeans(points, k)
        per_cluster_sizes = [int((assignments == ci).sum()) for ci in range(k)]
        x_min, y_min = points.min(dim=0).values.tolist()
        x_max, y_max = points.max(dim=0).values.tolist()
        center_descs = [
            f"region{ci + 1}: center=({float(centers[ci, 0]):.2f}, {float(centers[ci, 1]):.2f}), spots={per_cluster_sizes[ci]}"
            for ci in range(k)
        ]
        return (
            sc_text
            + "\n\n[scibert-spatial] Spatial layer (on GPU):\n"
            + f"  - spots parsed: {len(coords)}; bounding box: x[{x_min:.2f}, {x_max:.2f}] y[{y_min:.2f}, {y_max:.2f}]\n"
            + f"  - {k} spatial regions identified via on-device KMeans:\n"
            + "\n".join(f"    - {d}" for d in center_descs)
        )
