# DeepSeek GUI Runtime 架构治理任务板

更新时间：2026-06-20

## 不可变规则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走model router
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。

## 新任务：跨 Runtime 吸收 Kun 上游能力

目标：从本机 Kun 上游仓库选择性吸收能力，但必须收敛到本项目的多 runtime 架构。Kun、Codex、Claude 等 runtime 都应通过统一 contract / service / IPC 使用同一套能力，不能只给单一 runtime 写旁路。

不纳入本轮：

- [x] 不引入上游“模型供应商/端点体系”；本项目继续以 Model Router 作为唯一模型路由入口。
- [x] 不吸收上游 IM / Claw 稳定性专项；本项目已有独立增强，后续只按具体 bugfix 单独判断。

### 总体设计任务

- [ ] 盘点现有 `agent-runtime-contract`、runtime adapter、renderer provider、IPC schema，确认哪些能力应进入 shared runtime contract，哪些作为 host service / auxiliary channel 提供。
- [ ] 为所有新能力定义 runtime 无关的 capability 标识、输入输出 schema、错误语义和权限边界。
- [ ] 确保 Kun、Codex、Claude runtime 的接入路径一致：前端不直接判断具体 runtime 来调用不同私有 API。
- [ ] 确保所有模型请求仍只通过 Model Router 或 runtime 已有的模型出口，不新增模型供应商旁路。
- [ ] 为每个能力补最小跨 runtime 回归测试：至少覆盖 contract/schema、host dispatch、一个 renderer 调用路径。

### LSP AI 工具 / 代码导航

- [ ] 抽象统一的只读代码导航能力，支持 `goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`。
- [ ] 以 shared tool/capability 形式暴露给所有 runtime，避免只在 Kun 内置工具里注册。
- [ ] 首期支持 TypeScript / JavaScript；缺少 `typescript-language-server` 时返回可操作错误，不让 turn 崩溃。
- [ ] 约束 LSP 工具为只读能力，不允许写文件、执行任意 shell 或绕过 workspace path 校验。
- [ ] 设计 LSP session 生命周期：按 workspace 复用、空闲清理、应用退出时关闭，避免孤儿 language server 进程。
- [ ] 待讨论：是否把 `typescript-language-server` 和 `typescript` 加入项目依赖，还是只提示用户自行安装。
- [ ] 待讨论：后续是否扩展 Python / Rust / Go 等语言，还是保持 TS/JS 小切片。

### LLM Debug Recorder / 模型请求审计

- [ ] 设计跨 runtime 的模型请求审计缓冲区，记录最近若干轮请求，而不是只记录 Kun model client。
- [ ] 捕获关键字段：runtimeId、threadId、turnId、provider/model alias、Model Router 请求 URL、request body 摘要、stream output、tool calls、usage、stop reason、error、duration。
- [ ] 默认只保存在内存，不落盘；提供清空入口，并在进程重启后自动清空。
- [ ] 实现统一脱敏策略：Authorization、API key、cookie、token、secret、文件绝对路径和大块正文需要隐藏或截断。
- [ ] 通过设置页或开发者面板展示审计记录，展示路径必须复用 shared contract，不直接读某个 runtime 私有状态。
- [ ] 确保审计不会改变正常流式输出、tool call 解析、usage 统计和错误传播。
- [ ] 待讨论：默认开启还是仅在开发者/调试开关开启后记录。
- [ ] 待讨论：request body 应展示完整脱敏 JSON，还是只展示消息数量、工具列表、附件摘要等结构化摘要。

### 上下文压缩 / Goal Resume

- [ ] 对比上游 `compaction-history`、`compaction-summary`、`goal-resume-coordinator`、`token-economy`，拆出可跨 runtime 复用的概念。
- [ ] 设计统一的上下文状态 contract：原始历史、有效历史、压缩摘要、摘要来源、token 估算、压缩触发原因。
- [ ] 先让 Kun 内核收益可验证，再评估 Codex / Claude runtime 是否能通过 adapter 注入同一套状态。
- [ ] 支持模型生成压缩摘要，但模型调用必须走本项目统一模型出口，不能引入上游供应商逻辑。
- [ ] 支持进行中目标的恢复语义：中断后可恢复、恢复次数可控、失败原因可见。
- [ ] UI 中统一展示压缩进度、摘要位置和 goal resume 状态，不按 runtime 分叉展示。
- [ ] 待讨论：压缩摘要应由 Model Router 统一生成，还是由各 runtime 自己生成但写入统一格式。
- [ ] 待讨论：Goal Resume 是否只适用于明确创建的 goal，还是也适用于普通长任务。

### Git 回合回滚 Checkpoint

- [ ] 引入跨 runtime 的 turn checkpoint 概念：在关键 turn 前后记录 Git 状态，支持按 turn 回滚。
- [ ] 复用现有 `git-service`，避免为 Kun/Codex/Claude 分别实现 Git 操作。
- [ ] 设计 checkpoint 元数据：runtimeId、threadId、turnId、workspaceRoot、branch、createdAt、diff/stat、恢复状态。
- [ ] 恢复前必须检测脏工作区、未跟踪文件和分支变化，避免覆盖用户未确认的修改。
- [ ] renderer 侧提供统一的 checkpoint 列表、预览和恢复入口，所有 runtime 的会话用同一套 UI。
- [ ] 待讨论：checkpoint 默认每 turn 自动创建，还是只在代码写入/工具修改文件前创建。
- [ ] 待讨论：回滚是否允许自动 stash 用户未提交改动，还是必须停下来让用户确认。

