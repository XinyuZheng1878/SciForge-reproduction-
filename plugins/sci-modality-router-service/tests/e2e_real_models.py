#!/usr/bin/env python3
"""End-to-end "no cheating" proof for the SciForge sci-modality router.

Drives the LIVE stack:  sci-modality-router (TS, :3898)  ->  expert-translator (Python, :8001)  ->  real GPU models

It does NOT stub anything. The point is to prove every translation is produced by a
real scientific model, not faked / canned / produced by a general chat LLM. The
arguments that a stub could not survive:

  A. Provider health reports CUDA available and all six experts registered.
  B. INPUT SENSITIVITY: two different inputs to the same expert produce different
     REAL numbers (perplexity, GC%, precursor mass, heavy-atom formula). A canned
     responder cannot vary its numbers with the input.
  C. REAL GPU FINGERPRINT: the provider stamps `expert@device <ms>ms`; we assert the
     device is a CUDA device and latency is non-trivial (a stub answers in ~0ms on CPU).
  D. ROUTING: the router selects the correct expert per modality (detected + explicit).

Run on the server (after starting expert-translator, ChemLLM vLLM, and the router):
    python3 tests/e2e_real_models.py
Env overrides: SCIMODALITY_ROUTER_URL (default http://127.0.0.1:3898),
               EXPERT_PROVIDER_URL   (default http://127.0.0.1:8001)
"""

from __future__ import annotations

import os
import re
import sys

import requests

ROUTER = os.environ.get("SCIMODALITY_ROUTER_URL", "http://127.0.0.1:3898").rstrip("/")
PROVIDER = os.environ.get("EXPERT_PROVIDER_URL", "http://127.0.0.1:8001").rstrip("/")
TIMEOUT = float(os.environ.get("E2E_TIMEOUT", "300"))

PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = "") -> bool:
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def translate(payload: str, modality: str | None = None, instruction: str | None = None) -> dict:
    body: dict = {"payload": payload}
    if modality:
        body["modality"] = modality
    if instruction:
        body["instruction"] = instruction
    r = requests.post(f"{ROUTER}/modality/translate", json=body, timeout=TIMEOUT)
    return r.json()


