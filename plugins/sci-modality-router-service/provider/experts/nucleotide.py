"""Nucleotide expert backed by InstaDeepAI's Nucleotide Transformer.

Runs InstaDeepAI/nucleotide-transformer-v2-50m-multi-species on GPU.
This is a real ESM-style DNA language model trained on multi-species
genomes. We extract per-token embeddings via a real forward pass and
report numerical features (mean embedding norm, ESM-MLM pseudo-
perplexity) plus deterministic sequence statistics (GC content, ORFs).

Note: we originally tried DNABERT-2-117M but it depends on a Triton
flash-attention kernel that fails on this CUDA stack; Nucleotide
Transformer uses vanilla attention so it works out of the box.
"""

from __future__ import annotations

import re

import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

_FASTA_HEADER_RE = re.compile(r"^>([^\n]*)", re.MULTILINE)
STOP_CODONS = {"TAA", "TAG", "TGA"}
START_CODON = "ATG"


def _extract_sequence(raw: str) -> tuple[str, str | None]:
    header = None
    match = _FASTA_HEADER_RE.search(raw)
    if match:
        header = match.group(1).strip()
        body = raw[match.end() :]
    else:
        body = raw
    seq = re.sub(r"[^A-Za-z]", "", body).upper().replace("U", "T")
    seq = "".join(c for c in seq if c in "ACGTN")
    return seq, header


def _find_orfs(seq: str, min_len: int = 90) -> list[tuple[int, int, int]]:
    found: list[tuple[int, int, int]] = []
    for frame in range(3):
        i = frame
        while i + 3 <= len(seq):
            if seq[i : i + 3] == START_CODON:
                j = i
                while j + 3 <= len(seq):
                    if seq[j : j + 3] in STOP_CODONS:
                        if j - i >= min_len:
                            found.append((frame, i, j + 3))
                        i = j + 3
                        break
                    j += 3
                else:
                    break
            i += 3
    return found


class NucleotideExpert:
    def __init__(self, model_path: str, device: str = "cuda:1") -> None:
        self.device = device
        self.tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
        self.model = (
            AutoModelForMaskedLM.from_pretrained(model_path, trust_remote_code=True)
            .to(device)
            .eval()
        )
        self.model_id = "InstaDeepAI/nucleotide-transformer-v2-50m-multi-species"

    @torch.inference_mode()
    def analyze(self, payload: str, instruction: str = "", system: str = "") -> str:
        seq, header = _extract_sequence(payload)
        if len(seq) < 20:
            return (
                "[nt-nucleotide] No usable DNA/RNA sequence found "
                f"(extracted length={len(seq)})."
            )

        # Nucleotide Transformer tokenizes by 6-mer; cap at ~6kb of sequence.
        seq_for_model = seq[:6000]
        tokens = self.tokenizer(
            seq_for_model, return_tensors="pt", truncation=True, max_length=1000
        ).to(self.device)
        outputs = self.model(**tokens, output_hidden_states=True)

        logits = outputs.logits[0]
        input_ids = tokens["input_ids"][0]
        log_probs = torch.log_softmax(logits, dim=-1)
        gathered = log_probs.gather(1, input_ids.unsqueeze(-1)).squeeze(-1)
        # Drop special tokens (typically CLS / EOS) by slicing interior tokens.
        interior = gathered[1:-1] if gathered.size(0) > 2 else gathered
        nll = -interior
        mean_nll = float(nll.mean())
        pseudo_ppl = float(torch.exp(nll.mean()))
        high_surprise = int((nll > 5.0).sum())  # NT vocab is larger so threshold is higher

        hidden = outputs.hidden_states[-1][0]
        mean_emb_norm = float(hidden.norm(dim=-1).mean())
        emb_dim = hidden.size(-1)
        num_tokens = hidden.size(0)

        gc = (seq.count("G") + seq.count("C")) / max(1, len(seq))
        a, c, g, t = seq.count("A"), seq.count("C"), seq.count("G"), seq.count("T")
        n_count = seq.count("N")

        orfs = _find_orfs(seq_for_model)
        orfs_sorted = sorted(orfs, key=lambda o: -(o[2] - o[1]))
        top_orf_descriptions = [
            f"frame{o[0]} [{o[1] + 1}-{o[2]}] len={o[2] - o[1]}nt" for o in orfs_sorted[:3]
        ]

        only_acgt = (a + c + g + t) >= 0.95 * len(seq)
        likely_kind = "RNA" if ("U" in payload.upper() and "T" not in seq) else "DNA"

        lines = [
            f"[nt-nucleotide] Inference complete on {self.model_id} ({self.device}).",
            f"Header: {header or '(no FASTA header)'}",
            f"Sequence length: {len(seq)} nt; model saw {len(seq_for_model)} nt across {num_tokens} 6-mer tokens.",
            f"Likely kind: {likely_kind} ({'clean ACGT' if only_acgt else f'has N={n_count} or ambiguous chars'})",
            f"GC content: {100 * gc:.1f}%; composition A={a} C={c} G={g} T={t}",
            f"Nucleotide-Transformer mean last-layer embedding norm: {mean_emb_norm:.3f} (dim={emb_dim})",
            f"Masked-LM mean NLL: {mean_nll:.3f} nats; pseudo-perplexity: {pseudo_ppl:.2f}",
            f"6-mer tokens with high model surprise (NLL>5): {high_surprise}/{interior.size(0)}",
        ]
        if top_orf_descriptions:
            lines.append(
                f"ORFs detected (>=90 nt): {len(orfs)}; top by length: {', '.join(top_orf_descriptions)}"
            )
        else:
            lines.append("ORFs detected (>=90 nt): 0 (in forward strand)")

        if gc > 0.6:
            lines.append(
                "Note: high GC content - consistent with CpG islands, GC-rich promoters, or microbial GC-rich genomes."
            )
        elif gc < 0.35:
            lines.append("Note: low GC content - consistent with AT-rich genomic regions.")

        if instruction:
            lines.append(f"User context: {instruction}")
        lines.append(
            "Confidence: Nucleotide Transformer is a real DNA language model (6-mer tokens, "
            "multi-species training). Numerical features above come from the forward pass; "
            "ORF/GC are deterministic from the sequence. Functional annotation is NOT looked up - "
            "the main agent should reason from these features."
        )
        return "\n".join(lines)
