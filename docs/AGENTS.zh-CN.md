# 代理运行时说明

SciForge 支持两个可由用户选择的本地 Agent 运行时：**SciForge Runtime** 和
**Codex**。SciForge Runtime 仍是默认运行时，适用于既有用户和新安装用户。Codex 是可选
运行时，必须由用户显式选择或启用；SciForge Runtime 失败时不能静默 fallback 到 Codex。

Code、Write、连接手机和定时任务应通过 runtime-neutral 的 `AgentRuntime`
contract 进入 agent 工作流。Renderer 业务代码应使用 `AgentRuntimeProvider`
和 `window.sciforge.agentRuntime` preload API，不能直接调用 SciForge Runtime `/v1/*` 端点或
Codex `codex:*` IPC。SciForge Runtime 继续在 adapter 后面提供 HTTP/SSE 路径。Codex
运行时代码必须模块化并集中在 `src/main/runtime/codex/` 下。连接手机在代码内部
仍沿用 `claw` 命名作为兼容标识。连接手机和定时任务会记录 runtime id，并保留
按运行时分离的 thread mapping；但这些后台工作流的非 SciForge Runtime 执行路径当前仍是
fail closed，直到补齐对应的原生 adapter 支持。

contract、event 与 capability 形状见
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md)。

## 允许的扩展路径

1. SciForge Runtime 行为在 `kun/src/contracts/` 中新增协议字段。
2. SciForge Runtime 行为在 `kun/src/loop/`、`kun/src/services/` 或 `kun/src/ports/` /
   `kun/src/adapters/` 下新增端口与适配器。
3. SciForge Runtime 行为在 `kun/src/server/routes/` 下新增 HTTP 接口。
4. SciForge Runtime 端点与事件通过 `src/main/runtime/local-runtime-agent-runtime-adapter.ts` 和共享
   AgentRuntime event/capability 类型映射；renderer 映射放在
   `src/renderer/src/agent/agent-runtime-event-dispatcher.ts`。
5. Codex 行为必须把 app-server JSON-RPC、配置、事件归一化、thread/event
   store 和进程生命周期代码留在 `src/main/runtime/codex/` 内，只从该目录导出
   窄 adapter 表面。
6. 共享集成点保持很薄：settings 类型/schema/migration、主进程 runtime
  选择、renderer provider registry、Settings UI 可以知道 `sciforge | codex`。
7. 设置项写入 `agents.sciforge` 或 `agents.codex`，并由 `activeAgentRuntime`
   记录用户显式选择。
8. 不要新增 `runtimeRequest` / `startSse` renderer 路径；应用代码统一走中性的
   `agentRuntime:*` IPC 表面。renderer 专用 `codex:*` IPC 已删除，`codex:` 字符串只能作为 app-server 内部
   method/event 名称存在。

## 禁止路径

- 不要恢复 CodeWhale/Reasonix 的适配器、进程管理、RPC 桥、更新器或导入器。
- 不要在 SciForge Runtime 失败时隐式切到 Codex。
- 不要新增绕过 `AgentRuntimeProvider` 或中性 `window.sciforge.agentRuntime` API
  的 renderer 业务逻辑。
- 不要把 Codex 实现散落到 `src/main/runtime/codex/` 之外；允许的例外只有上面列出的薄集成点。
- Model Router sidecar 是当前阶段的 LLM provider API 边界；不要把 SciForge
  workspace server、Browser、Computer Use、desktop runtime launcher、
  VSCode app module 或 artifact pipeline 混入这条 runtime contract。
- 不要恢复面向旧 provider 的 `AgentSwitcher`、`ConnectionStatusBar`、
  `RuntimeDiagnosticsDialog` 或运行时自检 UI。
- 不要恢复绘图/设计的启动卡片。
- 不要新增打开运行时控制面板的 `/usage` 或 `/runtime` 斜杠命令。

## 旧数据兼容规则

旧的持久化 key 仅在 settings 迁移时按只读路径使用：

- `agentProvider: codewhale | reasonix | deepseek-runtime` 映射为
  `activeAgentRuntime: "sciforge"`。
- `agents.codewhale`、`agents.reasonix` 和旧 `deepseek` 的值会一次性写入 `agents.sciforge`。
- 保存后的 settings 保留 `agents.sciforge`，也可以包含 `agents.codex`；不能继续保留
  `agents.codewhale` 或 `agents.reasonix`。
- 旧连接手机（内部 Claw）的 `agentThreadIds.codewhale/reasonix` 会并入 `agentThreadIds.sciforge`。
- 新的 Codex thread 映射必须使用 Codex 自己的 runtime/thread 存储，不能写进默认运行时映射。

## 验证清单

执行：

```bash
npm run typecheck
npm test
npm run build
```

手工冒烟检查：

- 既有用户和新安装默认选择 SciForge Runtime。
- 设置 -> Agent 可以展示 SciForge Runtime 和 Codex runtime 设置，但不出现 CodeWhale/Reasonix 配置块。
- Code 可以创建 SciForge Runtime 会话、流式回传回复、进行工具审批/拒绝、以及中断回合。
- Codex 被显式配置并选中后，Code 会通过 Codex runtime 边界路由，且不改写 SciForge Runtime 设置或 SciForge Runtime 会话。
- CodeWhale 的等价能力应保持在 SciForge Runtime 下可用：会话搜索/归档筛选、fork、会话恢复、`request_user_input` 提交与取消、usage 查询。
- 缓存指标使用 DeepSeek 原生 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；在稳定前缀热身后，热门对话的 hit rate 应长期保持在 90% 以上。
- 不可变前缀漂移与异常的 tool-call/tool-result 历史必须在请求下发 DeepSeek 前被拦截。
- Write 可以打开工作区、发起 inline 补全、使用选中文本助手动作；assistant thread 按当前运行时隔离。
- 连接手机可以保存设置，并继续执行 SciForge Runtime 手工任务。后续为 Codex-backed 手机连接 / 定时任务补 runtime-id 时，必须保留迁移数据的默认运行时映射，且不能把 Codex thread id 写进默认运行时映射。

SciForge Runtime 细节见 [`docs/local-runtime-architecture.md`](./local-runtime-architecture.md)。产品级
runtime contract 细节见
[`docs/agent-runtime-contract.md`](./agent-runtime-contract.md)。
