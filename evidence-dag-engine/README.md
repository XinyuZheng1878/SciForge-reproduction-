# Evidence-DAG Engine (SciForge 证据 DAG · 阶段一)

Standalone, dependency-light **Python** module that turns an agent trace into a
typed **claim–evidence DAG**, verifies its `supports` edges with an NLI judge,
and serialises losslessly to **PROV-JSON**. It is the engine half of the
"living evidence DAG" (the React view + the kun/codex trace-feed seam live in
the SciForge `gui` app).

> **Scope (phase 1):** one **thread == one graph**. Status is limited to
> `supported / unverified`; `contradicts` edges are **extracted and exposed but
> never adjudicated**. `fragile / conflicting / invalidated`, source
> quality/retraction/validity, ATMS labels, and Reconcile are phase 2+.

The module returns structured **`ServiceResult`** evidence only — never a
user-level final answer (per [`../Servic_Module_Template.md`](../Servic_Module_Template.md)).

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

## Run

```powershell
pip install -e .                         # networkx (stdlib otherwise)

# offline unit tests (stub LLM, no network)
python -m unittest discover -s tests -v

# live 1A extraction + verify + metrics + PROV-JSON round-trip on the fixture trace
$env:PYTHONUTF8='1'
$env:EDAG_LLM_BASE_URL='http://35.220.164.252:3888/v1'
$env:EDAG_LLM_API_KEY='sk-...'           # working gateway key (see 开发资源.txt)
$env:EDAG_LLM_MODEL='bailian/deepseek-v4-flash'
python scripts/live_extract.py

# Gate 1B core 门槛: Provenance Soundness vs cosine baseline on SciFact
python benchmark/soundness_benchmark.py --n 120

# HTTP service
$env:EDAG_STORAGE_DIR='.\out\threads'    # optional PROV-JSON persistence
python -m evidence_dag.server            # http://127.0.0.1:3897
```

## HTTP API (ServiceResult)

```text
GET  /health
GET  /version
POST /threads/{id}/ingest-trace   {"trace":[ {id,type,role?,tool_name?,content} ... ]}
GET  /threads/{id}/graph
POST /threads/{id}/verify         {"threshold":0.7}
GET  /threads/{id}/provenance?node=<nodeId>
GET  /threads/{id}/metrics
GET  /threads/{id}/analysis?threshold=0.7             # load-bearing / fragility / hidden shared-source
POST /threads/{id}/reconcile      {"remove_nodes":[...],"remove_edges":[...],"add_contradicts":[...]}
GET  /threads/{id}/prov-json                          # export
POST /threads/{id}/prov-json      {"doc":{...}}        # import / reload
```

`/analysis` (read-only, no LLM) reports **load-bearing** nodes (dominators ≥2 conclusions
depend on), **fragile** conclusions (ungrounded / single-source / contested), and
**hidden shared-source** claims (look multi-supported but every path funnels through one
source). `/reconcile` is a deterministic **what-if** — simulate removing sources/edges (or
adding a contradiction) and get the blast radius (which conclusions collapse / weaken /
turn conflicting) with a broken-dependency-chain explanation; it never mutates the graph.

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `EDAG_LLM_BASE_URL` | — | OpenAI-compatible base url (enables extraction/verify) |
| `EDAG_LLM_API_KEY` | — | Bearer key |
| `EDAG_LLM_MODEL` | `bailian/deepseek-v4-flash` | extraction + NLI-judge model |
| `EDAG_STORAGE_DIR` | — | if set, each thread's DAG is persisted as PROV-JSON |
| `EDAG_HOST` / `EDAG_PORT` | `127.0.0.1` / `3897` | HTTP bind |

Robustness (retry/backoff over a slow/flaky model) lives in the module
(`llm.py`: `max_attempts=5`, exp backoff), not in the host.

## 集成 seam（SciForge `gui` → 引擎）

实时喂入 = GUI 的统一 `AgentRuntimeHost` 在任意 backend 的 turn 完成时，
读取该 turn 的 neutral runtime items，并 POST 到
`/threads/{runtimeId}:{threadId}/ingest-trace`。目前覆盖仓库里的 `kun` 与
`codex` backend；未来独立的 Claude Code adapter 只要接入同一
`AgentRuntimeHost`/`AgentRuntimeEvent` 合约，也会复用同一条 feed。

| 件 | 位置 |
|---|---|
| runtime-scoped thread id + UI URL helper | `src/shared/evidence-dag.ts` |
| 映射 + 喂入(纯映射 + fail-open 客户端) | `src/main/runtime/evidence-dag-feed.ts` |
| 调用点(完成回合,fire-and-forget) | `src/main/runtime/agent-runtime/host.ts` |
| 顶栏打开 UI | `src/main/ipc/register-app-ipc-handlers.ts`, `src/renderer/src/components/Workbench.tsx` |
| 单测 | `src/main/runtime/evidence-dag-feed.test.ts`, `src/main/runtime/agent-runtime/host.test.ts` |

`trace_ref` 直接复用 `AgentRuntimeItem.id`（稳定持久);LLM 不照抄时由引擎
`extractor.resolve_trace_refs` 按内容重叠**确定性兜底**重锚到真实 item id。

GUI 主进程侧 env（不设则该 seam 为 no-op，行为不变）：

| Var | 默认 | 含义 |
|---|---|---|
| `SCIFORGE_EVIDENCE_DAG_SERVICE_URL` | — | 引擎 base url(gate;不设=关) |
| `SCIFORGE_EVIDENCE_DAG_API_KEY` | — | 可选 Bearer |
| `SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS` | `600000` | 单次喂入超时(fire-and-forget) |
