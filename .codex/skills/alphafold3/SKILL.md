---
name: alphafold3
description: Submit protein folding tasks to the AlphaFold3 C550 inference platform. Use when the user needs to run AlphaFold3 predictions with pre-prepared JSON input files on the AI4S Kubernetes cluster.
---

# AlphaFold3 C550 Inference Platform

Submit and monitor AlphaFold3 protein folding tasks on the C550 inference cluster.

## Prerequisites

- Access to the C550 AI4S Kubernetes cluster (`~/code/ai_lab/kubeconfig_dir/config-vc-c550-ai4s-sys`)
- AlphaFold3 credentials exported as `ALPHAFOLD3_PASSWORD`
- Input JSON files prepared per AlphaFold3 input format

## Endpoints

| Endpoint | URL |
|---|---|
| Auth (login) | `http://10.12.111.135:10008/api/v1/auth/login` |
| Tasks | `http://10.12.111.135:10010/v1/scimodel/tasks` |
| Username | `ai4s-discovery` |
| Required Header | `x-original-model: alphafold3` (all requests) |
| Timeout | 7200s |

## Workflow

### 1. Upload Input Data

Copy AlphaFold3 input JSON files to the shared PVC:

```bash
K8S="kubectl --kubeconfig=~/code/ai_lab/kubeconfig_dir/config-vc-c550-ai4s-sys -n studio-ams"
$K8S cp ./my_input.json deploy/alphafold3-1:/data/input/my_input.json
```

The `input_dir` supports multiple JSON files for batch processing.

### 2. Submit & Monitor (Quick Start)

Use the bundled script for the full submit→poll→collect flow:

```bash
# Credentials are auto-loaded from .codex/skills/alphafold3/.env

bash .codex/skills/alphafold3/scripts/alphafold3_submit.sh \
  --input-dir /data/input/my_batch \
  [--output-dir ./outputs/alphafold3/my_batch]
```

The script will:
- Authenticate and refresh tokens automatically
- Submit the fold task
- Poll every 60s until completed or failed
- Report status and task ID
- Optionally copy results back (if `--output-dir` is provided)

### 3. Manual API Calls

#### Get Token

```bash
curl -s -X POST http://10.12.111.135:10008/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ai4s-discovery","password":"'"$ALPHAFOLD3_PASSWORD"'"}'
```

Returns `{"token": "eyJ..."}`, valid ~1 hour.

#### Submit Task

```bash
curl -s -X POST http://10.12.111.135:10010/v1/scimodel/tasks \
  -H "Authorization: Bearer <token>" \
  -H "x-original-model: alphafold3" \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "fold",
    "inputs": {
      "input_dir": "/data/my_input_dir",
      "model_dir": "/opt/weights"
    }
  }'
```

Returns `{"task_id": "xxxxxxxx-xxxx"}`.

#### Poll Status

```bash
curl -s "http://10.12.111.135:10010/v1/scimodel/tasks/<task_id>" \
  -H "Authorization: Bearer <token>" \
  -H "x-original-model: alphafold3"
```

Status progression: `queued` → `running` → `completed` / `failed`.

#### Collect Results

```bash
K8S="kubectl --kubeconfig=~/code/ai_lab/kubeconfig_dir/config-vc-c550-ai4s-sys -n studio-ams"
$K8S exec deploy/alphafold3-1 -- cp -r \
  /tmp/model_server/alphafold3_<task_id>/outputs/* \
  /data/results/my_batch/
```

Each input JSON produces a subdirectory with `model.cif`, `confidences.json`, `ranking_scores.csv`, etc.

## Important Notes

- Both GET and POST must include `x-original-model: alphafold3` header; missing it returns 404.
- `/tmp/` on the pod is ephemeral — move results to `/data/` immediately after completion.
- Token expires in ~1 hour; long-running polls must refresh the token.
- Auth endpoint does not support concurrency; space task submissions by ≥5 seconds.
- Results include: `model.cif` (structure), `confidences.json` (pLDDT/PAE), `ranking_scores.csv` (model ranking).

## Resources

- `scripts/alphafold3_submit.sh`: End-to-end submit, poll, and optional result collection script.
