# DeepSeek GUI Kun / Codex 双运行时迁移任务板

最后更新：2026-06-11

## 当前目标

把 `/Applications/workspace/ailab/research/app/SciForge` 中已经验证过的
Codex app-server runtime 思路迁移到本项目，让 **Kun** 和 **Codex** 成为用户
可选的本地 agent 运行时。

迁移前 DeepSeek GUI 的代码和文档是单运行时 Kun 方案；当前工作树已把约束改为
Kun 默认、Codex 可选：

- `docs/AGENTS.md`、`docs/kun-architecture.md`、`DESIGN.md` 已不再禁止第二运行时。
- renderer 曾只有 Kun provider；当前已收敛到中性
  `src/renderer/src/agent/agent-runtime-provider.ts`。
- main process 已新增中性 RuntimeHost / AgentRuntimeHost，并通过
  `src/main/runtime/codex/` 托管 Codex app-server capsule。
- settings 已表达 `agents.kun`、`agents.codex` 和 `activeAgentRuntime`，旧
  `agentProvider` 会被迁移掉。

本任务板就是把这些约束改成新的产品事实：**Kun 默认保留，Codex 可选启用；
Code、Write、连接手机和定时任务通过同一套 RuntimeHost 选择当前运行时，不再把
renderer 直接绑死到 Kun。**

## 迁移结论

推荐迁移方式是 **主进程托管 Codex app-server client，而不是照搬 SciForge
workspace server / Model Router / Computer Use 侧车**。

为了保持最小侵入，Codex 运行时相关实现尽量集中在一个子目录：

```text
src/main/runtime/codex/
  app-server/
  codex-config.ts
  codex-agent-runtime-adapter.ts
  codex-thread-store.ts
  codex-event-store.ts
  codex-service.ts
  index.ts
```

子目录外只允许薄集成点：

- settings 类型、默认值、schema 和 migration。
- main process 中选择 active runtime 的少量分支。
- renderer provider registry 中选择 `kun` 或 `codex`。
- Settings UI 中展示 Codex 配置。

不要为了接 Codex 先重构 Kun。Kun 当前路径能不动就不动；所有 Codex JSON-RPC、
thread/event store、事件归一化、配置生成、进程生命周期都留在
`src/main/runtime/codex/` 内部。

SciForge 中值得迁移的核心：

- `src/runtime/codex/codex-app-server-client.ts`：通过
  `codex app-server --listen stdio://` 建立 JSON-RPC 会话，调用
  `initialize`、`thread/start`、`thread/resume`、`turn/start`、
  `turn/interrupt`。
- `src/runtime/codex/codex-app-server-adapter.ts`：把 app-server 事件归一化为
  GUI 可消费的 agent event。
- `src/runtime/codex/backend-event-normalization.ts` 与
  `codex-event-normalizer.ts`：把 rich-client / tool / message / approval /
  done / failed 事件映射成稳定事件。
- `src/runtime/codex/codex-runtime-config.ts` 的 fail-closed 思路：缺 runtime
  配置、workspace、provider key 或非法 endpoint 时直接失败，不静默 fallback。

`/Applications/workspace/ailab/research/app/codexia` 进一步验证和补充。本项目采用
**方案 2：复用 Codex app-server capsule + 通用事件总线思想**，不采用方案 3
的整个平台外壳迁移：

- app-server 的 approval / user input 不是独立 `approval_response` 方法，而是
  **server-originated JSON-RPC request**：app-server 发带 `id` 的 request，
  GUI 弹出审批或输入 UI 后，向同一个 `id` 写回 JSON-RPC response。
- `codexia/src-tauri/src/codex/server_request.rs` 把
  `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、
  `item/tool/requestUserInput` 转成 GUI 事件，并保留 `requestId`。
- `codexia/src-tauri/src/codex/commands.rs` 通过 `send_response(request_id, result)`
  回写 `CommandExecutionRequestApprovalResponse`、
  `FileChangeRequestApprovalResponse` 或 user-input response。
- `codexia` 使用统一 `EventSink` 把 Tauri、WebSocket、SSE 事件都包装成
  `{ event, payload }`，这个模式适合本项目的中性 AgentRuntime event bus。
- `codexia` 在 `thread/start` config 和 `turn/start` params 中显式设置
  `model_reasoning_effort`、`show_raw_agent_reasoning`、
  `model_reasoning_summary` / `effort` / `summary`，可作为改善 Codex 思考过程
  可见性的优先参考。
- 从 `codexia` 复制或改写的代码必须收拢进 `src/main/runtime/codex/app-server/`
  这类 capsule，不允许 renderer、Kun adapter、RuntimeHost 直接依赖 capsule
  内部文件。
- 多 agent CLI 不进入核心代码层面。未来需要 Claude Code、Gemini CLI 或其他
  agent 时，优先通过 A2A、MCP、外部 CLI bridge 或独立 runtime adapter 接入；
  不把 `codexia` 的 Claude Code / automation / web-server 平台外壳搬进本项目。

已确认实现决策：

- 优先先做 Codex approval / user input 双向交互，再做更大范围的中性 event
  bus 收敛。
- 可参考或复制 `codexia` 的协议形状和小段逻辑，但落地时改写成
  TypeScript / Electron 风格，不逐行翻译 Rust/Tauri 结构。
- Codex command/file approval 第一版全部弹出中性审批卡片；未知 request 一律
  fail closed，并生成可见 recoverable error。
- User input 复用现有中性 `user_input` 卡片，不做 Codex 专用 UI。
- Reasoning 只显示 app-server 实际给出的 summary / trace / raw 文本，不补写、
  不伪装 Kun 式完整思考。
- renderer 专用 `codex:*` IPC 已删除；旧 `runtimeRequest` / `startSse` /
  `stopSse` 只作为 Kun/legacy 兼容入口保留，新代码走中性 `agentRuntime:*`
  IPC。
- E2E smoke 中，Codex 和 Kun 都至少需要一次真实 assistant 回复；recoverable
  error 只作为错误路径单独验证。

不直接迁移的 SciForge 部分：

- Model Router sidecar、workspace writer、desktop runtime launcher。
- SciForge Browser / Computer Use / VSCode app module。
- `codex exec --json` legacy bridge，除非作为 focused test fixture。
- SciForge 的 final-answer projection 和科研 artifact pipeline。
- Codexia 的 Tauri runtime、Axum REST/WS headless server、P2P/tunnel、
  automation 外壳和 Claude Code session UI。

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] 对话、工作链路需要统一，不要额外生出旁路。
- [x] Kun 仍是默认运行时；已有用户设置和 Kun 会话不能被迁移破坏。
- [x] Codex 必须由用户显式选择或开启；不能在 Kun 失败时静默 fallback 到 Codex。
- [x] 不恢复 CodeWhale / Reasonix 旧路径；本次只新增 `codex`。
- [x] renderer 只依赖 `AgentProvider` / `RuntimeHost` 抽象，不直接知道进程、
  端口、token 或 JSON-RPC 细节。
- [x] main process 统一拥有运行时启动、停止、认证、日志、端口/stdio 和
  settings 同步。
- [x] Codex 多轮必须使用 app-server thread 语义恢复；GUI 不拼接历史
  transcript 当作下一轮 prompt。
- [x] stderr、raw JSON-RPC、provider payload 和 secret 只能进入折叠 audit /
  debug，不进入用户可见正文。
- [x] Codex 缺 command、CODEX_HOME、workspace、model provider 或 API key
  时 fail closed，显示可恢复错误。
- [x] Write inline completion 仍可保持当前直连 provider 的低延迟路径；写作
  assistant thread 是否跟随当前运行时要作为显式产品选择处理。
- [x] 连接手机和定时任务必须记录所用 runtime id，不能把 Codex thread id
  写进 Kun mapping。

## 目标架构

```text
Renderer
  Code / Write / Connect phone / Schedule
        |
        | AgentProvider registry chooses active runtime
        v
Preload IPC
  dsGui.agentRuntime.*
  + legacy Kun runtimeRequest / startSse / stopSse compatibility
        |
        v
Main process AgentRuntimeHost
  AgentRuntimeAdapter registry
    - KunAgentRuntimeAdapter
    - CodexAgentRuntimeAdapter
        |
        +--> Kun: HTTP/SSE to `kun serve`
        |
        +--> Codex: stdio JSON-RPC to `codex app-server --listen stdio://`
                   + GUI-owned Codex thread/event store
