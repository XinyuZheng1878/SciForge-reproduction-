# SciForge 精简与风险清理任务板

更新时间：2026-07-01

## 当前目标

从第一次提交开始审查项目历史，删除与最终目标冲突的旧逻辑、冗余旁路和过度工程，并保持同类功能只有一条统一工作链路。

本轮继续使用多个 sub agent 并行审查和实现。已确认能安全收敛的点直接落地；涉及兼容窗口或产品取舍的更简洁方案记录在“需决策候选方案”，后续等待人类决策后再实施。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 model router。
- 相同功能的工作链路需要统一，不要额外生出旁路；删除冗余，代码尽可能精简。
- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- 用户可见文案和公开 API 不暴露 Kun 影子；默认本地 runtime 对外称 SciForge Runtime / local runtime。

---

## 本轮多 agent 清理

- [x] 删除已无真实调用的 `RuntimeHost` legacy request/SSE 兼容层，事件链路统一到 `AgentRuntimeHost` / adapter。
- [x] 删除旧 singular user-input HTTP endpoint `/v1/user-input/:id`，只保留 canonical `/v1/user-inputs/:id`，并保留 legacy singular 404 回归测试。
- [x] 删除未挂载的旧 Connect phone 独立页/旧大弹窗链路：移除 `SidebarClawDialog*.tsx`、旧 `ConnectPhoneView` 组件本体和对应旧链路测试，只保留当前 sidebar panel/dialog/helper。
- [x] 将 Settings route section 的内部枚举从 `'claw'` 清名为 `'connectPhone'`，同步 settings view/sidebar/store/update 调用点。
- [x] 清理 local-runtime 打包 helper 里的 `Kun` 命名，root postinstall/after-pack 继续复用统一 local-runtime package helper。
- [x] 删除 renderer 缺 runtime id 时默认路由到 SciForge 的 helper fallback，远程通道线程绑定 helper 必须显式传 runtime id。
- [x] 将 renderer `managedBy: 'claw'` 分类值迁到 `managedBy: 'remoteChannel'`；旧 `'claw'` 仅作为 legacy read 识别输入。
- [x] 删除 settings/API/UI 层的 `endpointFormat` 暴露，旧 settings 字段由 normalizer 丢弃，IPC patch strict schema 直接拒绝。
- [x] 删除 `src/shared/model-endpoint-format.ts` 和 `src/shared/thread-contract.ts` 这类 shared 到 `kun/src` 的薄包装，收紧 `kun/src` import 边界白名单。
- [x] 为 Model Router 与 Search worker 增加独立 `typecheck` 脚本和 worker tsconfig，并在 root scripts 暴露转发命令。
- [x] 删除无生产引用的 renderer 死代码：`ChatStarterGrid.tsx`、`plan-request.ts` 及其自测。
- [x] 删除 plan store 未使用的 preview/generated-content 状态和 localStorage key。
- [x] 将 compaction digest marker 从 `<kun:tool_digest ...>` 改为中性 `<tool_digest ...>`。
- [x] 补齐 runtime todo source/快照合约，thread detail 现在能携带 `todos`，renderer 事件/详情路径保持一致。
- [x] 为 runtime thread refresh poll 补导航集成测试，确认 `refreshThreads` 后会启动轮询。
- [x] 收紧 ScheduleRuntime / ClawRuntime / WorkflowRuntime 对 `agentRuntime` 的依赖：生产 deps 必填，测试用 fail-fast stub 覆盖非 agent 路径。
- [x] 清理低风险用户可见 Kun/Claw/OpenClaw 文案：WeChat bridge 错误、system prompt、DESIGN 叙述、SciModality 启动脚本提示等改为中性名称。
- [x] 更新 stale 文档测试路径，删除已移除科学绘图测试文件的旧命令引用。
- [x] 补齐显式 side conversation 列表读路径：shared contract / IPC schema / provider options 支持 `includeSide`，local runtime adapter 只在显式请求时调用 `/v1/threads?include=side`。
- [x] 补齐 runtime todo 与 `create_plan` replay 映射：thread list/detail 保留 `todos`，`todos_updated` / `todos_cleared` 转成 neutral `todo_event`，`create_plan` result metadata 可从 tool result 恢复。
- [x] 将 legacy `.kun` skills 来源的用户可见文档/UI 展示改成中性 legacy/local runtime 迁移输入，不再指导写旧 `~/.kun/mcp.json`。
- [x] 为 image-generation direct provider 临时例外加边界：子进程不继承 `SCIFORGE_IMAGE_*` / `SCIFORGE_SCIMODALITY_SERVICE_*`，静态测试防止 GUI/runtime 新增直连，README 标注为 worker-contained exception。
- [x] 删除 remote-channel 旧死代码和 stale 文档：移除 `ClawRuntime.runTask()` 墓碑 shim、未使用 Claw schedule alias、schedule detector 未用参数、DESIGN 中已删除的 Feishu mirror API。
- [x] 继续清理 remote-channel / phone-connection 用户可见旧命名：DESIGN、AGENTS、locale 文案统一为 platform-neutral remote channel / phone connection；`OpenClaw Gateway` 安装错误不再原样透出 UI。
- [x] 清理 `.kun` 相关内部命名与默认 roots 防回归：MCP builder / renderer MCP merge helper / global SciForge skill root key 改成 local-runtime/SciForge 语义，并补测试确认 generic 默认 roots 不回退 `~/.kun`。
- [x] 统一 provider capability 判断和 side conversation 入口：thread/side/maintenance action 共享 `providerSupportsCapability`，`/btw` 与 topbar 入口按 `forkThread` / `fork` / `sideConversations` 一致 gating，side SSE 失败会收敛 busy/error 状态。
- [x] 收敛 plan/todo 一致性：renderer plan merge 保留已完成 todo，runtime `preserveCompleted` 只保护 completed，local-runtime auxiliary get/set todos 统一走 normalizer，GUI plan registry 使用 shared plan id/workspace helper。
- [x] 补齐 remote-channel / schedule 公开边界测试和文档：删除 stale `imCommandNotReadyText`，Workbench 本地 help 不再广告未支持的 `/attach current`，DESIGN 补列 `createScheduleTaskFromText`，IPC 覆盖 `remoteChannel:task:create-from-text`。
- [x] 删除 Connect phone 安装链路的 WeChat bridge 旧环境变量回退，显式配置优先，其次走 managed bridge resolver，最后仅使用默认本地 endpoint。
- [x] 将 remote-channel `message_read` 处理标记为当前产品边界内的显式 no-op，等待 read receipts 决策前不再保留模糊 TODO。
- [x] 修正 generic `remoteChannel` 消息来源展示，不再把未知 remote-channel 默认标成 Feishu / Lark。
- [x] 补齐 sci-modality router 的 Model Router 接入 token 文档和部署提示，并把 translate-only 注释统一到 Model Router vision-translator contract。
- [x] 收紧 Model Router 静态边界审查：legacy image direct env 只允许 managed image-generation config，`EDAG_LLM_*` 只允许 Evidence DAG sidecar scrubber。
- [x] 清理 stale 文档中的旧 runtime / direct provider / bare `SKILL.md` 表述：runtime 文档聚焦 Model Router 链路，scientific skills MCP 明确只读索引/读取/规划，安装入口保持显式 GUI/IPC approval。
- [x] 清理 Connect phone 安装链路内部命名：删除未用 `postJson` / `sleep`，private install result type 和 renderer helper 改为 `ConnectPhoneInstall*` 语义。
- [x] computer-use 决策前收口：文档明确 `@sciforge/computer-use` 与 `gui-owl-computer-use` 暂并存等待人工测试；`gui_computer_use` 注明为 GUI-managed `@sciforge/computer-use` MCP，不等同 GUI-Owl。
- [x] computer-use 配置加防回归：`SCIFORGE_CUA_SERVICE_URL` 存在时不启用 GUI-managed `@sciforge/computer-use` MCP，避免同一 runtime config 注册重复 `computer_use`。
- [x] computer-use 状态 UI 只透出高价值 target 安全字段 `inputIsolation`、`affectsUserInput`、`requiresHostFocus`、`usesHostClipboard`，并把 rejection fixture 统一为 canonical `target_in_use`。
- [x] 清理公开文档/locale 的 pending/旧名残留：K-Dense legacy/local runtime 来源改成只读 discovery 输入，贡献指南标注 SciForge Runtime 包（源码路径 `kun/`），DESIGN 移除待办注释，连接手机架构说明不再暴露内部旧名。
- [x] K-Dense Scientific Skills 未安装提示统一引导插件页显式 Install / Repair 或 `SCIFORGE_KDENSE_SKILLS_ROOT`，不再提示外部 `npx skills add` 命令作为默认路径。
- [x] 收紧 Model Router 相关环境继承：Codex/Claude runtime 不继承 `SCIFORGE_IMAGE_*`、`SCIFORGE_SCIMODALITY_SERVICE_*`、`EDAG_LLM_*`；Model Router sidecar 剔除 `SCIFORGE_IMAGE_*` / `EDAG_LLM_*`，仅保留自身需要的 sci-modality service env。
- [x] sci-modality worker public diagnostics 脱敏：`/version` 和 CLI 启动日志不再返回或打印 expert provider base URL，只给 configured/kind/expert count/token guard 等状态。
- [x] plan/todo merge 语义与 runtime 对齐：renderer 只继承已完成 todo，不再保留旧 `in_progress`；GUI plan registry key 导出并加防回归；GUI plan shared helper 与 runtime mirror 增加 parity guard。
- [x] 删除 GUI shared 到 `kun/src/contracts/policy` 的 `runtime-policy.ts` thin wrapper，policy 字面量/default 改由 GUI shared 自有类型声明，`kun/src` import 边界白名单继续收紧。
- [x] 删除旧 `~/.sciforge/claw` 作为内部 remote-channel workspace 的路径兼容；当前 `~/.sciforge/remote-channel` 仍作为内部路径处理，旧 claw 路径按普通 workspace 展示/保存。
- [x] 删除 legacy Claw prompt/title 展示兼容：`[Claw managed instructions]`、`[Claw IM agent instructions]`、`Claw skill policy:`、无 canonical 空行分隔 inbound prompt、`[Claw:]` / `[Claw IM:]` 标题恢复均不再被当前 remote-channel 链路识别；只保留 `[Remote channel ...]` canonical 链路。
- [x] Agent Runtime thread/turn/session/interaction 操作跨 IPC/host 边界强制显式 `runtimeId`：shared contract、preload API、IPC schema、host resolver 和 adapter 测试均改为 fail-closed；`connect` / `capabilities` / `listThreads` / `usage` 保留当前 active/aggregate 语义。
- [x] 收紧 renderer auxiliary thread routing：`uploadAttachment({ threadId })`、`getAttachmentContent(options.threadId)`、`listModelAuditRecords({ threadId })`、`listGitCheckpoints({ threadId })`、`createGitCheckpoint({ threadId })` 会按 remembered thread runtime 发起，不再在 active runtime 切换后误走当前 active runtime。
- [x] 补齐 computer-use 状态投影与文案边界：IPC/backend status 聚合保留 `inputIsolation`、`affectsUserInput`、`requiresHostFocus`、`usesHostClipboard` 的 `false` 值，settings UI 改为用户可读安全摘要；README/locale 明确 GUI-managed `@sciforge/computer-use` 默认是 isolated `browser-cdp` primitive path。
- [x] 清理 Evidence DAG / sci-modality / plugins 文档中的 Kun timeline 命名残留，统一表述为 AgentRuntime / SciForge Runtime / local runtime / Codex / Claude。
- [x] Schedule detector 内部清名：`claw-scheduled-task-detector` / `ParsedClawScheduledTaskRequest` / `detectClawScheduledTaskRequest` 已改为 neutral `scheduled-task-detector` / `ParsedScheduledTaskRequest` / `detectScheduledTaskRequest`。

