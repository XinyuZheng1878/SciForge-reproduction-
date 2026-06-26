#!/bin/bash
# Launch the SciForge expert-translator FastAPI provider (the six expert models).
# Five run a real transformer on GPU (cuda:1 by default); molecule delegates to ChemLLM-7B
# via vLLM on cuda:0. Location-relative so it runs wherever this provider/ dir is deployed.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

export EXPERT_TRANSLATOR_HOST="${EXPERT_TRANSLATOR_HOST:-127.0.0.1}"
export EXPERT_TRANSLATOR_PORT="${EXPERT_TRANSLATOR_PORT:-8001}"
export EXPERT_DEVICE="${EXPERT_DEVICE:-cuda:1}"
export EXPERT_MODEL_DIR="${EXPERT_MODEL_DIR:-/root/expert-models}"
export EXPERT_PROVIDER_API_KEY="${EXPERT_PROVIDER_API_KEY:?EXPERT_PROVIDER_API_KEY is required for the expert translator provider}"
export TOKENIZERS_PARALLELISM=false

# Python interpreter (override PYTHON for non-default environments).
exec "${PYTHON:-/root/miniconda3/envs/serve/bin/python}" -u server.py