```

Kun 继续暴露原生 `/v1/threads`、`/v1/threads/{id}/turns`、
`/v1/threads/{id}/events` 等 HTTP/SSE API。

Codex 不要求伪装成完整 Kun server。当前收敛路径是一个 renderer
`AgentRuntimeProvider` 加 main-side Codex service：Codex app-server 的
thread / turn / rich-client events 先映射成中性 AgentRuntime 语义，再进入
`ThreadEventSink` / `ChatBlock`。

## 最终目标：中性 AgentRuntime 接口

当前 renderer 通过中性 `AgentRuntimeProvider` / `ThreadEventSink` 消费运行时；
旧 Kun HTTP/SSE 入口只作为兼容层存在。最终目标不是让 Codex 伪装成完整 Kun
server，而是把 Kun 与 Codex 都接到同一个 **AgentRuntime contract**：

```ts
type AgentRuntimeAdapter = {
  id: 'kun' | 'codex'
  transport: 'http_sse' | 'jsonrpc_stdio'

  connect(context): Promise<void>
  capabilities(context): Promise<AgentRuntimeCapabilities>

  listThreads(context, input): Promise<AgentRuntimeThread[]>
  startThread(context, input): Promise<AgentRuntimeThread>
  readThread(context, input): Promise<AgentRuntimeThreadDetail>

  startTurn(context, input): Promise<AgentRuntimeTurnHandle>
  interruptTurn(context, input): Promise<void>
  steerTurn(context, input): Promise<void>

  renameThread(context, input): Promise<void>
  deleteThread(context, input): Promise<void>
  compactThread?(context, input): Promise<void>
  forkThread?(context, input): Promise<AgentRuntimeThread>
  resumeSession?(context, input): Promise<AgentRuntimeSessionResumeHandle>

  subscribeEvents(context, input): AsyncIterable<AgentRuntimeEvent>
  resolveApproval?(context, input): Promise<void>
  resolveUserInput?(context, input): Promise<void>
  updateThreadRelation?(context, input): Promise<void>
  usage(context, input): Promise<AgentRuntimeUsageResponse>
  auxiliary?(context, input): Promise<unknown>
}
```

中性 `AgentRuntimeEvent` 以 UI 可消费语义为中心，而不是以某个 backend 的原生
协议为中心：

```ts
type AgentRuntimeEvent =
  | { kind: 'thread_lifecycle'; state: 'created' | 'updated' | 'archived' }
  | { kind: 'turn_lifecycle'; state: 'started' | 'completed' | 'failed' | 'aborted' | 'steered' }
  | { kind: 'runtime_status'; phase?: AgentRuntimePhase; message?: string; latencyMs?: number }
  | { kind: 'user_message'; itemId: string; text: string; displayText?: string }
  | { kind: 'assistant_delta'; itemId: string; text: string }
  | { kind: 'reasoning_delta'; itemId: string; text: string; visibility: ReasoningVisibility }
  | { kind: 'item_snapshot'; item: AgentRuntimeItem }
  | { kind: 'tool_event'; itemId: string; status: 'running' | 'success' | 'error'; detail?: string }
  | { kind: 'approval_requested' | 'approval_resolved'; ... }
  | { kind: 'user_input_requested' | 'user_input_resolved'; ... }
  | { kind: 'compaction_event' | 'review_event' | 'goal_event' | 'todo_event'; ... }
  | { kind: 'usage'; usage: AgentRuntimeUsage }
  | { kind: 'error'; recoverable: boolean; severity: 'info' | 'warning' | 'error'; ... }
  | { kind: 'heartbeat' }
```

`AgentRuntimeCapabilities` 必须比现在 renderer 里的五个布尔值更细，特别要显式
表达 Codex 慢和思考过程不完整的问题：

```ts
type AgentRuntimeCapabilities = {
  contractVersion: 1
  transport: 'http_sse' | 'jsonrpc_stdio'
  events: {
    live: boolean
    replayable: boolean
    sequenced: boolean
    delivery: 'sse' | 'ipc' | 'async_iterable'
  }
  threadMaterialization: 'immediate' | 'after_first_user_message'
  latency: {
    phaseEvents: boolean
    firstTokenMetric: boolean
    turnDurationMetric: boolean
  }
  reasoning: {
    available: boolean
    streaming: boolean
    visibility: 'none' | 'summary' | 'trace' | 'full_runtime_text'
    source: 'model' | 'runtime_summary' | 'backend_redacted' | 'unknown'
  }
  model: {
    id?: string
    inputModalities: Array<'text' | 'image'>
    outputModalities: Array<'text' | 'image'>
    supportsToolCalling: boolean
    contextWindowTokens?: number
  }
  tools: {
    toolCalling: boolean
    commandExecution: boolean
    fileChange: boolean
    mcp: CapabilityState & { search?: CapabilityState; toolCount?: number }
    web: CapabilityState & { fetch?: CapabilityState; search?: CapabilityState }
    skills: CapabilityState
    subagents: CapabilityState
  }
  controls: {
    interrupt: boolean
    steer: boolean
    approval: 'unsupported' | 'sync' | 'async' | 'fail_closed'
    userInput: 'unsupported' | 'sync' | 'async' | 'fail_closed'
    compact: 'unsupported' | 'native' | 'noop'
    fork: boolean
    resumeSession: boolean
  }
  storage: {
    guiOwnedThreads: boolean
    backendThreadIdStable: boolean
    usage: boolean
    attachments: CapabilityState
    memory: CapabilityState
  }
}
```

### Kun 现有 RuntimeEvent / capabilities 审计

Kun 底层已支持的 runtime events：

- thread lifecycle：`thread_created`、`thread_updated`。
- turn lifecycle：`turn_started`、`turn_completed`、`turn_failed`、
  `turn_aborted`、`turn_steered`。
- item lifecycle：`item_created`、`item_updated`、`item_completed`。
- streaming：`assistant_text_delta`、`assistant_reasoning_delta`。
- tool：`tool_call_started`、`tool_call_finished`、`tool_call_ready`、
  `tool_result_upload_wait`、`tool_storm_suppressed`、
  `tool_catalog_changed`。
- interaction：`approval_requested`、`approval_resolved`、
  `user_input_requested`、`user_input_resolved`。
- runtime side panels：`compaction_started`、`compaction_completed`、
  `goal_updated`、`goal_cleared`、`todos_updated`、`todos_cleared`。
- diagnostics：`pipeline_stage`、`usage`、`error`、`heartbeat`。

Kun capability manifest 已覆盖：

- model：模型 id、输入/输出模态、tool calling、context window、message part
  支持。
- CLI：`serve` / `run` / `chat` / `exec` 状态。
- MCP：配置数、连接数、tool count、tool search direct/search/auto。
- Web：fetch/search 独立 capability 和 provider。
- Skills：root 数和发现 skill 数。
- Subagents：并行上限和 child run 上限。
- Attachments：图片大小、尺寸、mime type、text fallback。
- Memory：scope 和注入上限。
- Runtime info：host、port、dataDir、model、approvalPolicy、sandboxMode、
  tokenEconomyMode、insecure、pid、startedAt。

Renderer 当前已能消费的中性语义：

- `ChatBlock`：user、assistant、reasoning、tool、compaction、review、
  system、approval、user_input。
- `ThreadEventSink`：seq、deltas、user message、tool、compaction、review、
  approval、user input/status、runtime status、runtime error、goal、todos、
  usage、turn complete。

### Codex 当前能力与缺口

Codex main-side 当前已支持：

- stdio JSON-RPC `initialize`、`thread/start`、`thread/list`、`thread/read`、
  `turn/start`、`turn/interrupt`、`turn/steer`。
- GUI-owned thread/event store，用稳定 GUI thread id 绑定可变 app-server thread
  id。
- app-server event 归一化：assistant delta、reasoning text/summary delta、
  command/file delta、turn completed/failed/cancelled、approval/user-input
  fail-closed。
- 中性 `agentRuntime:*` IPC 实时事件，以及 legacy RuntimeHost 兼容路径的 stored
  event replay；renderer 专用 `codex:*` IPC 已删除。

Codex 接入中性接口时必须显式暴露的差异：

- `threadMaterialization = 'after_first_user_message'`，不能假设空 thread 可
  `includeTurns`。
- `events.delivery = 'ipc'` 初期成立；迁移完成后可以统一成 main-side
  `AsyncIterable<AgentRuntimeEvent>`。
- `reasoning.visibility` 只能按 app-server 实际事件声明：当前最多是
  `summary` / `trace`，不能承诺 Kun 式完整思考。
- `approval` / `userInput` 通过 app-server server-originated request 的同一
  JSON-RPC id 回写 response；Codex capability 声明为 `async`。
- `usage`、attachments、memory、review、fork、resumeSession 初期不可用或
  unsupported。
- 必须新增 latency phase events：`process_start`、`initialize_start/done`、
  `thread_start_done`、`turn_start_sent`、`first_delta`、`turn_done`，用于定位
  “Codex backend 慢”到底慢在启动、初始化、首 token、模型响应还是工具执行。

### 模块落点

新增或收敛到以下模块，保持最小侵入：

```text
src/shared/agent-runtime-contract.ts
  中性 AgentRuntime DTO、events、capabilities、failure/result 类型。

src/main/runtime/agent-runtime/
  host.ts                 # 根据 activeAgentRuntime 选择 adapter
  adapter.ts              # main-side AgentRuntimeAdapter interface
  event-store.ts          # 可选：共享 replay helper，不知道 backend 细节

src/main/runtime/kun-agent-runtime-adapter.ts
  Kun HTTP/SSE -> AgentRuntimeAdapter；把 Kun DTO 映射到中性 AgentRuntime。

src/main/runtime/codex/codex-agent-runtime-adapter.ts
  Codex app-server service -> AgentRuntimeAdapter；继续放在 codex 子目录。

src/main/runtime/codex/app-server/
  从 codexia 复用/改写的 app-server capsule：protocol、stdio JSON-RPC、
  server request registry、event normalizer、reasoning config、README。

src/renderer/src/agent/agent-runtime-client.ts
  renderer 只调用中性 preload IPC，不知道 Kun endpoint 或 Codex IPC。

src/renderer/src/agent/agent-runtime-event-dispatcher.ts
  AgentRuntimeEvent -> ThreadEventSink / ChatBlock。
