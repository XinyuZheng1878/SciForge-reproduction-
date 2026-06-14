# DeepSeek GUI 聊天图片展示任务板

更新时间：2026-06-14

## 核心目标

只引入聊天页面图片展示的增量能力，为后续 Model Router 支持图像生成成员模型做接收层准备。

本任务不引入图片生成工具、不引入 provider refactor、不新增图像模型设置。

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

- [x] timeline 支持 assistant / tool result 中的图片 attachment 展示。
- [x] 支持 generated image 类型的缩略图渲染。
- [x] 支持点击图片打开 lightbox 预览。
- [x] 支持保存 / 打开原图 / 复制路径等基础操作，按 DeepSeek-GUI 现有文件工作链路实现。
- [x] 图片加载失败时显示可解释 fallback。
- [x] 对图片 payload 做通用解析：data URL、workspace file、generated file metadata 等，不为单一模型硬编码。
- [x] 附件 picker / bridge 返回真实文件路径时，聊天图片展示优先复用该路径进入统一 workspace/file 读取链路。

## Kun v0.2.10 增量纳入项

- [x] 纳入 `fix(attachments): expose picker file path through kun bridge` 中对文件路径暴露的必要部分，用于图片/PDF/附件展示接收层。
- [x] 不引入图像生成工具，只复用其输出形态和附件路径处理经验。

## 不引入范围

- [x] 不新增 `generate_image` 工具。
- [x] 不引入 OpenAI/MiniMax image provider 设置。
- [x] 不引入 Kun provider capability 系统。
- [x] 不改变 Model Router 架构；只接收它未来返回的图片结果。
- [x] 不把图片展示做成独立旁路页面。

## 并行边界

本任务主要是 renderer message timeline 和 preload/main 文件读取小接口，可与 runtime 修复并行。

优先修改范围：

- `src/renderer/src/components/chat/MessageTimeline.tsx`
- `src/renderer/src/components/chat/message-timeline-bubbles.tsx`
- `src/renderer/src/components/chat/message-timeline-cards.tsx`
- `src/renderer/src/components/chat/ImagePreviewLightbox.tsx`
- `src/shared/*api*`
- 必要的 workspace image read IPC

不要修改：

- Model Router。
- provider settings。
- write workspace PDF viewer，留给 `PROJECT_PDF_WORKSPACE.md`。
- image generation runtime tools。

## 参考来源

- Kun `src/renderer/src/components/chat/ImagePreviewLightbox.tsx`
- Kun `src/renderer/src/components/chat/message-timeline-bubbles.tsx`
- Kun v0.2.10 `src/preload/index.ts`
- Kun v0.2.10 `src/main/ipc/app-ipc-schemas.ts`
- Kun `kun/src/adapters/tool/image-gen-tool-provider.ts` 仅参考输出形态，不引入工具能力。
- Kun commit: `fix(attachments): expose picker file path through kun bridge`

## 验收清单

- [x] 普通文本消息渲染不受影响。
- [x] 图片结果能在聊天页直接预览。
- [x] 多张图片能稳定布局，不遮挡文本。
- [x] 图片点击预览可关闭，键盘/鼠标交互符合现有 UI 习惯。
- [x] 图片来源不可读取时有明确错误状态。
- [x] 没有新增图像生成设置或 provider preset。
- [x] picker 选择的本地图片能通过统一文件路径链路展示，不依赖临时旁路。
