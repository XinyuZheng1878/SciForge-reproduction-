# Kun runtime 架构说明

本文记录 DeepSeek GUI 中 Kun runtime 的边界和内部约束。它不再把全产品描述为
只能围绕 Kun：产品层面由 `RuntimeHost` 在 `kun | codex` 之间选择，Kun 仍是
默认运行时，Codex 只能由用户显式选择或启用。本文只约束 Kun 路径、
Kun cache optimization 和旧 provider 清理。

Codex runtime 的 app-server JSON-RPC、配置、事件归一化、thread/event store
和进程生命周期必须模块化集中在 `src/main/runtime/codex/`。不要为了接 Codex
提前迁移 SciForge 的 workspace server、Model Router sidecar、Browser、
Computer Use、desktop runtime launcher 或科研 artifact pipeline。

CodeWhale、Reasonix、绘画/设计类入口和面向旧 provider 的运行时诊断面板仍不再
作为产品表面回归。

## 目标边界

```text
Renderer (React + Zustand)
  Code / Write / Connect phone UI
        |
        | AgentRuntimeProvider
        | window.dsGui.agentRuntime.*
        v
Preload IPC bridge
        |
        v
Main process
  AgentRuntimeHost (activeAgentRuntime = kun) -> KunAgentRuntimeAdapter
  process/config/port/token management only
        |
        v
kun serve (TypeScript package)
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

这个边界借鉴 TUI/CodeWhale 的 serve HTTP 架构：GUI 不直接嵌 Kun agent
loop，Kun 路径只把本地 HTTP 服务当成稳定协议。Codex 可以在另一个 runtime
adapter 中使用 stdio app-server；renderer 只消费
[`AgentRuntime` contract](./agent-runtime-contract.md)，不关心底层是 Kun
HTTP/SSE 还是 Codex JSON-RPC stdio。这不改变 Kun 的 HTTP/SSE 合约。Kun 内部再
吸收 Reasonix 的 cache-first loop：immutable
prefix、append-only log、bounded LRU/TTL cache、inflight cleanup、
steering queue、context compaction、usage/cache telemetry。

## 缓存命中优化

Kun 的缓存命中率要按 Reasonix 的 DeepSeek 原生口径计算和优化：

- 模型 client 优先解析 DeepSeek 原生
  `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。只有原生字段缺失
  时，才退回 `prompt_tokens_details.cached_tokens`、`cache_read_input_tokens`
  等兼容字段。
- cache hit rate 使用 `hit / (hit + miss)`，不使用
  `hit / prompt_tokens`。DeepSeek 原生 miss 不一定等于 `prompt_tokens - hit`，
  Reasonix 也是按 hit+miss 作为缓存统计分母。
- `kun/src/prompt/kun-system-prompt.ts` 是稳定前缀。它只放长期
  不变的 Kun 运行契约，不能放 workspace、时间戳、文件片段、选中文本、
  用户动态信息或一次性工具结果。
- `ImmutablePrefix` 在每次 model step 前调用 `verifyImmutablePrefix()`。
  如果有人绕过 `setSystemPrompt` / `setTools` / `setFewShots` 直接改 prefix，
  开发和测试期会立即暴露 fingerprint drift，而不是悄悄牺牲缓存。
- few-shot fingerprint 只计算真正会发给模型的内容，不计算 item id、turn id、
  thread id、时间戳等 GUI/存储层动态字段。
- 工具 schema 在发送到模型前 canonical sort，避免同一工具集合因为顺序或
  schema key 顺序变化造成 prefix churn。
- 每个 turn 会持久化 canonical tool catalog fingerprint 和 tool count；同一
  scope 下工具定义漂移时会标记 `toolCatalogDrift`，便于排查 cache miss。
- 历史消息发送给 DeepSeek 前会做共享的 model-history repair：孤儿
  `tool_result` 不发，缺少对应 result 的 `tool_call` 不发；同一次响应里的
  多个 tool call 会重组为一个合法 assistant `tool_calls` 消息，避免
  400/retry 造成额外延迟和缓存浪费。
- 同一模型回合里连续的 built-in 只读工具 `read` / `grep` / `find` / `ls`
  会小批量并发执行，但 `tool_result` 仍按 call 顺序写入，减少等待时间的同时
  不让动态历史随完成顺序抖动。
