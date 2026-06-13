# DeepSeek GUI Tiptap 富文本写作任务板

更新时间：2026-06-13

## 核心目标

引入 Tiptap 富文本 Markdown 编辑能力，但保留 DeepSeek-GUI 当前 CodeMirror / Markdown 源码编辑作为稳定兜底。

本任务是写作体验升级，必须独立推进，不和 runtime bug fix 混合。

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

富文本是同一写作链路的一种显示/编辑模式，不是新的文档系统。

```text
同一个 workspace file
  ├─ rich mode: Tiptap
  └─ source mode: 现有 Markdown 编辑器
```

## 引入范围

- [ ] 添加 Tiptap rich mode，可在现有写作工作区切换。
- [ ] 保留 source mode，并作为保真失败、大文件、异常时的默认兜底。
- [ ] Markdown parse/serialize 增加保真门禁：不通过时禁止 rich 写回。
- [ ] 未发生用户编辑的文档绝不自动重写落盘。
- [ ] 支持基础 Markdown：标题、段落、列表、任务列表、代码块、表格、图片、链接、引用、粗斜体。
- [ ] 行内 AI / inline completion 复用现有写作服务和 IPC，不新建旁路。
- [ ] 粘贴图片、本地图片显示、富文本复制可作为后续子阶段。

## 不引入范围

- [ ] 不替换掉现有 Markdown 源码编辑器。
- [ ] 不引入 Kun 视觉风格。
- [ ] 不引入 SDD 全套闭环，SDD 只可复用 editor 基础能力。
- [ ] 不引入图片生成工具。
- [ ] 不引入付费 Tiptap AI 产品。

## 并行边界

本任务改动面大，应独立 worker 或单独分支推进。避免和 `PROJECT_PDF_WORKSPACE.md` 同时修改 `WriteWorkspaceView.tsx`；若并行，PDF 先提供独立 viewer，富文本后接入。

优先修改范围：

- `src/renderer/src/write/tiptap/*`
- `src/renderer/src/components/write/WriteWorkspaceView.tsx`
- `src/renderer/src/components/write/WriteMarkdownEditor.tsx`
- `src/renderer/src/components/write/WriteWorkspaceToolbar.tsx`
- `src/renderer/src/styles/write-rich-editor.css`
- `scripts/tiptap-roundtrip-audit.mjs`
- `package.json` / lockfile for `@tiptap/*`

不要修改：

- runtime / agent loop。
- IM。
- Model Router / provider settings。

## 参考来源

- Kun `docs/tiptap-migration.md`
- Kun `src/renderer/src/write/tiptap/WriteRichEditor.tsx`
- Kun `src/renderer/src/write/tiptap/markdown-manager.ts`
- Kun `src/renderer/src/write/tiptap/markdown-projection.ts`
- Kun `scripts/tiptap-roundtrip-audit.mjs`

## 验收清单

- [ ] 默认打开简单 Markdown 可以进入 rich mode。
- [ ] 保真审计失败的 Markdown 自动回 source mode。
- [ ] rich mode 编辑后保存，常见 Markdown 结构稳定。
- [ ] 没编辑的文档不会因为打开/关闭产生 git diff。
- [ ] inline AI 仍走现有写作链路。
- [ ] 大文件、异常文件、复杂 HTML Markdown 不破坏内容。
