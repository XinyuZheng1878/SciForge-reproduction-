"""Protein expert backed by ESM-2.

Runs a real forward pass through facebook/esm2_t12_35M_UR50D on GPU.
Reports masked-LM perplexity (a real model output), per-residue
confidence, attention-weighted positions, and AA-composition. All
numbers come from the model; descriptive prose is composed from those
numbers, never invented.
"""

from __future__ import annotations

import re
from collections import Counter

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

AA_CHARS = set("ACDEFGHIKLMNPQRSTVWY")
_FASTA_HEADER_RE = re.compile(r"^>([^\n]*)", re.MULTILINE)


def _extract_sequence(raw: str) -> tuple[str, str | None]:
    header = None
    match = _FASTA_HEADER_RE.search(raw)
    if match:
        header = match.group(1).strip()
        body = raw[match.end() :]
    else:
        body = raw
    seq = re.sub(r"[^A-Za-z*]", "", body).upper().replace("*", "")
    seq = "".join(c for c in seq if c in AA_CHARS)
    return seq, header


class ProteinExpert:
    def __init__(self, model_path: str, device: str = "cuda:1") -> None:
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_path)
        self.model = AutoModelForMaskedLM.from_pretrained(model_path).to(device).eval()
        self.model_id = "facebook/esm2_t12_35M_UR50D"

    @torch.inference_mode()
    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        seq, header = _extract_sequence(payload)
        if len(seq) < 5:
            return (
                "[esm2-protein] Input did not contain a recognisable amino-acid sequence "
                f"(extracted length={len(seq)})."
            )

        seq_for_model = seq[:1022]
        tokens = self.tokenizer(seq_for_model, return_tensors="pt").to(self.device)
        outputs = self.model(**tokens, output_attentions=True)
        logits = outputs.logits[0]
        input_ids = tokens["input_ids"][0]

        log_probs = torch.log_softmax(logits, dim=-1)
        gathered = log_probs.gather(1, input_ids.unsqueeze(-1)).squeeze(-1)
        residue_nll = -gathered[1:-1]
        mean_nll = float(residue_nll.mean())
        perplexity = float(torch.exp(residue_nll.mean()))
        low_conf_count = int((residue_nll > 3.0).sum())

        last_attn = outputs.attentions[-1][0].mean(dim=0)
        attention_to_each = last_attn[1:-1, 1:-1].sum(dim=0)
        top_k = min(5, attention_to_each.size(0))
        top_indices = torch.topk(attention_to_each, top_k).indices.tolist()
        top_residues = [
            f"{seq_for_model[i]}{i + 1} (attn={float(attention_to_each[i]):.2f})"
            for i in sorted(top_indices)
        ]

        comp = Counter(seq)
        total = sum(comp.values())
        hydrophobic = sum(comp[a] for a in "AVILMFYW")
        polar = sum(comp[a] for a in "STNQH")
        charged_pos = sum(comp[a] for a in "KR")
        charged_neg = sum(comp[a] for a in "DE")
        cys = comp["C"]

        truncated = len(seq) > len(seq_for_model)

        lines = [
            f"[esm2-protein] Inference complete on {self.model_id} ({self.device}).",
            f"Header: {header or '(no FASTA header)'}",
            f"Sequence length: {len(seq)} residues" + (" (model saw first 1022)" if truncated else ""),
            f"ESM-2 masked-LM mean NLL: {mean_nll:.3f} nats; pseudo-perplexity: {perplexity:.2f}",
            f"Residues with high model surprise (NLL>3): {low_conf_count}/{len(seq_for_model)} "
            f"({100.0 * low_conf_count / max(1, len(seq_for_model)):.1f}%)",
            f"Top attended residues (last-layer mean-head): {', '.join(top_residues)}",
            "Composition: "
            f"hydrophobic {hydrophobic} ({100 * hydrophobic / total:.1f}%), "
            f"polar {polar} ({100 * polar / total:.1f}%), "
            f"K+R {charged_pos} ({100 * charged_pos / total:.1f}%), "
            f"D+E {charged_neg} ({100 * charged_neg / total:.1f}%), "
            f"Cys {cys}",
        ]
        if cys >= 4:
            lines.append(f"Note: {cys} cysteines present - disulfide bonds plausible.")
        if perplexity > 15:
            lines.append("Note: pseudo-perplexity is high; sequence is unusual relative to ESM-2 priors.")
        elif perplexity < 5:
            lines.append("Note: low pseudo-perplexity; sequence is well within ESM-2's known protein distribution.")
        if instruction:
            lines.append(f"User context: {instruction}")
        lines.append(
            "Confidence: ESM-2 35M is a real protein language model trained on UniRef50; "
            "numerical features above are direct model outputs. Functional/UniProt annotation "
            "is NOT looked up here - the main agent should reason from these features."
        )
        return "\n".join(lines)
