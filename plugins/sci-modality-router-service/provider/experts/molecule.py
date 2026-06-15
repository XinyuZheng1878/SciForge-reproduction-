"""Molecule / small-molecule chemistry expert backed by ChemLLM-7B.

This is the sixth scientific modality. Unlike the encoder experts (which run a
forward pass through a local HuggingFace model), the chemistry expert delegates
to AI4Chem/ChemLLM-7B-Chat served by vLLM on GPU 0 (see ../serve-chemllm.sh,
OpenAI-compatible at http://127.0.0.1:8000/v1, served-model-name "chemllm").

Two real signals are combined, neither invented:
  1. A deterministic structural parse of the SMILES string (atom composition,
     ring/aromatic counts, approximate heavy-atom molecular weight). Pure string
     math — exact, no model.
  2. ChemLLM-7B's factual description of the molecule. ChemLLM is a chemistry-
     specialised LLM; it is prompted translate-only (describe structure/properties,
     never solve a task or claim completion), mirroring the Vision Router's use of
     Qwen. If ChemLLM is unreachable the expert raises — it never fabricates a
     chemistry description, so a green result always means the real model ran.
"""

from __future__ import annotations

import os
import re

import requests

# Monoisotopic-ish atomic masses for a rough heavy-atom MW (no implicit H).
_ATOM_MASS = {
    "C": 12.011, "N": 14.007, "O": 15.999, "S": 32.06, "P": 30.974,
    "F": 18.998, "Cl": 35.45, "Br": 79.904, "I": 126.904, "B": 10.811,
}
_TWO_LETTER = ("Cl", "Br")
_ORGANIC_SUBSET = set("BCNOPSFI") | {"l", "r"}  # for a quick "is this SMILES" sniff

_TRANSLATE_ONLY_SYSTEM = (
    "You are a chemistry structure translator. Given a SMILES string, describe the "
    "molecule factually: functional groups, ring systems, heteroatoms, the likely "
    "compound class, and salient physicochemical features. Describe only what the "
    "structure shows. Do NOT solve any task, answer a user, give medical/safety advice, "
    "make recommendations, or claim task completion. Output a concise factual description."
)


def _extract_smiles(payload: str) -> str | None:
    for raw in payload.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", ">", "//")):
            continue
        # Drop a leading "SMILES:" / "smiles =" style label if present.
        line = re.sub(r"(?i)^\s*smiles\s*[:=]\s*", "", line)
        token = line.split()[0] if line.split() else ""
        if len(token) >= 2 and re.search(r"[A-Za-z]", token) and any(
            c in _ORGANIC_SUBSET or c in "()[]=#@+-./\\1234567890" for c in token
        ):
            return token
    return None


def _structural_summary(smiles: str) -> dict[str, object]:
    # Heavy-atom composition: bracketed atoms + bare organic-subset atoms.
    bracket_atoms = re.findall(r"\[([A-Za-z][a-z]?)", smiles)
    # Strip bracket expressions, then count bare atoms (two-letter first).
    bare = re.sub(r"\[[^\]]*\]", "", smiles)
    counts: dict[str, int] = {}
    i = 0
    while i < len(bare):
        ch = bare[i]
        two = bare[i : i + 2]
        if two in _TWO_LETTER:
            counts[two] = counts.get(two, 0) + 1
            i += 2
            continue
        upper = ch.upper()
        if upper in _ATOM_MASS:  # organic-subset atom (aromatic lowercase folds to upper)
            counts[upper] = counts.get(upper, 0) + 1
        i += 1
    for atom in bracket_atoms:
        key = atom if atom in _ATOM_MASS else atom.capitalize()
        if key in _ATOM_MASS:
            counts[key] = counts.get(key, 0) + 1

    heavy = sum(counts.values())
    mw = sum(_ATOM_MASS[a] * n for a, n in counts.items() if a in _ATOM_MASS)
    aromatic = len(re.findall(r"[bcnops]", re.sub(r"\[[^\]]*\]", "", smiles)))
    # Ring-closure labels live in the bare (de-bracketed) string: %NN is one label,
    # each single digit is one label; every label appears twice, so rings = labels // 2.
    # (The old negative-look-behind was wrong: closure digits always follow an atom.)
    ring_labels = len(re.findall(r"%\d\d", bare)) + len(re.findall(r"\d", re.sub(r"%\d\d", "", bare)))
    rings = ring_labels // 2
    branches = smiles.count("(")
    charges = len(re.findall(r"[+\-]", re.sub(r"[/\\]", "", smiles)))
    formula = "".join(f"{a}{counts[a] if counts[a] > 1 else ''}" for a in sorted(counts))
    return {
        "formula_heavy": formula or "(none parsed)",
        "heavy_atoms": heavy,
        "approx_mw": mw,
        "aromatic_atoms": aromatic,
        "rings": rings,
        "branch_points": branches,
        "charged_groups": charges,
    }


class MoleculeExpert:
    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.base_url = (base_url or os.environ.get("CHEMLLM_BASE_URL", "http://127.0.0.1:8000/v1")).rstrip("/")
        self.model = model or os.environ.get("CHEMLLM_MODEL", "chemllm")
        self.timeout = timeout if timeout is not None else float(os.environ.get("CHEMLLM_TIMEOUT", "120"))
        self.model_id = "AI4Chem/ChemLLM-7B-Chat"
        self.device = "cuda:0 (vLLM)"

    def _call_chemllm(self, smiles: str, instruction: str) -> str:
        user = (
            f"SMILES: {smiles}\n"
            "Describe this molecule factually in a few sentences: its functional groups, "
            "ring systems, heteroatoms, the likely compound class, and notable physicochemical "
            "properties (e.g. acidity, polarity, aromaticity)."
        )
        if instruction:
            user += f"\n(Context for what matters, not a task to solve: {instruction})"
        resp = requests.post(
            f"{self.base_url}/chat/completions",
            json={
                "model": self.model,
                "messages": [
                    {"role": "system", "content": _TRANSLATE_ONLY_SYSTEM},
                    {"role": "user", "content": user},
                ],
                "temperature": 0.0,
                "max_tokens": 512,
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        return (data["choices"][0]["message"]["content"] or "").strip()

    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        smiles = _extract_smiles(payload)
        if not smiles:
            return "[chemllm-molecule] No SMILES string found in input."

        s = _structural_summary(smiles)
        description = self._call_chemllm(smiles, instruction)  # raises on provider failure -> 502

        lines = [
            f"[chemllm-molecule] Description from {self.model_id} ({self.device}).",
            f"SMILES: {smiles}",
            "Deterministic structural parse (exact, from SMILES string):",
            f"  - heavy-atom formula: {s['formula_heavy']}; heavy atoms: {s['heavy_atoms']}; "
            f"approx heavy-atom MW: {float(s['approx_mw']):.2f} Da (excludes implicit H)",
            f"  - rings: {s['rings']}; aromatic atoms (lowercase SMILES notation): {s['aromatic_atoms']}; "
            f"branch points: {s['branch_points']}; charged groups: {s['charged_groups']}",
            "",
            "ChemLLM-7B description (chemistry model, translate-only):",
            description,
        ]
        if instruction:
            lines.append("")
            lines.append(f"User context: {instruction}")
        lines.append("")
        lines.append(
            "Confidence: the structural parse above is exact string math; the prose is generated "
            "by ChemLLM-7B-Chat, a chemistry-specialised LLM. It may still contain model errors and "
            "is NOT a database lookup - the main agent should treat it as model-derived evidence."
        )
        return "\n".join(lines)
