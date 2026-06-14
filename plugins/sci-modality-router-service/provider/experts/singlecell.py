"""Single-cell expert backed by SciBERT.

Real GPU forward pass: we embed (a) every gene symbol in the input, and
(b) a curated catalogue of canonical cell-type descriptions, then score
each cell type by mean cosine similarity over its marker genes. The
SciBERT embedding step is the actual GPU computation; cell-type scoring
is deterministic on top of those embeddings.
"""

from __future__ import annotations

import re

import torch
from transformers import AutoModel, AutoTokenizer

CELL_TYPE_MARKERS: dict[str, list[str]] = {
    "T cell (CD4+)": ["CD3D", "CD3E", "CD4", "IL7R", "CCR7", "TCF7"],
    "T cell (CD8+ cytotoxic)": ["CD3D", "CD8A", "CD8B", "GZMB", "GZMK", "PRF1", "NKG7"],
    "B cell": ["MS4A1", "CD19", "CD79A", "CD79B", "IGHM", "BANK1"],
    "Natural killer (NK) cell": ["NKG7", "GNLY", "NCAM1", "FCGR3A", "KLRD1", "PRF1"],
    "Monocyte / macrophage": ["CD14", "LYZ", "S100A8", "S100A9", "FCN1", "CST3"],
    "Dendritic cell": ["FCER1A", "CST3", "CLEC10A", "CLEC9A", "ITGAX"],
    "Plasma cell": ["MZB1", "JCHAIN", "IGHA1", "XBP1", "CD38"],
    "Endothelial cell": ["PECAM1", "VWF", "CDH5", "CLDN5"],
    "Fibroblast": ["COL1A1", "COL3A1", "DCN", "LUM", "FAP"],
    "Epithelial cell": ["EPCAM", "KRT18", "KRT8", "CDH1"],
    "Neuron": ["RBFOX3", "SYN1", "SNAP25", "MAP2", "NEFL"],
    "Astrocyte": ["GFAP", "AQP4", "S100B", "ALDH1L1"],
    "Microglia": ["CX3CR1", "P2RY12", "TMEM119", "AIF1"],
    "Erythrocyte / RBC": ["HBA1", "HBA2", "HBB", "ALAS2"],
}

GENE_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9\-]{1,9}\b")


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def _parse_input(payload: str) -> tuple[list[str], list[list[float]] | None, list[str] | None]:
    lines = [line.strip() for line in payload.splitlines() if line.strip()]
    if not lines:
        return [], None, None

    first = lines[0]
    header_tokens = first.split()
    looks_like_header = (
        len(header_tokens) >= 3
        and not all(_is_number(t) for t in header_tokens[1:])
    )
    if looks_like_header and len(lines) >= 2:
        body_lines = lines[1:]
        rows: list[list[float]] = []
        row_labels: list[str] = []
        for raw in body_lines:
            parts = raw.split()
            if len(parts) != len(header_tokens):
                continue
            row_label = parts[0]
            values: list[float] = []
            for v in parts[1:]:
                try:
                    values.append(float(v))
                except ValueError:
                    values = []
                    break
            if values:
                rows.append(values)
                row_labels.append(row_label)
        if rows:
            cols_are_genes = sum(1 for t in header_tokens[1:] if GENE_TOKEN_RE.fullmatch(t)) >= 2
            rows_are_genes = sum(1 for t in row_labels if GENE_TOKEN_RE.fullmatch(t)) >= 2
            if cols_are_genes:
                return header_tokens[1:], rows, row_labels
            if rows_are_genes:
                num_cells = len(rows[0])
                transposed: list[list[float]] = [
                    [rows[g][c] for g in range(len(rows))] for c in range(num_cells)
                ]
                return row_labels, transposed, header_tokens[1:]

    tokens = GENE_TOKEN_RE.findall(payload)
    seen: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.append(t)
    return seen, None, None


