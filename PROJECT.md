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

实现策略：优先从 `/Applications/workspace/ailab/research/app/Kun` 上游已有实现中移植、改造和收敛，不从零重写已经验证过的能力；每个功能先标出可参考的上游文件，再按本项目的 shared runtime contract、Model Router 和 UI 架构做适配。

不纳入本轮：

- [x] 不引入上游“模型供应商/端点体系”；本项目继续以 Model Router 作为唯一模型路由入口。
- [x] 不吸收上游 IM / Claw 稳定性专项；本项目已有独立增强，后续只按具体 bugfix 单独判断。

### 总体设计任务

- [ ] 盘点现有 `agent-runtime-contract`、runtime adapter、renderer provider、IPC schema，确认哪些能力应进入 shared runtime contract，哪些作为 host service / auxiliary channel 提供。
- [ ] 为所有新能力定义 runtime 无关的 capability 标识、输入输出 schema、错误语义和权限边界。
- [ ] 确保 Kun、Codex、Claude runtime 的接入路径一致：前端不直接判断具体 runtime 来调用不同私有 API。
- [ ] 确保所有模型请求仍只通过 Model Router 或 runtime 已有的模型出口，不新增模型供应商旁路。
- [ ] 为每个能力补最小跨 runtime 回归测试：至少覆盖 contract/schema、host dispatch、一个 renderer 调用路径。
- [ ] 每个功能必须补端到端测试验证：从 renderer/IPC 或 runtime host 入口触发，覆盖至少一个成功路径和一个失败/降级路径。
- [ ] 每个功能实现前先列出 Kun 上游参考文件、可直接移植的代码、必须改造的架构边界和不应照搬的部分。

### LSP AI 工具 / 代码导航

- [ ] 参考并移植上游 `kun/src/adapters/tool/builtin-lsp-tool.ts`、`kun/src/adapters/tool/lsp-client.ts`，不要从头实现 LSP JSON-RPC 客户端。
- [ ] 抽象统一的只读代码导航能力，支持 `goToDefinition`、`findReferences`、`hover`、`documentSymbol`、`workspaceSymbol`、`goToImplementation`。
- [ ] 以 shared tool/capability 形式暴露给所有 runtime，避免只在 Kun 内置工具里注册。
- [ ] 首期支持 TypeScript / JavaScript；缺少 `typescript-language-server` 时返回可操作错误，不让 turn 崩溃。
- [ ] 约束 LSP 工具为只读能力，不允许写文件、执行任意 shell 或绕过 workspace path 校验。
- [ ] 设计 LSP session 生命周期：按 workspace 复用、空闲清理、应用退出时关闭，避免孤儿 language server 进程。
- [ ] 端到端测试：在测试 workspace 中让 runtime 调用 LSP definition/reference 查询，验证所有 runtime 能收到一致结果；同时验证缺少 language server 时返回可见错误。
- [ ] 待讨论：是否把 `typescript-language-server` 和 `typescript` 加入项目依赖，还是只提示用户自行安装。
- [ ] 待讨论：后续是否扩展 Python / Rust / Go 等语言，还是保持 TS/JS 小切片。

### LLM Debug Recorder / 模型请求审计

- [ ] 参考并改造上游 `kun/src/services/llm-debug-recorder.ts`、`kun/src/server/routes/debug-llm.ts` 和设置页展示，保留 ring buffer 思路，不照搬 Kun 私有 route。
- [ ] 设计跨 runtime 的模型请求审计缓冲区，记录最近若干轮请求，而不是只记录 Kun model client。
- [ ] 捕获关键字段：runtimeId、threadId、turnId、provider/model alias、Model Router 请求 URL、request body 摘要、stream output、tool calls、usage、stop reason、error、duration。
- [ ] 默认只保存在内存，不落盘；提供清空入口，并在进程重启后自动清空。
- [ ] 实现统一脱敏策略：Authorization、API key、cookie、token、secret、文件绝对路径和大块正文需要隐藏或截断。
- [ ] 通过设置页或开发者面板展示审计记录，展示路径必须复用 shared contract，不直接读某个 runtime 私有状态。
- [ ] 确保审计不会改变正常流式输出、tool call 解析、usage 统计和错误传播。
- [ ] 端到端测试：用模拟 Model Router 响应跑一次 Kun/Codex/Claude 请求链路，验证审计记录可查看、已脱敏、可清空，且不改变用户可见输出。
- [ ] 待讨论：默认开启还是仅在开发者/调试开关开启后记录。
- [ ] 待讨论：request body 应展示完整脱敏 JSON，还是只展示消息数量、工具列表、附件摘要等结构化摘要。

### 上下文压缩 / Goal Resume

