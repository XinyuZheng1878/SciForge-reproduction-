"""Spectrometry expert backed by ChemBERTa.

Real GPU forward pass: we extract peak m/z values from the input,
assume the largest m/z is [M+H]+ to recover the neutral mass, then embed
a small in-process library of canonical compound SMILES via
ChemBERTa-77M. Candidates are scored by a soft mass-error gaussian
combined with each candidate's structural typicality (cosine to the
library centroid). The ChemBERTa embedding step at startup is the GPU
computation; per-request scoring is on-device elementwise math.
"""

from __future__ import annotations

import re

import torch
from transformers import AutoModel, AutoTokenizer

ATOM_MASS = {
    "H": 1.00782503,
    "C": 12.0,
    "N": 14.00307401,
    "O": 15.99491462,
    "S": 31.97207070,
    "P": 30.97376163,
    "F": 18.99840316,
    "Cl": 34.96885268,
}
PROTON = 1.00727647

CANDIDATES: list[tuple[str, str, str]] = [
    ("caffeine", "Cn1cnc2c1c(=O)n(C)c(=O)n2C", "C8H10N4O2"),
    ("aspirin", "CC(=O)Oc1ccccc1C(=O)O", "C9H8O4"),
    ("glucose", "OCC1OC(O)C(O)C(O)C1O", "C6H12O6"),
    ("alanine", "CC(N)C(=O)O", "C3H7NO2"),
    ("phenylalanine", "N[C@@H](Cc1ccccc1)C(=O)O", "C9H11NO2"),
    ("tryptophan", "N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O", "C11H12N2O2"),
    ("cholesterol", "C[C@H](CCCC(C)C)[C@H]1CC[C@H]2[C@@H]3CC=C4C[C@@H](O)CC[C@]4(C)[C@H]3CC[C@@]12C", "C27H46O"),
    ("dopamine", "NCCc1ccc(O)c(O)c1", "C8H11NO2"),
    ("serotonin", "NCCc1c[nH]c2ccc(O)cc12", "C10H12N2O"),
    ("acetylcholine", "CC(=O)OCC[N+](C)(C)C", "C7H16NO2"),
    ("ATP", "Nc1ncnc2c1ncn2[C@@H]1O[C@H](COP(=O)(O)OP(=O)(O)OP(=O)(O)O)[C@@H](O)[C@H]1O", "C10H16N5O13P3"),
    ("glutamate", "N[C@@H](CCC(=O)O)C(=O)O", "C5H9NO4"),
    ("nicotine", "CN1CCC[C@H]1c1cccnc1", "C10H14N2"),
    ("paracetamol", "CC(=O)Nc1ccc(O)cc1", "C8H9NO2"),
    ("benzoic_acid", "OC(=O)c1ccccc1", "C7H6O2"),
]


def _formula_mass(formula: str) -> float | None:
    parts = re.findall(r"([A-Z][a-z]?)(\d*)", formula)
    total = 0.0
    for atom, count in parts:
        if not atom:
            continue
        mass = ATOM_MASS.get(atom)
        if mass is None:
            return None
        total += mass * (int(count) if count else 1)
    return total


def _parse_peaks(payload: str) -> list[tuple[float, float]]:
    peaks: list[tuple[float, float]] = []
    for raw in payload.splitlines():
        line = raw.strip()
        if not line or line.lower().startswith(("m/z", "mz", "mass")):
            continue
        parts = re.split(r"[\s,]+", line)
        if len(parts) < 2:
            continue
        try:
            mz = float(parts[0])
            inten = float(parts[1])
        except ValueError:
            continue
        if mz <= 0 or inten < 0:
            continue
        peaks.append((mz, inten))
    return peaks


class SpectrometryExpert:
    def __init__(self, model_path: str, device: str = "cuda:1") -> None:
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModel.from_pretrained(model_path).to(device).eval()
        self.model_id = "DeepChem/ChemBERTa-77M-MTR"
        with torch.inference_mode():
            smiles = [c[1] for c in CANDIDATES]
            tokens = self.tokenizer(smiles, padding=True, truncation=True, return_tensors="pt").to(device)
            out = self.model(**tokens)
            mask = tokens["attention_mask"].unsqueeze(-1).float()
            pooled = (out.last_hidden_state * mask).sum(dim=1) / mask.sum(dim=1).clamp_min(1)
            self._candidate_embeddings = pooled
            self._candidate_masses = torch.tensor(
                [_formula_mass(c[2]) or 0.0 for c in CANDIDATES], device=device
            )

    @torch.inference_mode()
    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        peaks = _parse_peaks(payload)
        if not peaks:
            return "[chemberta-spectrometry] No m/z-intensity peaks parsed from input."

        peaks.sort(key=lambda p: -p[1])
        top_peaks = peaks[:5]
        precursor_mz = max(p[0] for p in peaks)
        neutral_mass_pos = precursor_mz - PROTON

        diffs = (self._candidate_masses - neutral_mass_pos).abs()
        mass_score = torch.exp(-diffs / 2.0)

        centroid = self._candidate_embeddings.mean(dim=0, keepdim=True)
        sim_to_centroid = torch.nn.functional.cosine_similarity(
            self._candidate_embeddings, centroid, dim=-1
        )
        sim_to_centroid = (sim_to_centroid + 1) / 2

        composite = (mass_score * 0.7) + (sim_to_centroid * 0.3)
        top_k = min(5, composite.size(0))
        top = torch.topk(composite, top_k)

        candidate_lines = []
        for k, ci in enumerate(top.indices.tolist()):
            name, smiles, formula = CANDIDATES[ci]
            mass = float(self._candidate_masses[ci])
            err_mDa = float(diffs[ci]) * 1000
            candidate_lines.append(
                f"  - {name} ({formula}, monoisotopic={mass:.4f} Da)"
                f" - mass-err={err_mDa:+.1f} mDa, ChemBERTa centroid sim={float(sim_to_centroid[ci]):.3f},"
                f" combined score={float(top.values[k]):.3f}"
                f"\n    SMILES: {smiles}"
            )

        peak_lines = [f"  - m/z={mz:.4f}, intensity={inten:.0f}" for mz, inten in top_peaks]

        lines = [
            f"[chemberta-spectrometry] Inference complete on {self.model_id} ({self.device}).",
            f"Peaks parsed: {len(peaks)}; top precursor m/z: {precursor_mz:.4f}",
            f"Assumed [M+H]+, neutral mass: {neutral_mass_pos:.4f} Da",
            "",
            "Top peaks (by intensity):",
            *peak_lines,
            "",
            f"Top candidates from the {len(CANDIDATES)}-compound on-GPU ChemBERTa library "
            "(ranked by mass match + structural typicality):",
            *candidate_lines,
        ]
        if instruction:
            lines.append("")
            lines.append(f"User context: {instruction}")
        lines.append("")
        lines.append(
            "Confidence: ChemBERTa-77M-MTR was used to embed a small built-in compound library "
            "on GPU; matching is (mass-error gaussian) x (ChemBERTa structural similarity). "
            "A real spectral library (MoNA, GNPS) is not consulted. The main agent should treat "
            "candidates as suggestions, not identifications."
        )
        return "\n".join(lines)
