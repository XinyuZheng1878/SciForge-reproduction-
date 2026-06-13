# DeepSeek GUI IM / 手机值守任务板

更新时间：2026-06-13

核心原则：

> remote conversation 是绑定源，local thread 是稳定目标，desktop focus 只是可显式接管的观察状态；所有消息按绑定目标串行排队，任何切换都必须显式。

体验底线：

> 手机端稳定、桌面端不打断、切换必须显式、失败必须可解释。

## 当前目标

让飞书 / Lark、微信、Discord 等 IM 消息进入 DeepSeek GUI 时，行为等价于用户在桌面端控制同一个本地会话，但不会被桌面当前焦点、刷新、切屏影响。

一个 DeepSeek GUI 安装可以配置一个 Discord Bot，邀请到一个或多个 server/channel；每个绑定 channel 可以有自己的 workspace、model、agent profile 和 guard 模式。

权限默认与桌面端一致：IM 请求沿用项目级 runtime、sandbox、Model Router 配置。所谓“默认给 agent 所有权限”，表示远端消息不额外降权，但不能绕过项目配置。

## 已落地基线

- [x] 手机/IM 会话默认按 remote conversation 绑定本地 thread，不再绑定电脑当前焦点。
- [x] 首次手机消息默认新建本地 thread。
- [x] `/attach current` 是显式接管当前桌面会话的入口。
- [x] 飞书私聊默认全响应，群聊默认只响应 @bot / @all。
- [x] 飞书已有按 remote conversation 的串行队列。
- [x] 飞书已有基础 messageId 去重。
- [x] 手机消息进入后，项目工作页面保持不跳转到专门 IM 页面。
- [x] 侧边栏已有机器人值守标志 / 活跃状态提示基础。
- [x] Codex active turn 期间 `readThread` fallback 不再杀掉本地运行。
- [x] 已支持 `/new`、`/help`、`/model`、`/model auto|pro|flash` 等基础命令。
- [x] 每个 IM channel 已能记录 agent profile、workspace、model 等绑定配置。
- [x] 飞书已有基础文本回复、生成文件发送、直接文件发送路径。

## 不可变规则

- 桌面当前焦点默认永远不能改变手机绑定目标。
- 切换绑定必须显式发生：桌面动作或 `/attach current`。
- 远端绑定 key 至少包含：`provider + channelId + chatId + remoteThreadId`。
- 同一个 remote conversation 必须严格串行处理。
- 同一个 local thread 全局只能有一个 active turn，手机和桌面消息共享队列。
- 失败必须回传到 IM 端，不能沉默。
- 私聊和群聊使用不同响应语义。
- Bot token、app secret、webhook secret 永远不能进入普通日志。

## P0：绑定与桌面不打断

- [x] 手机来消息时不自动跳转桌面焦点，只更新 sidebar 标记 / unread / active 状态。
- [x] 首次手机消息默认新建并绑定稳定本地 thread，而不是绑定桌面当前焦点。
- [x] `/attach current` 作为显式接管入口。
- [ ] 桌面支持“让手机值守当前会话”的待绑定状态，默认 5 分钟过期。（本轮跳过：需要新增桌面显式接管入口；已先落实 `/attach current` 10 分钟活跃限制）
- [x] `/attach current` 只允许接管 10 分钟内活跃的桌面当前会话；过期时手机端提示失败原因。
- [x] 侧边栏机器人标志区分“已绑定/值守”和“正在运行”。
- [ ] 手机来消息时支持 toast / 系统通知，但不抢桌面焦点。（本轮跳过：避免在未确认通知策略前打扰桌面；已保持不抢焦点）

## P1：跨渠道队列、去重、顺序

- [x] 飞书已有内存级 messageId 去重和按 remote conversation 的队列。
- [x] 抽象 provider-agnostic 的 remote conversation queue，供飞书、微信、Discord 复用。
- [x] 最近 messageId 去重持久化 24 小时，重启后仍避免重复回复。
- [x] 平台提供 timestamp / messageId 顺序时，按平台顺序处理；否则按接收时间处理并保留来源时间。
- [x] 桌面端和 IM 端消息进入同一个 thread-level turn queue。
- [x] 当上一条仍在处理时，手机端立即收到“已排队”的轻量提示。
- [ ] 断线恢复后按顺序处理积压消息。（本轮跳过：需要 provider 离线 backlog API / relay 设计）
- [ ] 短时间连续积压消息支持合并，例如 2 分钟窗口合成一个 prompt。（本轮跳过：先保守逐条串行，避免错误合并用户意图）
- [ ] 积压较多时先发送提示，例如“收到 N 条离线消息，将合并处理”。（本轮跳过：依赖离线 backlog / 合并窗口实现）

## P2：回复格式与附件投递

- [x] 基础 Markdown 文本回复。
- [x] 飞书生成文件 / 已有文件发送路径。
- [x] 建立 Feishu/Lark、WeChat、Discord 的能力矩阵。
- [x] 长文本按平台限制自动分段发送。
- [x] 代码块尽量保持 Markdown。
- [x] 文件生成后优先发送文件或链接。
- [x] 图片、文件、链接在平台不支持时降级为摘要 + “请到桌面查看完整结果”。
- [x] 每个平台配置最大消息长度、附件限制和重试策略。

## P3：审批、交互

- [x] IM 请求沿用项目级 runtime、sandbox、Model Router 配置。
- [x] 远端请求 prompt 包含来源和发送者上下文。
- [ ] Agent 需要简单用户回答时，可以回发到手机，手机回答后继续同一 turn。（本轮跳过：需要跨 IM 的 pending user-input 协议）
- [ ] 审计所有远端运行路径，确保 API 一律走项目级 Model Router。（本轮跳过：已有失败分类与边界测试，本项保留为安全审计任务）