- [ ] 对比上游 `compaction-history`、`compaction-summary`、`goal-resume-coordinator`、`token-economy`，拆出可跨 runtime 复用的概念。
- [ ] 优先移植上游已验证的 compaction/history/goal resume 算法，再把入口和存储改造成本项目 shared runtime 形态。
- [ ] 设计统一的上下文状态 contract：原始历史、有效历史、压缩摘要、摘要来源、token 估算、压缩触发原因。
- [ ] 先让 Kun 内核收益可验证，再评估 Codex / Claude runtime 是否能通过 adapter 注入同一套状态。
- [ ] 支持模型生成压缩摘要，但模型调用必须走本项目统一模型出口，不能引入上游供应商逻辑。
- [ ] 支持进行中目标的恢复语义：中断后可恢复、恢复次数可控、失败原因可见。
- [ ] UI 中统一展示压缩进度、摘要位置和 goal resume 状态，不按 runtime 分叉展示。
- [ ] 端到端测试：构造超长会话触发压缩，并模拟中断后恢复，验证摘要写入、恢复状态和 UI 事件在所有 runtime contract 下保持一致。
- [ ] 待讨论：压缩摘要应由 Model Router 统一生成，还是由各 runtime 自己生成但写入统一格式。
- [ ] 待讨论：Goal Resume 是否只适用于明确创建的 goal，还是也适用于普通长任务。

### Git 回合回滚 Checkpoint

- [ ] 参考并改造上游 `src/main/services/git-checkpoint-service.ts`、`src/shared/git-checkpoint.ts`，复用其 Git 安全检查思路。
- [ ] 引入跨 runtime 的 turn checkpoint 概念：在关键 turn 前后记录 Git 状态，支持按 turn 回滚。
- [ ] 复用现有 `git-service`，避免为 Kun/Codex/Claude 分别实现 Git 操作。
- [ ] 设计 checkpoint 元数据：runtimeId、threadId、turnId、workspaceRoot、branch、createdAt、diff/stat、恢复状态。
- [ ] 恢复前必须检测脏工作区、未跟踪文件和分支变化，避免覆盖用户未确认的修改。
- [ ] renderer 侧提供统一的 checkpoint 列表、预览和恢复入口，所有 runtime 的会话用同一套 UI。
- [ ] 端到端测试：在临时 Git repo 中跑一次 turn 修改文件、创建 checkpoint、预览 diff、恢复 checkpoint，并验证脏工作区阻断路径。
- [ ] 待讨论：checkpoint 默认每 turn 自动创建，还是只在代码写入/工具修改文件前创建。
- [ ] 待讨论：回滚是否允许自动 stash 用户未提交改动，还是必须停下来让用户确认。

### Memory 管理 UI / 共享记忆

- [ ] 参考上游 `src/renderer/src/components/settings-section-memory.tsx` 和 `kun/src/memory/memory-store.ts`，优先移植管理体验和 CJK/作用域修复。
- [ ] 盘点现有 Kun memory store 与多 runtime contract，决定 memory 是 Kun 私有能力还是提升为 shared memory capability。
- [ ] 若提升为 shared capability，定义统一 memory record schema：scope、workspace/project、tags、confidence、disabled/deleted、createdAt/updatedAt。
- [ ] 设置页提供统一管理入口：查看、创建、编辑、禁用、删除、按 scope 过滤。
- [ ] 所有 runtime 注入 memory 时都必须走同一检索/过滤规则，避免 Kun/Codex/Claude 看到不同记忆。
- [ ] 保留上游有价值修复：用户级记忆始终注入、项目作用域隔离、CJK 检索行为可用。
- [ ] 端到端测试：通过设置页创建/编辑/禁用记忆，再启动不同 runtime 的会话，验证注入、过滤和禁用行为一致。
- [ ] 待讨论：是否现在就做跨 runtime 共享 memory contract，还是先把 Kun memory UI 补齐。
- [ ] 待讨论：memory 是否默认开启，以及哪些 scope 可以被模型自动写入。

### Workspace 文件树预览 / Composer 文件引用增强

- [ ] 参考并改造上游 `WorkspaceFilePreviewPanel`、`ChatFileTreePanel`、`workspace-file-index`、`workspace-text-preview`、`composer-file-references` 等实现。
- [ ] 引入统一 workspace file index / text preview 能力，支持文件树、文本预览、图片/PDF 摘要和安全路径解析。
- [ ] Composer 的文件引用、研究、写作、代码模式都使用同一套 workspace reference 数据结构。
- [ ] 文件引用传给 runtime 时使用稳定、安全、可审计的 workspace-relative ref，不暴露不必要的绝对路径。
- [ ] 支持 worktree/project 分组展示，但不引入完整上游 worktree 池，除非后续单独决策。
- [ ] 增强拖拽、@ 文件提及、目录引用和预览面板的交互，确保所有 runtime 收到一致附件/文件上下文。
- [ ] 端到端测试：从 composer 引用文件/目录并预览，再发送到不同 runtime，验证 runtime 收到同一 workspace-relative ref 和预期内容摘要。
- [ ] 待讨论：是否把 Workspace 文件树预览作为独立右侧面板，还是合并进现有 composer/file picker。
