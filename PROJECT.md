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

## 验证记录

- [x] `npm run typecheck`
- [x] `npm run model-router:typecheck`
- [x] `npm run search:typecheck`
- [x] `npx tsc --noEmit -p tsconfig.node.json`
- [x] `npm test`（232 files / 1802 tests）
- [x] `npm --prefix kun test`（52 files / 543 tests）
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
- [x] `npm test -- src/main/claw-runtime.test.ts src/main/claw-scheduled-task-detector.test.ts src/main/schedule-runtime.test.ts`
- [x] `npx vitest run src/renderer/src/components/PluginMarketplaceView.test.ts`
- [x] `npx vitest run src/renderer/src/store/chat-store-runtime.test.ts`
- [x] `git diff --check`

## 已决策待实施

- [x] 关闭 settings normalizer 旧 `threadId` / `localThreadId` / `lastThreadId` 兼容窗口：settings 类型、normalizer、IPC patch schema、schedule/remote-channel UI 与测试 fixture 已统一只读写 canonical `agentThreadIds`，旧字段作为 patch 输入会被 strict schema 拒绝。
- [x] 关闭 WeChat bridge 旧 `openclaw.json` / legacy credentials token 运行态兼容：内置 bridge 不再读取旧 `openclaw.json`，也不再从 `weixin-bridge/credentials/openclaw-weixin/credentials.json` 回退 token；发送链路只使用当前 per-account token。
- [x] 收敛 Codex app-server compatibility re-export；内部测试/import 已迁到 `app-server/`，已删除 shim、旧 request registry shim 与 README 兼容说明。
- [x] 收敛 `window.sciforge` 里的 Feishu mirror 旧公开 API；已删除 `mirrorRemoteChannelMessageToFeishu` / `mirror-to-feishu` 兼容窗口，改为 remote-channel 中性 API。
- [x] public runtime machine protocol 暂继续保留 `KUN_READY`、health `service: "kun"`、CLI/env `KUN_*` 作为底层协议边界；本轮记录为协议边界决策，不做 breaking rename。
- [ ] 修改 legacy `~/.kun` global skills / MCP 配置兼容：迁移到新的 SciForge/local-runtime 路径，旧路径只作为迁移输入。已完成用户可见文档/UI 中性化和 `~/.sciforge/mcp.json` 当前事实修正；仍需决策：迁移目标用 workspace `.agents/skills/...` 还是 global `~/.sciforge/skills/...`；旧 `~/.kun` 内容是复制、移动、提示导入还是忽略；是否保留 `npx skills add` 外部 CLI install 入口；旧 runtime config 中的 `~/.kun` roots 是自动改写还是只提示一次。
- [x] `DeepseekCompatModelClient` 长期收敛原则：LLM 只能走 model router；已加生产边界测试，除 runtime factory 注入 Model Router 客户端外，不允许新增直接 provider 调用。
- [ ] sci-modality expert provider 与 image-generation direct provider 原则上统一经 model/media router，避免形成新的 LLM/API 旁路。已完成 sci-modality / image-generation 边界防回归和 image-generation worker-contained 临时例外说明；仍需决策：全部并入 Model Router，还是拆出 Media Router 统一承接 image/video/audio 等非文本 provider；任一方案都应保持 GUI/runtime 只依赖 router 层。
- [x] Model Router provider 诊断只透出少量高价值状态到 health/UI：auth、network/timeout、provider bad response、provider error；不暴露全部内部细节。
- [ ] side conversation / plan checklist / GUI plan registry 的长期 owner 归 runtime/thread metadata；GUI 只负责展示和即时乐观更新。已完成显式 `includeSide` 读路径、runtime todo snapshot/event 透传、`create_plan` result replay 和完成后 goal/todos snapshot merge；仍需决策：active GUI plan 存成 `thread.guiPlan` metadata，还是从最近一次 `create_plan` tool result 派生；旧 `sciforge.plan.registry.v1` localStorage 是迁移还是清空；side conversation 重启后是否需要恢复。
- [ ] remote-channel IM command 边界：账户/连接/线程选择归 GUI；任务执行、计划、工具行为归 runtime/agent，避免新增并行控制链路。已删除 dead `ClawRuntime.runTask()` 和 stale Feishu mirror API 文档；仍需决策：IM 是否允许 `/model` / `/mode` 这类 runtime 行为命令；项目/thread 选择是否允许经 IM 发生；schedule/task 创建是否允许从 IM 自动触发。
- [x] 删除 `vision-router-service`：Model Router 当前 `translators.vision` 已覆盖默认链路需要的 translate-only vision 能力，视觉输入会先经 vision translator 生成文本 evidence，再交给 text reasoner；已删除 standalone `plugins/vision-router-service` 及其文档/测试/notice 引用，默认链路不再保留第二条服务边界。后续如需要更强 retry/backoff/timeout，只在 Model Router `visionTranslator` provider call 内实现。
- [ ] `gui-owl-computer-use` 暂停处理：保持 `gui-owl-computer-use` 与旧 `@sciforge/computer-use` 并存，不迁移、不删除，等待人工分别测试两套 computer-use 后再决策。

## 待核对/拆解

- [x] 已核对并删除 standalone `vision-router-service`：Model Router 已覆盖主链路的 vision translation、runtime auth、body cap、healthz config/auth 诊断、trace redaction、失败降级和多输入形态测试；独立 ServiceResult API 不再保留。
- [x] 核对并替换 WeChat bridge 第三方 media sender：旧包内 `send-media` 会经 API wrapper 读取 `OPENCLAW_CONFIG` / state dir `openclaw.json` 的 `routeTag` / `botAgent`；现已改为本地 media upload/send 路径，显式使用当前 per-account token / baseUrl / cdnBaseUrl / contextToken，避免文件级隐式兼容。
- [ ] 等待人工测试两套 computer-use 后，再梳理是否迁移 `@sciforge/computer-use` 的 target/session/lease 合约、lease 冲突检测、shared action lock、native/browser backends、permission/status/audit、confirmation/risk taxonomy、local runtime/Codex/Claude MCP registry。