```

迁移完成后，`KunRuntimeProvider` 与 `CodexRuntimeProvider` 可以收敛成一个
`AgentRuntimeProvider`，差异来自 `capabilities()`，而不是 renderer 里的
`if runtime === codex` 分支。

## Settings 目标形态

新增显式运行时选择字段，保留 `agents.kun`，新增 `agents.codex`：

```json
{
  "activeAgentRuntime": "kun",
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 8899,
      "autoStart": true,
      "apiKey": "",
      "baseUrl": "",
      "providerId": "",
      "runtimeToken": "",
      "dataDir": "~/.deepseekgui/kun",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write"
    },
    "codex": {
      "command": "codex",
      "args": [],
      "autoStart": true,
      "codexHome": "~/.deepseekgui/codex",
      "profile": "deepseek-gui",
      "model": "deepseek-v4-pro",
      "modelProvider": "deepseek",
      "approvalPolicy": "on-request",
      "sandboxMode": "workspace-write",
      "inheritModelProvider": true
    }
  }
}
```

Codex 支持两个配置模式：

- **GUI 托管 CODEX_HOME**：DeepSeek-GUI 根据当前 model provider settings 生成
  Codex config，写到 app userData 下的 Codex home。
- **外部 CODEX_HOME**：高级用户填写已有 `codexHome` / `command` / `profile`，
  GUI 只负责启动和检查，不改写其配置。

## 当前执行路线

当前实现状态：

- 已完成第一阶段最小侵入迁移：settings/schema、main-side Codex app-server client
  与 service、preload IPC、renderer Codex provider、Settings UI、Write registry
  runtime 隔离、相关文档和 focused tests。
- 已完成第二阶段最小侵入补齐：GUI-owned Codex thread/event store、
  minimal RuntimeHost request routing、连接手机 / 定时任务 runtime id 隔离、
  Codex approval / user input fail-closed。
- 已完成第三阶段收口：RuntimeHost SSE 入口改为统一委派；Kun 继续走原 HTTP
  SSE，Codex 中性 `subscribeEvents` 先回放 GUI-owned event store，再继续接收
  Codex service live event 广播；旧 `codex:event` IPC 仅保留为兼容路径；
  Codex compact/fork/resume 和 approval/input 控制语义显式 fail-closed；停止运行中
  的 Codex turn 时会把 `discard` 传到 main service 并关闭 stdio session。
- 已完成 Codex approval / user input 双向桥补充调查：DeepSeek-GUI 与 SciForge
  没有独立的 `approval_response` / `input_response` JSON-RPC 方法；但
  `codexia` 已有可参考实现，证明 app-server 会以 server-originated request
  形式等待同一 JSON-RPC id 的同步/异步 result。当前 DeepSeek-GUI 仍保守
  fail-closed；下一阶段应把 request 暂存、投递成中性
  `approval_requested` / `user_input_requested`，并在用户操作后回写同 id response。
- 已完成：Electron binary / better-sqlite3 native module 环境修复后的完整 build、
  focused tests、Codex app-server 真实配置 smoke 和 Kun 回归 smoke。
- 当前代码选择比原 P2/P3 更收敛的落点：renderer 走中性 `agentRuntime:*`
  IPC；Codex app-server 细节留在 `src/main/runtime/codex/` service；Kun 原
  HTTP/SSE 行为保持不变，只在入口层通过 RuntimeHost/AgentRuntimeHost 委派。
- 下一阶段目标：继续硬化 `docs/agent-runtime-contract.md` 描述的中性
  AgentRuntime contract；Codex 专用 renderer IPC 已删除，剩余清理聚焦旧 Kun
  兼容入口和重复文档/测试夹具。
- 已修复 2026-06-11 调试中发现的问题：
  - active runtime 为 Codex 时，Settings / Initial setup 的 API key 判断改为读取
    共享 provider API key，不再误提示“需要先配置 API Key”。
  - Codex app-server `thread/start` 使用字符串 sandbox，`turn/start` 使用对象
    sandboxPolicy，匹配当前 app-server 协议。
  - 重复 `connect()` 复用 initialize handshake，避免 app-server 返回
    `Already initialized`。
  - Codex thread store 写入改成串行 + 原子 rename，并能从 valid JSON prefix
    恢复一次尾部损坏的 snapshot。
  - app-server 请求失败后丢弃缓存 client；用户修复 command / CODEX_HOME 后，
    不重启 app 也能重新连接。
  - 真实 UI 调试暴露出 Codex app-server 空线程/未物化线程恢复问题：renderer 走
    Kun 兼容 `/v1/threads` 通道时，GUI thread id 不能假设永远等同于
    app-server thread id。当前修复方向是把 GUI id 保持稳定，底层 Codex thread
    缺失时在 service 层重新物化并重试发送。

### P0：改写产品约束与任务入口

目标：先把“单运行时 Kun”的文档约束改成“Kun 默认、Codex 可选”。

- [x] 修改 `docs/AGENTS.md` / `docs/AGENTS.zh-CN.md`：允许新增 `codex`
  runtime，但继续禁止 CodeWhale / Reasonix。
- [x] 修改 `docs/kun-architecture.md` / `.en.md`：把它降级为 Kun runtime
  说明，不再作为全产品单运行时约束。
- [x] 修改 `DESIGN.md` / `DESIGN.zh-CN.md` / `README.md`：描述 RuntimeHost
  双运行时边界。
- [x] 保留 Kun cache optimization 文档，不把 Codex 运行时混入 Kun 内部。

验收：

- [x] 文档中不再出现“只能有 Kun 一个 live runtime”的硬约束。
- [x] 文档仍明确旧 CodeWhale / Reasonix 不回归。

### P1：运行时 settings 和 schema

目标：settings 能表达 `kun | codex` 选择，且旧用户配置安全迁移。

- [x] 在 `src/shared/app-settings-types.ts` 增加
  `AgentRuntimeId = 'kun' | 'codex'`、`CodexRuntimeSettingsV1`、
  `activeAgentRuntime`。
- [x] 新增 `src/shared/app-settings-codex.ts`，实现 default / merge /
  normalize / patch helper。
- [x] 修改 `src/shared/app-settings-normalize.ts` 和
  `src/main/settings-store.ts`，让旧 settings 默认迁移为
  `activeAgentRuntime: 'kun'`。
- [x] 修改 `src/main/ipc/app-ipc-schemas.ts`，允许 patch
  `activeAgentRuntime` 和 `agents.codex`。
- [x] 增加 settings 单测：旧 Kun-only 文件、legacy provider 文件、新 Codex
  patch、保存后不会丢 Kun。

验收：

- [x] `npm test -- src/main/settings-store.test.ts src/shared/app-settings.test.ts`
  通过。
- [x] 保存 settings 后同时保留 `agents.kun` 和 `agents.codex`。

### P2：最小运行时选择器

目标：用最少代码让 main process 能选择 Kun 或 Codex；先不大改 Kun 内部。

- [x] 新增 `src/main/runtime/runtime-adapter.ts`，只放最小接口：
  `id`、`ensureRunning`、`stopAndWait`、`isChildRunning`、`request`、
  `startEvents`。
- [x] 新增 `src/main/runtime/runtime-host.ts`，只负责读取
  `activeAgentRuntime` 并委派到 Kun 或 Codex adapter。
- [x] 保持 `src/main/runtime/kun-adapter.ts` 现有行为；只补齐最小接口，不移动
  Kun process/config 代码。
- [x] `src/main/index.ts` 先保留现有 Kun helper；新增的 runtime-neutral
  wrapper 调用它，避免一次性大重构。
- [x] `src/main/runtime-sse-ipc.ts` 只改入口：从 RuntimeHost 获取事件流。Kun
  仍走原 HTTP SSE，Codex 走 `src/main/runtime/codex/` 内部事件 store。

验收：

- [x] 所有现有 Kun tests 不改预期继续通过；Electron binary 修复后
  `npm test` 全量通过。
- [x] active runtime 为 Kun 时，Code / Write / 连接手机行为不变。

### P3：迁移 Codex app-server client

目标：把 SciForge 的 Codex app-server stdio JSON-RPC client 剪裁进本项目。

- [x] 新增 `src/main/runtime/codex/codex-app-server-client.ts`，迁移
  JSON-RPC process/session、`initialize`、`thread/start`、`thread/resume`、
  `turn/start`、`turn/interrupt`、`turn/steer`。
- [x] 新增 `src/main/runtime/codex/codex-event-normalizer.ts`，只保留
  message/tool/progress/approval/done/failed/cancelled 的稳定映射。
- [x] 新增 `src/main/runtime/codex/codex-config.ts`，支持 GUI 托管
  `CODEX_HOME` 和外部 `CODEX_HOME` 两种模式。
- [x] 新增 main-side Codex adapter；P10 收敛后移除旧
  `codex-runtime-adapter.ts` 伪 Kun endpoint 投影。
- [x] 新增 `src/main/runtime/codex/index.ts`，只从这个文件向外导出 Codex
  runtime 能力；外部文件不直接 import 子目录内部模块。
- [x] 新增 fake app-server fixture 测试，覆盖 initialize、thread start、
  resume、turn start、message delta、done、failed、interrupt。

验收：

- [x] 不引入 SciForge workspace server / Model Router / Browser /
  Computer Use 依赖。
- [x] Codex adapter 缺配置时返回结构化 `runtime_error`，不抛未处理异常。

### P4：Codex thread/event store 与 GUI 兼容层

目标：Codex app-server 事件能被现有 Chat UI 当作一个 provider 使用。

- [x] 新增 `src/main/runtime/codex/codex-thread-store.ts`，在 app userData 下
  保存 GUI thread id、Codex `threadId`、workspace、title、createdAt、
  updatedAt、archived、latestSeq、runtime id。
- [x] 新增 `src/main/runtime/codex/codex-event-store.ts`，保存每个 turn 的
  normalized event JSONL，用于 reload / resume / fork。
- [x] 实现 Codex provider service：list/create/get detail/send turn/interrupt。
- [x] Codex compact no-op or unsupported/fork/resume。
- [x] 把 Codex normalized events 映射为现有 `ChatBlock` 所需字段；tool 输出
  默认折叠为 summary/audit，避免 raw stderr 外露。
- [x] Codex SSE 使用 GUI event store seq，不直接暴露 JSON-RPC raw event。

验收：

- [x] renderer reload 后仍能看到 Codex thread 列表和历史消息。
- [x] Codex turn 结束后能得到 assistant message 或明确 blocked/failed 状态。
- [x] Codex thread id 不写入 Kun data dir。

### P5：Renderer provider registry 和设置 UI

目标：用户可以在设置里选择 Kun 或 Codex，Code workbench 使用当前 provider。

- [x] 修改 `src/renderer/src/agent/registry.ts`：P10 收敛后始终返回
  `AgentRuntimeProvider`，不再保留 Kun / Codex renderer provider 分叉。
- [x] P10 收敛后删除 `src/renderer/src/agent/codex-runtime.ts`。
- [x] P10 收敛后删除 `src/renderer/src/agent/codex-mapper.ts` 和旧 focused
  tests。
- [x] 修改 chat store：settings 变更时重建 provider cache，并按 runtime id
  重新加载线程列表。
- [x] 修改 `src/renderer/src/components/settings-section-agents.tsx`，增加
  Kun / Codex segmented control；Kun 展示原配置，Codex 展示 command、
  codexHome、profile、model、approval、sandbox、继承 provider 开关。
- [x] 更新 i18n 文案。

验收：

- [x] 默认安装只显示 Kun 已选中，Codex 未配置也不影响 Kun。
- [x] 切到 Codex 后，新建 Code 会话走 Codex provider。
- [x] 切回 Kun 后，Kun 会话列表和发送消息仍正常。

### P6：Write / 连接手机 / 定时任务运行时策略

目标：所有后台入口都明确知道自己使用哪个 runtime。

- [x] 为 Write assistant thread registry 增加 runtime id；inline completion
  继续保持 direct provider path。
- [x] 为 `claw` channel / conversation thread mapping 增加
  `agentThreadIds.codex`，保留 `agentThreadIds.kun`。
- [x] 为 schedule task 增加 runtime id，默认跟随创建任务时的
  `activeAgentRuntime`，后续运行不因用户切换设置而漂移。
- [x] 修改 `src/main/claw-runtime.ts`、`src/main/schedule-runtime.ts`，通过
  RuntimeHost 创建和发送 turn。
- [x] 增加迁移：旧 `agentThreadIds.kun` 不变；没有 runtime id 的旧任务视为
  Kun。

验收：

- [x] Connect phone 手动任务能在 Kun 下继续运行。
- [x] Codex 下创建的新 schedule task 不写入 Kun thread mapping。
- [x] 旧 settings 迁移后后台任务默认仍用 Kun。

### P7：停止、取消、审批与用户输入

目标：把两个 runtime 的控制语义对齐到 GUI。

- [x] Kun 保持现有 approval / user input / interrupt 路径。
- [x] Codex 初版支持 cancel / interrupt。
- [x] Codex approval 和 user input 如果上游 app-server 事件缺少可回复桥，则显示
  blocked，并提示需要下一阶段实现。
- [x] 调查 Codex app-server approval/input 双向桥：没有独立 response 方法，
  但 `codexia` 证明可以对 app-server 主动发来的 JSON-RPC request id 写回
  response。当前版本仍保持默认拒绝 approval、取消 elicitation、空 user input。
- [x] 基于 `codexia` 模式实现 Codex pending server request registry：
  收到 request 时不立即拒绝，先映射成中性 approval/user-input event；
  用户操作后调用 `sendResponse(requestId, result)`。
- [x] Codex request registry 必须放在 `src/main/runtime/codex/app-server/`
  capsule 内；外部只通过 `CodexRuntimeService.resolveApproval/resolveUserInput`
  一类方法调用，避免旁路。
- [x] Codex approval 第一版不做自动允许策略；command/file approval 均走中性
  approval 卡片，未知 request fail closed。
- [x] Codex user input 复用现有中性 user_input 卡片，不新增 Codex 专用 renderer
  UI。
- [x] 所有控制消息必须校验 active thread / turn id，避免回复到旧 turn。

验收：

- [x] Codex 正在运行时点击停止会中断 turn 并关闭 stdio session。
- [x] 不支持的 approval/input 不会被当成成功执行。

### P8：中性 AgentRuntime contract

目标：把当前半中性的 `AgentProvider` / `ThreadEventSink` 收敛成共享
AgentRuntime contract，作为 Kun 与 Codex 的唯一产品接口。

- [x] 新增 `src/shared/agent-runtime-contract.ts`，定义
  `AgentRuntimeThread`、`AgentRuntimeThreadDetail`、
  `AgentRuntimeTurnHandle`、`AgentRuntimeEvent`、
  `AgentRuntimeCapabilities`、`AgentRuntimeResult` 和
  `AgentRuntimeFailure`。
- [x] 把 `docs/agent-runtime-contract.md` 中的事件 kind 固化成 TypeScript
  discriminated union：thread/turn lifecycle、runtime status、user message、
  assistant delta、reasoning delta、item snapshot、tool event、approval、
  user input、compaction、review、goal、todo、usage、error、heartbeat。
- [x] capability 必须覆盖 Kun 已有 manifest：model、MCP、web、skills、
  subagents、attachments、memory、usage、tool diagnostics；同时补上 Codex
  所需的 transport、thread materialization、reasoning visibility、latency
  metrics、approval/user-input support。
- [x] 新增 runtime status phase 类型：`process_start`、`initialize_start`、
  `initialize_done`、`thread_start_done`、`turn_start_sent`、`first_delta`、
  `turn_done`、`tool_running`，用于定位 Codex 慢在哪里。
- [x] 规定 reasoning 可见性：Kun 可以声明 `full_runtime_text`；Codex 只能按
  app-server 实际事件声明 `summary` / `trace` / `none`，不能补写或伪装完整思考。
- [x] 文档明确多 agent CLI 不属于本阶段核心代码迁移范围；未来通过 A2A/MCP/
  外部 bridge 或独立 adapter 接入，不复制 Codexia 的平台外壳。
- [x] 为 contract 增加 focused tests / fixture，确保事件 union 可被 exhaustive
  dispatch，capability 默认值不会误把 unsupported 功能展示成 available。

验收：

- [x] shared contract 不 import renderer、Electron、Kun server 或 Codex
  app-server 具体模块。
- [x] `npm test -- src/shared/agent-runtime-contract.test.ts` 通过。
- [x] 文档 `docs/agent-runtime-contract.md` 与实际类型字段一致。

### P9：Kun / Codex 接入中性 runtime

目标：main process 只暴露中性 AgentRuntimeHost；Kun 与 Codex 都作为 adapter
接入，保留内部协议但不泄漏给 renderer。

- [x] 新增 `src/main/runtime/agent-runtime/adapter.ts`，定义 main-side
  `AgentRuntimeAdapter`，包括 connect/capabilities/list/start/read/startTurn/
  interrupt/steer/subscribeEvents/controls。
- [x] 新增 `src/main/runtime/agent-runtime/host.ts`，根据
  `activeAgentRuntime` 选择 Kun 或 Codex adapter；旧 `runtime-host.ts` 只保留
  兼容入口或迁移到新 host。
- [x] 新增 `src/main/runtime/kun-agent-runtime-adapter.ts`，把 Kun HTTP/SSE
  contract 映射成 `AgentRuntimeAdapter`；初期复用 `kun-adapter.ts`、
  `kunRuntimeEvents` 和 renderer 现有 mapper 的纯转换逻辑，不移动 Kun internals。
- [x] 新增 `src/main/runtime/codex/codex-agent-runtime-adapter.ts`，把
  `CodexRuntimeService` 映射成 `AgentRuntimeAdapter`；继续把 app-server client、
  config、thread/event store、event normalizer 留在 `src/main/runtime/codex/`。
- [x] 新增 `src/main/runtime/codex/app-server/` capsule，并把可从 `codexia`
  直接复制/改写的 app-server 能力集中到这里：
  `protocol.ts`、`json-rpc-client.ts`、`server-requests.ts`、
  `request-registry.ts`、`event-normalizer.ts`、`reasoning-config.ts`、
  `README.md`。
- [x] 把 Codex raw app-server event 归一化为 `AgentRuntimeEvent`，并补齐
  latency phase events、first delta 统计、turn duration 统计。
- [x] Kun adapter 暴露 `capabilities()` 时，从现有 Kun runtime info /
  capability manifest 映射到中性 capability，不丢 MCP/web/skills/subagents/
  attachments/memory 信息。
- [x] Codex adapter 暴露 `capabilities()` 时，明确声明
  `threadMaterialization = 'after_first_user_message'`；approval/userInput 在
  server-request response registry 完成前为 `fail_closed`，完成后升级为
  `async`；usage/attachments/memory/review/fork/resume 按实际支持声明
  unsupported 或 degraded。
- [x] Preload 新增中性 IPC：`agentRuntime:connect`、
  `agentRuntime:capabilities`、`agentRuntime:listThreads`、
  `agentRuntime:startThread`、`agentRuntime:readThread`、
  `agentRuntime:startTurn`、`agentRuntime:interruptTurn`、
  `agentRuntime:steerTurn`、`agentRuntime:subscribeEvents`、
  `agentRuntime:resolveApproval`、`agentRuntime:resolveUserInput`。
- [x] Codex app-server request normalizer 覆盖
  `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、
  `item/tool/requestUserInput`、`mcpServer/elicitation/request`、
  `item/permissions/requestApproval`；未知 request 必须 fail closed 且生成
  可见 recoverable error。