## 验证记录

- [x] `npm run typecheck`
- [x] `npm run model-router:typecheck`
- [x] `npm run search:typecheck`
- [x] `npx tsc --noEmit -p tsconfig.node.json`
- [x] `npm test`（234 files / 1831 tests）
- [x] `npm --prefix kun test`（53 files / 552 tests）
- [x] `npm --prefix kun test -- http-server.test.ts tests/loop.test.ts`
- [x] `npx vitest run src/main/schedule-runtime.test.ts src/main/workflow-runtime.test.ts src/main/claw-runtime.test.ts`
- [x] `npx vitest run src/shared/agent-runtime-contract.test.ts src/renderer/src/agent/agent-runtime-event-dispatcher.test.ts src/renderer/src/agent/agent-runtime-provider.test.ts src/renderer/src/lib/thread-sidebar-visibility.test.ts src/renderer/src/store/chat-store-claw-actions.test.ts src/renderer/src/store/chat-store-navigation-actions.test.ts`
- [x] `npx vitest run src/main/packaging-config.test.ts src/main/kun-src-boundary.test.ts src/main/weixin-bridge-runtime.test.ts src/main/ipc/app-ipc-schemas.test.ts src/main/settings-store.test.ts src/renderer/src/components/settings-section-agents.test.ts`
- [x] `npx vitest run src/renderer/src/components/chat/ConnectPhoneView.test.ts src/renderer/src/components/chat/SidebarClawDialogHelpers.test.ts src/renderer/src/plan/plan-store.test.ts src/renderer/src/plan/plan-command.test.ts src/renderer/src/plan/plan-prompts.test.ts src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/store/chat-store-runtime-helpers.test.ts`
- [x] `npx vitest run src/renderer/src/store/chat-store-navigation-actions.test.ts src/renderer/src/store/chat-store-schedulers.test.ts`
- [x] `npx tsc --noEmit -p tsconfig.node.json --pretty false`
- [x] `npx tsc --noEmit -p tsconfig.web.json --pretty false`
- [x] `npx vitest run src/shared/app-settings.test.ts src/main/settings-store.test.ts src/main/ipc/app-ipc-schemas.test.ts src/main/weixin-bridge-runtime.test.ts src/main/schedule-runtime.test.ts src/renderer/src/components/schedule/ScheduleTasksView.test.ts src/renderer/src/store/chat-store-claw-actions.test.ts src/renderer/src/store/chat-store-helpers.test.ts src/renderer/src/store/chat-store-app-actions.test.ts src/renderer/src/store/chat-store-thread-actions.test.ts src/renderer/src/components/chat/ConnectPhoneView.test.ts src/renderer/src/components/chat/RemoteGuardDetailView.test.ts src/renderer/src/components/settings-section-claw.test.ts`
- [x] `npm run model-router:test`
- [x] `npx vitest run src/main/model-router-api-boundary.test.ts src/main/model-router-health.test.ts src/renderer/src/components/settings-section-agents.test.ts src/main/weixin-bridge-runtime.test.ts`
- [x] `npx vitest run src/main/runtime/codex/app-server/json-rpc-client.test.ts src/main/runtime/codex/app-server/request-registry.test.ts src/main/runtime/codex/app-server/event-normalizer.test.ts src/main/runtime/codex/app-server/capsule-boundary.test.ts src/main/runtime/codex/codex-service.test.ts`
- [x] `npx vitest run src/preload/index.test.ts src/renderer/src/dev/dev-sciforge-bridge.test.ts src/renderer/src/lib/remote-channel-api.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/main/ipc/app-ipc-schemas.test.ts src/renderer/src/store/chat-store-runtime.test.ts src/renderer/src/store/chat-store-thread-actions.test.ts src/main/claw-runtime.test.ts`
- [x] `npx vitest run src/main/runtime/local-runtime-agent-runtime-adapter.test.ts src/renderer/src/agent/agent-runtime-event-dispatcher.test.ts src/renderer/src/agent/agent-runtime-provider.test.ts src/main/ipc/app-ipc-schemas.test.ts src/main/ipc/register-app-ipc-handlers.test.ts src/renderer/src/agent/agent-runtime-client.test.ts src/renderer/src/store/chat-store-navigation-actions.test.ts`
- [x] `npm test -- src/main/model-router-api-boundary.test.ts src/main/local-runtime-process.test.ts src/main/image-generation-mcp-config.test.ts src/renderer/src/components/chat/FloatingComposer.test.ts`
- [x] `npm test -- src/main/claw-runtime.test.ts src/main/scheduled-task-detector.test.ts src/main/schedule-runtime.test.ts`
- [x] `npx vitest run src/renderer/src/components/PluginMarketplaceView.test.ts`
- [x] `npx vitest run src/renderer/src/store/chat-store-runtime.test.ts`
- [x] `npx vitest run src/renderer/src/components/PluginMarketplaceView.test.ts src/renderer/src/components/settings-section-agents.test.ts src/renderer/src/components/chat/SidebarClawDialogHelpers.test.ts src/renderer/src/plan/plan-todo-sync.test.ts src/renderer/src/store/chat-store-provider-capabilities.test.ts`
- [x] `npx vitest run src/main/ipc/register-app-ipc-handlers.test.ts src/shared/claw-commands.test.ts src/main/ipc/app-ipc-schemas.test.ts src/preload/index.test.ts src/renderer/src/dev/dev-sciforge-bridge.test.ts src/renderer/src/lib/remote-channel-api.test.ts`
- [x] `npx vitest run src/main/services/skill-service.test.ts packages/workers/workspace-intel/src/service.test.ts`
- [x] `(packages/workers/workspace-intel) node --import tsx --test src/service.test.ts`
- [x] `npx vitest run src/shared/gui-plan.test.ts src/renderer/src/plan/plan-store.test.ts src/renderer/src/components/workbench-plan-controller.test.ts`
- [x] `npx vitest run src/renderer/src/store/chat-store-provider-capabilities.test.ts src/renderer/src/store/chat-store-side-actions.test.ts src/renderer/src/components/chat/FloatingComposer.test.ts src/renderer/src/components/chat/WorkbenchTopBar.test.ts`
- [x] `npx vitest run src/main/runtime/local-runtime-agent-runtime-adapter.test.ts src/renderer/src/agent/agent-runtime-event-dispatcher.test.ts`
- [x] `npm --prefix kun test -- tests/thread-service.test.ts`
- [x] `npx vitest run src/main/claw-platform-install.test.ts src/main/claw-runtime.test.ts src/main/weixin-bridge-runtime.test.ts src/main/ipc/register-app-ipc-handlers.test.ts`
- [x] `npx vitest run src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts`
- [x] `npx vitest run src/main/model-router-api-boundary.test.ts src/main/image-generation-mcp-config.test.ts`
- [x] `npm --workspace @sciforge/sci-modality-router run typecheck`
- [x] `npm --workspace @sciforge/sci-modality-router run test`
- [x] `npx vitest run src/main/claw-platform-install.test.ts src/renderer/src/components/chat/SidebarClawDialogHelpers.test.ts src/renderer/src/components/chat/ConnectPhoneView.test.ts`
- [x] `npx vitest run src/main/ipc/app-ipc-schemas.test.ts src/main/local-runtime-process.test.ts src/main/services/computer-use-status.test.ts src/renderer/src/components/settings-section-agents.test.ts src/main/computer-use-mcp-config.test.ts`
- [x] `node -e 'const fs=require("fs"); for (const f of ["src/renderer/src/locales/en/common.json","src/renderer/src/locales/en/settings.json","src/renderer/src/locales/zh/common.json","src/renderer/src/locales/zh/settings.json"]) JSON.parse(fs.readFileSync(f,"utf8"));'`
- [x] `npx vitest run packages/workers/scientific-plotting/src/scientific-skills-index.test.ts`
- [x] `npx vitest run src/main/runtime/codex/codex-config.test.ts src/main/runtime/claude-code/claude-code-config.test.ts src/main/model-router-sidecar.test.ts`
- [x] `npm --workspace @sciforge/sci-modality-router run typecheck`
- [x] `npm --workspace @sciforge/sci-modality-router run test`
- [x] `npx vitest run src/renderer/src/plan/plan-todo-sync.test.ts src/renderer/src/plan/plan-store.test.ts src/renderer/src/plan/plan-prompts.test.ts src/shared/gui-plan.test.ts`
- [x] `npm --prefix kun test -- tests/gui-plan.test.ts`
- [x] `npx vitest run src/main/kun-src-boundary.test.ts src/shared/app-settings.test.ts src/main/settings-store.test.ts src/renderer/src/components/settings-section-agents.test.ts`
- [x] `npx vitest run src/renderer/src/components/chat/ConnectPhoneView.test.ts src/renderer/src/store/chat-store-helpers.test.ts src/renderer/src/lib/workspace-path.test.ts src/main/discord-bot-runtime.test.ts`
- [x] `npm run typecheck`
- [x] `npm test`（235 files / 1841 tests）
- [x] `npm --prefix kun test -- tests/builtin-tools.test.ts`
- [x] `npm --prefix kun test`（53 files / 552 tests）
- [x] `git diff --check`
- [x] `npx vitest run src/shared/app-settings.test.ts src/renderer/src/components/chat/MessageTimeline.tool-summary.test.ts src/renderer/src/store/chat-store-helpers.test.ts src/renderer/src/store/chat-store-claw-actions.test.ts`
- [x] `npm test -- src/main/services/computer-use-status.test.ts src/renderer/src/components/settings-section-agents.test.ts src/main/ipc/app-ipc-schemas.test.ts src/main/runtime/agent-runtime/host.test.ts src/renderer/src/agent/agent-runtime-client.test.ts src/preload/index.test.ts`
- [x] `npm test -- src/renderer/src/agent/agent-runtime-provider.test.ts`

