# Agent Runtime Notes

DeepSeek GUI supports two user-selectable local agent runtimes: **Kun** and
**Codex**. Kun remains the default runtime for existing and new users. Codex is
optional and must be selected or enabled explicitly; the app must never
silently fall back from Kun to Codex.

Code, Write, Connect phone, and scheduled tasks should enter agent work through
the runtime-neutral `AgentRuntime` contract. Renderer code should use
`AgentRuntimeProvider` and the `window.dsGui.agentRuntime` preload API instead
of calling Kun `/v1/*` endpoints or Codex `codex:*` IPC directly. Kun continues
to serve HTTP/SSE behind its adapter. Codex runtime code must stay modular and
centralized under `src/main/runtime/codex/`. Connect phone still uses the
internal `claw` name in code for compatibility. Connect phone and scheduled
tasks record runtime ids and preserve runtime-specific thread mappings, but
their non-Kun execution path currently fails closed until native adapter support
is implemented for those background workflows.

The contract and event/capability shape are documented in
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md).

## Allowed Extension Path

1. For Kun behavior, add protocol fields in `kun/src/contracts/`.
2. For Kun behavior, add agent behavior in `kun/src/loop/`, `kun/src/services/`, or a
   new port/adapter under `kun/src/ports/` and `kun/src/adapters/`.
3. For Kun behavior, add HTTP endpoints under `kun/src/server/routes/`.
4. Map Kun endpoint/events through `src/main/runtime/kun-agent-runtime-adapter.ts`
   and the shared AgentRuntime event/capability types. Renderer mapping belongs
   in `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`.
5. For Codex behavior, keep app-server JSON-RPC, configuration, event
   normalization, thread/event stores, and lifecycle code inside
   `src/main/runtime/codex/`; expose only the narrow adapter surface from that
   directory.
6. Keep shared integration thin: settings type/schema/migration, main-process
   runtime selection, renderer provider registry, and Settings UI may know
   about `kun | codex`.
7. Add settings under `agents.kun` or `agents.codex`, with
   `activeAgentRuntime` recording the explicit user choice.
8. Legacy `runtimeRequest` / `startSse` paths are compatibility shims only.
   Renderer-specific `codex:*` IPC has been removed; `codex:` strings should
   remain internal app-server method/event names only.

## Forbidden Paths

- No CodeWhale/Reasonix adapter, process manager, RPC bridge, updater, or
  importer.
- No implicit fallback from Kun to Codex when Kun fails.
- No new renderer business logic that bypasses `AgentRuntimeProvider` or the
  neutral `window.dsGui.agentRuntime` API.
- No scattered Codex implementation outside `src/main/runtime/codex/`, beyond
  the thin integration points listed above.
- Model Router sidecar is the LLM provider API boundary for the current stage;
  do not mix SciForge workspace server, Browser, Computer Use, desktop runtime
  launcher, VSCode app module, or artifact pipeline into this runtime contract.
- No legacy `AgentSwitcher`, `ConnectionStatusBar`, `RuntimeDiagnosticsDialog`,
  or runtime self-check UI for old providers.
- No drawing/design starter card in the core workbench.
- No `/usage` or `/runtime` slash command that opens a runtime control panel.

## Legacy Data Rule

Old persisted keys may be read only inside settings migration:

- `agentProvider: codewhale | reasonix | deepseek-runtime` maps to
  `activeAgentRuntime: "kun"`.
- `agents.codewhale`, `agents.reasonix`, and legacy `deepseek` values seed
  `agents.kun` once.
- Saved settings preserve `agents.kun` and may contain `agents.codex`; they must
  not retain `agents.codewhale` or `agents.reasonix`.
- Old Connect phone (internal Claw) `agentThreadIds.codewhale/reasonix` fold into
  `agentThreadIds.kun`.
- New Codex thread mappings must use Codex-owned runtime/thread storage and must
  not be written into Kun mappings.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke:

- Existing users and fresh installs default to Kun.
- Settings -> Agents can expose Kun and Codex runtime settings, but not
  CodeWhale/Reasonix blocks.
- Code can create a Kun thread, stream a reply, approve/deny tools, and
  interrupt a turn.
- When Codex is explicitly configured and selected, Code routes through the
  Codex runtime boundary without changing Kun settings or threads.
- CodeWhale parity endpoints still work through Kun: thread search/archive
  filters, fork, session resume, request_user_input submit/cancel, and usage.
- Cache telemetry uses DeepSeek native `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`; hot Kun turns should stay above 90% cache
  hit after the stable prefix is warm.
- Immutable prefix drift and malformed tool-call/tool-result history must be
  caught before a request reaches DeepSeek.
- Write can open the workspace, request inline completion, and use selected-text
  assistant actions; assistant threads are isolated by active runtime.
- Connect phone can save settings and run manual Kun tasks. Runtime-id support
  for Codex-backed phone/schedule tasks must preserve legacy Kun mappings for
  migrated data and must not write Codex thread IDs into Kun mappings.

Kun runtime details are in
[`docs/kun-architecture.md`](./kun-architecture.md). Product-level runtime
contract details are in
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md).