- [x] Codex reasoning 参数生成集中到 `reasoning-config.ts`，确保
  `thread/start` config 和 `turn/start` params 都能显式表达 effort / summary /
  raw reasoning 可见性；不要散落在 service 和 adapter 里。
- [x] 实现顺序优先 Codex approval / user input 双向交互；event bus 大收敛在
  该交互闭环通过 focused tests 后推进。
- [x] 旧 `runtimeRequest` / `startSse` 保持兼容一轮，但新代码不再新增对它们
  的依赖；renderer 专用 `codex:*` IPC 已删除。

验收：

- [x] Kun 通过中性 adapter 完成 list/create/read/startTurn/subscribeEvents/
  interrupt，现有 Kun HTTP/SSE 行为不回归。
- [x] Codex 通过中性 adapter 完成 list/create/read/startTurn/subscribeEvents/
  interrupt，GUI thread id 与 app-server thread id 继续隔离。
- [x] `npm test -- src/main/runtime/agent-runtime src/main/runtime/runtime-host.test.ts src/main/runtime/codex`
  通过。

### P10：Renderer 收敛、Computer Use E2E 与代码清理

目标：renderer 只消费中性 AgentRuntimeProvider，真实 UI 上 Kun 与 Codex 端到端
都通过；最后删除临时兼容和重复代码，保持代码简洁凝练。

