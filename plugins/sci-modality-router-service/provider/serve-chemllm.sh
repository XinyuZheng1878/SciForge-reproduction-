#!/bin/bash
# Serve ChemLLM-7B-Chat via vLLM (OpenAI-compatible) for the molecule expert.
# Runs on GPU 0 by default; the other five experts run on cuda:1 (see provider/start.sh).
# Override paths/ports via env. Skip this if you do not need the molecule modality.
set -euo pipefail

PYTHON="${PYTHON:-/root/miniconda3/envs/serve/bin/python}"
CHEMLLM_MODEL_DIR="${CHEMLLM_MODEL_DIR:-/root/models/ChemLLM-7B-Chat}"
CHEMLLM_PORT="${CHEMLLM_PORT:-8000}"
CHEMLLM_CHAT_TEMPLATE="${CHEMLLM_CHAT_TEMPLATE:-$(dirname "$(readlink -f "$0")")/internlm2.jinja}"
CHEMLLM_GPU_MEM_UTIL="${CHEMLLM_GPU_MEM_UTIL:-0.45}"
CHEMLLM_API_KEY="${CHEMLLM_API_KEY:?CHEMLLM_API_KEY is required for the ChemLLM vLLM server}"

exec "$PYTHON" -u -m vllm.entrypoints.openai.api_server \
  --model "$CHEMLLM_MODEL_DIR" \
  --served-model-name chemllm \
  --trust-remote-code \
  --chat-template "$CHEMLLM_CHAT_TEMPLATE" \
  --host 127.0.0.1 \
  --port "$CHEMLLM_PORT" \
  --api-key "$CHEMLLM_API_KEY" \
  --gpu-memory-utilization "$CHEMLLM_GPU_MEM_UTIL" \
  --max-model-len 4096 \
  --enforce-eager
