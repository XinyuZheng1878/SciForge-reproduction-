# @sciforge/gui-owl-computer-use

Model-Router-backed **vision** computer-use worker: turn one natural-language
task into real desktop actions (click / type / scroll / open apps) on the
user's own **Windows / macOS / Linux** machine.

Computer-use is delegated through **SciForge Model Router** to a user/operator
configured vision-capable computer-use model or remote service. The selected
model reads the screen, plans, grounds pixel coordinates, and decides when to
stop. The main agent does not call provider APIs or plan the desktop steps; it
hands the task to `computer_use`, and this worker sends model traffic only to
Model Router.

```
                ┌──────────────────────────────────────────────┐
task ──▶        │  observe → routed model plans+grounds+decides → act → …    │
                │   model  → SciForge Model Router /v1/responses             │
                │   act    → DesktopExecutor (local, the only OS layer) │
                └──────────────────────────────────────────────┘
```

The model is remote (it only sees screenshots + text); the executor runs locally
where the desktop is. No Linux VM required. This package does not ship model
weights or a default raw provider URL. The development-only
[`server/serve-gui-owl-32b.sh`](server/serve-gui-owl-32b.sh) helper refuses to
start unless the operator explicitly opts in and supplies a licensed checkpoint.

## Relationship to the retired primitive MCP path

This worker is now the single computer-use path. The old
`@sciforge/computer-use` GUI-managed primitive MCP server has been retired, and
startup cleanup removes stale `gui_computer_use` entries from user MCP config.

The local runtime still exposes a `computer_use` tool to agents, but that tool
calls this GUI-Owl HTTP sidecar. GUI-Owl owns the observe → plan → act loop,
while Model Router owns model/provider selection and policy.

## Boundary (Servic_Module_Template.md / PROJECT_mcp.md)

- Returns a **`ServiceResult`** with status + trace + screenshot artifact refs —
  **never a final answer or completion truth**. The agent host decides if the
  task is truly done.
- **External side effects require approval**: dry-run by default. Real
  mouse/keyboard happens only when the call sets `execute=true` **and**
  `approve=true` **and** the worker was started with `CUA_ALLOW_EXECUTE=true`;
  otherwise it returns `NEEDS_APPROVAL`.
- **HTTP sidecar auth**: `POST /computer-use/run` and
  `POST /computer-use/cancel` accept an optional bearer token via
  `CUA_SERVICE_TOKEN`. The GUI launcher generates a random token per start and
  passes it to the Kun tool provider as `SCIFORGE_CUA_SERVICE_TOKEN`.
- **Refs-first**: screenshots are written to disk and returned as artifact refs,
  never inlined into a tool result.
- **Model router only**: set `CUA_MODEL_ROUTER_BASE_URL`,
  `CUA_MODEL_ROUTER_MODEL`, and `CUA_MODEL_ROUTER_API_KEY`. Legacy direct-provider
  env vars are ignored.

## Package layout

| Concern | File |
|---|---|
| Public contract (tool names, schemas, error codes, result mapping) | `cua/contract.py` |
| ServiceResult envelope | `cua/result.py` |
| Service core: the observe→plan→act→reflect loop, trace, safety | `cua/runner.py` |
| Routed model driver (prompt, call, parse, coord mapping) | `cua/owl_agent.py` |
| Mobile-Agent-v3 reflector | `cua/reflector.py` |
| Env-driven config | `cua/config.py` |
| Cancellation registry | `cua/cancel.py` |
| **MCP** stdio transport adapter | `cua/mcp_server.py` |
| **HTTP** ServiceResult sidecar | `cua/server.py` |
| Local entry (`--stdio` / `--http`) | `cua/cli.py` |
| Cross-platform desktop executor | `driver/desktop.py` |
| Click-through mouse overlay | `driver/overlay.py` |
| Pure contract/result/parse tests | `tests/test_contract.py` |
| Development-only local model serve helper | `server/serve-gui-owl-32b.sh` |
| One-click launcher: Model Router check + service + SciForge GUI | `一键启动-computer-use.bat`, `启动-sciforge-computer-use.ps1` |
| Launcher secrets template (copy to `启动-secrets.local.ps1`) | `启动-secrets.example.ps1` |

Everything for the module lives in this one folder; see **Integration touchpoints**
below for the few unavoidable edits elsewhere in the app.

## MCP tools

- `gui_computer_use_run` — `{ instruction, execute?, approve?, imagePath?, imageBase64?, requestId? }`
- `gui_computer_use_cancel` — `{ requestId }`

The full machine-readable `ServiceResult` is returned as a compact JSON text
block alongside a one-line summary; screenshots stay as artifact refs.

## Run

```bash
python -m pip install -r requirements.txt
export CUA_SERVICE_TOKEN=dev-local-token
export CUA_MODEL_ROUTER_BASE_URL=http://127.0.0.1:3892/v1
export CUA_MODEL_ROUTER_MODEL=sciforge-router
export CUA_MODEL_ROUTER_API_KEY=replace-with-model-router-runtime-key

# MCP stdio server (for Kun / Codex / agent runtimes):
python -m cua.cli --stdio

# HTTP sidecar (curl-able; what the Kun computer_use tool provider calls):
python -m cua.cli --http        # -> http://127.0.0.1:3900

# dry-run (safe): plan + ground against a static screen, no actions
curl -s localhost:3900/computer-use/run \
  -H "Authorization: Bearer $CUA_SERVICE_TOKEN" \
  -d '{"instruction":"click the Save button","imagePath":"some_ui.png"}'

# live execution (opt-in): start with CUA_ALLOW_EXECUTE=true, then
curl -s localhost:3900/computer-use/run \
  -H "Authorization: Bearer $CUA_SERVICE_TOKEN" \
  -d '{"instruction":"open Notepad and type hello","execute":true,"approve":true}'
```

Standalone service smoke test (no GUI): start `--http`, then
`python accept.py --task "open Notepad"` (add `--execute` for real actions).

To launch the **full SciForge GUI with this module wired in** (so the in-app
agent gets a `computer_use` tool), double-click `一键启动-computer-use.bat`
(or run `启动-sciforge-computer-use.ps1`) **in this folder**: it verifies Model
Router config, starts this service, sets `SCIFORGE_CUA_SERVICE_URL`, then runs
`npm run dev` from the repo root.

## Integration touchpoints (outside this folder)

The module is self-contained here; the only edits elsewhere in the app are the
minimal wiring needed to expose it to the agent runtime:

| File | Why |
|---|---|
| `kun/src/adapters/tool/computer-use-tool-provider.ts` (+ test) | the Kun `computer_use` tool that calls this service over HTTP |
| `kun/src/server/runtime-factory.ts` | registers the tool provider (1 import + 1 spread) |
| `src/main/local-runtime-process.ts` | passes `SCIFORGE_CUA_SERVICE_URL` and token env through to the local runtime so the Kun `computer_use` tool can call this sidecar |
| `src/main/model-router-sidecar.ts` | unrelated Windows fix: spawn `npm.cmd` via a shell (Node EINVAL) so the Model Router can auto-start |

## Config

See [`.env.example`](.env.example). Key vars: `CUA_MODEL_ROUTER_BASE_URL`,
`CUA_MODEL_ROUTER_MODEL`, `CUA_MODEL_ROUTER_API_KEY`, `CUA_MAX_STEPS`,
`CUA_REFLECT`, `CUA_ALLOW_EXECUTE`,
`CUA_PORT`, `CUA_SERVICE_TOKEN`, `CUA_SHOW_OVERLAY`, `CUA_ARTIFACT_DIR`.