- [x] 新增 `src/renderer/src/agent/agent-runtime-client.ts`，只调用中性 preload
  IPC，不知道 Kun endpoint 或 Codex IPC。
- [x] 新增 `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`，把
  `AgentRuntimeEvent` 统一投递到 `ThreadEventSink` / `ChatBlock`。
- [x] 新增或改造 `AgentRuntimeProvider`，替代 `KunRuntimeProvider` /
  `CodexRuntimeProvider` 的分叉；UI 差异只来自 `capabilities()`。
- [x] Settings / Code / Write / 连接手机 / 定时任务继续只读取
  `activeAgentRuntime`，不直接判断 `kun` 或 `codex` 的具体 transport。
- [ ] 用 Computer Use 做真实 Electron UI smoke，不能只用 CDP 或 direct IPC：
  切到 Codex、创建/选择 thread、输入消息、发送、看到真实 assistant 回复、
  停止 turn；recoverable error 另作为错误路径验证，不能替代正常路径。
- [ ] 用 Computer Use 做真实 Electron UI smoke：切到 Kun、创建/选择 thread、
  输入消息、发送、看到真实 assistant 回复、停止 turn。
- [ ] Computer Use smoke 需要记录 marker、当前 URL、active runtime、是否出现
  latency phase / reasoning visibility 表示；失败时记录截图/可见错误文本和日志
  路径。
- [x] 2026-06-11 Computer Use blocker：`list_apps`、
  `get_app_state("DeepSeek GUI")`、`get_app_state("Electron")` 均在 120s
  超时；未用 CDP/direct IPC 替代真实 smoke，因此上面 3 项保持未勾。
- [x] 2026-06-11 retry：已显式重启 `Codex Computer Use.app` 后台
  `SkyComputerUseService`，新 PID 出现；`SkyComputerUseClient` 短暂启动后退出，
  当前 Codex MCP 工具变为 `Transport closed`。重新执行 `npm run build` 通过；
  Computer Use 真实 smoke 仍未执行，因此上面 3 项继续保持未勾。
- [x] 2026-06-11 desktop bug retry：真实桌面截图发现 Codex turn 发送
  `reasoningEffort = "max"` 时 app-server 报
  `unknown variant max`；已在 Codex app-server reasoning 边界把跨 runtime
  alias 归一化为 `max -> xhigh`、`off -> none`，并补上 missing GUI thread
  mapping 的 rematerialize 重试，避免新建/乐观 GUI thread 被当成 Codex
  thread id 后直接失败。后续代码审计发现 rematerialize 还必须检查 event store
  中的实际 GUI 历史；已改为在本次 runtime status 写入前读取历史快照，只有
  stored thread / event blocks 均为空时才物化新 Codex thread，且纯 runtime status
  不再凭空创建 thread-store 映射。Electron PID 61913 的截图确认顶部错误条消失。
  该验证来自 macOS 截屏和日志，不替代 Computer Use 真实 smoke，所以上面 3 项
  继续保持未勾。
- [x] 2026-06-11 只读审计：Computer Use `list_apps` 当前仍 120s 超时；
  P10 三个 Computer Use smoke 项继续未勾。审计同时确认已有 Codex/Kun UI marker
  持久化证据只能辅助排障，不能替代“由 Computer Use 操作”的验收。
- [x] 2026-06-11 desktop restart verification：重新执行 `npm run build` 通过，
  最新 `out/main/index.js` 包含 `max -> xhigh` reasoning alias 和
  rematerialize/event-store guard；旧 Electron PID 61913 早于最新 build，已退出并
  重启为 PID 54877。macOS 截图 `/tmp/deepseek-gui-desktop-restarted.png` 确认
  `DeepSeek GUI` 窗口可见，`127.0.0.1:8787/8788` 重新监听；日志只新增 startup
  记录，未再次出现 `unknown variant max` 或 `thread not found`。Computer Use
  MCP 仍为 `Transport closed`，所以上面 3 项继续保持未勾。
- [x] 2026-06-11 status-only empty Codex thread fix：并行代码审计发现空
  Codex GUI thread 只持久化 runtime status 后会因为 `latestSeq > 0` 被误判为
  非空，仍可能跳过 rematerialize 并在桌面暴露 `thread not found`。已改为有
  stored detail 时以实际 chat blocks 判定是否有历史，保留用户/助手/工具/错误
  历史禁止 rematerialize 的保护；同时 `startTurn()` 现在返回 app-server
  `userMessageItemId`，避免 renderer 后续模型标记对不上。新增回归测试覆盖
  status-only 空线程恢复和 `userMessageItemId` 返回值；Electron 已重启为 PID
  91477，截图 `/tmp/deepseek-gui-desktop-after-status-fix.png` 确认窗口可见，日志
  只新增 startup 记录。Computer Use MCP 仍为 `Transport closed`，所以上面 3 项
  继续保持未勾。
- [x] 2026-06-11 runtime switch isolation hardening：并行审计发现 Settings 切换
  `activeAgentRuntime` 后，`refreshThreads()` 可能把旧 runtime 的 active thread
  作为 pending thread 保留，导致 Kun thread 混入 Codex sidebar；同时
  renderer event subscription 没有 pin runtime id，设置切换后可能订阅到当前
  settings 的 runtime。已改为只保留属于当前 active runtime 的 pending active
  thread，并在 `subscribeEvents` 请求中传入订阅开始时的 runtime id。新增 focused
  tests 覆盖 Kun -> Codex 后旧 active thread 被清理、同 runtime pending thread
  仍保留、事件订阅带 `runtimeId`；`npm test --
  src/renderer/src/store/chat-store-navigation-actions.test.ts
  src/renderer/src/agent/agent-runtime-client.test.ts
  src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/store/chat-store-thread-actions.test.ts
  src/main/runtime/codex/codex-service.test.ts` 通过，5 files / 38 tests passed；
  `npm run typecheck` 通过；renderer 旧通道扫描只剩普通 `codex:` registry/settings
  字符串，没有生产代码直接调用 `runtimeRequest` / `startSse` / `codex:*` IPC。
- [x] 2026-06-11 runtime switch follow-up hardening：二次并行审计发现隐藏 SDD
  assistant thread 仍可能绕过 pending-thread runtime guard，并且 approval /
  user-input 回复只记录 request id -> thread id，用户在请求出现后切换 runtime
  时可能把 Codex request 发给 Kun。已补齐 SDD preserved active thread 的 runtime
  guard，并把 interaction request map 升级为 request id -> `{ threadId,
  runtimeId }`。新增 focused tests 覆盖 legacy Kun 空 runtime id 仍按 Kun 保留、
  上一 runtime 的隐藏 SDD active thread 被清理、approval/user-input 使用请求产生
  时的 runtime；`npm test --
  src/renderer/src/store/chat-store-navigation-actions.test.ts` 通过，1 file / 4
  tests passed；`npm test --
  src/renderer/src/agent/agent-runtime-provider.test.ts` 通过，1 file / 6 tests
  passed。
