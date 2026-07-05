#!/bin/bash
set -euo pipefail

# ============================================================
# AlphaFold3 C550 Inference Platform — Submit & Monitor Script
# ============================================================
#
# Four modes:
#   Mode A — Submit from a local AlphaFold3 JSON file:
#     bash alphafold3_submit.sh --json ./input.json [--output-dir ./results]
#
#   Mode B — Auto-generate JSON from a protein sequence:
#     bash alphafold3_submit.sh --sequence "MQIFVK..." --name "MyFold"
#
#   Mode C — Submit a pre-staged PVC input directory:
#     bash alphafold3_submit.sh --input-dir /data/input/my_batch --no-wait
#
#   Mode D — Submit a single pre-staged PVC JSON file:
#     bash alphafold3_submit.sh --remote-json /data/input/my_batch/input.json --no-wait
#
# Credentials are read from the .env file alongside this script.
#
# Options:
#   --json        PATH   Submit a local AlphaFold3 JSON file.
#   --json-input  PATH   Alias for --json.
#   --sequence    TEXT   Protein sequence (auto-generates proper AF3 JSON).
#   --input-dir   PATH   Submit a PVC directory already containing AF3 JSON files.
#   --remote-json PATH   Submit a single JSON file already present on the PVC.
#   --json-path   PATH   Alias for --remote-json.
#   --name        TEXT   Task name (required with --sequence, default: "Fold").
#   --output-dir  PATH   Local directory for downloaded .cif results.
#   --model-dir   PATH   Model weights directory (default: /opt/weights).
#   --kubeconfig  PATH   Optional kubeconfig path for kubectl upload/download.
#   --max-wait    N      Max poll iterations, each 60s (default: 90 = 1.5h).
#   --no-wait            Submit and return immediately; don't poll/download.
#   --help               Show this help.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- sourcing .env ----
if [[ -f "$SKILL_DIR/.env" ]]; then
    set -a; source "$SKILL_DIR/.env"; set +a
else
    echo "Warning: $SKILL_DIR/.env not found. Set ALPHAFOLD3_PASSWORD manually."
fi

API_AUTH="http://10.12.111.135:10008/api/v1/auth/login"
API_TASKS="http://10.12.111.135:10010/v1/scimodel/tasks"
K8S_NS="studio-ams"
OUTPUT_BASE="/data/scimodel/muxi_alphafold3_server/alphafold3/output"

JSON_FILE=""
SEQUENCE=""
TASK_NAME="Fold"
OUTPUT_DIR=""
MODEL_DIR="/opt/weights"
MAX_WAIT=90
NO_WAIT=false
INPUT_DIR=""
REMOTE_JSON=""
KUBECONFIG_PATH=""

usage() {
    sed -n '2,34p' "$0"
    exit 0
}

# ---- argument parsing ----
while [[ $# -gt 0 ]]; do
    case "$1" in
        --json|--json-input) JSON_FILE="$2"; shift 2 ;;
        --sequence)    SEQUENCE="$2";    shift 2 ;;
        --input-dir)   INPUT_DIR="$2";   shift 2 ;;
        --remote-json|--json-path) REMOTE_JSON="$2"; shift 2 ;;
        --name)        TASK_NAME="$2";   shift 2 ;;
        --output-dir)  OUTPUT_DIR="$2";  shift 2 ;;
        --model-dir)   MODEL_DIR="$2";   shift 2 ;;
        --kubeconfig)  KUBECONFIG_PATH="$2"; shift 2 ;;
        --max-wait)    MAX_WAIT="$2";    shift 2 ;;
        --no-wait)     NO_WAIT=true;     shift ;;
        --help)        usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

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

kubectl_cmd() {
    if [[ -n "$KUBECONFIG_PATH" ]]; then
        kubectl --kubeconfig "$KUBECONFIG_PATH" "$@"
    else
        kubectl "$@"
    fi
}

get_pod_name() {
    local output
    if ! output=$(kubectl_cmd -n "$K8S_NS" get pods -l app=alphafold3 \
        -o jsonpath='{.items[0].metadata.name}' 2>&1); then
        echo "Error: failed to query alphafold3 pod in namespace $K8S_NS." >&2
        echo "$output" >&2
        return 1
    fi
    printf '%s' "$output"
}

make_tmp_json() {
    local tmp_root="${TMPDIR:-/tmp}"
    tmp_root="${tmp_root%/}"
    mktemp "$tmp_root/alphafold3_input_XXXXXX"
}