### Memory 管理 UI / 共享记忆

- [ ] 盘点现有 Kun memory store 与多 runtime contract，决定 memory 是 Kun 私有能力还是提升为 shared memory capability。
- [ ] 若提升为 shared capability，定义统一 memory record schema：scope、workspace/project、tags、confidence、disabled/deleted、createdAt/updatedAt。
- [ ] 设置页提供统一管理入口：查看、创建、编辑、禁用、删除、按 scope 过滤。
- [ ] 所有 runtime 注入 memory 时都必须走同一检索/过滤规则，避免 Kun/Codex/Claude 看到不同记忆。
- [ ] 保留上游有价值修复：用户级记忆始终注入、项目作用域隔离、CJK 检索行为可用。
- [ ] 待讨论：是否现在就做跨 runtime 共享 memory contract，还是先把 Kun memory UI 补齐。
- [ ] 待讨论：memory 是否默认开启，以及哪些 scope 可以被模型自动写入。

### Workspace 文件树预览 / Composer 文件引用增强

- [ ] 引入统一 workspace file index / text preview 能力，支持文件树、文本预览、图片/PDF 摘要和安全路径解析。
- [ ] Composer 的文件引用、研究、写作、代码模式都使用同一套 workspace reference 数据结构。
- [ ] 文件引用传给 runtime 时使用稳定、安全、可审计的 workspace-relative ref，不暴露不必要的绝对路径。
- [ ] 支持 worktree/project 分组展示，但不引入完整上游 worktree 池，除非后续单独决策。
- [ ] 增强拖拽、@ 文件提及、目录引用和预览面板的交互，确保所有 runtime 收到一致附件/文件上下文。
- [ ] 待讨论：是否把 Workspace 文件树预览作为独立右侧面板，还是合并进现有 composer/file picker。

## 当前目标

合并 GitHub PR #12 `Multimodal plugins`，但按本项目架构约束收敛实现：`sci-modality` 只由 Model Router 调用，Kun/Codex runtime 只负责传递结构化附件引用，不直接调用模型型翻译服务。

目标链路：

```text
GUI attachment picker
  -> Runtime (Kun / Codex)
    -> structured attachment ref
      -> Model Router
        -> external plugin service (sci-modality / vision)
          -> text reasoner
```

## 架构决策

- [x] `plugins/` 是外置服务目录，不作为桌面 app 必然打包内容。
- [x] `sci-modality` 只由 Model Router 调用；Kun/Codex 不直接读取 `SCIFORGE_SCIMODALITY_SERVICE_URL` 调外部专家服务。
- [x] 任意位置拖入的科学文件采用复制模式：复制到 workspace 内 `.sciforge/uploads/` 后，以结构化附件引用交给 Model Router。
- [x] 默认自动科学模态识别只覆盖明确科学扩展名，不包含泛用 `.txt`、`.csv`、`.tsv`。
- [x] `.txt`、`.csv`、`.tsv` 默认作为普通文本/文件引用；后续如需科学分析，需要显式“作为科学数据分析”的用户动作。

## 合并任务

- [x] 合并 PR #12 `multimodal-plugins` 到当前 `gui` 分支。
- [x] 手工解决 `packages/workers/model-router/src/router.ts` 冲突：保留当前 `gui` 的 tool transcript hydrate/cache 逻辑，再接入 scientific modality fallback。
- [x] 移除或绕开 Kun 侧直接调用 `sci-modality` 的路径，确保 runtime 只传结构化附件引用。
- [x] 实现科学附件复制模式：外部文件复制到 workspace `.sciforge/uploads/`，再传安全相对引用。
- [x] 收紧科学扩展名 gating：默认不让 `.txt`、`.csv`、`.tsv` 自动外发到专家服务。
- [x] 保留 PR 新增的 `plugins/sci-modality-router-service`，并保留/迁移 `plugins/vision-router-service` 作为外置插件服务。
- [x] 按外置插件策略修正 `electron-builder.config.cjs`、`scripts/after-pack.cjs` 和 packaging tests，不再要求插件目录随 app 打包。
- [x] 更新文档和设置文案：明确 scientific modality 是外置插件服务，未配置时不启用。

## 回归测试

- [x] `npm --workspace @sciforge/model-router run test`
- [x] `npm --workspace sciforge-sci-modality-router-service run test`
- [x] `npm --workspace sciforge-vision-router-service run test`
- [x] `npm --prefix kun test -- attachment-store`
- [x] `npx vitest run src/main/packaging-config.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`

## 验收标准

- PR #12 的科学多模态能力可用，但模型型翻译服务调用只发生在 Model Router。
- Kun/Codex runtime 不直接调用 `sci-modality`，不会产生 runtime-specific 模型服务旁路。
- 外部科学文件通过复制到 workspace 的 `.sciforge/uploads/` 获得稳定、安全、可审计的引用。
- 明确科学格式可自动进入 sci-modality；泛用文本/表格格式默认不外发。
- `plugins/` 外置策略与打包、测试、文档一致，不破坏 release 链路。
- `SCIFORGE_SCIMODALITY_SERVICE_URL` 未配置或服务不可用时，普通文本、图片、PDF 和聊天流程保持可用。