- Serve runtime 会从 persisted usage event 恢复累计 cache hit/miss counters，
  重启或 resume 后 runtime usage 面板不重新从 0 计算。
- 动态上下文必须追加在稳定前缀之后。compaction、resume、fork、plan context
  也不得改写稳定系统前缀。

冷启动第一轮可能仍然低或为 0，因为服务端还没有同一前缀可读；热起来后应稳定
超过 90%。2026-06-02 的真实 Kun 临时线程验证：

- 12 轮短消息：去掉冷启动后的热命中 `94.7%`，最新一轮 `93.6%`。
- 同一稳定前缀热身后 24 轮短消息：整体含冷启动 `95.2%`，最新一轮 `98.1%`。

优化前已经持久化的旧 usage 事件不会被事后改写，因为当时没有保存 DeepSeek
原生缓存字段；这些历史数据只能作为旧实现的证据，不能证明新实现仍然低命中。

Reasonix 资料里仍可作为下一阶段的借鉴项：

- 工具集合 mutation gate：新增工具允许 append，编辑、重排、删除工具时要求
  restart 或新会话边界，避免热前缀突然全量 miss。当前 Kun 已排序工具
  schema，但还没有把“工具集合变更策略”做成显式产品规则。
- LLM fold summarizer：现在 `ContextCompactor` 是本地摘要骨架，没有额外请求
  模型。未来如果改成模型摘要，应复用主 agent 的 system/tools/few-shot 前缀，
  让 summarizer call 也命中同一段缓存。
- 大工具结果 token cap 和长参数 markerize：当前本地工具输出较小；一旦加入
  shell、文件全文、网页抓取类工具，需要在进入历史窗口前按 token 截断或标记化，
  不让超大 tool result 把 append-only log 撑爆。
- volatile scratch 边界：assistant reasoning 现在不会上传给模型，但仍会落 GUI
  历史。未来若加入内部计划、临时草稿或子 agent scratch，应保持“可展示”和
  “可重放给模型”分离。

## GUI 产品边界

Renderer 不应再绑死到旧 CodeWhale/Reasonix provider，也不应把 Codex 逻辑写进
Kun provider。Runtime-neutral UI 可以通过 Settings / provider registry 暴露
`kun | codex` 选择；当当前运行时是 Kun 时，功能仍通过 Kun HTTP/SSE 边界进入。
需要删除或保持删除的旧 UI 面包括：

- 旧 Agent 切换器：面向 CodeWhale/Reasonix 的 `AgentSwitcher` 不再出现。
  如果新增用户可见 runtime 选择，只能选择 `kun | codex`，并走 Settings /
  `RuntimeHost` / provider registry。
- 顶部连接状态条和 legacy runtime 诊断按钮：不再把旧 provider 检测作为用户入口。
- Runtime insights/right panel：右侧面板只保留 Changes、Preview、Plan、
  File 等 GUI 工作区视图，不再有 runtime/usage 控制台。
- 斜杠菜单里的 `/usage`、`/runtime`：这些命令会打开运行时控制台，不作为
  runtime 选择入口。
- 设置页 provider selector：Settings -> Agents 可以展示 Kun 和 Codex 的配置。
  Kun 配置仍包含 binary path、port、autoStart、API key、base URL、
  runtime token、data dir、model、approval policy、sandbox mode、insecure。
- 绘画/设计 starter：GUI 首页不再放设计/绘画入口，只保留 Code、Write、
  连接手机相关核心流。

## Main / Preload 要拆的东西

主进程和 preload 不再暴露旧 agent IPC：

- 删除 `deepseek:spawn-if-needed`、`deepseek:update-*`、
  `deepseek:diagnostics`。
- 删除 `reasonix:rpc-send`、`reasonix:spawn-if-needed`、
  `reasonix` RPC event bridge。
- 删除 CodeWhale adapter、Reasonix adapter、Reasonix HTTP bridge、
  DeepSeek/CodeWhale updater、旧 binary resolver、旧 process manager。
- 删除和受支持 runtime 无关的 diagnostics/importer 模块。用户要的是可用的
  runtime 选择，不是旧 provider 检测中心。

主进程现在的 runtime 责任是：

- `RuntimeHost`：读取 `activeAgentRuntime`，默认选择 `kun`，只在用户显式选择
  后委派到 `codex`。