## 已决策待实施

- [x] 关闭 settings normalizer 旧 `threadId` / `localThreadId` / `lastThreadId` 兼容窗口：settings 类型、normalizer、IPC patch schema、schedule/remote-channel UI 与测试 fixture 已统一只读写 canonical `agentThreadIds`，旧字段作为 patch 输入会被 strict schema 拒绝。
- [x] 关闭 WeChat bridge 旧 `openclaw.json` / legacy credentials token / legacy env endpoint 运行态兼容：内置 bridge 不再读取旧 `openclaw.json`，也不再从 `weixin-bridge/credentials/openclaw-weixin/credentials.json` 回退 token；Connect phone 安装链路不再读取 `SCIFORGE_WEIXIN_BRIDGE_URL` / `SCIFORGE_OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_URL`；发送链路只使用当前 per-account token。
- [x] 收敛 Codex app-server compatibility re-export；内部测试/import 已迁到 `app-server/`，已删除 shim、旧 request registry shim 与 README 兼容说明。
- [x] 收敛 `window.sciforge` 里的 Feishu mirror 旧公开 API；已删除 `mirrorRemoteChannelMessageToFeishu` / `mirror-to-feishu` 兼容窗口，改为 remote-channel 中性 API。
- [x] public runtime machine protocol 暂继续保留 `KUN_READY`、health `service: "kun"`、CLI/env `KUN_*` 作为底层协议边界；本轮记录为协议边界决策，不做 breaking rename。
- [ ] 修改 legacy `~/.kun` global skills / MCP 配置兼容：迁移到新的 SciForge/local-runtime 路径，旧路径只作为迁移输入。已完成用户可见文档/UI 中性化、`~/.sciforge/mcp.json` 当前事实修正、内部 MCP builder / renderer helper 清名，以及 generic 默认 roots 不读 `~/.kun` 的防回归测试；仍需决策：迁移目标用 workspace `.agents/skills/...` 还是 global `~/.sciforge/skills/...`；旧 `~/.kun` 内容是复制、移动、提示导入还是忽略；是否保留 `npx skills add` 外部 CLI install 入口；旧 runtime config 中的 `~/.kun` roots 是自动改写还是只提示一次。
- [x] `DeepseekCompatModelClient` 长期收敛原则：LLM 只能走 model router；已加生产边界测试，除 runtime factory 注入 Model Router 客户端外，不允许新增直接 provider 调用。
- [ ] sci-modality expert provider 与 image-generation direct provider 原则上统一经 model/media router，避免形成新的 LLM/API 旁路。已完成 sci-modality / image-generation 边界防回归和 image-generation worker-contained 临时例外说明；仍需决策：全部并入 Model Router，还是拆出 Media Router 统一承接 image/video/audio 等非文本 provider；任一方案都应保持 GUI/runtime 只依赖 router 层。
- [x] Model Router provider 诊断只透出少量高价值状态到 health/UI：auth、network/timeout、provider bad response、provider error；不暴露全部内部细节。
- [ ] side conversation / plan checklist / GUI plan registry 的长期 owner 归 runtime/thread metadata；GUI 只负责展示和即时乐观更新。已完成显式 `includeSide` 读路径、runtime todo snapshot/event 透传、`create_plan` result replay、完成后 goal/todos snapshot merge、GUI plan registry shared helper 对齐、plan/todo merge 语义收敛、side capability gate 与 SSE 失败状态收敛；仍需决策：active GUI plan 存成 `thread.guiPlan` metadata，还是从最近一次 `create_plan` tool result 派生；旧 `sciforge.plan.registry.v1` localStorage 是迁移还是清空；side conversation 重启后是否需要恢复。
- [ ] remote-channel IM command 边界：账户/连接/线程选择归 GUI；任务执行、计划、工具行为归 runtime/agent，避免新增并行控制链路。已删除 dead `ClawRuntime.runTask()`、stale Feishu mirror API 文档、dead `imCommandNotReadyText`，并补齐 remote-channel task IPC 测试和 public API 文档；仍需决策：IM 是否允许 `/model` / `/mode` 这类 runtime 行为命令；项目/thread 选择是否允许经 IM 发生；schedule/task 创建是否允许从 IM 自动触发。
- [x] 删除 `vision-router-service`：Model Router 当前 `translators.vision` 已覆盖默认链路需要的 translate-only vision 能力，视觉输入会先经 vision translator 生成文本 evidence，再交给 text reasoner；已删除 standalone `plugins/vision-router-service` 及其文档/测试/notice 引用，默认链路不再保留第二条服务边界。后续如需要更强 retry/backoff/timeout，只在 Model Router `visionTranslator` provider call 内实现。
- [ ] `gui-owl-computer-use` 暂停处理：保持 `gui-owl-computer-use` 与旧 `@sciforge/computer-use` 并存，不迁移、不删除，等待人工分别测试两套 computer-use 后再决策。人工测试矩阵需覆盖：`-SafeDryRun` 不动鼠标键盘、live 必须 GUI approve、cancel 有效、无 token live 被拒、是否让手工 dry-run 也强制 token（因为会截图并走 Model Router）。
- [ ] Agent Runtime auxiliary 仍需决策是否改为按 operation 区分的 discriminated union：`reviewThread`、`listThreadChildren`、`readChildTranscript`、context ledger/state、runtime handoff、goal/todos、checkpoint create、thread workspace/archive、`cancelUserInput` 等 thread-bound operation 应强制 `runtimeId`；`getRuntimeInfo` / `listSkills` / `listMemories` / `listWorkspaceReferences` 等 active-scoped 能力继续允许省略。
- [ ] `SCIFORGE_CUA_SERVICE_URL` loopback 策略等待 computer-use 人工测试后决策：允许哪些 loopback 形式、是否支持 SSH tunnel hostname、非 loopback 时 fail-closed 并不广告旧 tool，还是保留当前“不启用 GUI-managed MCP 以避免重复注册”的冲突 guard。