# ---- use a single pre-staged PVC JSON file (Mode D) ----
if [[ -n "$REMOTE_JSON" ]]; then
    if [[ "$REMOTE_JSON" != /* ]]; then
        echo "Error: --remote-json must be an absolute PVC path such as /data/input/my_batch/input.json"
        exit 1
    fi
    if [[ "${REMOTE_JSON##*.}" != "json" ]]; then
        echo "Error: --remote-json must point to a .json file."
        exit 1
    fi
    echo "=== Using pre-staged remote input_json ==="
    echo "  $REMOTE_JSON"

# ---- use pre-staged PVC input directory (Mode C) ----
elif [[ -n "$INPUT_DIR" ]]; then
    if [[ "$INPUT_DIR" != /* ]]; then
        echo "Error: --input-dir must be an absolute PVC path such as /data/input/my_batch"
        exit 1
    fi
    echo "=== Using pre-staged input_dir ==="
    echo "  $INPUT_DIR"

# ---- generate JSON from sequence (Mode B) ----
elif [[ -n "$SEQUENCE" ]]; then
    # Sanitize task name for filesystem
    SAFE_NAME=$(echo "$TASK_NAME" | tr ' ' '_' | tr -cd '[:alnum:]_-')
    INPUT_DIR="/data/input/${SAFE_NAME}_$(date +%s)"
    
    JSON_FILE=$(make_tmp_json)
    python3 -c "
import json, sys
seq = '''$SEQUENCE'''.strip()
doc = {
    'name': '$SAFE_NAME',
    'dialect': 'alphafold3',
    'version': 1,
    'modelSeeds': [1],
    'sequences': [{
        'protein': {
            'id': 'A',
            'sequence': seq,
            'unpairedMsa': '',
            'pairedMsa': '',
            'templates': []
        }
    }]
}
with open('$JSON_FILE', 'w') as f:
    json.dump(doc, f, indent=2)
print(f'Generated AF3 JSON ({len(seq)} aa) → $JSON_FILE')
" 2>&1

    echo "=== Uploading to $INPUT_DIR ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: No alphafold3 pod found."
        exit 1
    fi
    kubectl_cmd -n "$K8S_NS" exec "$POD" -- mkdir -p "$INPUT_DIR"
    kubectl_cmd -n "$K8S_NS" cp "$JSON_FILE" "${POD}:${INPUT_DIR}/$(basename "$JSON_FILE").json"
    echo "Upload done."
    rm -f "$JSON_FILE"

elif [[ -n "$JSON_FILE" ]]; then
    # Mode A: upload local JSON
    if [[ ! -f "$JSON_FILE" ]]; then
        echo "Error: JSON file not found: $JSON_FILE"
        exit 1
    fi
    
    # Validate JSON
    if ! python3 -c "import json; json.load(open('$JSON_FILE'))" 2>/dev/null; then
        echo "Error: Invalid JSON in $JSON_FILE"
        exit 1
    fi
    
    # Extract name for input_dir
    BASE=$(basename "$JSON_FILE" .json)
    SAFE_NAME=$(echo "$BASE" | tr ' ' '_' | tr -cd '[:alnum:]_-')
    INPUT_DIR="/data/input/${SAFE_NAME}_$(date +%s)"
    
    echo "=== Uploading to $INPUT_DIR ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: No alphafold3 pod found."
        exit 1
    fi
    kubectl_cmd -n "$K8S_NS" exec "$POD" -- mkdir -p "$INPUT_DIR"
    kubectl_cmd -n "$K8S_NS" cp "$JSON_FILE" "${POD}:${INPUT_DIR}/$(basename "$JSON_FILE")"
    echo "Upload done."
else
    echo "Error: Provide --json <file>, --sequence <seq>, --input-dir <pvc-dir>, or --remote-json <pvc-json>."
    usage
fi

# ---- auth ----
echo "=== Authenticating ==="
TOKEN=$(get_token)
echo "Token obtained."

# ---- submit ----
echo "=== Submitting fold task ==="
echo "  model_dir: $MODEL_DIR"

if [[ -n "$REMOTE_JSON" ]]; then
    echo "  input_json: $REMOTE_JSON"
    TASK_PAYLOAD=$(python3 -c "import json; print(json.dumps({'task_type':'fold','inputs':{'input_json':'$REMOTE_JSON','model_dir':'$MODEL_DIR'}}))")
else
    echo "  input_dir: $INPUT_DIR"
    TASK_PAYLOAD=$(python3 -c "import json; print(json.dumps({'task_type':'fold','inputs':{'input_dir':'$INPUT_DIR','model_dir':'$MODEL_DIR'}}))")
fi

TASK_RESP=$(curl -s -X POST "$API_TASKS" \
    -H "Authorization: Bearer $TOKEN" \
    -H "x-original-model: alphafold3" \
    -H "Content-Type: application/json" \
    -d "$TASK_PAYLOAD")

TASK_ID=$(echo "$TASK_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
echo "Task ID: $TASK_ID"

# ---- no-wait early exit ----
if $NO_WAIT; then
    echo ""
    echo "Task submitted. Poll manually with:"
    echo "  curl -s \"${API_TASKS}/${TASK_ID}\" -H 'Authorization: Bearer ...' -H 'x-original-model: alphafold3'"
    echo ""
    echo "To download results later:"
    echo "  POD=\$(kubectl -n $K8S_NS get pods -l app=alphafold3 -o jsonpath='{.items[0].metadata.name}')"
    echo "  kubectl -n $K8S_NS cp \$POD:${OUTPUT_BASE}/${TASK_ID}.cif ./${TASK_ID}.cif"
    exit 0
fi

# ---- poll ----
echo "=== Polling status (every 60s, max ${MAX_WAIT} iterations) ==="
STATUS_RESP=""
for i in $(seq 1 "$MAX_WAIT"); do
    # Refresh token every 10 polls (~10 min)
    if (( i % 10 == 1 && i > 1 )); then
        echo "  Refreshing token..."
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
        ERROR=$(echo "$STATUS_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "unknown")
        echo "Error: $ERROR"
        echo ""
        # Helpful diagnostics
        if echo "$ERROR" | grep -qi "missing.*MSA\|unpaired.*MSA"; then
            echo "💡 This C550 AF3 server requires 'unpairedMsa' and 'pairedMsa' fields in the protein block."
            echo "   They can be empty strings if you want the server to compute MSA automatically:"
            echo ""
            echo '   "protein": {'
            echo '     "id": "A",'
            echo '     "sequence": "...",'
            echo '     "unpairedMsa": "",'
            echo '     "pairedMsa": "",'
            echo '     "templates": []'
            echo '   }'
            echo ""
            echo "   Or use --sequence to auto-generate the correct format."
        fi
        exit 1
    fi

    sleep 60
done

# ---- download results ----
if [[ -n "$OUTPUT_DIR" ]]; then
    echo "=== Downloading results ==="
    POD=$(get_pod_name)
    if [[ -z "$POD" ]]; then
        echo "Error: Could not find running alphafold3 pod."
        echo "Check with: kubectl -n $K8S_NS get pods -l app=alphafold3"
        exit 1
    fi
    echo "  Pod: $POD"

    mkdir -p "$OUTPUT_DIR"
    STATUS_OUTPUT_PATH=$(echo "$STATUS_RESP" | python3 -c "
import json, sys
try:
    resp = json.load(sys.stdin)
except Exception:
    print('')
    raise SystemExit
outputs = resp.get('outputs') or {}
paths = []
if isinstance(outputs, dict):
    for key in ('output_path', 'cif', 'cif_path', 'file', 'path'):
        value = outputs.get(key)
        if isinstance(value, str) and value.endswith('.cif'):
            paths.append(value)
for key in ('output_path', 'cif_path'):
    value = resp.get(key)
    if isinstance(value, str) and value.endswith('.cif'):
        paths.append(value)
print(paths[0] if paths else '')
" 2>/dev/null || true)

    CANDIDATE_REMOTE_FILES=()
    if [[ -n "$STATUS_OUTPUT_PATH" ]]; then
        CANDIDATE_REMOTE_FILES+=("$STATUS_OUTPUT_PATH")
    fi
    CANDIDATE_REMOTE_FILES+=("${OUTPUT_BASE}/${TASK_ID}.cif" "/output/${TASK_ID}.cif")

    REMOTE_FILE=""
    for CANDIDATE in "${CANDIDATE_REMOTE_FILES[@]}"; do
        if kubectl_cmd -n "$K8S_NS" exec "$POD" -- test -f "$CANDIDATE" 2>/dev/null; then
            REMOTE_FILE="$CANDIDATE"
            break
        fi
    done

    if [[ -z "$REMOTE_FILE" ]]; then
        echo "  Warning: no CIF found at task-reported or fallback paths. Listing available outputs..."
        kubectl_cmd -n "$K8S_NS" exec "$POD" -- ls "$OUTPUT_BASE/" 2>/dev/null | grep -i "$TASK_ID" || true
        kubectl_cmd -n "$K8S_NS" exec "$POD" -- ls "/output/" 2>/dev/null | grep -i "$TASK_ID" || true
        exit 1
    fi

    LOCAL_FILE="${OUTPUT_DIR}/${TASK_ID}.cif"
    echo "  Remote file: $REMOTE_FILE"
    kubectl_cmd -n "$K8S_NS" cp "${POD}:${REMOTE_FILE}" "$LOCAL_FILE" 2>/dev/null

    FILE_SIZE=$(ls -lh "$LOCAL_FILE" 2>/dev/null | awk '{print $5}' || echo "?")
    echo "  Downloaded: $LOCAL_FILE ($FILE_SIZE)"

    # Show preview
    echo ""
    echo "=== Structure Preview ==="
    head -40 "$LOCAL_FILE"
    echo "  ... (use PyMOL/ChimeraX to view full structure)"
    echo ""
    echo "=== Summary ==="
    python3 -c "
import sys
with open('$LOCAL_FILE') as f:
    content = f.read()
atoms = content.count('ATOM')
hetatm = content.count('HETATM')
chains = set()
for line in content.split('\n'):
    if line.startswith('ATOM') or line.startswith('HETATM'):
        parts = line.split()
        if len(parts) > 6:
            chains.add(parts[6] if len(parts) > 10 else parts[5])
print(f'  Atoms: {atoms} (ATOM) + {hetatm} (HETATM)')
print(f'  Chains: {\" \".join(sorted(chains)) if chains else \"N/A\"}')
print(f'  File: {len(content):,} bytes')
" 2>/dev/null || true
fi

echo ""
echo "Done. Task ID: $TASK_ID"
