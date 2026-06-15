# DeepSeek GUI LaTeX / 科研写作任务板

更新时间：2026-06-14

## 核心目标

在不分裂 Write 写作主链路、不过度增加 GUI 复杂度的前提下，支持科研写作中的数学公式、论文结构与 LaTeX 交付需求。

本任务采用 Markdown-first 路线：默认以 Markdown 作为源格式，增强公式预览、富文本安全编辑和 LaTeX 导出；`.tex` 仅作为普通文本文件支持，并通过后台服务接入编译、转换等重能力。

GUI 的职责只是承载必要的人机交互：编辑、预览、选择、确认、展示状态与错误。其余可自动化能力应优先交给 Agent 后台、MCP 服务或独立 HTTP 服务完成，主应用保持轻量 UI 壳。

```text
同一个 Write workspace
  ├─ Markdown 科研写作：默认路径，轻量、可预览、可导出 LaTeX
  └─ .tex 文件支持：源码编辑、后台编译、PDF 结果预览
```

## 产品判断

优先支持“Markdown 下编辑，然后导出 LaTeX”。

理由：

- 当前 Write 模式已经以 Markdown 文件为核心，预览、富文本、导出、inline AI、选区引用都围绕 Markdown 工作。
- LaTeX 完整编译会引入 TeX 引擎、宏包、模板工程、bib、图片路径、编译日志、超时与安全边界，复杂度明显更高。
- 对大多数科研写作场景，Markdown + 公式 + LaTeX 导出已经能覆盖草稿、长文、基金/论文初稿与协作交付。
- `.tex` 文件支持仍然重要，但它应服务于期刊模板、已有 `.tex` 工程、本地 PDF 编译等硬需求，并以普通文本文件 + 后台服务的形式存在，不应成为 GUI 大入口。

## 必须遵守的原则约束

1. 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
2. 所有修改必须通用，不能为特定论文、特定模板、特定用户路径写硬编码补丁。
3. 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
4. 写作、预览、导出、AI 辅助、选区引用需要复用现有 Write 链路，不要额外生出旁路。
5. Markdown 仍是默认源格式；`.tex` 是文件类型能力和后台服务接入场景，不是新的文档系统。
6. 富文本能力必须遵守现有 Markdown 保真门禁：无法稳定 parse/serialize 的内容回退 source mode，不允许静默改写落盘。
7. GUI 只承载必须由人参与的交互；搜索、编译、转换、检索、批处理、computer use 增强等能力优先通过 Agent / MCP / HTTP 服务模块化实现。
8. 主代码框架保持简洁，避免把可服务化能力内嵌进 renderer 或 Electron main 的核心流程。

## 架构边界

```text
GUI shell
  ├─ 必要交互：编辑、预览、选择、确认、错误展示
  └─ 不承担重逻辑：编译、批量转换、模板解析、检索、外部自动化

后台能力
  ├─ Agent tools：一次性任务、智能修复、格式转换编排
  ├─ MCP services：可复用工具，如搜索、computer use、LaTeX 编译
  └─ HTTP services：需要长期运行或跨进程隔离的能力
```

LaTeX 能力的优先落点：

- 公式渲染属于前端必要预览能力，可以在 GUI 中实现。
- Markdown -> LaTeX 导出属于文档转换能力，优先做成可被 main/Agent 复用的纯模块，不绑定 UI。
- `.tex` 编译属于重后台能力，长期应以外部工具链 + MCP/HTTP 服务方式接入，GUI 只负责触发、状态展示和 PDF 预览。

## 阶段 1：Markdown 科研写作 MVP

- [x] 支持 Markdown 数学公式预览：
  - `$...$`
  - `$$...$$`
  - `\(...\)`
  - `\[...\]`
- [x] 在 Markdown preview 中接入公式渲染，继续保留 `rehype-harden` 安全边界。
- [x] 在 HTML / PDF / DOC / DOCX 导出中复用同一套公式渲染能力，避免预览和导出不一致。
- [x] 在富文本模式中将公式作为 inline/block math 节点处理，避免 Tiptap parse/serialize 丢失公式源码。
- [x] 在 Live 编辑模式中支持公式装饰：当前行保留源码编辑，非当前行可渲染为公式。
- [x] 增加 Markdown -> LaTeX 导出格式，覆盖基础结构：
  - 标题、段落、粗斜体
  - 有序/无序列表、任务列表降级
  - 引用、分割线
  - 表格
  - 图片
  - 代码块
  - inline/block 公式

## 阶段 2：LaTeX 导出质量增强

- [ ] 支持导出模板：
  - `article`
  - `ctexart`
  - 基础科研论文模板
- [ ] 支持 Markdown metadata/frontmatter 到 LaTeX 文档信息的映射：
  - `title` -> `\title{}`
  - `author` -> `\author{}`
  - `date` -> `\date{}`
- [ ] 支持图片导出策略：
  - 保持相对路径
  - 可选复制图片到导出目录
  - 路径包含空格或中文时正确转义
- [ ] 支持基本引用占位策略，但暂不引入完整 bib 管理。
- [ ] 导出 `.tex` 后不自动编译，保持第一阶段能力轻量、可控。

## 阶段 3：`.tex` 文件源码编辑支持