- [x] 2026-06-11 turn completion / stop button desktop bug fix：真实桌面截图发现
  Codex turn 已 completed 但 UI 仍显示“推进中”；同时中止按钮在缺少
  `currentTurnId`、runtime 已返回 `turn_not_running` 或 stop 后立即 drain queue
  时看起来无反应。已让 terminal `runtime_status.phase = turn_done` 清理
  `busy/currentTurnId/currentTurnUserId`，不会在 `turn_completed` 后重新置 busy；
  `turnComplete` 也会 settle 残留的 running tool / pending approval 等 runtime
  work，避免 `turnPending` 继续让 timeline 显示“推进中”；点击中止会先 abort
  本地 SSE 并 settle UI，再等待 runtime interrupt 返回。interrupt 成功、陈旧
  busy、`turn_not_running` 都会 settle 本地 pending work，且用户中止后不自动
  drain queued messages。focused tests 覆盖 terminal status-only completion、
  completion 后 terminal status、turnComplete settle stale pending work、interrupt
  click immediate local settle、stale busy interrupt 和 stale turn interrupt；
  `npm test --
  src/renderer/src/store/chat-store-maintenance-actions.test.ts
  src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/agent/agent-runtime-event-dispatcher.test.ts
  src/renderer/src/store/chat-store-runtime.test.ts` 通过，4 files / 46 tests
  passed。
- [x] 2026-06-11 capability alignment hardening：并行审计发现 Codex 下
  `/compact` 为 noop、`/fork`/`/btw`/`/review`/`/goal`/`/skill:*` 不支持但
  UI 仍暴露，且部分 store action 会把 unsupported/noop 当成功入口执行。已在
  中性 `AgentRuntimeCapabilities.controls` 增加 review/goals/todos 能力位，
  renderer provider 将 compact noop 映射为不可用；FloatingComposer、Workbench
  topbar/changed-files review、maintenance actions 和 side conversation action
  均改为按 active runtime capability 显示和执行。focused tests 覆盖不可用
  slash commands 隐藏、compact/fork/goal store guard；`npm test --
  src/renderer/src/components/chat/FloatingComposer.test.ts
  src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/store/chat-store-maintenance-actions.test.ts` 通过，3 files /
  57 tests passed；`npm test --
  src/renderer/src/store/chat-store-side-actions.test.ts` 通过，1 file / 9 tests
  passed。
- [x] 2026-06-11 Codex model/runtime auxiliary alignment：并行审计发现 active
  runtime 为 Codex 时 renderer 会把 Kun/DeepSeek `composerModel` 透传到
  Codex `turn/start`，覆盖 Codex settings model；thread-scoped auxiliary
  operations 在设置切换后仍可能使用 active runtime。已在
  `AgentRuntimeProvider.sendUserMessage` 对 Codex turn 丢弃 renderer model，
  保留 reasoning/displayText；review/goal/todo/archive/update workspace 等
  thread-scoped auxiliary 改用 remembered thread runtime，`cancelUserInput`
  使用 request id -> `{ threadId, runtimeId }` 映射。focused provider tests
  覆盖 Codex 不转发 DeepSeek model，以及 active runtime 切换后 auxiliary 仍
  路由到产生该 thread/request 的 runtime。
- [x] 2026-06-11 queued message / thread-runtime fail-closed hardening：并行审计
  发现 queued user message、stale recovery 和冷 provider thread-bound 操作仍可能
  依赖当前 active runtime。已为 queued message 记录原始 `threadId/runtimeId` 并在
  drain 时丢弃跨线程或跨 runtime 的陈旧消息；`recoverActiveTurn` 在用户切走后不再
  恢复旧 thread；`AgentRuntimeProvider` 对未知 thread-bound 操作 fail closed，不再
  fallback 到 active runtime；store 的 select/send/recover/interrupt/compact/fork/
  goal/todo/navigation/side/Claw/turn-completion polling 入口均从 thread snapshot
  显式播种 runtime。focused tests 覆盖跨线程 queued message 丢弃、stale recovery
  不覆盖当前 thread、未知 thread-bound send 拒绝、registry 显式 runtime 绑定；
  `npm test`、`npm run typecheck`、`npm run build`、`git diff --check` 全部通过。
- [x] 2026-06-11 feature alignment follow-up：并行审计发现 Settings 底部
  permissions 卡片仍像全局设置，Codex 表单还暴露 Kun-only `auto` / `suggest` /
  `external-sandbox` 值，Composer footer 还残留不可见的 Kun execution picker
  wiring；旧 `startSse` bridge 没有 runtimeId，Claw/Schedule Codex-bound 任务会
  继续尝试 legacy Kun `/v1`，Claw renderer 选择/删除/重置会忽略 channel 或
  conversation 已保存的 runtime binding。已分别修为 Kun-specific 文案、
  Codex-supported permission options、删除 dead Composer execution wiring、
  `startSse` 可选 runtimeId 且默认 Kun、Claw/Schedule 非 Kun fail closed、Claw
  renderer 优先使用 conversation/channel runtime binding；同时
  `cancelUserInput` 在缺 request mapping 时 fail closed，不再 fallback active
  runtime。focused tests 覆盖 Settings、app-settings normalization、Composer、
  provider cancel、SSE bridge、Claw/Schedule 和 Claw renderer runtime binding。
- [x] 2026-06-11 Computer Use retry after runtime isolation fix：清理残留
  `SkyComputerUseClient` 进程并重新打开 bundled `Codex Computer Use.app` 后，
  `SkyComputerUseService` 进程可见，但 `mcp__computer_use.get_app_state("Electron")`
  与 `mcp__computer_use.list_apps` 均立即返回 `Transport closed`。因此无法由
  Computer Use 点击/输入/观察真实 Electron UI；P10 三个 Computer Use smoke 项和
  总验收项继续保持未勾，不用 CDP/direct IPC 替代。
- [x] 2026-06-11 resumed Computer Use retry：当前 Electron PID 91477 仍在，
  `127.0.0.1:8787/8788` 监听正常。再次清理多余
  `SkyComputerUseClient mcp`，重新打开
  `~/.codex/computer-use/Codex Computer Use.app` 后，
  `SkyComputerUseService` PID 94355 可见；但
  `mcp__computer_use.list_apps` 和
  `mcp__computer_use.get_app_state("Electron")` 仍立即返回
  `Transport closed`。未用截图/CDP/direct IPC 替代真实 Computer Use 验收；
  P10 三个 Computer Use smoke 项和总验收项继续保持未勾。
- [x] 2026-06-11 cleanup after resumed audit：把 README / DESIGN /
  package metadata 中仍暗示 Codex 后台任务已完整可执行的文案降级为当前事实：
  Connect phone / Schedule 会记录 runtime id，非 Kun 后台执行当前 fail closed，
  不会把 Codex thread id 写入 Kun mapping；删除 production 已无 import 的旧
  renderer `kun-mapper.ts` 和对应 legacy test，并把文档引用改到
  `kun-agent-runtime-adapter` / `agent-runtime-event-dispatcher`。验证：
  `rg` 确认无 `kun-mapper` 悬空引用；`npm run typecheck` 通过；`npm test`
  通过，138 files / 864 tests passed；`npm run build` 通过；`git diff --check`
  通过。
- [x] 清理冗余：删除 renderer 侧不再使用的 `codex-runtime.ts` /
  `codex-mapper.ts` 或降级为薄兼容 shim；删除不再使用的 Codex 专用 preload
  IPC；删除 RuntimeHost 中 Codex 伪 Kun endpoint 投影；删除重复 DTO 和 mapper。
- [x] 清理后跑死代码扫描：`rg` 确认没有新代码 import 已弃用模块；保留的兼容
  shim 必须有注释说明删除条件。
- [x] 更新 `docs/AGENTS.md`、`docs/kun-architecture.md`、README/DESIGN 中的
  runtime 链路说明，指向 `docs/agent-runtime-contract.md`。
- [x] 2026-06-11 git review hardening：根据并行 reviewer 发现补齐
  `user_input.questions` 在 thread detail / item snapshot 回放中的结构化保真；
  settings IPC schema 与 normalizer 允许并保留 Claw/Schedule 的
  `runtimeId` / `agentThreadIds`；`turn_done` runtime status 会结算 pending
  tool/approval/user_input，避免完成后仍显示推进中；preload/main control IPC
  覆盖 `interruptTurn` / `steerTurn`；Codex list 支持 includeArchived/search/limit，
  archive/restore 走中性 auxiliary，app-server closed 后丢弃旧 client；Schedule /
  Claw 打开 thread 前播种 runtime mapping；contract/README/AGENTS/PROJECT
  旧 `codex:*` renderer IPC 文案和 Kun contributing 旧路径已清理。Focused
  tests：`npx vitest run src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/agent/agent-runtime-event-dispatcher.test.ts
  src/shared/app-settings.test.ts src/main/ipc/app-ipc-schemas.test.ts
  src/renderer/src/store/chat-store-runtime.test.ts src/preload/index.test.ts
  src/main/ipc/register-app-ipc-handlers.test.ts` 通过，7 files / 135 tests；
  `npx vitest run src/main/runtime/codex/codex-service.test.ts
  src/main/runtime/agent-runtime/host.test.ts` 通过，2 files / 37 tests；
  `npx vitest run src/renderer/src/components/schedule/ScheduleTasksView.test.ts
  src/renderer/src/store/chat-store-navigation-actions.test.ts` 通过，2 files /
  10 tests；`npm run typecheck`、`npm run lint`、`git diff --check` 通过
  （lint 仅剩既有 React hook warnings）。