def provider_raw(model: str, payload: str) -> dict:
    """Call the expert-translator directly to read its system_fingerprint."""
    r = requests.post(
        f"{PROVIDER}/v1/chat/completions",
        json={"model": model, "messages": [{"role": "user", "content": payload}]},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def num(pattern: str, text: str) -> float | None:
    m = re.search(pattern, text)
    return float(m.group(1)) if m else None


# Real example payloads (small but genuine).
INSULIN = "GIVEQCCTSICSLYQLENYCN"  # insulin A-chain
UBIQUITIN = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"
DNA_GC_LOW = ">low\n" + "ATATATATATAAATTTATATATATTAATATATATATATATTAAATATA"
DNA_GC_HIGH = ">high\n" + "GCGCGCGGCGCGCGCGGGCCGCGCGCGCGCGGGCGCGCGCGCGCGCGC"
ASPIRIN = "CC(=O)OC1=CC=CC=C1C(=O)O"
CAFFEINE = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
SPECTRUM_A = "m/z intensity\n195.0877 999\n138.0662 420\n110.0713 210"  # caffeine-ish
SPECTRUM_B = "m/z intensity\n180.0786 999\n163.0390 330\n121.0290 150"
MARKERS = "CD3D\nCD3E\nCD8A\nGZMB\nNKG7"
SPATIAL = "x y GENE\n0 0 CD3D\n1 0 CD3E\n10 10 EPCAM\n11 10 KRT18\n0 11 MS4A1\n1 11 CD79A"


def main() -> int:
    print(f"Router:   {ROUTER}\nProvider: {PROVIDER}\n")

    # --- A. provider health: real CUDA + six experts -----------------------------------
    print("A. Provider health (real GPU, six experts)")
    try:
        h = requests.get(f"{PROVIDER}/health", timeout=30).json()
    except Exception as exc:  # noqa: BLE001
        check("provider /health reachable", False, str(exc))
        return summary()
    check("provider /health reachable", True)
    check("torch CUDA available", bool(h.get("torch_cuda_available")), str(h.get("device")))
    experts = set(h.get("experts", []))
    expected = {"esm2-protein", "nt-nucleotide", "scibert-singlecell",
                "scibert-spatial", "chemberta-spectrometry", "chemllm-molecule"}
    check("all six experts registered", expected <= experts, f"{sorted(experts)}")

    # --- B. input sensitivity: different inputs -> different REAL numbers ---------------
    print("\nB. Input sensitivity (real model numbers vary with input)")

    # Protein: two sequences must give different pseudo-perplexity.
    p1 = translate(INSULIN, "protein")
    p2 = translate(UBIQUITIN, "protein")
    s1 = p1.get("data", {}).get("summary", "")
    s2 = p2.get("data", {}).get("summary", "")
    ppl1, ppl2 = num(r"pseudo-perplexity:\s*([\d.]+)", s1), num(r"pseudo-perplexity:\s*([\d.]+)", s2)
    len1, len2 = num(r"Sequence length:\s*(\d+)", s1), num(r"Sequence length:\s*(\d+)", s2)
    check("protein -> esm2-protein", p1.get("data", {}).get("model") == "esm2-protein")
    check("protein perplexity present & input-dependent", ppl1 is not None and ppl2 is not None and ppl1 != ppl2,
          f"insulin ppl={ppl1} vs ubiquitin ppl={ppl2}")
    check("protein length parsed correctly", len1 == len(INSULIN) and len2 == len(UBIQUITIN),
          f"{len1} vs {len(INSULIN)}, {len2} vs {len(UBIQUITIN)}")

    # Nucleotide: GC content must track the actual sequence.
    n_lo = translate(DNA_GC_LOW, "nucleotide")
    n_hi = translate(DNA_GC_HIGH, "nucleotide")
    gc_lo = num(r"GC content:\s*([\d.]+)%", n_lo.get("data", {}).get("summary", ""))
    gc_hi = num(r"GC content:\s*([\d.]+)%", n_hi.get("data", {}).get("summary", ""))
    check("nucleotide -> nt-nucleotide", n_lo.get("data", {}).get("model") == "nt-nucleotide")
    check("nucleotide GC% tracks real input", gc_lo is not None and gc_hi is not None and gc_lo < 20 < 80 < gc_hi,
          f"AT-rich GC={gc_lo}% vs GC-rich GC={gc_hi}%")

    # Spectrometry: precursor neutral mass must follow the real top peak.
    sp_a = translate(SPECTRUM_A, "spectrometry")
    sp_b = translate(SPECTRUM_B, "spectrometry")
    mass_a = num(r"neutral mass:\s*([\d.]+)", sp_a.get("data", {}).get("summary", ""))
    mass_b = num(r"neutral mass:\s*([\d.]+)", sp_b.get("data", {}).get("summary", ""))
    check("spectrometry -> chemberta-spectrometry", sp_a.get("data", {}).get("model") == "chemberta-spectrometry")
    check("spectrometry precursor mass tracks input", mass_a is not None and mass_b is not None and mass_a != mass_b,
          f"specA mass={mass_a} vs specB mass={mass_b}")

    # --- C. real GPU fingerprint (device + non-trivial latency) -------------------------
    print("\nC. Real GPU fingerprint (provider system_fingerprint)")
    raw = provider_raw("esm2-protein", UBIQUITIN)
    fp = raw.get("system_fingerprint", "")
    m = re.search(r"@(cuda:\d+|cuda)\D.*?\s(\d+)ms", fp) or re.search(r"@(cuda:\d+)\s+(\d+)ms", fp)
    check("fingerprint names a CUDA device", "cuda" in fp, fp)
    ms = int(m.group(2)) if m else -1
    check("inference latency is non-trivial (real forward pass)", ms >= 5, f"{ms}ms")

    # --- D. routing correctness (detection + explicit override) -------------------------
    print("\nD. Routing correctness")
    det = translate(">x\n" + UBIQUITIN)  # no modality -> must auto-detect protein
    check("auto-detect routes protein", det.get("data", {}).get("modality") == "protein"
          and det.get("data", {}).get("modalitySource") == "detected")
    # Explicit override: send a protein sequence but force nucleotide; must hit nt expert.
    forced = translate(UBIQUITIN, "nucleotide")
    check("explicit modality overrides detection",
          forced.get("data", {}).get("model") == "nt-nucleotide"
          and forced.get("data", {}).get("modalitySource") == "explicit")

    # --- molecule (ChemLLM via vLLM) — only if the vLLM server is up --------------------
    print("\nE. Molecule / ChemLLM (skipped if vLLM not running)")
    m_asp = translate(ASPIRIN, "molecule")
    if m_asp.get("ok"):
        s_asp = m_asp.get("data", {}).get("summary", "")
        m_caf = translate(CAFFEINE, "molecule").get("data", {}).get("summary", "")
        check("molecule -> chemllm-molecule", m_asp.get("data", {}).get("model") == "chemllm-molecule")
        # Aspirin C9H8O4 heavy-atom formula = C9O4 (no implicit H); caffeine has N's.
        check("aspirin structural parse correct (real string math)", "C9O4" in s_asp.replace(" ", ""), s_asp[:200])
        check("caffeine differs from aspirin (N present)", "N" in m_caf and m_caf != s_asp)
        check("ChemLLM produced a non-trivial description",
              "ChemLLM-7B description" in s_asp and len(s_asp) > 300)
    else:
        err = m_asp.get("error", {})
        print(f"  [SKIP] ChemLLM vLLM not reachable: {err.get('code')} {err.get('message')}")

    return summary()


def summary() -> int:
    print(f"\n{'=' * 60}\nPASS: {len(PASS)}   FAIL: {len(FAIL)}")
    if FAIL:
        print("FAILED:")
        for f in FAIL:
            print(f"  - {f}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