- [x] 将 `.tex` 纳入 Write workspace 文本文件类型。
- [x] `.tex` 文件默认进入 source editor，不进入 Tiptap 富文本模式。
- [ ] 为 `.tex` 提供 CodeMirror 语法高亮或轻量 tokenizer。
- [ ] 复用现有能力：
  - inline AI completion
  - 选区 quote action
  - 右侧写作助手
  - 保存、文件监听、外部编辑器打开
- [ ] 提供基础 LaTeX outline：
  - `\part`
  - `\chapter`
  - `\section`
  - `\subsection`
  - `\subsubsection`
- [x] 不自动重排或改写 `.tex` 源文件。

## 阶段 4：后台 LaTeX 服务接入

- [ ] 将 `.tex` 编译能力设计为独立后台服务，而不是 GUI 内置模式：
  - MCP service
  - 或本地 HTTP service
  - 或 Agent tool wrapper
- [ ] 后台服务检测本机 TeX 工具链：
  - `tectonic`
  - `xelatex`
  - `pdflatex`
  - `latexmk`
- [ ] 不默认捆绑大型 TeX 发行版，避免安装包膨胀。
- [ ] GUI 只提供必要的人类交互入口：
  - 手动编译
  - 可选保存后编译
  - 编译中状态
  - 取消编译
- [ ] Agent 可调用后台服务完成自动化任务：
  - 编译 `.tex`
  - 修复常见编译错误
  - 转换 Markdown / LaTeX
  - 生成或调整模板文件
- [ ] 编译必须有安全边界：
  - 限定工作目录
  - 超时
  - 日志脱敏
  - 不执行任意用户配置脚本
- [ ] PDF 预览复用现有 `WritePdfViewer`。
- [ ] 编译失败显示可解释日志，不能让 UI 卡死。
- [ ] 支持常见工程结构：
  - 单文件 `.tex`
  - `\input{}`
  - `\include{}`
  - 图片资源目录
- [ ] 后续再评估 bib / biber / bibtex / 多轮编译支持。

## 不引入范围

- [ ] 不把 Markdown 主编辑器替换成 LaTeX 编辑器。
- [ ] 不默认内置 TeX Live / MacTeX 等大型发行版。
- [ ] 不引入新的 AI 写作旁路。
- [ ] 不在 GUI 中内嵌 LaTeX 专用模式、完整 LaTeX IDE、模板管理器或工程管理器。
- [ ] 不把搜索、编译、批处理转换等后台能力写成 renderer 专属逻辑。
- [ ] 不让 `.tex` 文件进入 Tiptap 富文本保真链路。
- [ ] 不为了支持 `\section{}` 在 Markdown 里混入半套 LaTeX 文档语法。
- [ ] 不引入特定期刊、特定学校、特定模板的硬编码逻辑。
- [ ] 不重构 runtime / agent loop / provider settings。

## 并行边界

本任务应和 `PROJECT_WRITE_RICH_TEXT.md`、`PROJECT_PDF_WORKSPACE.md` 协调，避免同时大改同一写作容器。

优先修改范围：

- `src/renderer/src/components/write/WriteMarkdownPreview.tsx`
- `src/main/services/write-export-service.ts`
- `src/renderer/src/write/markdown-live-preview.ts`
- `src/renderer/src/write/markdown-live-widgets.ts`
- `src/renderer/src/write/tiptap/*`
- `src/shared/write-export.ts`
- `src/shared/write-text-file.ts`
- `src/renderer/src/components/write/WriteWorkspaceToolbar.tsx`
- `src/renderer/src/components/write/WriteWorkspaceDocumentPane.tsx`
- `package.json` / `package-lock.json`

不要修改：

- runtime / agent loop
- IM / Connect phone
- Model Router / provider settings
- SDD closed-loop 逻辑

## 技术候选

Markdown 公式渲染候选：

- `remark-math`
- `rehype-katex`
- KaTeX CSS

LaTeX 导出候选：

- 自研 Markdown AST -> LaTeX serializer
- 或复用统一 Markdown AST，避免从渲染 HTML 反推 LaTeX

`.tex` 编译候选：

- 优先外部工具链检测，不内置完整发行版
- `tectonic` 可作为轻量优先候选
- `latexmk` / `xelatex` / `pdflatex` 作为本机已有工具链支持
- 长期优先封装为 MCP / HTTP 服务，GUI 不直接承载编译状态机细节

## 验收清单

- [x] Markdown 中的 inline/block 公式在 preview 中稳定渲染。
- [x] 公式导出 HTML/PDF/DOC/DOCX 后效果与 preview 基本一致。
- [x] Markdown -> LaTeX 导出的 `.tex` 可被常见 TeX 工具链编译。
- [x] 富文本模式不会丢失或改写公式源码。
- [x] 保真失败、大文件、复杂语法仍能回退 source mode。
- [x] `.tex` 文件可在 Write workspace 中打开、编辑、保存。
- [x] `.tex` 文件不进入 Tiptap 富文本模式。
- [ ] `.tex` 编译失败不会卡死 UI，并能展示可解释错误。
- [ ] 现有 Write inline AI、选区引用、导出菜单不产生旁路。
- [ ] GUI 中没有引入非必要重交互；后台能力通过可复用模块、Agent tool、MCP 或 HTTP 服务接入。