- [x] 2026-06-11 lint cleanup / Computer Use retry：把
  `ConnectPhoneView` / `SidebarClawDialog` 的安装轮询 cleanup 函数稳定为
  `useCallback`，补齐 effect 依赖，`npm run lint -- --max-warnings=0` 通过，
  相关组件 focused tests 通过（2 files / 8 tests）。同轮再次尝试
  `mcp__computer_use.get_app_state("DeepSeek GUI")` 与 `list_apps`，均立即返回
  `Transport closed`；Electron PID 91477 仍在运行且 `127.0.0.1:8787/8788`
  监听正常，说明失败仍在 Computer Use MCP transport，不替代真实 UI smoke，
  P10 Computer Use smoke 项继续保持未勾。
- [x] 2026-06-11 boundary cleanup：根据并行 cleanup review，把 Codex-only
  DTO / event payload 类型从 `src/shared/codex-runtime-api.ts` 收回
  `src/main/runtime/codex/codex-runtime-api.ts`，Codex capsule 外只保留中性
  contract / settings 类型；删除 `rendererRuntimeClient.agentRuntime` 这层
  重复 IPC wrapper，renderer runtime 调用只走 `agent-runtime-client.ts`；
  DESIGN / PROJECT 中 `runtimeRequest` 和迁移前状态的过时文案已修正为
  legacy Kun-only / 当前双 runtime 事实。Focused tests：
  `npx vitest run src/renderer/src/agent/runtime-client.test.ts
  src/renderer/src/agent/agent-runtime-client.test.ts
  src/main/runtime/codex/codex-service.test.ts
  src/main/runtime/codex/codex-store.test.ts` 通过，4 files / 41 tests；
  `npm run typecheck` 通过。
- [x] 2026-06-11 final verification after lint/boundary cleanup：
  `npm run lint -- --max-warnings=0` 通过；`npm run typecheck` 通过；
  `npm test` 通过，138 files / 868 tests；`npm run build` 通过；
  `git diff --check` 通过。`rg -n "\[ \]" PROJECT.md` 确认剩余未勾项仅为
  P10 Computer Use 真实 Electron UI smoke 和对应总验收。

验收：

- [x] renderer 业务代码不直接调用 Kun `/v1/*` endpoint 或 `codex:*` IPC。
- [ ] Kun 与 Codex 的真实 Electron UI smoke 均通过，且由 Computer Use 操作
  点击/输入/观察。
- [x] `npm run typecheck`、`npm test`、`npm run build`、`git diff --check` 通过。
- [x] 新增和旧有 runtime 代码目录边界清晰：Codex 细节仍集中在
  `src/main/runtime/codex/`，Kun internals 不被 Codex adapter 侵入。
- [x] 删除无用临时兼容层、重复 mapper、重复 DTO；保留的 legacy
  `runtimeRequest` / `startSse` bridge 仅作为 Kun 兼容入口并有删除条件说明；
  代码路径短、命名明确，没有“以后可能用”的空抽象。

### P11：测试与发布门槛

每个实现 PR 至少跑：

```bash
npm run typecheck
npm test
```

当前已跑：

- [x] `npm run typecheck`
- [x] Focused tests: 24 files / 278 tests passed, covering settings,
  IPC schemas/handlers, RuntimeHost, Codex service/store/normalizer/client,
  Claw runtime, Schedule runtime, renderer provider registry, Write registry,
  Codex mapper, Claw helpers, Schedule UI helpers, Settings UI, and phone
  connection UI.
- [x] `git diff --check`
- [x] `npm test`：Electron binary 修复后全量通过；最新 2026-06-11 结果为
  138 files / 855 tests passed。
- [x] `npm run build`：已通过，包含 `npm run build:kun` 和
  `electron-vite build`。
- [x] `npm run dev`：已验证可以先 build Kun，再启动 renderer Vite localhost
  服务和 Electron app；本机 5173-5176 被占用时自动使用
  `http://localhost:5177/`。
- [x] 2026-06-11 regression tests:
  `npm test -- src/main/runtime/codex/codex-service.test.ts src/main/runtime/codex/codex-app-server-client.test.ts src/main/runtime/codex/codex-store.test.ts src/shared/app-settings.test.ts`
  通过，4 files / 74 tests passed。
- [x] 2026-06-11 background/runtime id focused tests:
  `npm test -- src/main/claw-runtime.test.ts src/main/schedule-runtime.test.ts src/renderer/src/components/schedule/ScheduleTasksView.test.ts src/renderer/src/store/chat-store-claw-actions.test.ts src/renderer/src/write/write-thread-registry.test.ts`
  通过，5 files / 58 tests passed。
- [x] 2026-06-11 neutral runtime convergence focused tests:
  `npm test -- src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/preload/index.test.ts src/main/runtime/agent-runtime/host.test.ts src/renderer/src/agent/agent-runtime-client.test.ts src/renderer/src/agent/agent-runtime-provider.test.ts src/renderer/src/agent/registry.test.ts src/renderer/src/hooks/use-daily-usage.test.ts src/renderer/src/hooks/use-model-usage.test.ts src/renderer/src/hooks/use-thread-usage.test.ts src/renderer/src/store/chat-store-side-actions.test.ts`
  通过，11 files / 87 tests passed。
- [x] 2026-06-11 AgentRuntime adapter focused tests:
  `npm test -- src/main/runtime/agent-runtime src/main/runtime/runtime-host.test.ts src/main/runtime/codex`
  通过，9 files / 59 tests passed。
- [x] 2026-06-11 Codex app-server capsule focused tests:
  `npm test -- src/main/runtime/codex/app-server src/main/runtime/codex src/main/runtime/agent-runtime`
  通过，9 files / 57 tests passed。
- [x] 2026-06-11 latency / neutral runtime focused tests:
  `npm test -- src/main/runtime/codex src/main/runtime/agent-runtime src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/preload/index.test.ts src/renderer/src/agent src/renderer/src/hooks/use-daily-usage.test.ts src/renderer/src/hooks/use-model-usage.test.ts src/renderer/src/hooks/use-thread-usage.test.ts src/renderer/src/store/chat-store-side-actions.test.ts`
  通过，26 files / 208 tests passed。
- [x] 2026-06-11 Codex neutral live event stream focused tests:
  `npm test -- src/main/runtime/codex src/main/runtime/agent-runtime src/renderer/src/agent/agent-runtime-client.test.ts src/renderer/src/agent/agent-runtime-provider.test.ts src/renderer/src/agent/registry.test.ts`
  通过，12 files / 70 tests passed；`npm run typecheck` 通过。
- [x] 2026-06-11 final neutral-provider cleanup verification:
  `npm run typecheck` 通过；`npm test` 通过，137 files / 839 tests passed；
  `npm run build` 通过；`git diff --check` 通过。
- [x] 2026-06-11 final focused cleanup tests:
  renderer/provider/PluginMarketplace/store slice 11 files / 79 tests passed；
  main IPC/preload/runtime/Codex/Claw/Schedule slice 15 files / 137 tests passed。
- [x] 2026-06-11 desktop bug focused tests:
  `npm test -- src/main/runtime/codex/codex-service.test.ts src/main/runtime/codex/app-server/reasoning-config.test.ts`
  通过，2 files / 24 tests passed；新增覆盖 `max/off` alias、missing GUI thread
  mapping rematerialize，以及 event store 已有历史时不得 rematerialize。
- [x] 2026-06-11 final verification after desktop bug fix:
  `npm run typecheck` 通过；`npm test` 通过，137 files / 843 tests passed；
  `npm run build` 通过；`git diff --check` 通过。
- [x] 2026-06-11 final verification after status-only thread fix:
  focused Codex runtime suite 2 files / 26 tests passed；`npm run typecheck`
  通过；`npm test` 通过，137 files / 845 tests passed；`npm run build` 通过。
- [x] 2026-06-11 final verification after rematerialize/reconcile test hardening:
  追加覆盖 `deltas` / `tool` / `runtimeError` 历史均禁止 rematerialize，以及
  renderer send-message 会用 runtime `userMessageItemId` 替换 optimistic user
  block；相关 focused tests 2 files / 28 tests passed；`npm run typecheck`
  通过；`npm test` 通过，137 files / 849 tests passed；`npm run build` 通过；
  `git diff --check` 通过。
- [x] 2026-06-11 final verification after runtime switch hardening:
  `npm test --
  src/renderer/src/store/chat-store-navigation-actions.test.ts
  src/renderer/src/agent/agent-runtime-client.test.ts
  src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/store/chat-store-thread-actions.test.ts
  src/main/runtime/codex/codex-service.test.ts` 通过，5 files / 41 tests
  passed；`npm run typecheck` 通过；`git diff --check` 通过；`npm test`
  通过，138 files / 855 tests passed；`npm run build` 通过。
