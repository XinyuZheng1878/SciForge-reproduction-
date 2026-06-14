# DeepSeek GUI Agent / Tool 安全与回合收敛任务板

更新时间：2026-06-14

## 核心目标

从 Kun 更新中引入 agent loop 和 tool dispatch 的稳定性修复，让失败可解释、回合能收敛、工具权限遵守每个 turn 的运行上下文。

本任务不改变 DeepSeek-GUI 的主要交互设计，只修正 agent 运行时行为。

## 上游参考目录

Kun 上游仓库在本机：

`/Applications/workspace/ailab/research/app/Kun`

实现时优先阅读并移植 Kun 中对应的现成代码，不从头造车；但必须按 DeepSeek-GUI 当前架构、命名、配置、产品原则做必要适配。不得整仓 merge、不得引入本任务“不引入范围”里的 Kun 品牌化或旁路能力。

## 必须遵守的原则约束

1. 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
2. 所有修改必须通用，不能为特例写硬编码补丁。
3. 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
4. 对话、工作链路需要统一，不要额外生出旁路。

## 引入范围

- [x] 工具执行异常转成模型可见 tool result，除真正 abort 外不直接杀掉整个 turn。
- [x] suppressed / duplicate tool calls 能写入可解释结果，避免 queue 卡住。
- [x] 重复无工具 goal continuation 有上限和明确停止原因。
- [x] active turn abort / interrupt 后，open items 能 finalize 为 aborted / failed。
- [x] per-turn sandbox mode 传入 tool host，并过滤/拦截不允许的工具。
- [x] plan mode 工具隔离：只暴露 read-only / plan 所需工具。
- [x] `web_fetch` 大 body 截断为可用摘要，避免因过大直接失败。
- [x] `web_fetch` HTML 正文提取使用更稳健的扫描/解析逻辑，避免 script/style、注释、标签属性、HTML entity 等边界造成污染。
- [x] shell runtime 信息用事实型 `<shell_environment>` 上下文表达，避免模型在普通回复中复述命令式工具说明。
- [x] 失败 tool 的详情默认可见，但必须可折叠；pending approval / user input 等仍按当前处理保持强制展开。
- [x] 使用统一 runtime turn queue，不额外创建旁路执行链路。

## 不引入范围

- [x] 不引入 hooks。
- [x] 不引入新工具生态或 UI plugin。
- [x] 不引入 skills 管理开关、`load_skill` 工具或 skill catalog 注入；这些属于独立工具生态变更。
- [x] 不引入 LLM debug 设置页或 `/v1/debug/llm-rounds` 调试接口。
- [x] 不引入图片/语音/视频生成工具。
- [x] 不改变审批 UI 的产品语义，除非旧逻辑与 per-turn policy 冲突。
- [x] 不改变 Model Router 架构。

## Kun v0.2.10 增量纳入项

- [x] 纳入 `fix(chat): allow failed tool details to collapse`：参考 Kun `src/renderer/src/components/chat/message-timeline-process.tsx`，但只作为失败可解释的 UI 小修，不改聊天主布局。
- [x] 纳入 Kun `web-tool-provider.ts` HTML 提取增强：保留现有工具输出契约，只替换正文提取实现。
- [x] 纳入 Kun `builtin-tool-utils.ts` 中 shell runtime fact block 思路：不额外添加命令式系统提示。
- [x] 评估 Kun `token-economy.ts` 技术片段保护；只有当本任务同时处理 token economy/压缩时才纳入，不单独开旁路。

## 并行边界

本任务可能触碰 agent loop 核心文件，应避免和其他 worker 同时修改这些文件。

优先修改范围：

- `kun/src/loop/agent-loop.ts`
- `kun/src/services/turn-service.ts`
- `kun/src/adapters/tool/local-tool-host.ts`
- `kun/src/adapters/tool/sandbox-policy.ts`
- `kun/src/adapters/tool/web-tool-provider.ts`
- `kun/src/adapters/tool/builtin-tool-utils.ts`
- `kun/src/adapters/tool/output-accumulator.ts`
- `src/renderer/src/components/chat/message-timeline-process.tsx`
- 相关 contracts / tests

不要修改：

- runtime process supervision，留给 `PROJECT_RUNTIME_FOUNDATION.md`。
- IM provider/channel 业务，留给 `PROJECT_IM_STABILITY.md`。
- renderer message timeline 视觉，除非测试需要暴露错误状态。

## 参考来源

- Kun `kun/src/loop/agent-loop.ts`
- Kun `kun/src/services/turn-service.ts`
- Kun `kun/src/adapters/tool/sandbox-policy.ts`
- Kun `kun/src/adapters/tool/web-tool-provider.ts`
- Kun `kun/src/adapters/tool/builtin-tool-utils.ts`
- Kun `src/renderer/src/components/chat/message-timeline-process.tsx`
- Kun `kun/tests/goal-repetition-guard.test.ts`
- Kun `kun/tests/agent-loop-sandbox.test.ts`
- Kun commit: `fix(chat): allow failed tool details to collapse`

## 验收清单

- [x] 单个工具执行失败后，模型能收到失败结果并继续或收敛。
- [x] suppressed duplicate tool call 不会让 turn 永久 running。
- [x] plan mode 下无法执行写入/命令类工具。
- [x] workspace-write sandbox 下 in-process 文件写入限制在 workspace 内。
- [x] abort 后 timeline 中未完成 item 有明确终态。
- [x] web fetch 超大响应不会导致整个 turn 失败。
- [x] HTML 页面 fetch 的正文不包含 script/style 噪音，常见 entity 能正确解码。
- [x] 失败 tool 详情默认展示，用户可以收起并再次展开。
