# SciForge Sci-Modality Router Service

A **standalone, pluggable** SciForge service module — the scientific-data sibling of the
[Vision Router](../vision-router-service/), and a peer plugin module beside it. It translates a
**non-text scientific input** (protein/DNA sequence, small molecule, single-cell or spatial
expression matrix, mass spectrum) into **natural-language evidence** using real expert models on
GPU, so a text-only main agent (DeepSeek V4) can "see" the data.

- **Translate-only.** Each expert reports what its model measured (sequence stats, model
  scores, salient features, uncertainty). It never reasons, answers the user, gives advice,
  draws conclusions, or claims task completion. Reasoning stays with the main agent.
- **Real models, no cheating.** Every translation is produced by a real forward pass through
  a domain model (ESM-2, Nucleotide Transformer, ChemLLM, SciBERT, ChemBERTa). The prose is
  composed strictly from real numeric outputs — never invented. The provider stamps a
  `system_fingerprint` (`expert@device <ms>ms`) on every response.
- **Independent.** No dependency on the SciForge main repo. Zero runtime npm dependencies
  (Node 20+ `node:http` + `fetch`).
- **Template-conformant.** Returns the `ServiceResult` envelope from
  [`../Servic_Module_Template.md`](../Servic_Module_Template.md). Per the template's placement
  rules this is an **HTTP service** (a stable transform invoked by the host during input
  pre-extraction), not an Agent-chosen MCP tool.

## Architecture (Model Router owned)

```
GUI/Kun/Codex input_object ref  ──>  Model Router  ──HTTP──>  sci-modality-router-service (this, TS)  ──OpenAI-compat──>  provider/ (Python, GPU)
       workspace file ref              gating + fallback       ServiceResult contract + retry                  six real expert models
```

- **This service** owns the `ServiceResult` contract, modality detection, and robustness.
  It is the analogue of `vision-router-service` (which calls Qwen).
- **Model Router** is the only in-repo caller. Runtimes pass structured workspace file refs; they
  do not read `SCIFORGE_SCIMODALITY_SERVICE_URL` or call this service directly.
- **`provider/`** is the GPU "model provider" — the `expert-translator` FastAPI app (port 8001),
  analogue of the Qwen endpoint. It runs on the GPU server; each of the six modalities maps to
  one registered expert model. The molecule expert delegates to ChemLLM-7B served by vLLM.

## The six modalities

| Modality | Expert id | Real model |
|---|---|---|
| `protein` | `esm2-protein` | facebook/esm2_t12_35M_UR50D |
| `nucleotide` | `nt-nucleotide` | InstaDeepAI/nucleotide-transformer-v2-50m |
| `molecule` | `chemllm-molecule` | AI4Chem/ChemLLM-7B-Chat (vLLM) |
| `single_cell` | `scibert-singlecell` | allenai/scibert_scivocab_uncased |
| `spatial` | `scibert-spatial` | allenai/scibert_scivocab_uncased (spatial backend) |
| `spectrometry` | `chemberta-spectrometry` | DeepChem/ChemBERTa-77M-MTR |

## Run

```bash
# 1) Provider (on the GPU server): the six expert models
cd provider && bash start.sh           # FastAPI on :8001 (cuda:1); ChemLLM via vLLM on :8000 (cuda:0)

# 2) This module (calls the provider)
npm install
cp .env.example .env                    # fill provider/router runtime tokens
npm start                               # http://127.0.0.1:3898
```

When SciForge runs on a different machine than the GPU server, expose the provider/module over a
stable SSH port-forward (preferred over public tunnels):
`ssh -p 2222 -N -L 3898:127.0.0.1:3898 <gpu-server>` and point the host at `http://127.0.0.1:3898`.

## API

```
GET  /health   -> { ok, service, checkedAt }
GET  /version  -> { service, version, provider, modalities }
POST /modality/translate
```

All routes require `Authorization: Bearer $SCIMODALITY_ROUTER_RUNTIME_TOKEN`.
The GPU provider behind this router requires `EXPERT_PROVIDER_API_KEY`; the
molecule vLLM helper also requires `CHEMLLM_API_KEY` when enabled.

`POST /modality/translate` request:

```jsonc
{
  "payload": "MKTAYIAKQR...",        // raw scientific text (FASTA / SMILES / matrix / peak list)
  "modality": "protein",             // optional — omit to auto-detect from payload
  "instruction": "what is this?",    // optional context (NOT a task to solve)
  "objectId": "upload-123",          // optional, echoed into provenance
  "requestId": "optional"
}
```

Response — `ServiceResult<ModalityTranslation>`:

```jsonc
{
  "ok": true,
  "summary": "[esm2-protein] mean NLL 2.13; pseudo-perplexity 8.4; …",   // bounded preview
  "data": {
    "summary": "…full multi-line evidence from the model…",
    "modality": "protein",
    "model": "esm2-protein",
    "modalitySource": "detected"
  },
  "provenance": { "serviceId": "sciforge.sci-modality-router", "operation": "modality_translate", "requestId": "…" }
}
```

Failures return `{ ok: false, error: { code, message, retryable }, provenance }` with codes
`INVALID_ARGUMENT` / `UNAUTHENTICATED` / `NOT_FOUND` / `RATE_LIMITED` / `TIMEOUT` / `UNAVAILABLE` / `INTERNAL_ERROR`.

## Robustness (lives here, not in the caller)

The main agent cannot read these modalities, so a raw-payload fallback is useless — this
service is the authority on "keep trying until the expert answers". Each call retries transient
failures (timeout / 5xx / 429 / network) with exponential backoff; only auth (401/403) and an
unregistered-expert (404) stop it early, plus a caller disconnect. The HTTP caller (SciForge)
therefore stays a thin one-shot POST. Tunables (env):

| Var | Default | Meaning |
|---|---|---|
| `EXPERT_PROVIDER_TIMEOUT_MS` | `180000` | Per-attempt timeout (GPU can be slow). |
| `EXPERT_PROVIDER_MAX_ATTEMPTS` | `6` | Total attempts before giving up. |
| `EXPERT_PROVIDER_RETRY_BASE_MS` | `1500` | Exponential backoff base (capped at 15s). |

## How SciForge uses it

Model Router consumes this module during input routing:

- GUI copies explicit scientific uploads into the workspace under `.sciforge/uploads/` and passes a
  structured `input_object` ref through the runtime.
- Model Router gates refs by explicit scientific extensions such as `.fasta`, `.smi`, `.mol`,
  `.sdf`, `.mgf`, `.pdb`, `.cif`, `.vcf`, `.bed`, and `.seq`. Generic `.txt`, `.csv`, and `.tsv`
  are not auto-routed to this service.
- When `SCIFORGE_SCIMODALITY_SERVICE_URL` and `SCIFORGE_SCIMODALITY_SERVICE_TOKEN` are set in the
  Model Router environment, Model Router reads the workspace file text, POSTs it here
  (`/modality/translate`), and injects the returned evidence into the text reasoner. When unset or
  unavailable, Model Router falls back to readable raw text where safe.

## Test

```bash
npm test            # stubbed provider, no network, no GPU (TS module)
npm run typecheck

# the SciForge-dev hook unit test:
cd ../SciForge-dev && npm run smoke:scimodality-preextract
```

The real-model end-to-end proof (no cheating) lives in [`tests/e2e_real_models.py`](tests/e2e_real_models.py) —
it drives this service against the live GPU provider and asserts real model fingerprints and that
distinct inputs yield distinct real outputs (18/18).
