# DeepSeek GUI IM 稳定性补丁审计任务板

更新时间：2026-06-13

## 核心目标

引入 Kun 中 DeepSeek-GUI 尚未修复的 IM / 手机值守 bug fix。只补缺失问题，不覆盖当前 DeepSeek-GUI 已有二开设计。

当前 `PROJECT.md` 仍是 IM 主任务板；本文件只记录从 Kun 回合里需要审计和补齐的增量修复。

## 上游参考目录

Kun 上游仓库在本机：

`/Applications/workspace/ailab/research/app/Kun`

实现时优先阅读并移植 Kun 中对应的现成代码，不从头造车；但必须按 DeepSeek-GUI 当前架构、命名、配置、产品原则做必要适配。不得整仓 merge、不得引入本任务“不引入范围”里的 Kun 品牌化或旁路能力。

## 必须遵守的原则约束

1. 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
2. 所有修改必须通用，不能为特例写硬编码补丁。
3. 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
4. 对话、工作链路需要统一，不要额外生出旁路。

## 审计方法

每个 Kun 修复点必须先做等价性审计：

- [ ] DeepSeek-GUI 已经等价修复：记录结论，跳过代码修改。
- [ ] DeepSeek-GUI 部分修复：只补缺失路径。
- [ ] DeepSeek-GUI 未修复：按最小通用补丁引入。

不得为了“同步 Kun”而覆盖 DeepSeek-GUI 现有 IM 设计。

## 候选引入范围

- [ ] 长 agent turn 期间，WeChat/Feishu/Discord channel 仍能响应状态与排队提示。
- [ ] auto / IM agent approval handling 修复，远端请求不能卡在不可见审批状态。
- [ ] busy watchdog exhaustion 后，message queue 能 unstick。
- [ ] IM runtime routing 与 desktop runtime routing 保持统一，不额外生成旁路。
- [ ] 生成文件、图片、附件投递失败时返回可解释消息。
- [ ] 微信/飞书 SDK 媒体类型或声明缺口，只在当前代码确实缺失时补齐。

## 不引入范围

- [ ] 不引入 Kun UI / iKun / branding。
- [ ] 不重写 IM channel 配置页。
- [ ] 不改变 `PROJECT.md` 已确认的绑定原则。
- [ ] 不引入云 relay / 离线队列。
- [ ] 不引入新的 provider 设置结构。

## 并行边界

本任务必须和 `PROJECT_RUNTIME_FOUNDATION.md`、`PROJECT_AGENT_TOOL_SAFETY.md` 协调：如果 bug 根因在 runtime/agent loop，优先让对应任务修核心逻辑，IM 任务只接入结果。

优先修改范围：

- `src/main/claw-runtime.ts`
- `src/main/claw-runtime-helpers.ts`
- `src/main/weixin-bridge-runtime.ts`
- `src/main/runtime/*adapter*`
- `src/renderer/src/components/chat/ConnectPhoneView.tsx`
- IM 相关 tests

不要修改：

- 通用 agent loop，除非和 `PROJECT_AGENT_TOOL_SAFETY.md` 合并执行。
- runtime process supervisor。
- model/provider settings。

## 参考来源

- Kun commits: `Fix approval handling for auto and IM agents`
- Kun commits: `fix: keep WeChat channel responsive during long agent turns`
- Kun commits: `fix: unstick message queue after busy watchdog exhaustion`
- Kun `src/main/claw-runtime.ts`
- Kun `src/main/weixin-bridge-runtime.ts`

## 验收清单

- [ ] DeepSeek-GUI 已修过的 IM bug 不被重复改坏。
- [ ] 手机端长回合期间能收到 queued / running / failed 反馈。
- [ ] IM 请求审批语义与桌面项目级 runtime/sandbox/Model Router 一致。
- [ ] provider 发送失败时有日志和远端提示。
- [ ] 桌面焦点和 remote binding 规则仍完全符合 `PROJECT.md`。
