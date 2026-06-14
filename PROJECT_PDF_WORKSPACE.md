# DeepSeek GUI PDF 工作区阅读任务板

更新时间：2026-06-14

## 核心目标

引入 Kun 中相对独立的 PDF 阅读/选区能力，让 DeepSeek-GUI 的写作或研究工作区能打开 PDF、选择文本，并把选区纳入现有对话/写作辅助链路。

本任务不依赖 Tiptap 富文本，可先独立落地。

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

- [x] workspace file preview 支持 PDF 文件读取。
- [x] renderer 使用 pdf.js 渲染 PDF 页面。
- [x] 支持分页、缩放、搜索/基础导航。
- [x] 支持 PDF 文本选区，并把选区传给现有 assistant / quote 工作链路。
- [x] PDF 选区显示页码和位置，引用时可追溯。
- [x] 大文件或解析失败时显示可解释 fallback。
- [x] 附件 picker / bridge 能暴露真实文件路径，PDF 打开与引用复用统一 workspace/file 链路。

## 不引入范围

- [x] 不引入 Tiptap 富文本。
- [x] 不改变 Markdown 编辑器默认模式。
- [x] 不引入图片生成、原型生成、SDD 全套闭环。
- [x] 不新增独立 PDF 对话旁路；必须复用现有 workspace assistant/selection 流。

## Kun v0.2.10 增量纳入项

- [x] 纳入 `fix(attachments): expose picker file path through kun bridge` 的文件路径暴露部分，作为 PDF 打开/引用的接入基础。
- [x] 可参考 Kun `feat(write): add selection quote action`，确保 PDF 选区进入现有 quote tray，而不是新增 PDF 专用发送链路。

## 并行边界

本任务可能触碰 write workspace 文件预览和 IPC，避免与 `PROJECT_WRITE_RICH_TEXT.md` 同时大改同一写作容器。可以先完成 main/preload PDF read 和独立 viewer，再由富文本任务接入。

优先修改范围：

- `src/main/services/workspace-files.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/shared/workspace-file.ts`
- `src/renderer/src/components/write/WritePdfViewer.tsx`
- `src/renderer/src/components/WorkspaceFilePreviewPanel.tsx`

不要修改：

- Tiptap rich editor。
- SDD trace/writeback。
- Model Router。

## 参考来源

- Kun `src/renderer/src/components/write/WritePdfViewer.tsx`
- Kun `src/shared/pdfjs-dist.d.ts`
- Kun `src/main/services/write-pdf-text-service.ts`
- Kun `src/main/services/workspace-files.ts`
- Kun v0.2.10 `src/renderer/src/components/write/WriteInlineAgent.tsx`
- Kun commit: `feat(write): add selection quote action`
- Kun commit: `fix(attachments): expose picker file path through kun bridge`

## 验收清单

- [x] PDF 文件能在工作区打开并渲染。
- [x] PDF 选区文本能进入现有 assistant 引用链路。
- [x] 选区跨页时页码范围准确。
- [x] PDF 加载失败有明确提示。
- [x] Markdown/text 文件预览和编辑不受影响。
- [x] PDF 选区引用走现有 assistant quote 工作链路。
