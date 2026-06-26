# SciForge Runtime architecture

This document describes the boundary and internal constraints of the SciForge Runtime
inside SciForge. It no longer describes the whole product as tied to one default runtime:
product-level code selects `sciforge | codex` through `AgentRuntimeHost`, SciForge Runtime remains the
default runtime, and Codex must be selected or enabled explicitly by the user.
This document only constrains the default runtime path, SciForge Runtime cache optimization, and legacy
provider cleanup.

Codex runtime app-server JSON-RPC, configuration, event normalization,
thread/event stores, and process lifecycle must stay modular and centralized in
`src/main/runtime/codex/`. The current stage makes Model Router the LLM provider
API boundary for every runtime; SciForge workspace server, Browser, Computer Use,
desktop runtime launcher, and the research artifact pipeline still do not belong
to the default runtime path.

CodeWhale, Reasonix, painting/design entry points, and runtime diagnostics panels
for legacy providers still should not return as product surfaces.

## Target boundary

```text
Renderer (React + Zustand)
  Code / Write / Connect phone UI
        |
        | AgentRuntimeProvider
        | window.sciforge.agentRuntime.*
        v
Preload IPC bridge
        |
        v
Main process
  AgentRuntimeHost (default local runtime) -> SciForge Runtime adapter
  process/config/port/token management only
        |
        v
SciForge Runtime service (TypeScript package)
  /health
  /v1/threads
  /v1/threads/{id}/turns
  /v1/threads/{id}/events
  /v1/threads/{id}/fork
  /v1/sessions/{id}/resume-thread
  /v1/approvals/{id}
  /v1/user-inputs/{id}
  /v1/usage
  /v1/workspace/status
```

This boundary follows the HTTP architecture used by TUI/CodeWhale: GUI never
embeds the SciForge Runtime agent loop, and the default runtime path treats the local HTTP server as the
stable API boundary. Codex may use stdio app-server in a separate runtime
adapter. Renderer consumes the neutral
[`AgentRuntime` contract](./agent-runtime-contract.md) and does not need to know
whether the backend is SciForge Runtime HTTP/SSE or Codex JSON-RPC stdio; that does not
change the SciForge Runtime HTTP/SSE contract.
Inside `sciforge`, the cache-first agent loop is adopted from Reasonix (`immutable` prompt
prefix, append-only log, bounded LRU/TTL cache, inflight cleanup, steering queue,
context compaction, usage/cache telemetry).
When SciForge Runtime needs a model call, it treats the local Model Router `/v1` endpoint as a
normal Responses-compatible provider. Upstream provider base URLs, provider API
keys, vision service URLs, and internal profiles belong to Model Router
configuration, not SciForge Runtime configuration.

## Cache-hit optimization

SciForge Runtime cache-hit metrics should be computed and optimized using DeepSeek native fields first:

