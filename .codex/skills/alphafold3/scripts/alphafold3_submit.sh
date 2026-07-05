#!/bin/bash
set -euo pipefail

# ============================================================
# AlphaFold3 C550 Inference Platform — Submit & Monitor Script
# ============================================================
#
# Usage:
#   bash alphafold3_submit.sh --input-dir /data/input/my_batch [--output-dir ./results]
#
# Credentials are read from the .env file alongside this script.
#
# Options:
#   --input-dir   PATH   Required. Shared PVC path with input JSON files.
#   --output-dir  PATH   Optional. If set, copies results from the pod to this
#                        local directory after the task completes.
#   --model-dir   PATH   Model weights directory (default: /opt/weights).
#   --max-wait    N      Max poll iterations, each 60s (default: 90 = 1.5h).
#   --help               Show this help.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source .env from skill directory
if [[ -f "$SKILL_DIR/.env" ]]; then
    set -a; source "$SKILL_DIR/.env"; set +a
else
    echo "Warning: $SKILL_DIR/.env not found. Set ALPHAFOLD3_PASSWORD manually."
fi

API_AUTH="http://10.12.111.135:10008/api/v1/auth/login"
API_TASKS="http://10.12.111.135:10010/v1/scimodel/tasks"
K8S="kubectl --kubeconfig=${HOME}/code/ai_lab/kubeconfig_dir/config-vc-c550-ai4s-sys -n studio-ams"
K8S_POD="deploy/alphafold3-1"

INPUT_DIR=""
OUTPUT_DIR=""
MODEL_DIR="/opt/weights"
MAX_WAIT=90

usage() {
    sed -n '2,21p' "$0"
    exit 0
}

# ---- argument parsing ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --input-dir)   INPUT_DIR="$2";   shift 2 ;;
        --output-dir)  OUTPUT_DIR="$2";  shift 2 ;;
        --model-dir)   MODEL_DIR="$2";   shift 2 ;;
        --max-wait)    MAX_WAIT="$2";    shift 2 ;;
        --help)        usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

if [[ -z "$INPUT_DIR" ]]; then
    echo "Error: --input-dir is required."
    usage
fi

if [[ -z "${ALPHAFOLD3_PASSWORD:-}" ]]; then
    echo "Error: ALPHAFOLD3_PASSWORD is not set. Add it to $SKILL_DIR/.env"
    exit 1
fi

# ---- helpers ----
get_token() {
    curl -s -X POST "$API_AUTH" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"ai4s-discovery\",\"password\":\"${ALPHAFOLD3_PASSWORD}\"}" \
        | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])"
}

# ---- auth ----
echo "=== Authenticating ==="
TOKEN=$(get_token)
echo "Token obtained."

# ---- submit ----
echo "=== Submitting fold task ==="
echo "  input_dir: $INPUT_DIR"
echo "  model_dir: $MODEL_DIR"

TASK_RESP=$(curl -s -X POST "$API_TASKS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-original-model: alphafold3" \
    -H "Content-Type: application/json" \
    -d "{\"task_type\":\"fold\",\"inputs\":{\"input_dir\":\"${INPUT_DIR}\",\"model_dir\":\"${MODEL_DIR}\"}}")

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
echo "Task ID: $TASK_ID"

# ---- poll ----
echo "=== Polling status (every 60s, max ${MAX_WAIT} iterations) ==="
for i in $(seq 1 "$MAX_WAIT"); do
    # Refresh token every 10 polls
    if (( i % 10 == 1 && i > 1 )); then
        TOKEN=$(get_token)
    fi

    STATUS_RESP=$(curl -s "${API_TASKS}/${TASK_ID}" \
        -H "Authorization: Bearer $TOKEN" \
        -H "x-original-model: alphafold3")

    STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','?'))")
    echo "[$i] $STATUS"

    if [[ "$STATUS" == "completed" ]]; then
        echo ""
        echo "=== Task completed successfully ==="
        break
    elif [[ "$STATUS" == "failed" ]]; then
        echo ""
        echo "=== Task FAILED ==="
        echo "Full response: $STATUS_RESP"
        exit 1
    fi

    sleep 60
done

# ---- collect results ----
if [[ -n "$OUTPUT_DIR" ]]; then
    echo "=== Collecting results ==="
    RESULT_REMOTE="/tmp/model_server/alphafold3_${TASK_ID}/outputs/"
    RESULT_STAGING="/data/results/alphafold3_${TASK_ID}"

    # Move results from ephemeral /tmp to shared PVC
    $K8S exec "$K8S_POD" -- cp -r "$RESULT_REMOTE" "$RESULT_STAGING"
    echo "Results moved to pod PVC: $RESULT_STAGING"

    # Copy from pod to local
    mkdir -p "$OUTPUT_DIR"
    $K8S cp "${K8S_POD}:${RESULT_STAGING}" "$OUTPUT_DIR"
    echo "Results copied to: $OUTPUT_DIR"

    # List output files
    echo ""
    echo "=== Output files ==="
    find "$OUTPUT_DIR" -type f | head -50
fi

echo ""
echo "Done. Task ID: $TASK_ID"
