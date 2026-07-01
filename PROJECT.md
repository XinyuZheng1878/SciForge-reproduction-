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

## 已决策待实施

- [ ] 关闭 settings normalizer 旧 `threadId` / `localThreadId` / `lastThreadId` 兼容窗口；后续只读 canonical `agentThreadIds`。
- [ ] 关闭 WeChat bridge 旧 `openclaw.json` / legacy credentials token 运行态兼容；后续只读当前 `weixin-bridge.json` 与 per-account token。
- [ ] 收敛 Codex app-server compatibility re-export；内部测试/import 迁到 `app-server/`，删除 shim 与 README 兼容说明。
- [ ] 收敛 `window.sciforge` 里的 Feishu mirror 旧公开 API；删除 `mirrorRemoteChannelMessageToFeishu` / `mirror-to-feishu` 兼容窗口，改为 remote-channel 中性 API。
- [ ] public runtime machine protocol 暂继续保留 `KUN_READY`、health `service: "kun"`、CLI/env `KUN_*` 作为底层协议边界；不在本轮做 breaking rename。
- [ ] 修改 legacy `~/.kun` global skills / MCP 配置兼容：迁移到新的 SciForge/local-runtime 路径，旧路径只作为迁移输入。
- [ ] `DeepseekCompatModelClient` 长期收敛原则：LLM 只能走 model router；后续不再扩展绕过 Model Router 的直接 provider 能力。
- [ ] sci-modality expert provider 与 image-generation direct provider 原则上统一经 model/media router，避免形成新的 LLM/API 旁路。
- [ ] Model Router provider 诊断只透出少量高价值状态到 health/UI：auth、network/timeout、provider bad response、provider error；不暴露全部内部细节。
- [ ] side conversation / plan checklist / GUI plan registry 的长期 owner 归 runtime/thread metadata；GUI 只负责展示和即时乐观更新。
- [ ] remote-channel IM command 边界：账户/连接/线程选择归 GUI；任务执行、计划、工具行为归 runtime/agent，避免新增并行控制链路。
- [x] 删除 `vision-router-service`：Model Router 当前 `translators.vision` 已覆盖默认链路需要的 translate-only vision 能力，视觉输入会先经 vision translator 生成文本 evidence，再交给 text reasoner；已删除 standalone `plugins/vision-router-service` 及其文档/测试/notice 引用，默认链路不再保留第二条服务边界。后续如需要更强 retry/backoff/timeout，只在 Model Router `visionTranslator` provider call 内实现。
- [ ] `gui-owl-computer-use` 暂停处理：保持 `gui-owl-computer-use` 与旧 `@sciforge/computer-use` 并存，不迁移、不删除，等待人工分别测试两套 computer-use 后再决策。

## 待核对/拆解

- [x] 已核对并删除 standalone `vision-router-service`：Model Router 已覆盖主链路的 vision translation、runtime auth、body cap、healthz config/auth 诊断、trace redaction、失败降级和多输入形态测试；独立 ServiceResult API 不再保留。
- [ ] 等待人工测试两套 computer-use 后，再梳理是否迁移 `@sciforge/computer-use` 的 target/session/lease 合约、lease 冲突检测、shared action lock、native/browser backends、permission/status/audit、confirmation/risk taxonomy、local runtime/Codex/Claude MCP registry。