## P4：身份、群聊、噪音控制

- [x] 短期不做跨 provider 身份合并，按 remote conversation 绑定。
- [x] 飞书群聊默认只响应 @bot / @all，私聊默认全响应。
- [x] 每个 channel 支持 guard mode：`only_mention`、`all_messages`、`off`。
- [x] 群聊默认按群 / channel 共享一个本地 thread。
- [x] 预留 `/new private`，未来支持群里创建个人私有 thread。
- [ ] 联系人身份合并只做设计文档，暂不实现。（本轮跳过：产品已确认短期不做跨 provider 身份合并）

## P5：上下文生命周期与命令

- [x] `/new` 可以显式开启新话题。
- [x] `/model` 和 `/model auto|pro|flash` 可查看 / 切换模型。
- [x] `/mode agent|plan`。
- [x] `/summary` 查看当前远端会话摘要。
- [ ] 长期 remote-bound thread 自动 compact。（本轮跳过：需要和 runtime compaction 策略统一）
- [ ] 桌面显示“已压缩上下文”标记。（本轮跳过：依赖 compact 事件/状态落库）
- [x] 如果本地 thread 被删除，绑定标为 broken；手机下次发消息时自动新建并告知。
- [x] `/detach` 解除当前 remote conversation 绑定。
- [x] `/status` 查看当前绑定、队列、模型、workspace、运行状态。

## P6：Discord Bot Bridge

- [x] Repo 中已有 Discord Bot runtime / bridge 基础结构。
- [x] 一个 DeepSeek GUI 安装配置一个 Discord Bot token。
- [x] 支持填写 Client ID / Bot Token。
- [x] 生成 Bot invite URL 和邀请二维码。
- [x] 扫码邀请 Bot 到一个或多个 server。
- [x] 选择 server / channel 并绑定本地 workspace、model、profile。
- [x] 测试发送 / 接收。
- [x] 启用 / 暂停值守。
- [x] 多 server / channel 各自拥有独立 channel 配置。

## P7：桌面 UX 与可追溯

- [x] 侧边栏已有 bot-watched 标志基础。
- [x] 桌面消息气泡显示来源标签：`飞书 · Alice`、`微信 · 某群`、`Discord · #support`、`Desktop`。
- [x] sidebar 显示远端 unread / active badge。
- [x] 只有用户正在看这个 thread 时，时间线才实时滚动到底。
- [x] 桌面 UI 区分 watched、bound、running、queued、error。
- [x] 桌面 thread 顶部可查看当前远端绑定详情。

## P8：隐私、日志、删除

- [x] Bot token、app secret、webhook secret 在所有日志和 trace 中脱敏，并补测试。
- [ ] 设置里支持清除某个 remote binding 的历史。（本轮跳过：需要删除策略和审计视图一起设计）
- [ ] 删除 channel 时，分开询问是否删除本地 thread / 历史。（本轮跳过：需要 destructive UX 确认流）
- [ ] 提供 remote binding 审计视图。（本轮跳过：需要单独审计页面/数据模型）
- [ ] 明确 IM 消息进入本地日志 / 历史的保留策略。（本轮跳过：需要产品/隐私文档决策）

## P9：失败可解释与重试

- [x] 飞书已有基础 unsupported message、schedule error、processing error 提示。
- [x] Codex active turn 的 `readThread` fallback 已修复，避免运行中被误判失败。
- [x] 统一失败分类：runtime offline、model missing、timeout、waiting desktop approval、local thread deleted、provider send failed。
- [x] 可恢复失败有重试策略。
- [x] 手机端能看到 queued / running / failed 状态。
- [x] 桌面端能看到远端来源和失败原因。
- [x] Provider 发送失败时记录并提示，而不是吞掉。

## P10：在线/离线与多设备

- [x] UI 明确标注“本机在线时值守”。
- [x] 云 relay / 离线队列只做未来设计，不作为当前本机 bridge 的默认承诺。
- [x] 生成并持久化 installationId。
- [x] 检测同一个 bot/channel 是否被另一台 DeepSeek GUI 安装值守。
- [x] 冲突时提示“这个 Bot 正被另一台设备值守”，并提供手动接管。

## 验收清单

- [x] 手机睡一晚后继续发消息，仍进入同一个本地 thread。
- [x] 桌面切换焦点不会改变手机绑定目标。
- [x] `/attach current` 在桌面上下文过期时明确失败。
- [x] 手机连续发送 A、B，A 运行中时 B 入队，回复不会慢一拍。
- [x] 桌面在同一 thread 发送消息时，也进入同一个串行队列。
- [x] webhook / WS 重试不会产生重复 user message 或重复 agent reply。
- [x] 重启后短期重复事件仍能去重。
- [x] 运行失败时，手机端能收到明确原因。
- [x] 普通日志里没有 token、secret、敏感配置。

## 已确认产品决策

- 首次手机消息默认新建本地 thread。
- 群聊默认共享群 / channel 的本地 thread。
- 同一个本地 thread 同时只能有一个 active turn。
- 桌面 focus 只是观察状态，不是绑定状态。
- `/attach current` 和桌面“值守当前会话”是显式切换入口。
- 短期不合并跨 provider 身份。
- 每个 IM channel 可以独立配置 workspace、model、agent profile。
- 手机端请求权限与桌面端一致，继承项目 runtime / sandbox / Model Router。
- 手机端不自动唤醒或打断桌面当前工作。
