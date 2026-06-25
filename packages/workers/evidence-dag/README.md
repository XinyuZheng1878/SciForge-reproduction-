# @sciforge/evidence-dag

Standalone, dependency-light **Python** service (`packages/workers/evidence-dag`) that
turns an agent trace into a typed **claim–evidence DAG**, verifies its `supports` edges
with an NLI judge, and serialises losslessly to **PROV-JSON**. It is the engine half of the
"living evidence DAG" — the React view + the kun/codex trace-feed seam live in the SciForge
desktop app (`src/main/runtime/evidence-dag-feed.ts`, `src/renderer/.../WorkbenchTopBar.tsx`).

The service returns structured **`ServiceResult`** evidence only (graph, provenance,
metrics) — never a user-level final answer or completion truth.

> **Scope (phase 1):** one **thread == one graph**. Status is limited to
> `supported / unverified`; `contradicts` edges are extracted and exposed but never
> adjudicated. `fragile / conflicting / invalidated`, source quality/retraction, ATMS
> labels, and Reconcile-write are phase 2+.

## Layout

| Concern | File |
|---|---|
| Data contract (Node/Edge/enums, content-addressed ids, dedup key) | `src/evidence_dag/model.py` |
| Thread graph: dedup, cycle detection, provenance traversal, topo layers | `src/evidence_dag/graph.py` |
| PROV-JSON serialize/deserialize (lossless round-trip) | `src/evidence_dag/provjson.py` |
| OpenAI-compatible LLM client (+ offline stub) | `src/evidence_dag/llm.py` |
| Trace → DAG extractor (LLM structured output) | `src/evidence_dag/extractor.py` |
| L2 verifier: NLI ν per supports edge, noisy-OR status | `src/evidence_dag/verifier.py` |
| Four AAR metrics | `src/evidence_dag/metrics.py` |
| Load-bearing / fragility / hidden shared-source (dominator analysis) | `src/evidence_dag/analysis.py` |
| Reconcile / what-if 扰动 (deterministic, read-only) | `src/evidence_dag/reconcile.py` |
| Engine facade + per-thread persistence | `src/evidence_dag/service.py` |
| HTTP service (`ServiceResult`) | `src/evidence_dag/server.py` |
| Bundled web UI (graph view, served at `/`) | `ui/index.html` |
| Demo multi-turn traces for acceptance | `samples/*.json`, `samples/load.py` |

## Run

As an npm workspace (installs the Python package editable, then serves on :3897):

```bash
npm --workspace @sciforge/evidence-dag run start
```

Or directly (what the one-click launcher does):

```powershell
cd packages/workers/evidence-dag
python -m pip install -r requirements.txt    # networkx (stdlib otherwise)
$env:PYTHONPATH = 'src'; $env:PYTHONUTF8 = '1'
$env:EDAG_STORAGE_DIR = '.\out\threads'      # optional PROV-JSON persistence
# LLM env enables extraction + verify (omit for an offline graph-only server):
$env:EDAG_LLM_BASE_URL = 'http://35.220.164.252:3888/v1'
$env:EDAG_LLM_API_KEY  = 'sk-...'
$env:EDAG_LLM_MODEL    = 'bailian/deepseek-v4-flash'
python -m evidence_dag.server                # http://127.0.0.1:3897
```

Load the demo traces into a running engine, then open `http://127.0.0.1:3897/`:

```bash
python samples/load.py        # or EDAG_URL=http://127.0.0.1:3897 python samples/load.py
```

## HTTP API (ServiceResult)

```text
GET  /health
GET  /version
GET  /                                                 # bundled web UI
POST /threads/{id}/ingest-trace   {"trace":[ {id,type,role?,tool_name?,content} ... ], "merge?":bool, "verify?":bool}
GET  /threads/{id}/graph
POST /threads/{id}/verify         {"threshold":0.7}
GET  /threads/{id}/provenance?node=<nodeId>
GET  /threads/{id}/metrics
GET  /threads/{id}/analysis?threshold=0.7              # load-bearing / fragility / hidden shared-source
POST /threads/{id}/reconcile      {"remove_nodes":[...],"remove_edges":[...],"add_contradicts":[...]}
GET  /threads/{id}/prov-json                           # export
POST /threads/{id}/prov-json      {"doc":{...}}        # import / reload
GET  /threads                                          # list known thread ids
```

`/analysis` (read-only, no LLM) reports **load-bearing** nodes (dominators ≥2 conclusions
depend on), **fragile** conclusions (ungrounded / single-source / contested), and
**hidden shared-source** claims (look multi-supported but every path funnels through one
source). `/reconcile` is a deterministic **what-if** — simulate removing sources/edges (or
adding a contradiction) and get the blast radius (which conclusions collapse / weaken /
turn conflicting); it never mutates the graph. `ingest-trace` with `merge:true` grows the
thread's graph incrementally across turns; default replaces it (whole-conversation re-extract).

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `EDAG_LLM_BASE_URL` | — | OpenAI-compatible base url (enables extraction/verify; omit for offline) |
| `EDAG_LLM_API_KEY` | — | Bearer key |
| `EDAG_LLM_MODEL` | `bailian/deepseek-v4-flash` | extraction + NLI-judge model |
| `EDAG_AUTO_VERIFY` | `1` | auto-verify supports edges right after ingest |
| `EDAG_STORAGE_DIR` | — | if set, each thread's DAG is persisted as PROV-JSON |
| `EDAG_HOST` / `EDAG_PORT` | `127.0.0.1` / `3897` | HTTP bind |

Retry/backoff over a slow/flaky model lives in the module (`llm.py`: `max_attempts=5`,
exp backoff), not in the host.

## App integration seam (SciForge desktop → engine)

Real-time feed: the GUI's unified `AgentRuntimeHost` reads each completed turn's neutral
items and POSTs them to `/threads/{runtimeId}:{threadId}/ingest-trace`. Kun, Codex and the
Claude Code CLI all flow through the same public `AgentRuntime` contract, so they enter one
Evidence-DAG seam. Touch points in the app:

| Piece | Location |
|---|---|
| Mapping + feed (pure mapping + fail-open client) | `src/main/runtime/evidence-dag-feed.ts` |
| Call site (completed turn, fire-and-forget) | `src/main/runtime/agent-runtime/host.ts` |
| Open UI | `evidenceDag:open` IPC + Workbench top-bar Evidence DAG button |

GUI main-process env (unset = the seam is a no-op, behaviour unchanged):

| Var | Default | Meaning |
|---|---|---|
| `SCIFORGE_EVIDENCE_DAG_SERVICE_URL` | — | engine base url (gate; unset = off) |
| `SCIFORGE_EVIDENCE_DAG_API_KEY` | — | optional Bearer |
| `SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS` | `600000` | per-feed timeout (fire-and-forget) |

`trace_ref` reuses the neutral `AgentRuntimeItem.id` (stable, persistent); when the LLM does
not echo it verbatim, the extractor (`extractor.resolve_trace_refs`) deterministically
re-anchors to the real item id by content overlap.