- Model client prefers native fields:
  `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
  Only when those are missing should it fall back to compatibility fields
  such as `prompt_tokens_details.cached_tokens` and `cache_read_input_tokens`.
- Use hit rate as `hit / (hit + miss)`, not `hit / prompt_tokens`.
  DeepSeek native misses are not always equal to `prompt_tokens - hit`; Reasonix also uses
  the `hit + miss` denominator.
- The SciForge Runtime system prompt is the stable prefix.
  It may only contain long-lived SciForge Runtime run contract content and must not include
  workspace names, timestamps, file snippets, selected text, user dynamic state,
or one-off tool outputs.
- `ImmutablePrefix` must run `verifyImmutablePrefix()` before each model step.
  If `setSystemPrompt` / `setTools` / `setFewShots` bypasses this contract,
developer/runtime checks should surface fingerprint drift immediately instead of
quietly reducing cache behavior.
- Few-shot fingerprint only includes payload actually sent to the model.
  It should not include dynamic GUI/storage fields like `item id`, `turn id`, `thread id`,
or timestamps.
- Tool schema is canonicalized before sending to the model.
  Stable ordering avoids prefix churn caused by schema reordering.
- Each turn persists a canonical tool-catalog fingerprint and count.
  If a scope detects tool-definition drift, `toolCatalogDrift` is recorded to aid cache debugging.
- Before sending historical messages to DeepSeek, repair message history:
  no orphaned `tool_result`, no `tool_call` whose result is missing.
  Multiple tool calls in one response are reorganized into a single legal
  assistant `tool_calls` message to reduce 400/retry loops.
- Consecutive built-in read-only tools (`read` / `grep` / `find` / `ls`) in one model turn
  are executed in small concurrent batches, while `tool_result` entries are still written
  in tool-call order to avoid ordering noise in replay history.
- Serve runtime restores cumulative cache hit/miss counters from persisted usage events.
  After restart/resume, usage totals do not restart from zero.
- Dynamic context must be appended **after** stable prefix.
  `compaction`, `resume`, `fork`, and plan context must not rewrite the stable prefix.

Cold-start hit rate can be low (or zero) on the first round because the service has no prior
matching prefix yet. Once warmed up, hit rate should stably exceed 90%.
Observed temporary-thread verification on `2026-06-02`:

- 12 short-message turns: hot hit `94.7%` after excluding first-start warm-up rounds,
  latest round `93.6%`.
- 24 short-message turns after warming with the same stable prefix:
  overall (including warm-up) `95.2%`, latest round `98.1%`.

Pre-existing usage events persisted before optimization cannot be rewritten because
DeepSeek native cache fields were not recorded then; they only reflect old behavior and
should not be treated as evidence that current hit rates are lower.

Reasonix findings still useful as future references:

- Tool-collection mutation policy: adding tools should be append-only; edit/reorder/remove
  requires either restart or a new session boundary to avoid sudden cache misses.
  Current SciForge Runtime canonicalizes schema, but this mutation policy still needs explicit product-level
  enforcement.
- LLM fold summarizer: `ContextCompactor` is currently local summary logic with no extra
  model call. If model-based summarization is introduced later, it should reuse
  main-agent `system`/`tools`/`few-shot` prefix so summary calls can share cache.
- Large tool-result bounds and long-argument markerization: current outputs are smaller;
  if shell/file-fulltext/web-scraping tools are added, tool results should be token
  bounded or tokenized before entering history to avoid log bloat.
- Volatile scratch boundary: assistant reasoning is not sent back to the model by default
  but can still appear in GUI history. For future internal plans, temporary scratchpads,
or sub-agent scratch, keep “displayable” and “replayable to model” separated.

## Renderer product boundary

Renderer should no longer be hard-wired to legacy CodeWhale/Reasonix providers,
and Codex logic should not be placed inside the SciForge Runtime provider. Runtime-neutral UI
may expose `sciforge | codex` selection through Settings / provider registry. When the
active runtime is SciForge Runtime, work still enters through the SciForge Runtime HTTP/SSE boundary.
The legacy UI sections listed below should be removed or kept removed:

- Legacy agent switcher: the CodeWhale/Reasonix `AgentSwitcher` is no longer
  shown. If a user-visible runtime selector is added, it may only select
  `sciforge | codex` and must go through Settings / `AgentRuntimeHost` / provider registry.
- Top connection status + legacy runtime diagnostics entry: old provider
  detection is no longer the user entrypoint.
- Runtime insights / right panel: retain only `Changes`, `Preview`, `Plan`, and GUI workspace
  views (`File`, etc.); remove runtime/usage control surfaces.
- Slash menu commands `/usage`, `/runtime`: these open runtime control surfaces
  and should not be the runtime selection entrypoint.
- Settings provider selector: `Settings -> Agents` may show SciForge Runtime and Codex
  configuration. SciForge Runtime config still includes:
  `binaryPath`, `port`, `autoStart`, `runtimeToken`, `dataDir`, default
  provider/model-router member values, `approvalPolicy`, `sandboxMode`, and
  `insecure`. Model Router `baseUrl`, runtime `apiKey`, and public model alias
  belong under `modelRouter`; they are no longer written to `agents.sciforge`.
- Painting/Design starter card is removed; only Code, Write, and Connect phone remain.

## Main / preload responsibilities to remove

Main process and preload no longer expose old provider IPC:

- Remove legacy provider-specific spawn, update, and diagnostics IPC.
- Remove `reasonix:rpc-send`, `reasonix:spawn-if-needed`, and the `reasonix` RPC bridge.
- Remove CodeWhale adapter, Reasonix adapter, Reasonix HTTP bridge,
  provider-specific updater, legacy binary resolver, and old process manager.
- Remove diagnostic/importer modules unrelated to supported runtimes.

Main-process runtime responsibilities are:

- `AgentRuntimeHost`: expose the neutral connect/capabilities/thread/turn/event/control
  methods defined in `docs/agent-runtime-contract.md`; renderer calls it through
  `window.sciforge.agentRuntime`.
- Runtime adapter: start/stop the local runtime service, sync config, calculate base URL,
and append auth headers.
- `src/main/runtime/codex/`: centralize Codex app-server client, configuration,
  event normalization, thread/event stores, and lifecycle; outside files only
  integrate through the narrow adapter surface.
- `runtimeRequestViaHost`, `runtimeRequest`, and `startSse` / `stopSse` bypasses
  have been removed; new renderer code must not restore those paths.
- Model Router is the LLM provider boundary for the current stage; SciForge
  workspace server, Browser, Computer Use, and similar sidecars still do not
  belong to this SciForge Runtime contract.

## Settings / migration

Saved settings should represent an explicit runtime choice: default
`activeAgentRuntime` is `sciforge`, `agents.sciforge` is preserved, and `agents.codex` is
allowed for user-configured Codex.

```json
{
  "activeAgentRuntime": "sciforge",
  "agents": {
    "sciforge": {
      "binaryPath": "",
      "port": 8899,
      "autoStart": true,
      "runtimeToken": "",
      "dataDir": "~/.sciforge/runtime",
      "model": "sciforge-router",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "insecure": false
    },
    "codex": {
      "command": "codex",
      "args": [],
      "autoStart": true,
      "codexHome": "<managed: dev .codex-runtime/codex-home, packaged userData/runtime-codex/codex-home>",
      "profile": "sciforge-runtime",
      "model": "sciforge-router",
      "modelProvider": "sciforge-model-router",
      "approvalPolicy": "on-request",
      "sandboxMode": "workspace-write",
      "inheritModelProvider": false
    }
  }
}
```

The only reason `agentProvider`, `codewhale`, and `reasonix` strings remain in
code is for one-time migration from old settings:

- `agentProvider: codewhale | reasonix | deepseek-runtime` normalizes to
  `activeAgentRuntime: "sciforge"`.
- Old `agents.deepseek` / `agents.codewhale` values for `port`, `autoStart`,
  `runtimeToken`, `approvalPolicy`, and `sandboxMode` are no longer migrated
  into `agents.sciforge`; old upstream API keys, base URLs, and models must be
  reconfigured through Model Router instead of being written back to local
  runtime settings.
- Old `agents.reasonix` values, including `autoStart` and upstream provider
  fields, are no longer migrated into `agents.sciforge`; provider values must be
  reconfigured through Model Router.
- Persisted files after migration preserve `agents.sciforge`, may preserve
  `agents.codex`, and no longer retain `agents.codewhale` / `agents.reasonix`.
- Legacy Connect phone fields `agentThreadIds.codewhale` and `agentThreadIds.reasonix` are collapsed
  to `agentThreadIds.sciforge`.
- New Codex thread IDs must be written to Codex-owned thread/event stores or
  Codex mappings such as `agentThreadIds.codex`; they must not pollute SciForge Runtime
  mappings.

## Code / Write / Connect phone flows when SciForge Runtime is active

- Code: the provider registry returns `AgentRuntimeProvider`, which lists/creates
  threads, sends turns, steers, interrupts, compacts, resolves approvals, and
  subscribes to events through the neutral contract. When the active runtime is
  SciForge Runtime, the main-side SciForge Runtime adapter maps those calls to SciForge Runtime HTTP/SSE. Chat UI does
  not know old providers, SciForge Runtime endpoints, or Codex IPC.
- Write: writing assistant threads follow `activeAgentRuntime`, and the write
  thread registry isolates SciForge Runtime and Codex writing threads by workspace + runtime id.
  Inline completion uses a Write public model alias on Model Router for
  low-latency completion.
- Connect phone: scheduled tasks, Feishu/Lark/WeChat, and IM webhooks create or reuse SciForge Runtime threads.
  Renderer state uses the chat route with explicit Connect phone panel/channel state, and persisted settings use
  `remoteChannel` plus `connectPhone`.
  `threadId` / `localThreadId` remain only for legacy settings input;
  canonical local runtime mapping is written to `agentThreadIds.sciforge`.
  New tasks need to record the runtime id used; Codex thread IDs must not be
  written into local runtime mappings.

## Functional parity from CodeWhale in GUI HTTP path

Replacing CodeWhale is not only preserving chat.
SciForge Runtime GUI HTTP must expose the same capabilities previously exposed through CodeWhale:

- `GET /v1/threads` supports `limit`, `search`, `include_archived`, `archived_only`.
  Archived/deleted threads are hidden by default; session search and archive views
  should not depend on GUI-level guessing.
- `POST /v1/threads/{id}/fork` duplicates thread history, records fork lineage,
  and writes historical items back into the new thread's session store.
  During copy, pending `approval` / `user-input` states are rewritten to history-only
  states to prevent hanging gates in new sessions.
- `POST /v1/sessions/{id}/resume-thread` follows the previous CodeWhale resume path.
  SciForge Runtime should first attempt same-name thread restore, then session snapshot/JSONL reconstruction,
and return `404` when not found.
- Both `POST /v1/user-inputs/{id}` and legacy `POST /v1/user-input/{id}` are accepted,
  with `{ answers }` or `{ cancelled: true }`.
  `request_user_input` / `user_input` tool pauses a turn and resumes after GUI answer.
- `POST /v1/approvals/{id}` continues tool approval. Both approval and user-input flows
  use gate/route/service layering; no agent logic is implemented in renderer.
- `GET /v1/usage?group_by=thread|day` returns accumulated token/turn/cache-hit counters.
  Workbench home and composer footer consume SciForge Runtime usage only and do not open runtime
  insight panels.

## Paths that must remain removed

Legacy runtime paths should not reappear:

- `src/renderer/src/agent/codewhale-runtime.ts`
- `src/renderer/src/agent/reasonix-runtime.ts`
- `src/renderer/src/agent/reasonix-event-mapper.ts`
- `src/main/runtime/codewhale-adapter.ts`
- `src/main/runtime/reasonix-adapter.ts`
- `src/main/runtime/reasonix-http-bridge.ts`
- Legacy provider process manager modules
- Legacy provider binary resolver modules
- Legacy provider updater modules
- `src/main/reasonix-process.ts`
- `src/main/reasonix-config.ts`
- `src/main/resolve-reasonix-binary.ts`
- `src/shared/reasonix-protocol.ts`
- Legacy provider update contracts
- Diagnostic/importer modules for old runtime paths.

Legacy UI entrypoints should not reappear:

- CodeWhale/Reasonix `AgentSwitcher`
- Legacy provider-detection `ConnectionStatusBar`
- Legacy provider self-check `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- `ReasonixInsightsPanel`
- Design/Painting starter card

