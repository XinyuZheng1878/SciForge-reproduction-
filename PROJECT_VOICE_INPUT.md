# DeepSeek GUI 语音输入任务板

更新时间：2026-06-14

## 核心目标

引入聊天输入框语音转文字能力，但保持 DeepSeek-GUI 现有 Model Router 和 provider 设置结构不变。

语音输入是输入方式增强，不是新的 agent 工作链路。

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

- [x] 设置页增加独立 Speech-to-Text 配置：enabled、baseUrl、apiKey、model、language、timeout。
- [x] 支持 OpenAI-compatible `/audio/transcriptions`。
- [x] 可选支持 MiMo ASR，仅作为通用协议选项，不引入 Xiaomi provider preset。
- [x] 聊天 composer 增加麦克风按钮。
- [x] 录音后支持“插入到输入框”和“转写后直接发送”。
- [x] 转写中、失败、权限拒绝、超时都有可解释 UI。
- [x] 限制单次录音时长和 IPC payload 大小。

## 不引入范围

- [x] 不引入 provider refactor。
- [x] 不引入 TTS / 音乐 / 视频。
- [x] 不改变 IM 远端输入链路。
- [x] 不新增独立语音会话页面。
- [x] 不把语音配置混进 Kun Providers 页面。

## 并行边界

本任务可在 runtime 修复之后独立推进。主要触碰 settings、preload/main IPC、composer。

优先修改范围：

- `src/shared/speech-to-text.ts`
- `src/main/services/speech-to-text-service.ts`
- `src/main/ipc/app-ipc-schemas.ts`
- `src/main/ipc/register-app-ipc-handlers.ts`
- `src/preload/index.ts`
- `src/renderer/src/components/chat/use-voice-dictation.ts`
- `src/renderer/src/components/chat/FloatingComposer.tsx`
- `src/renderer/src/components/settings-section-speech-to-text.tsx`

不要修改：

- Model Router。
- provider preset/catalog。
- media generation tools。
- IM remote message handling。

## 参考来源

- Kun `src/shared/speech-to-text.ts`
- Kun `src/main/services/speech-to-text-service.ts`
- Kun `src/renderer/src/components/chat/use-voice-dictation.ts`
- Kun `src/renderer/src/components/settings-section-speech-to-text.tsx`

## 验收清单

- [x] 未配置语音输入时，现有 composer 体验不变。
- [x] 配置后可以录音、转写、插入输入框。
- [x] 直接发送不会绕过现有 send/turn queue。
- [x] 录音权限拒绝和转写失败有明确提示。
- [x] API key 不进入普通日志。
