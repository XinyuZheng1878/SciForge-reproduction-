# SciForge PDF 交互式批注任务板

更新时间：2026-06-22

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走 model router。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。


## 新任务：PDF 交互式批注、评论、翻译与聊天提问

目标：让 PDF 阅读支持可持久、可分享、可贡献的交互式批注层。用户可以划定 PDF 内容，进行高亮、评论、翻译和统一聊天提问；AI 回答可以沉淀为批注；批注随 sidecar 包导入导出，并可被外部修改和贡献。

### 产品与数据契约

- [x] 定义 PDF sidecar v1 schema，包含 `manifest`、`pdfFingerprint`、`anchors`、`annotations`、`threads`、`authors`、`version` 和 `updatedAt`。
- [x] 明确 sidecar 本地形态：默认保存到 `.sciforge/pdf-annotations/<pdfHash>.json`，并支持与 PDF 同目录的 `paper.pdf.dsgui-annotations.json` 兼容读取。
- [x] 明确 sidecar 交换形态：导出 `paper.dsgui-pdf.zip`，包含原始 PDF、`annotations.json`、`manifest.json` 和可选附件。
- [x] 定义 `PdfAnchor`，同时保存页码、归一化页面坐标、quote 文本、text hash、前后文 fallback 和创建时 PDF 指纹。
- [x] 定义 `PdfAnnotationThread`，统一承载 comment、note、translation、question、answer、highlight，不为每种动作建立旁路模型。
- [x] 为 sidecar schema 增加迁移机制，后续版本通过 `schemaVersion` 做无损升级。

### PDF 锚点与渲染层

- [x] 将当前 PDF 选区 rect 从视口像素坐标升级为页面归一化坐标，保证缩放、窗口变化、重新打开后可稳定复现。
- [x] 实现 anchor 重新定位：优先使用 text hash 和 quote，失败时使用前后文 fallback，再失败时降级到原始 rect。
- [x] 在 PDF overlay 层渲染持久高亮、评论标记、翻译标记和当前选区预览。
- [x] 支持跨页选区，并限制极端大量 rect 的性能风险。
- [x] 对无 text layer 的 PDF 标记为视觉选区模式，为后续 OCR/视觉模型提问预留 anchor 类型。
- [x] 增强 PDF text layer 词级命中与视觉行拖选，避免隐藏 DOM 顺序导致词划不到或误选后续大段文本。

### 批注交互

- [x] 划选 PDF 文本后显示操作条：高亮、评论、翻译、提问、复制引用。
- [x] 支持在 PDF 文本上右键直接打开批注菜单，无需先手动划选。
- [x] 评论线程支持卡片内直接输入、保存、再次编辑和删除。
- [x] 批注面板支持左右拖拽调宽，每条批注线程都有明确删除入口。
- [x] PDF 正文批注高亮支持隐藏、当前、全部三档，默认只显示当前选中批注。
- [x] 实现右侧批注面板，按页码、类型、状态筛选 annotation thread。
- [x] 支持新建、编辑、删除、解决/重新打开评论线程。
- [x] 支持翻译选区并保存为 translation annotation，保留目标语言和源文本。
- [x] 支持从 AI 回答一键保存为 note、answer 或 translation annotation。
- [x] 支持点击批注跳转到 PDF 对应页和 anchor 位置。

### 统一聊天桥接

- [x] 复用现有 quoted selection 工作链路，将 PDF anchor 作为聊天上下文进入统一 composer。
- [x] 聊天 prompt 中包含 PDF 文件、页码范围、anchor 位置、quote 文本和附近检索上下文。
- [x] 让“提问”动作不创建新的旁路聊天，而是把选区引用注入当前统一聊天。
- [x] 支持多选区、多批注作为同一条用户问题的上下文。
- [x] 将聊天回答与来源 anchor/thread 建立可追踪关联，便于保存、回看和导出。

### Sidecar 导入导出与贡献

- [x] 实现读取 sidecar：打开 PDF 时自动加载同目录或 `.sciforge` 中匹配的 annotations。
- [x] 实现保存 sidecar：批注变更自动写入本地 annotations 文件，并保留稳定排序，方便 Git diff。
- [x] 实现导出 sidecar 包：生成包含 PDF 和批注数据的 zip。
- [x] 实现导入 sidecar 包：校验 PDF 指纹，匹配成功直接导入，匹配失败提示用户选择是否尝试 anchor 重新定位。
- [x] 支持外部修改后的 annotations 重新加载，并对 schema、作者、更新时间和冲突字段做校验。
- [x] 规划贡献流程：annotation JSON 可 review、可 diff、可合并，冲突先按 thread id 和 updatedAt 解决。

### 扫描版 PDF 与视觉提问

- [x] 检测无 text layer PDF，并在 UI 中提示可使用视觉选区能力。
- [x] 支持用户框选页面图片区域，生成 image anchor。
- [x] 将 image anchor 发送到 model router 的视觉模型进行解释、翻译或摘要。
- [x] 可选接入 OCR，将识别文本回填为 quote，提升后续搜索和重新定位能力。
- [x] 将 OCR/视觉结果保存为 annotation，并与原始图片区域保持关联。

### 权限、隐私与安全

- [x] 明确 sidecar 不默认嵌入用户私密聊天全文，只保存用户显式保存为批注的内容。
- [x] 导出前提供内容预览，展示将被打包的 PDF、批注、作者和附件。
- [x] 对导入的 sidecar 做 schema 校验、大小限制和文本清洗，避免恶意内容污染 UI。
- [x] 对外部贡献内容保留作者和时间戳，但允许用户在导出前匿名化。

### 测试与验收

- [x] 覆盖 anchor 坐标归一化、缩放复现、跨页选区和重新定位单元测试。
- [x] 覆盖 sidecar schema 校验、保存、读取、导入、导出和版本迁移测试。
- [x] 覆盖 PDF 选区进入统一聊天 prompt 的测试，确保不产生旁路工作链路。
- [x] 覆盖批注面板的新增、编辑、删除、筛选、跳转交互测试。
- [x] 使用真实论文 PDF 验证：文本选区、评论、翻译、提问、保存回答、导出包、重新导入完整闭环。
- [x] 使用扫描版 PDF 验证视觉选区降级路径不会破坏普通文本 PDF 流程。