- [x] 2026-06-11 final verification after stop/capability/model alignment:
  `npm test --
  src/shared/agent-runtime-contract.test.ts
  src/main/runtime/agent-runtime/host.test.ts
  src/main/ipc/register-app-ipc-handlers.test.ts
  src/renderer/src/agent/runtime-client.test.ts
  src/renderer/src/agent/agent-runtime-provider.test.ts
  src/renderer/src/agent/registry.test.ts
  src/renderer/src/components/chat/FloatingComposer.test.ts
  src/renderer/src/store/chat-store-maintenance-actions.test.ts
  src/renderer/src/store/chat-store-side-actions.test.ts` 通过，9 files / 96
  tests passed；`npm run typecheck` 通过；`npm test` 通过，138 files / 865
  tests passed；`npm run build` 通过；`git diff --check` 通过。
- [x] 2026-06-11 final verification after queued/runtime binding hardening:
  `npm test` 通过，138 files / 868 tests passed；`npm run typecheck` 通过；
  `npm run build` 通过；`git diff --check` 通过。
- [x] 2026-06-11 final verification after feature-alignment and stop-status
  follow-up：SSE bridge / Claw-Schedule / Claw renderer binding / Settings /
  Composer / provider cancel / stop-status focused suites 均通过；`npm run
  typecheck` 通过；`npm test` 通过，139 files / 883 tests passed；`npm run
  build` 通过；`git diff --check` 通过。
- [x] 2026-06-11 git review cleanup：针对当前 diff 继续并行审计并修复
  cleanliness / correctness gaps。Codex service 增加 in-flight client guard，
  pending app-server request 先映射 backend thread id -> GUI thread id；Codex
  event store 增加 per-thread append queue，避免并发 seq race；AgentRuntime event
  stream 增加 sender ownership 和 listener cleanup，避免跨窗口 stop/replace；
  renderer Claw/Write/legacy thread recovery 增加 runtime 隔离，`/goal` 在
  goals capability disabled 时不再静默吞掉输入；公共 `startSse` 类型补齐可选
  `runtimeId`，文档明确 Connect phone / schedule 非 Kun 后台执行仍 fail closed。
  Focused tests 通过，6 files / 90 tests passed；`npm run typecheck` 通过；
  `npm test` 通过，139 files / 893 tests passed；`npm run build` 通过；
  `git diff --check` 通过。

运行时相关 PR 额外跑：

```bash
npm run build
npm run build:kun
```

手工 smoke：

- [x] Kun 默认启动、创建 thread、发送消息、SSE、停止、审批仍正常。
- [x] Codex 配置有效时可以创建 thread、发送普通消息、看到流式回复和最终
  done。
- [x] Electron renderer/CDP UI smoke：active runtime = Codex，创建/选择
  thread，从聊天输入发送消息，并在 UI/CDP 记录中看到 assistant 回复；该项不等同于
  Computer Use smoke。
- [x] Electron renderer/CDP UI smoke：active runtime = Kun，创建/选择 thread，
  从聊天输入发送消息，并在 UI/CDP 记录中看到 assistant 回复；该项不等同于
  Computer Use smoke。
- [x] Codex 配置缺失时显示可恢复错误，不影响切回 Kun。
- [x] 切换 active runtime 不混淆线程列表、thread detail、SSE stream。
- [x] Write inline completion 不受 Codex 选择影响。
- [x] 连接手机和定时任务明确记录 runtime id。

2026-06-11 手工 smoke 记录：

- 调试配置使用 Codex app 当前配置：`agents.codex.codexHome = "~/.codex"`，
  `command = "codex"`，active runtime = `codex`；检查时只确认 key 是否存在，
  不输出密钥内容。
- Settings 页面在 active runtime = Codex 且共享 provider API key 已配置时，
  不再显示 API Key 缺失提示。
- Kun：`/health` 返回 200；已有手工线程 `thr_ohs8mobu` 可 list/detail；
  发送 prompt 得到 `SMOKE_KUN_OK`；SSE 回放 70 个事件且无错误；interrupt 返回
  200 并进入 aborted。
- Codex 有效配置：新线程 `019eb279-f5a2-7db1-8f8d-3c7982dd88c3` 在
  `/Applications/workspace/ailab/research/app/SciForge` 下发送普通消息后完成，
  assistant 正文为 `APP_SERVER_RUNTIME_OK`；SSE 回放 10 个事件，delta 拼接为
  `APP_SERVER_RUNTIME_OK`，包含 `turnComplete`。
- Codex 缺配置：把 command 临时设为
  `__deepseek_gui_missing_codex_command__` 后，`codex.connect()` 返回
  `{ ok: false, message: "spawn ... ENOENT", recoverable: true }`；切回 Kun 后
  `/health` 仍返回 200；恢复 `command = "codex"` 后无需重启即可 reconnect 成功。
- runtime 切换：Kun list/detail 样例为 `thr_ohs8mobu`；Codex list/detail 样例为
  app-server UUID；Codex SSE 回放事件中的 `threadId` 全部为 Codex thread id。
- Write inline completion：active runtime = Codex 时，IPC 请求进入 direct provider
  path 并读取共享 provider key；本次上游返回 “non-JSON data”，属于 provider
  响应问题，不是 runtime 切换或 API key 缺失问题。
- 连接手机 / 定时任务 runtime id：focused tests 覆盖旧任务默认 Kun、Codex 新任务
  不写入 Kun mapping、Claw `agentThreadIds.kun/codex` 隔离。
- 真实 UI 复测：2026-06-11 使用 in-app browser/CDP 点击聊天 UI 时，Codex
  路径曾出现 `Codex app-server client stopped` / `thread not found`；修复后真实
  Codex UI prompt `E2E_CODEX_UI_1781141107082` 收到同 token assistant 回复。
  切到 Kun 并 reload 后，真实 Kun UI prompt `E2E_KUN_UI_1781141302495` 也收到同
  token assistant 回复。注意：本记录使用 in-app browser/CDP，不满足 P10
  Computer Use 验收。
- 2026-06-11 Codex reasoning/thread 回归：覆盖 thread/start reasoning config、
  turn/start effort/summary、空 GUI thread rematerialize、missing app-server
  thread retry，以及 event store 有历史时禁止 rematerialize；`npm test --
  src/main/runtime/codex/codex-service.test.ts src/main/runtime/codex/app-server/reasoning-config.test.ts`
  通过，2 files / 24 tests passed。

## 文件落点建议

新增：

- `src/shared/app-settings-codex.ts`
- `src/main/runtime/runtime-adapter.ts`
- `src/main/runtime/runtime-host.ts`
- `src/main/runtime/codex/`：Codex 运行时所有 main-side 代码集中在这里。
- `src/renderer/src/agent/agent-runtime-provider.ts`

重点修改：

- `src/shared/app-settings-types.ts`
- `src/shared/app-settings-normalize.ts`
- `src/main/settings-store.ts`
- `src/main/ipc/app-ipc-schemas.ts`
- `src/main/index.ts`
- `src/main/runtime/kun-adapter.ts`
- `src/main/runtime-sse-ipc.ts`
- `src/renderer/src/agent/registry.ts`
- `src/renderer/src/store/chat-store-runtime.ts`
- `src/renderer/src/components/settings-section-agents.tsx`
- `src/main/claw-runtime.ts`
- `src/main/schedule-runtime.ts`

## 本地调试方式

本项目是 Electron + Vite，不是只打开一个静态网页：

```bash
npm install
npm run dev
```

`npm run dev` 会先执行 `npm run build:kun`，然后由 `electron-vite dev` 启动
renderer 的本地 Vite dev server 和 Electron 窗口。也就是说会有 localhost
网页服务参与热更新，但主要调试对象是 Electron app；renderer 可以用 Electron
DevTools 看，main process 日志看启动终端。

常用调试命令：

```bash
npm run typecheck
npm test -- src/renderer/src/agent/agent-runtime-provider.test.ts
npm test -- src/main/runtime/codex/codex-app-server-client.test.ts
npm run dev
```

如果本机缺 Electron binary 或 native module 构建环境，先确认 Xcode Command
Line Tools 可用，再执行：

```bash
npm rebuild electron
npm rebuild better-sqlite3
```

Codex runtime smoke 需要本机可执行 `codex`，并在 Settings -> Agent runtime
里选择 Codex、确认 command / CODEX_HOME / profile / model 配置有效。

## 关键风险

- Codex app-server 的 thread list / history API 与 Kun 不等价，所以必须有
  GUI-owned Codex thread store。
- Codex app-server rich-client events 可能随上游变化，需要集中在
  `codex-event-normalizer.ts` 里做兼容，不要让 renderer 直接消费 raw event。
- 当前文档和 tests 有大量 “Settings -> Agents 只显示 Kun” 预期，P0/P1 要先
  系统性更新，否则后续实现会不断和旧设计打架。
- Codex approval / user input 的双向桥不一定一次迁完；初版可以 fail closed，
  但不能伪装成已支持。
- 如果选择 GUI 托管 `CODEX_HOME`，要特别小心不要覆盖用户外部 Codex 配置。

## 完成定义

- 用户能在 Settings 中选择 Kun 或 Codex。
- Kun 是默认值，旧用户无感升级。
- Codex 配置完成后，Code workbench 可以完成普通多轮对话，并能在 app 重启后
  恢复 Codex thread。
- active runtime 切换不会污染另一套 runtime 的 thread、events、settings 或
  data dir。
- 所有运行时错误都通过结构化 `runtime_error`/banner 呈现，不出现 raw secret、
  raw JSON-RPC 或未处理异常。
