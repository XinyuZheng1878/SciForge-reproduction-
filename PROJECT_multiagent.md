# SciForge Multi-Agent 与 Reasoning 任务板

更新时间：2026-06-27

## 当前目标

将所有聊天型 runtime 的 reasoning 展示和 multi-agent 工作链路收敛到统一 AgentRuntime 契约。运行过程中，用户应能看到 runtime 合法暴露的 reasoning 内容；reasoning、工具、运行状态和中间输出应在同一个“已处理 / 运行中”时间流里按事件顺序展示。所有 runtime 的 child/subagent 信息应通过右上角状态入口和右侧 children/transcript panel 查看。通用 multi-agent 能力已抽出到 `packages/workers/multi-agent`，作为独立拓展。

本任务只覆盖聊天型 Agent runtime：SciForge Runtime、Codex、Claude Code。schedule、workflow、image-generation 等 worker 不作为聊天 runtime 强行接入。

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 Model Router；multi-agent worker 不直接持有 provider API key，不直连上游模型。
- 相同功能的工作链路需要统一，不要额外生出旁路；删除冗余，代码尽可能精简。
- GUI 只显示 canonical runtime 数据：child 列表和 transcript 由 runtime children endpoint 或 adapter canonical projection 提供，事件只作为实时刷新信号。
- Reasoning 展示只使用 runtime/provider 明确暴露的 `reasoning_delta`、`assistant_reasoning` 或 summary，不绕过供应商/运行时的隐藏思考边界。

## 任务清单

- [x] 梳理现有 reasoning 链路：确认 SciForge Runtime、Codex、Claude Code 分别如何产出 `reasoning_delta`、`assistant_reasoning` 或 reasoning summary。
- [x] 梳理现有 multi-agent/children 链路：确认 SciForge Runtime `delegate_task`、Codex native child/collab metadata、Claude Code subagent 目录解析的共同字段和差异。
- [x] 定义 `packages/workers/multi-agent` 公共契约：child run record、usage、transcript entry、status、aggregate、diagnostics、错误码。
- [x] 定义 `packages/workers/multi-agent` 运行边界：worker 不直接调用 LLM provider，只接受 runtime host 注入的 executor；executor 必须走 Model Router。
- [x] 设计 `packages/workers/multi-agent` 文件存储：child-runs 持久化、parent thread/turn 过滤、transcript 读取、diagnostics 聚合。
- [x] 设计通用 `delegate_task` 工具输入输出：prompt、label、workspace、model、childId、status、summary、usage、error，不加入 runtime 特例字段。
- [x] 设计 SciForge Runtime 迁移：把通用 child run schema/store/runtime 从 `kun/src/delegation` 抽到 worker 包，local runtime 只保留依赖自身 AgentLoop 的 child executor。
- [x] 设计 Codex 接入：保留 native child/collab 解析，但输出必须归一到 `AgentRuntimeChild` 和 `AgentRuntimeChildTranscript`。
- [x] 设计 Claude Code 接入：保留 native subagent/workflow 解析，但输出必须归一到 `AgentRuntimeChild` 和 `AgentRuntimeChildTranscript`。
- [x] 设计 capabilities 语义：`tools.subagents.available` 表示当前 runtime 可展示并使用统一 multi-agent 能力；`maxParallel/maxChildren` 统一来自共享 agent capabilities。
- [x] 设计 renderer 实时更新：`child_event` 进入正式 `ThreadEventSink.onChild` 链路，只触发统一 children hook 重新拉 canonical children，不维护第二份 child 状态缓存。
- [x] 设计 children 状态栏和右侧 panel 行为：无 child 时隐藏右上角入口；运行中实时显示 queued/running/completed/failed/aborted；点击入口打开右侧 panel，点击 child 可查看 transcript；有真实 thread ref 时才显示打开线程。
- [x] 设计 transcript 展示：统一支持 user_message、reasoning、tool、assistant_message、system、event，默认限制条数并支持后续分页。
- [x] 设计 reasoning UI 行为：非 `none` 的 reasoning 流进入同一个 process timeline；运行中默认展开，完成后折叠但可展开；标注来源/可见级别。
- [x] 清理旧旁路：删除与统一 worker/AgentRuntime children/transcript 冲突的旧 delegation store、renderer-only child 缓存或 runtime 专属展示分支。
- [x] 补测试计划：worker contract/store 测试、SciForge Runtime `delegate_task` 测试、Codex/Claude child projection 测试、renderer `child_event` 刷新测试、reasoning 展示回归测试。
- [x] 补文档计划：更新 local runtime 架构、AgentRuntime contract 文档、settings/capabilities 说明，明确 LLM API 只能走 Model Router。

## 落地摘要

- `packages/workers/multi-agent` 提供共享 contract、file/in-memory store、bounded runtime、`delegate_task` IO 和 tests。
- SciForge Runtime 通过 worker runtime + host-injected child executor 接入；旧 `kun/src/delegation/delegation-runtime.ts` 已删除。
- Codex/Claude Code 保留 native child/workflow/subagent 解析，但统一输出 canonical `AgentRuntimeChild` / transcript。
- Renderer 的 `child_event` 只递增刷新 key，统一 children hook 重新拉 runtime canonical children；不缓存 event child。
- Child/subagent 展示从左侧 sidebar 收敛到右上角状态入口 + 右侧 panel；无 child 时入口隐藏。
- Reasoning delta 携带 visibility/source，在统一 process timeline 中按事件顺序与工具/状态/中间输出同流展示。
- 已验证：worker typecheck/test、kun typecheck 和 delegation/child executor tests、renderer/shared targeted tests、Codex/Claude/local runtime targeted tests、root typecheck。