## Design constraints

SciForge Runtime packages are organized by ports & adapters:

- `contracts/`: HTTP/SSE DTOs and zod schemas.
- `ports/`: ModelClient, ToolHost, ThreadStore, SessionStore,
  ApprovalGate, EventBus, WorkspaceInspector, Clock.
- `adapters/`: DeepSeek-compatible model client, local tool host,
  file/in-memory stores, workspace inspector.
- `loop/`: AgentLoop, InflightTracker, SteeringQueue, ContextCompactor.
- `cache/`: ImmutablePrefix, LRU, TTL-LRU.
- `server/`: Router, auth, SSE, routes.

Renderer should never implement agent business logic; it only runs the
AgentRuntime client, event dispatch, and UI state mapping. For runtime-specific
capability, add a runtime tool or HTTP endpoint first, then map it through the SciForge Runtime
`AgentRuntimeAdapter`. Codex capability enters through `AgentRuntimeHost` and
`src/main/runtime/codex/`; do not add renderer-side agent logic that bypasses
the runtime boundary.

## Verification list

Any change touching the architecture should run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke checks:

1. Open SciForge.
2. Existing users and fresh installs default to SciForge Runtime, and `agents.sciforge` is not
   damaged by migration.
3. With SciForge Runtime active, Code can create a new session, send messages, stream output,
   and use approval/interruption.
4. Write opens writing space; inline completion and inline selected-text assistant share the same Model Router runtime configuration.
5. With SciForge Runtime active, Connect phone can save settings, run manual tasks, and write
   thread IDs back to local runtime mapping.
6. `Settings -> Agents` can select SciForge Runtime or Codex; unconfigured Codex does not
   affect SciForge Runtime, and there are no CodeWhale/Reasonix config blocks or legacy
   runtime diagnostics panels.
7. When Codex is explicitly configured and selected, new Code sessions go through
   the Codex runtime boundary without changing SciForge Runtime threads, events, settings, or
   mappings.
8. If `GET /v1/usage?group_by=thread` returns history, home and footer no longer show
   blank “No usage yet”, but show token, turn, cache-hit indicators.
9. Thread search, archive, fork/resume, and request_user_input answer/cancel flows all operate
   through SciForge Runtime HTTP paths.