- `AgentRuntimeHost`：暴露 `docs/agent-runtime-contract.md` 中定义的中性
  connect/capabilities/thread/turn/event/control 方法，renderer 通过
  `window.dsGui.agentRuntime` 调用。
- `kunRuntimeAdapter`：启动/停止 `kun serve`、同步 config、
  计算 base URL、附加 auth header。
- `src/main/runtime/codex/`：集中持有 Codex app-server client、配置、事件归一化、
  thread/event store 和生命周期；目录外只通过窄 adapter 表面集成。
- 旧 `runtimeRequestViaHost`、`runtimeRequest`、`startSse/stopSse`：只作为
  兼容入口保留一轮。新 renderer 代码不得依赖这些路径；当中性 contract 暴露同等
  能力且 focused coverage 覆盖替代路径后删除 shim。
- 不提前引入 SciForge workspace server、Model Router、Browser、Computer Use
  等 sidecar。

## Settings / Migration

保存后的 settings 结构应表达显式运行时选择：默认 `activeAgentRuntime` 是
`kun`，保留 `agents.kun`，并允许用户配置 `agents.codex`。

```json
{
  "activeAgentRuntime": "kun",
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 8899,
      "autoStart": true,
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/beta",
      "runtimeToken": "",
      "dataDir": "~/.deepseekgui/kun",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "insecure": false
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

代码里仍允许出现 `agentProvider`、`codewhale`、`reasonix` 字符串的唯一原因是
读取旧 settings 文件时做一次性迁移：

- `agentProvider: codewhale | reasonix | deepseek-runtime` 归一为
  `activeAgentRuntime: "kun"`。
- 旧 `deepseek`/`agents.codewhale` 的 port、autoStart、API key、
  base URL、runtime token、approval、sandbox 会种到 `agents.kun`。
- 旧 `agents.reasonix` 的 API key、base URL、model、autoStart 会种到
  `agents.kun`。
- 迁移后的落盘文件保留 `agents.kun`，可保留 `agents.codex`，但不再保留
  `agents.codewhale` 或 `agents.reasonix`。
- 连接手机（内部旧名 Claw）旧 `agentThreadIds.codewhale/reasonix` 只折叠成
  `agentThreadIds.kun`。
- 新 Codex thread id 必须写入 Codex 自己的 thread/event store 或
  `agentThreadIds.codex` 等 Codex 映射，不能污染 Kun mapping。

## Code / Write / 连接手机在 Kun 下的路径

- Code：provider registry 返回 `AgentRuntimeProvider`，通过中性 contract
  list/create thread、send turn、steer、interrupt、compact、approval 和订阅事件。
  当前运行时为 Kun 时，main-side Kun adapter 把这些调用映射到 Kun HTTP/SSE。
  Chat UI 不知道旧 provider，也不直接知道 Kun endpoint 或 Codex IPC。
- Write：写作助手跟随 `activeAgentRuntime`，Write thread registry 按
  workspace + runtime id 隔离 Kun / Codex 写作线程；inline completion 可继续
  保留直连 provider 的低延迟路径。
- 连接手机：定时任务、飞书/Lark/微信、IM webhook 创建或复用 Kun thread。
  代码内部仍沿用 `claw` route / settings key / runtime 文件名，作为旧命名兼容。
  `threadId` / `localThreadId` 字段只作为旧 settings 兼容字段存在，真正
  当前 Kun 映射写入 `agentThreadIds.kun`。新任务需要记录所用 runtime id；Codex
  thread id 不能写入 Kun mapping。

## CodeWhale 功能等价面

替换 CodeWhale 不是只保留聊天。Kun 的 GUI HTTP 面必须覆盖旧
provider 已经暴露给 store/UI 的能力：

- `GET /v1/threads` 支持 `limit`、`search`、`include_archived`、
  `archived_only`。默认隐藏 archived/deleted，会话搜索和归档视图不依赖
  GUI 本地猜测。
- `POST /v1/threads/{id}/fork` 复制 thread 历史、写入 fork lineage，
  并把历史 item 写回新 thread 的 session store。复制时会把 pending
  approval/user-input 规整为不可继续操作的历史状态，避免新会话悬挂旧 gate。
- `POST /v1/sessions/{id}/resume-thread` 沿用旧 CodeWhale resume 路径。
  Kun 优先从同名 thread 恢复；没有 thread 时从 session snapshot
  或 JSONL items 重建 turns；找不到时返回 404，而不是在 GUI 抛
  unsupported。
- `POST /v1/user-inputs/{id}` 和旧兼容路径 `/v1/user-input/{id}` 都可接收
  `{ answers }` 或 `{ cancelled: true }`。AgentLoop 通过 `request_user_input`
  / `user_input` tool 暂停，GUI 回答后继续模型回合。
- `POST /v1/approvals/{id}` 继续支持工具审批；approval 和 user-input 都是
  gate/route/service 分层，不在 renderer 内实现 agent 逻辑。
- `GET /v1/usage?group_by=thread|day` 返回累计 token、turn、cache hit 数据。
  Workbench 首页和 composer 底部只消费 Kun usage，不再打开 runtime
  insights 面板。

## 已删除/应保持删除的旧路径

旧 agent 运行路径不应再回来：

- `src/renderer/src/agent/codewhale-runtime.ts`
- `src/renderer/src/agent/reasonix-runtime.ts`
- `src/renderer/src/agent/reasonix-event-mapper.ts`
- `src/main/runtime/codewhale-adapter.ts`
- `src/main/runtime/reasonix-adapter.ts`
- `src/main/runtime/reasonix-http-bridge.ts`
- `src/main/deepseek-process.ts`
- `src/main/resolve-deepseek-binary.ts`
- `src/main/deepseek-updater.ts`
- `src/main/reasonix-process.ts`
- `src/main/reasonix-config.ts`
- `src/main/resolve-reasonix-binary.ts`
- `src/shared/reasonix-protocol.ts`
- `src/shared/deepseek-update.ts`
- Runtime diagnostics/importers for old agent paths

旧 UI 入口不应再回来：

- 面向 CodeWhale/Reasonix 的 `AgentSwitcher`
- 面向旧 provider 检测的 `ConnectionStatusBar`
- 面向旧 provider 自检的 `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- `ReasonixInsightsPanel`
- 设计/绘画 starter card

