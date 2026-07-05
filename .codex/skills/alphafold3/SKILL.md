---
name: alphafold3
description: Submit protein folding tasks to the AlphaFold3 C550 inference platform. Use when the user needs to run AlphaFold3 predictions with pre-prepared JSON input files on the AI4S Kubernetes cluster.
---

# AlphaFold3 C550 Inference Platform

Submit, monitor, and download AlphaFold3 protein structure predictions on the C550 inference cluster.

Always distinguish three states in reports: (1) task submission accepted, (2) AF3 inference reached a terminal state, and (3) CIF coordinates were retrieved and analyzed. A queued or running task is not molecular evidence, and a completed task without CIF retrieval is execution-level evidence only.

## Quick Start

```bash
# 1. Auto-generate input from a simple sequence
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --sequence "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG" \
  --name "My_Protein" \
  --output-dir ./outputs/alphafold3/my_run

# 0. Preflight control-plane and data-plane readiness before evidence runs
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh --preflight

# 2. Or use a pre-prepared JSON file
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --json-input ./my_input.json \
  --output-dir ./outputs/alphafold3/my_run

# 3. Or submit a PVC directory that already contains AF3 JSON files
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --input-dir /data/input/my_batch \
  --output-dir ./outputs/alphafold3/my_run

# 4. Or submit one JSON file that is already present on the PVC
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --remote-json /data/input/my_batch/my_input.json \
  --output-dir ./outputs/alphafold3/my_run
```

The script handles upload → submit → poll → download automatically for local JSON/sequence inputs. With `--input-dir`, it skips upload and submits the existing PVC directory directly through the HTTP control plane. With `--remote-json`, it submits one existing PVC JSON file through the HTTP control plane and avoids whole-directory failure when another JSON in the directory is invalid.

## Input Format

Minimal working AlphaFold3 JSON:

```json
{
  "name": "My_Protein",
  "dialect": "alphafold3",
  "version": 1,
  "modelSeeds": [1],
  "sequences": [
    {
      "protein": {
        "id": "A",
        "sequence": "MQIFVKTLTG...",
        "unpairedMsa": "",
        "pairedMsa": "",
        "templates": []
      }
    }
  ]
}
```

**Critical**: Every `protein` block **must** include `unpairedMsa`, `pairedMsa` (can be empty strings), and `templates` (can be empty array). Omitting them causes `ValueError: missing unpaired MSA`.

For multi-chain complexes, add multiple entries in `sequences` with distinct `id` values (e.g. `"A"`, `"B"`).

## Endpoints

| Endpoint | URL |
|---|---|
| Auth | `http://10.12.111.135:10008/api/v1/auth/login` |
| Tasks | `http://10.12.111.135:10010/v1/scimodel/tasks` |
| User | `ai4s-discovery` |
| Header | `x-original-model: alphafold3` (ALL requests) |

## Script Options

```
--sequence SEQ    Auto-generate AF3 JSON from a single protein sequence
--name NAME       Job name (required with --sequence, default: "Fold")
--json-input F    Upload and submit a pre-prepared JSON file
--input-dir DIR   Shared PVC path already containing JSON files
--remote-json F   Single shared PVC JSON file already present on the cluster
--json-path F     Alias for --remote-json
--output-dir DIR  Local directory for downloaded .cif results
--max-wait N      Max poll iterations, each 60s (default: 90 = 1.5h)
--model-dir DIR   Model weights dir on pod (default: /opt/weights)
--kubeconfig F    Optional kubeconfig path for kubectl upload/download
--preflight        Print redacted AF3 HTTP/kubectl readiness TSV and exit
--help            Show help
```

**C550 API nuance**: the server-side `input_json` field is path-like on this deployment; do not use it to send raw JSON content. Inline raw JSON is interpreted as a filename and can fail with `Errno 36 File name too long`. Use `--remote-json /data/input/.../file.json` for a single pre-staged PVC JSON file, `--input-dir` for a validated pre-staged PVC directory, or `--json-input`/`--json` to upload a local file through kubectl.

When capturing logs with `tee`, use `set -o pipefail` in the caller shell. Otherwise a failed upload/download can be hidden by the successful `tee` process:

```bash
set -o pipefail
bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --json-input ./my_input.json \
  --output-dir ./outputs/alphafold3/my_run 2>&1 | tee ./outputs/alphafold3/my_run.log
```

## Manual API (Advanced)

### Authenticate

```bash
TOKEN=$(curl -s -X POST http://10.12.111.135:10008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ai4s-discovery","password":"'"$ALPHAFOLD3_PASSWORD"'"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

### Submit

```bash
TASK_ID=$(curl -s -X POST http://10.12.111.135:10010/v1/scimodel/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-original-model: alphafold3" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"fold","inputs":{"input_dir":"/data/input/my_batch","model_dir":"/opt/weights"}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
```

For a single pre-staged JSON file:

```bash
TASK_ID=$(curl -s -X POST http://10.12.111.135:10010/v1/scimodel/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-original-model: alphafold3" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"fold","inputs":{"input_json":"/data/input/my_batch/my_input.json","model_dir":"/opt/weights"}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['task_id'])")
```

### Poll

```bash
curl -s "http://10.12.111.135:10010/v1/scimodel/tasks/$TASK_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-original-model: alphafold3"
```

### Download

```bash
POD=$(kubectl -n studio-ams get pods -l app=alphafold3 -o jsonpath='{.items[0].metadata.name}')
kubectl -n studio-ams cp $POD:/data/scimodel/muxi_alphafold3_server/alphafold3/output/$TASK_ID.cif ./$TASK_ID.cif
```

## Output

Each task produces a single `.cif` file (mmCIF / ModelCIF format) with full 3D coordinates, chain info, and confidence scores. When downloading through kubectl, prefer the `outputs.output_path` returned by `GET /v1/scimodel/tasks/{task_id}`; observed C550 paths can be either `/output/{task_id}.cif` or `/data/scimodel/muxi_alphafold3_server/alphafold3/output/{task_id}.cif`.

```bash
head -30 ./outputs/my_run/*.cif    # Quick preview
```

Compatible with PyMOL, ChimeraX, or Biopython `MMCIFParser`.

## Troubleshooting

### "missing unpaired MSA" error

Your JSON `protein` block is missing required fields. Always include:

```json
"unpairedMsa": "",
"pairedMsa": "",
"templates": []
```

### kubectl cp fails

Use the actual pod name (not `deploy/...`):

```bash
POD=$(kubectl -n studio-ams get pods -l app=alphafold3 -o jsonpath='{.items[0].metadata.name}')
kubectl -n studio-ams cp $POD:/path/to/file ./local/
```

### 404 on API

Both GET and POST requests must include `x-original-model: alphafold3`.

### Token expired

Tokens last ~1h. The script auto-refreshes every 10 polls. For manual calls:

```bash
TOKEN=$(curl -s -X POST http://10.12.111.135:10008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ai4s-discovery","password":"'"$ALPHAFOLD3_PASSWORD"'"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

## Important

- **All** API requests need `x-original-model: alphafold3` header.
- Outputs at `/data/scimodel/muxi_alphafold3_server/alphafold3/output/` on the pod.
- Completed task metadata can contain an output path even when the CIF is not downloadable through HTTP; coordinate-level analysis still requires retrieving the `.cif`.
- Token expires ~1h; auto-refreshed when using the script.
- Space task submissions by ≥5s to avoid auth race conditions.
- `kubectl cp` needs the actual pod name; use the label selector pattern.

## Resources

- `scripts/alphafold3_submit.sh`: End-to-end submit, poll, and download script with auto-input generation.