class SingleCellExpert:
    def __init__(self, model_path: str, device: str = "cuda:1") -> None:
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModel.from_pretrained(model_path).to(device).eval()
        self.model_id = "allenai/scibert_scivocab_uncased"
        self._cell_type_embeddings = self._precompute_cell_type_embeddings()

    @torch.inference_mode()
    def _embed_terms(self, terms: list[str]) -> torch.Tensor:
        if not terms:
            return torch.empty(0, self.model.config.hidden_size, device=self.device)
        tokens = self.tokenizer(terms, padding=True, truncation=True, return_tensors="pt").to(self.device)
        outputs = self.model(**tokens)
        mask = tokens["attention_mask"].unsqueeze(-1).float()
        summed = (outputs.last_hidden_state * mask).sum(dim=1)
        counts = mask.sum(dim=1).clamp_min(1)
        return summed / counts

    def _precompute_cell_type_embeddings(self) -> dict[str, torch.Tensor]:
        out: dict[str, torch.Tensor] = {}
        for cell, markers in CELL_TYPE_MARKERS.items():
            anchors = [f"{cell} marker {g}" for g in markers] + [cell]
            embs = self._embed_terms(anchors)
            out[cell] = embs.mean(dim=0)
        return out

    @torch.inference_mode()
    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        genes, matrix, row_labels = _parse_input(payload)
        if not genes:
            return "[scibert-singlecell] No gene-like tokens found in input."

        gene_embs = self._embed_terms(genes)
        cell_keys = list(self._cell_type_embeddings)
        cell_matrix = torch.stack([self._cell_type_embeddings[k] for k in cell_keys])
        gene_norms = gene_embs / gene_embs.norm(dim=-1, keepdim=True).clamp_min(1e-8)
        cell_norms = cell_matrix / cell_matrix.norm(dim=-1, keepdim=True).clamp_min(1e-8)
        sim = gene_norms @ cell_norms.T

        cell_assignments: list[str] = []
        if matrix is not None:
            weights = torch.tensor(matrix, device=self.device, dtype=torch.float32)
            mins = weights.min(dim=1, keepdim=True).values
            maxs = weights.max(dim=1, keepdim=True).values
            weights = (weights - mins) / (maxs - mins).clamp_min(1e-8)
            per_cell_scores = weights @ sim
            top_indices = per_cell_scores.argmax(dim=1).tolist()
            for i, ci in enumerate(top_indices):
                label = row_labels[i] if row_labels else f"row{i}"
                cell_assignments.append(f"{label} -> {cell_keys[ci]} (score={float(per_cell_scores[i, ci]):.3f})")
            global_score = per_cell_scores.mean(dim=0)
        else:
            global_score = sim.mean(dim=0)

        top_k = min(5, global_score.size(0))
        top = torch.topk(global_score, top_k)
        top_lines = [f"{cell_keys[i]} (score={float(top.values[k]):.3f})" for k, i in enumerate(top.indices.tolist())]

        per_gene_best = sim.argmax(dim=1).tolist()
        per_gene_assignments = []
        for g, best in zip(genes[:15], per_gene_best[:15]):
            per_gene_assignments.append(f"{g} -> {cell_keys[best]}")

        lines = [
            f"[scibert-singlecell] Inference complete on {self.model_id} ({self.device}).",
            f"Genes embedded on GPU: {len(genes)}",
            f"Cell-type catalogue: {len(cell_keys)} canonical types",
            "",
            "Aggregate cell-type scores (cosine, higher = more consistent with these markers):",
            *(f"  - {line}" for line in top_lines),
        ]
        if cell_assignments:
            lines.append("")
            lines.append("Per-row cell-type assignment (rows interpreted as individual cells / clusters):")
            for assignment in cell_assignments[:20]:
                lines.append(f"  - {assignment}")
        lines.append("")
        lines.append(f"Per-gene nearest cell type (first {len(per_gene_assignments)}):")
        for line in per_gene_assignments:
            lines.append(f"  - {line}")
        if instruction:
            lines.append("")
            lines.append(f"User context: {instruction}")
        lines.append("")
        lines.append(
            "Confidence: SciBERT was trained on scientific text, NOT on single-cell counts; "
            "scores reflect semantic compatibility between gene symbols and cell-type descriptors. "
            "A true single-cell foundation model (Geneformer/scGPT) would be stronger, but the "
            "GPU embedding pass and per-cell scoring above are real model outputs."
        )
        return "\n".join(lines)
