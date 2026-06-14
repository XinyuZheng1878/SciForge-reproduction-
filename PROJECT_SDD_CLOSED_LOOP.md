# DeepSeek GUI SDD 需求闭环任务板

更新时间：2026-06-14

## 核心目标

引入 Kun 的 SDD 需求追踪与闭环能力，但必须 DeepSeek-GUI 化：沿用当前 DeepSeek-GUI 的 SDD 工作流和命名，不引入 Kun 品牌目录或旁路。

本任务关注 requirement → plan → todo → verify 的统一链路。

## 上游参考目录

Kun 上游仓库在本机：

`/Applications/workspace/ailab/research/app/Kun`

实现时优先阅读并移植 Kun 中对应的现成代码，不从头造车；但必须按 DeepSeek-GUI 当前架构、命名、配置、产品原则做必要适配。不得整仓 merge、不得引入本任务“不引入范围”里的 Kun 品牌化或旁路能力。

## 必须遵守的原则约束

1. 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
2. 所有修改必须通用，不能为特例写硬编码补丁。
3. 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
4. 对话、工作链路需要统一，不要额外生出旁路。

## 产品边界

SDD 闭环必须复用现有对话、计划、todo、写作/草稿链路。

```text
需求草稿
  → 计划 covers 标注
  → agent todo / plan progress
  → 验收验证
  → 需求状态更新
```

不要额外创造一个独立 SDD mini-app。

## 引入范围

- [x] 引入 R 块解析：`### R-1: 标题 {status}`。
- [x] 引入验收项解析：`- [ ]` / `- [x]`。
- [x] 引入 plan covers 标注解析：`(covers: R-1, R-2)`。
- [x] 计算需求覆盖率、未覆盖需求、完成进度。
- [x] 根据计划/todo 状态推导 requirement 状态，但自动写回需要受控。
- [x] 引入 verify prompt，要求 agent 按验收项检查并更新需求文件。
- [x] 支持需求相关图片/原型附件时，使用 DeepSeek-GUI 自己的目录规范。
- [x] 隐藏空的 requirement assistant thread，避免 sidebar 被没有内容的需求线程污染。
- [x] 打开 sidebar 中已有 requirement assistant thread 时，能恢复对应需求草稿；但启动/切 workspace 不自动劫持到上次草稿。

## 不引入范围

- [x] 不使用 `.kunsdd` 作为 DeepSeek-GUI 新目录名。
- [x] 不引入 Kun 品牌文本。
- [x] 不强制迁移已有 SDD 草稿。
- [x] 不引入 UI 插件/iKun。
- [x] 不引入图片/视频/音乐生成工具。
- [x] 不改变现有 plan/todo 的主链路。
- [x] 不引入 composer 底部工作区切换器；工作区切换仍遵守 DeepSeek-GUI 当前主导航。

## Kun v0.2.10 增量纳入项

- [x] 纳入 `fix(sdd): hide empty requirement assistant threads`：参考 Kun `sdd-thread-registry.ts` / `Workbench.tsx` / `sdd-draft-history.ts`。
- [x] 纳入“不自动恢复 remembered requirement draft”的产品修正：打开应用或切换工作区应进入干净会话，不被旧需求草稿打断。
- [x] 恢复已有需求草稿必须通过现有 sidebar / 需求入口显式发生。

## 并行边界

本任务会触碰 SDD、plan、write workspace，建议在 `PROJECT_WRITE_RICH_TEXT.md` 的 editor 基础接口稳定后推进 UI 层；底层 parser/compute 可先独立实现。

优先修改范围：

- `src/shared/sdd-trace.ts`
- `src/renderer/src/sdd/sdd-trace-compute.ts`
- `src/renderer/src/sdd/use-sdd-trace.ts`
- `src/renderer/src/sdd/sdd-verify-prompt.ts`
- `src/renderer/src/sdd/sdd-plan-prompt.ts`
- `src/renderer/src/components/sdd/*`
- 相关 tests

不要修改：

- runtime / agent loop。
- provider settings。
- chat image display。
- IM。

## 参考来源

- Kun `src/shared/sdd-trace.ts`
- Kun `src/renderer/src/sdd/sdd-trace-compute.ts`
- Kun `src/renderer/src/sdd/use-sdd-trace.ts`
- Kun `src/renderer/src/sdd/sdd-verify-prompt.ts`
- Kun `src/renderer/src/components/sdd/SddDraftEditorView.tsx`
- Kun v0.2.10 `src/renderer/src/sdd/sdd-thread-registry.ts`
- Kun v0.2.10 `src/renderer/src/sdd/sdd-draft-history.ts`
- Kun v0.2.10 `src/renderer/src/components/Workbench.tsx`
- Kun commit: `fix(sdd): hide empty requirement assistant threads`

## 验收清单

- [x] 能解析需求文档中的 R 块和验收项。
- [x] 能解析计划中的 covers 标注并计算覆盖率。
- [x] 未覆盖需求能在 UI 或报告中明确提示。
- [x] verify prompt 能要求 agent 按验收项核验。
- [x] 自动状态写回受控，不会在用户编辑中造成内容冲突。
- [x] 现有 SDD 草稿能继续读取，不被强制迁移。
- [x] 空 requirement assistant thread 不显示为普通会话噪音。
- [x] App 启动和 workspace 切换不会自动打开上次需求草稿。