## 设计模式约束

Kun 包按 ports & adapters 组织：

- `contracts/`：HTTP/SSE DTO 和 zod schema。
- `ports/`：ModelClient、ToolHost、ThreadStore、SessionStore、
  ApprovalGate、EventBus、WorkspaceInspector、Clock。
- `adapters/`：DeepSeek-compatible model client、local tool host、
  file/in-memory stores、workspace inspector。
- `loop/`：AgentLoop、InflightTracker、SteeringQueue、ContextCompactor。
- `cache/`：ImmutablePrefix、LRU、TTL-LRU。
- `server/`：Router、auth、SSE、routes。

GUI 侧不实现 agent 逻辑，只做 AgentRuntime client、event dispatch 和状态映射。
Kun-specific 能力优先加 Kun tool 或 HTTP endpoint，再通过 Kun
`AgentRuntimeAdapter` 映射到中性 contract。Codex 能力通过 `AgentRuntimeHost`
和 `src/main/runtime/codex/` 接入，不在 renderer 内新增绕过 runtime boundary 的
agent 逻辑。

## 验证清单

每次改这条线至少跑：

```bash
npm run typecheck
npm test
npm run build
```

手动冒烟：

1. 打开 DeepSeek GUI。
2. 既有用户和新安装默认选择 Kun，`agents.kun` 不被迁移破坏。
3. Code 在 Kun 下新建会话，能创建 thread、发送消息、流式返回、审批/中断可用。
4. Write 打开写作空间，inline completion 和选中文本助手能用同一个 API key。
5. 连接手机在 Kun 下能保存设置、运行手动 task、把 thread id 写回 Kun mapping。
6. Settings -> Agents 可以选择 Kun 或 Codex；Codex 未配置时不影响 Kun，且没有
   CodeWhale/Reasonix 配置块或旧 runtime diagnostics 面板。
7. Codex 被显式配置并选中后，新 Code 会话走 Codex runtime boundary，不改写
   Kun thread、events、settings 或 mapping。
8. `GET /v1/usage?group_by=thread` 有历史 usage 时，GUI 首页/底部不显示
   “暂无用量”，而显示 token、回合、缓存命中等指标。
9. 线程搜索、归档视图、fork、resume session、request_user_input 回答/取消
   都能通过 Kun HTTP 路径完成。
