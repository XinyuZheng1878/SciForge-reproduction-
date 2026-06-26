"""SciForge expert-translator service.

OpenAI-compatible /v1/chat/completions that dispatches to one of SIX domain
experts — the GPU "model provider" behind the standalone sci-modality-router
service module. Each expert produces text strictly from real model outputs:

  esm2-protein           protein sequence   ESM-2 35M            (HF, cuda:1)
  nt-nucleotide          DNA/RNA sequence   Nucleotide-Tf 50M    (HF, cuda:1)
  scibert-singlecell     scRNA-seq / markers SciBERT             (HF, cuda:1)
  scibert-spatial        spatial omics      SciBERT + KMeans      (HF, cuda:1)
  chemberta-spectrometry MS / spectra       ChemBERTa-77M         (HF, cuda:1)
  chemllm-molecule       SMILES / molecule  ChemLLM-7B-Chat       (vLLM, cuda:0)

The molecule expert delegates to ChemLLM-7B served by vLLM (see serve-chemllm.sh);
the other five run a real HF forward pass on cuda:1. GPU 0 is reserved for ChemLLM.

Bind: 127.0.0.1:8001  (EXPERT_TRANSLATOR_HOST / EXPERT_TRANSLATOR_PORT to override)
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from typing import Any

import torch
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from experts.protein import ProteinExpert
from experts.nucleotide import NucleotideExpert
from experts.singlecell import SingleCellExpert
from experts.spatial import SpatialExpert
from experts.spectrometry import SpectrometryExpert
from experts.molecule import MoleculeExpert

DEVICE = os.environ.get("EXPERT_DEVICE", "cuda:1")
HOST = os.environ.get("EXPERT_TRANSLATOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("EXPERT_TRANSLATOR_PORT", "8001"))
MODEL_DIR = os.environ.get("EXPERT_MODEL_DIR", "/root/expert-models")
EXPERT_PROVIDER_API_KEY = os.environ.get("EXPERT_PROVIDER_API_KEY", "").strip()
MAX_BODY_BYTES = int(os.environ.get("EXPERT_TRANSLATOR_MAX_BODY_BYTES", str(40 * 1024 * 1024)))

if not EXPERT_PROVIDER_API_KEY:
    raise RuntimeError("EXPERT_PROVIDER_API_KEY is required to start the expert-translator provider.")
if MAX_BODY_BYTES <= 0:
    raise RuntimeError("EXPERT_TRANSLATOR_MAX_BODY_BYTES must be positive.")

print(f"[expert-translator] loading encoder experts on {DEVICE} ...", flush=True)
_singlecell_backend = SingleCellExpert(f"{MODEL_DIR}/scibert", device=DEVICE)
EXPERTS: dict[str, Any] = {
    "esm2-protein": ProteinExpert(f"{MODEL_DIR}/esm2-35M", device=DEVICE),
    "nt-nucleotide": NucleotideExpert(f"{MODEL_DIR}/nucleotide-transformer-50M", device=DEVICE),
    "scibert-singlecell": _singlecell_backend,
    "scibert-spatial": SpatialExpert(_singlecell_backend),
    "chemberta-spectrometry": SpectrometryExpert(f"{MODEL_DIR}/chemberta-77M", device=DEVICE),
    # ChemLLM is a remote vLLM call (cuda:0); constructing it loads nothing, so it is always
    # registered. A molecule request fails with 502 if the vLLM server is not up.
    "chemllm-molecule": MoleculeExpert(),
}
print(f"[expert-translator] ready. registered models: {list(EXPERTS)}", flush=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    temperature: float | None = None
    max_tokens: int | None = None


app = FastAPI(title="SciForge Expert Translator", version="2.0.0")


@app.middleware("http")
async def require_runtime_token_and_cap_body(request: Request, call_next):
    if not _has_valid_bearer(request.headers.get("authorization")):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized."})

    raw_content_length = request.headers.get("content-length")
    if raw_content_length:
        try:
            if int(raw_content_length) > MAX_BODY_BYTES:
                return JSONResponse(status_code=413, content={"detail": "Request body is too large."})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length."})

    if request.method in {"POST", "PUT", "PATCH"}:
        body = await request.body()
        if len(body) > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"detail": "Request body is too large."})

    return await call_next(request)


@app.get("/v1/models")
def list_models() -> dict[str, Any]:
    return {
        "object": "list",
        "data": [
            {"id": name, "object": "model", "owned_by": "sciforge-expert"}
            for name in EXPERTS
        ],
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "device": DEVICE,
        "torch_cuda_available": torch.cuda.is_available(),
        "experts": list(EXPERTS),
    }


@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest) -> dict[str, Any]:
    expert = EXPERTS.get(req.model)
    if expert is None:
        raise HTTPException(
            status_code=404,
            detail=f"unknown model {req.model!r}. registered: {list(EXPERTS)}",
        )

    system = next((m.content for m in req.messages if m.role == "system"), "")
    user = next((m.content for m in req.messages if m.role == "user"), "")
    if not user:
        raise HTTPException(status_code=400, detail="missing user message")

    instruction, payload = _split_instruction_and_payload(user)
    started = time.time()
    try:
        text = expert.analyze(payload=payload, instruction=instruction, system=system)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"expert {req.model!r} failed: {exc}") from exc
    elapsed_ms = int((time.time() - started) * 1000)

    device = getattr(expert, "device", DEVICE)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "system_fingerprint": f"expert-translator/{req.model}@{device} {elapsed_ms}ms",
    }


def _split_instruction_and_payload(user_text: str) -> tuple[str, str]:
    """Router wraps payload in '--- <label> input ---' fences. Strip if present."""
    if "--- " in user_text and " input ---" in user_text:
        head, _, rest = user_text.partition("--- ")
        body, _, _tail = rest.partition("--- end ")
        payload_lines = body.split("\n", 1)
        payload = payload_lines[1].rstrip() if len(payload_lines) > 1 else body
        instruction = head.strip()
        if instruction.startswith("User request context:"):
            instruction = instruction.split(":", 1)[1].strip()
        return instruction, payload.strip()
    return "", user_text.strip()


def _has_valid_bearer(value: str | None) -> bool:
    if not value:
        return False
    scheme, _, token = value.partition(" ")
    return scheme.lower() == "bearer" and secrets.compare_digest(token.strip(), EXPERT_PROVIDER_API_KEY)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
