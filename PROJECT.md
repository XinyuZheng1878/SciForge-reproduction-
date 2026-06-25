# SciForge Research Memory MCP 任务板

更新时间：2026-06-26

## 当前目标

实现一个 MCP-first 的 Research Memory 能力，让学生在本地使用 agent 做科研工作，同时把经过压缩和确认的项目状态同步到 GitHub。

本功能不新增 extension UI。GUI 只保留必要的人类交互；真实能力放到 `packages/workers/research-memory`，通过 MCP 给 SciForge Runtime、Codex、Claude Code 等 runtime 复用。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 model router。
- 相同功能的工作链路需要统一，不要额外生出旁路;删除冗余,代码尽可能精简
- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- 用户可见文案和公开 API 不暴露 Kun 影子；默认本地 runtime 对外称 SciForge Runtime / local runtime。

---

## 第一阶段：Research Memory Worker 骨架

- [x] 新增 `packages/workers/research-memory` workspace。
- [x] 定义 `contract.ts`：tool names、zod schemas、结果类型、side-effect annotations。
- [x] 定义服务边界：artifact index、policy check、draft generation、status HTML、GitHub adapter。
- [x] 新增 worker README，说明它是 MCP worker，不是 renderer 功能。
- [x] 添加 worker typecheck/test scripts，并接入 root workspace scripts。

## 本轮多 agent 清理

- [x] 统一 Plan 工作链路，只保留当前 `.sciforge/plan` 路径，删除历史兼容旁路。
- [x] 统一 runtime config IPC/API 命名，删除旧 `deepseek:config:*` / `kun:config:*` GUI 通道。
- [x] 收紧 Research Memory worker，避免 `status.html` 生成路径旁路。
- [x] 清理用户可见 Kun 文案，让默认本地 runtime 对外呈现为 SciForge Runtime。
- [x] 修复 workspace 无根路径、dev browser bridge、terminal PTY owner token 等高风险旁路。
- [x] 清理 runtime-inspector MCP 外露工具/资源/env/CLI 命名，改为 local runtime 契约。
- [x] 运行针对性测试与 typecheck，确认精简后链路一致。

## Runtime id 深迁移

- [x] 将公开/持久化 runtime id 从 `kun` 迁移为 `sciforge`，覆盖 settings、IPC schema、schedule/claw/thread 映射、renderer store。
- [x] 将 `agents.kun` 设置 key 迁移为 `agents.sciforge`，删除 settings/IPC 里的旧 key 写入路径。
- [x] 将 runtime-inspector checkpoint 公开 schema 的 runtime id 迁移为 `sciforge`。
- [x] 将公开文档从 `kun-*` / `KUN_CONFIG` 重命名为 local-runtime 系列，并同步 README、AGENTS、architecture/config 文档。
- [x] 将默认本地 runtime 数据目录改为 `~/.sciforge/runtime`，旧 `.sciforge/kun` 仅作为历史默认路径识别。
- [x] 将公开 runtime status/error/default 常量命名改为 local runtime 命名。
- [x] 收敛内部 `Kun*` helper/type/file 命名；仅保留 `kun/` 包名、CLI、`KUN_*` env、`KUN_READY`、`service: 'kun'` 等底层协议边界。
- [x] 删除 Local Runtime credential override 和旧 tool-storm settings 兼容入口，统一走 Model Router/provider 与 `runtimeGuards`。
- [x] 统一 Schedule AgentRuntime 执行链路，复用共享 `runPromptViaRuntime`，删除本地重复等待/readThread 链路。
- [x] 删除旧 webhook secret header 成功路径，只接受 `Authorization: Bearer` 和 `x-sciforge-secret`。
- [x] 重新运行 typecheck、根测试、Local Runtime 子包测试与 runtime-inspector 测试，修复深迁移后的隐性编译/行为问题。
