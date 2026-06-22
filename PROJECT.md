# DeepSeek GUI Multi-Agent Runtime 集成任务板

更新时间：2026-06-21

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走 model router。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。
- [x] 子智能体只能由主 agent 在回合中通过 runtime 原生能力自动启动，GUI 不提供手动启动入口。
- [x] 第一版只展示当前 active thread 的 children，不展示环境信息分组。

## 新任务：Multi-Agent Children 面板与 Runtime Adapter 统一

目标：让 Codex、Claude Code、Kun 都能通过统一 runtime contract 暴露当前 active thread 的子智能体/子运行，并在侧边栏提供类似 Codex 的 children 展示面板。点击子项后展示状态、prompt、summary、usage；如果 runtime 提供 transcript，则可打开完整 transcript；如果 runtime 暴露真实 child thread，则可像普通 thread 一样进入聊天详情。

### 统一数据模型

- [x] 定义中性的 child run/thread 模型，覆盖 `agent`、`workflow`、`thread`、`remote` 等形态，避免把所有 runtime 强行建模成普通 thread。
- [x] 在 shared runtime contract 中补充 children 查询或事件字段，范围限定为当前 active thread 的直接 children。
- [x] 统一 status、prompt、summary、usage、transcriptRef、openAsThreadRef 等字段。
- [x] 支持 runtime 能力降级：没有 transcript 时只展示摘要详情；没有真实 child thread 时不显示进入聊天详情入口。

### Claude Code Adapter：官方 SDK 单一路径

- [x] 将 Claude Code adapter 改为使用官方 `@anthropic-ai/claude-agent-sdk`。
- [x] 删除旧的 `claude -p --output-format stream-json --verbose --bare` 进程解析实现，不保留双路径或兼容分支。
- [x] 复用现有 model router 环境构造逻辑，确保 SDK subprocess 仍然只走本地 model router。
- [x] SDK options 需要启用或接入 `forwardSubagentText`、`agentProgressSummaries`、`sessionStore` 等能力，以便结构化获取 subagent/workflow 状态和 transcript。
- [x] 映射 Claude `Agent` tool 输出：`agentId`、`agentType/subagent_type`、`prompt`、`usage`、`totalTokens`、`status`、`outputFile`。
- [x] 映射 Claude `Workflow` tool 输出：`taskId`、`runId`、`workflowName`、`summary`、`transcriptDir`、`scriptPath`、`status`。
- [x] 读取或镜像 Claude subagent transcript：`subagents/agent-{agentId}.jsonl`。
- [x] 不使用 `claude agents --json` 作为当前 thread children 来源；它属于 background agent view，不符合当前 active thread children 范围。

### Codex Adapter

- [x] 基于当前 Codex app-server 协议补齐 subagent 支持，优先使用 runtime 原生 thread/source/collab-agent 事件。
- [x] 映射 `collabAgentToolCall`、`receiverThreadIds`、`agentNickname`、`agentRole`、`threadSource: subagent` 等字段到统一 child 模型。
- [x] 支持真实 child thread 的 `openAsThreadRef`，允许进入普通聊天详情。
- [x] 如果本机 Codex 版本缺少某些协议字段，按能力降级，不额外发明非原生启动机制。

### Kun Adapter

- [x] 复用 Kun 原生 `delegate_task` / `DelegationRuntime` / child run 记录。
- [x] 将 Kun runtime event 的 `child` metadata 桥到统一 runtime contract。
- [x] 映射 child run 的 status、prompt、summary、usage。
- [x] 调研并补齐 Kun child transcript 持久化；如果 runtime 暂不提供，第一版只展示摘要详情。

### 侧边栏 Children 面板

- [x] 在侧边栏加入“子智能体”分组，视觉风格参考 Codex 当前面板。
- [x] 只展示当前 active thread 的直接 children，不展示其他 thread 或全局 background sessions。
- [x] 子项展示短名称、状态、运行中/完成/失败等视觉标识。
- [x] 点击子项打开详情：status、prompt、summary、usage。
- [x] 详情中在可用时提供完整 transcript 查看。
- [x] 详情中在可用时提供进入普通 thread 聊天详情的动作。

### 验证

- [x] Shared contract 单元测试覆盖 child 模型序列化、能力降级和 active thread 过滤。
- [x] Claude Code adapter 测试覆盖 SDK model router env、Agent 输出映射、Workflow 输出映射和 transcript 引用。
- [x] Codex adapter 测试覆盖 app-server subagent thread / collab agent 事件映射。
- [x] Kun adapter 测试覆盖 `child` metadata 桥接和 child run 映射。
- [x] Renderer 测试覆盖侧边栏 children 分组、点击详情、transcript/open thread 条件入口。
- [x] 手动验证 Codex、Claude Code、Kun 三个 runtime 至少各完成一次 child run 展示路径；不支持的能力记录降级原因。
  - Claude Code：通过本地 `127.0.0.1:3892` model router 发起真实 SDK 回合，`Agent` child run 完成；children 查询返回 `runtime: claude`、`childCount: 1`、`kind: agent`、`status: completed`、`transcriptRef` 可用，`openAsThreadRef` 按能力降级为空。
  - Kun：通过原生 `delegate_task` / `DelegationRuntime` 触发 completed child run，并经 GUI adapter `listThreadChildren` 映射为 `runtime: kun`、`childCount: 1`、`kind: agent`、`status: completed`、prompt/summary/usage 可展示；child transcript 当前未持久化，`readChildTranscript` 返回 degraded reason。
  - Codex：通过本地 `codex-cli 0.141.0` app-server 和 model router 发起真实回合；当前版本未暴露 native subagent/collab child，回合返回 `NO_NATIVE_CHILD_CAPABILITY`，children 查询 `childCount: 0`、`sinkChildEvents: 0`。按任务要求记录为本机 Codex 协议能力降级，不新增非原生启动机制。