## 待核对/拆解

- [x] 已核对并删除 standalone `vision-router-service`：Model Router 已覆盖主链路的 vision translation、runtime auth、body cap、healthz config/auth 诊断、trace redaction、失败降级和多输入形态测试；独立 ServiceResult API 不再保留。
- [x] 核对并替换 WeChat bridge 第三方 media sender：旧包内 `send-media` 会经 API wrapper 读取 `OPENCLAW_CONFIG` / state dir `openclaw.json` 的 `routeTag` / `botAgent`；现已改为本地 media upload/send 路径，显式使用当前 per-account token / baseUrl / cdnBaseUrl / contextToken，避免文件级隐式兼容。
- [ ] 等待人工测试两套 computer-use 后，再梳理是否迁移 `@sciforge/computer-use` 的 target/session/lease 合约、lease 冲突检测、shared action lock、native/browser backends、permission/status/audit、confirmation/risk taxonomy、local runtime/Codex/Claude MCP registry。
- [ ] Paper Radar 仍有旧 HTTP sidecar / plugin workspace 归属残留：当前 IPC 已走 `PaperRadarWorkerService`，但 `src/main/paper-radar-sidecar.ts` 和 `plugins/paper-radar-service` 仍需拆解是否删除旧 sidecar、迁移 core storage/source/profile/ranking 到 worker 内部或 shared core。
- [ ] Search worker root `index.ts` 仍暴露 query planner/provider helper；需核对外部消费后收窄 public surface。
- [x] Schedule detector 内部旧命名已清理为 neutral scheduled-task detector，并保留 Model Router-only 检测测试。
