# DeepSeek GUI Runtime 架构治理任务板

更新时间：2026-06-15

## 不可变规则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走model router
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。

## 当前目标

把已发现的 Codex 工具循环问题收敛成通用 runtime 架构治理任务：明确多个 runtime 的公共层、适配层和 runtime 原生层边界，让 Kun、Codex 以及后续 runtime 能共享通用稳定性治理，同时保留各自原生能力。

目标链路：

```text
UI / Write / Claw / Schedule
  -> AgentRuntimeHost
    -> Runtime Governance
      -> Runtime Adapter
        -> Native Runtime
```

## 设计任务

- [x] 更新 `docs/runtime-governance-design.zh-CN.md`，明确多 runtime 架构、公共层职责和特用层边界。
- [x] 定义 runtime capability：声明 native guard、steer、interrupt、approval、user input、event replay 等能力，避免双重治理。
- [x] 定义工具循环的通用 fingerprint 和预算模型，不绑定具体命令或具体平台。
- [x] 定义公共 synthetic event 规范：所有补充事件必须先持久化，再发布给 UI。
- [x] 定义配置迁移策略：把 `kunToolStorm` 类设置提升为 runtime guard 设置，同时兼容读取旧字段。

## P0：Debug 与现状盘点

- [ ] 复盘 Codex app-server 工具循环事件，确认重复工具调用来自 runtime 后端执行链路，而不是 UI 展示重复。
- [ ] 梳理 UI 对话、写作助手、Claw、Discord、Feishu、Schedule 入口现在分别如何调用 runtime。
- [ ] 对照稳定版 Kun 的 AgentLoop、ToolStormBreaker、runtime event recorder，识别可沉到公共层的治理能力。
- [ ] 找出现有 Codex/Kun 分叉逻辑、Kun-only 设置文案和入口层直连旁路，区分必须保留的 runtime 特性与可以统一的重复逻辑。
- [ ] 记录 Codex 原生能力边界：sandbox、approval、file change、thread、session、JSON-RPC 生命周期，后续公共层不得改写这些协议。

## P1：入口层统一

- [ ] 确认 UI 对话、写作助手、Claw、Schedule 都只构造统一 `AgentRuntime*Input`，不直接调用 Kun HTTP、Codex JSON-RPC 或 LLM API。
- [ ] 把 Claw/Discord/Feishu 值守入口的 runtime 调用统一收束到 `AgentRuntimeHost`，仅保留入口场景参数，例如更严格预算。
- [ ] 清理入口层对具体 runtime 的策略判断；必须分支时改为读取 capability。
- [ ] 明确 hidden prompt 与 `displayText` 的入口约定：隐藏上下文只进入 runtime payload，timeline 只展示用户原始文本。

## P2：公共治理层

- [ ] 在 `AgentRuntimeHost` 附近新增 runtime-neutral governance 层，所有 startTurn、subscribeEvents、steer、interrupt 都经过该层编排。
- [ ] 把 turn 排队、超时、预算、状态收束整理为公共能力，避免入口或 adapter 重复实现。
- [ ] 定义 runtime guard supervisor：消费归一化后的 `AgentRuntimeEvent`，处理工具循环、重复状态和异常收尾。
- [ ] 实现公共 synthetic event 生成规范：补充事件必须先写入对应 runtime 的事件存储，再发布给 UI。
- [ ] 公共层只做编排和治理，不改写 runtime 原生协议、不假设具体工具存在、不绕过 model router。

## P3：Capability 合同

- [ ] 扩展 `AgentRuntimeCapabilities`，声明 `guard.toolStorm = native | observe | unsupported`。
- [ ] 扩展或规范已有 controls/events 字段：steer、interrupt、approval、user input、compact、event replay、sequenced event。
- [ ] 公共治理层根据 capability 决定使用 native guard、observe guard、steer 或 interrupt，避免双重保护。
- [ ] Kun adapter 声明已有 native pre-exec tool storm 能力。
- [ ] Codex adapter 声明 observe tool storm 能力，并保留原生 steer、interrupt、approval、user input 能力。

## P4：工具循环治理

- [ ] 实现 runtime-neutral 工具事件 fingerprint：exact tool name + canonical args、tool kind、行为族、连续次数、总次数。
- [ ] 行为族识别必须通用，例如 shell/date、shell/read-file、search/read，不为具体用户话术或单个命令写硬编码补丁。
- [ ] 软阈值命中时优先 `steerTurn`：要求 runtime 停止同族工具，基于已有结果回答。
- [ ] 硬阈值命中时再 `interruptTurn`：终止本轮并生成保护说明。
- [ ] Kun native guard 在执行前生效，公共层只消费其结果事件；Codex observe guard 在事件后生效，先 steer 后 interrupt。

## P5：配置与迁移

- [ ] 新增通用配置命名：`runtimeGuards.toolStorm.*` 和 `runtimeGuards.budgets.*`。
- [ ] 兼容读取旧 `kunToolStorm` 或 `runtime.toolStorm` 字段，但写回新字段。
- [ ] 设置页文案从 Kun-only 命名迁移为 Runtime Guard。
- [ ] 为普通 UI、写作、Claw/Discord/Feishu 值守入口提供不同默认预算，但走同一个配置模型。
- [ ] 删除稳定后不再使用的 Kun-only 设置旁路和重复 runtime tuning 逻辑。

## P6：Adapter 与 Runtime 原生层

- [ ] Kun adapter 保留 AgentLoop、pre-exec tool host、ToolStormBreaker、request history hygiene 等原生能力。
- [ ] Codex adapter 保留 app-server 原生 sandbox、approval、file change、thread、session、JSON-RPC 生命周期。
- [ ] Adapter 只负责协议转换、事件归一化、能力声明和错误封装，不承载业务治理策略。
- [ ] 新 runtime 接入时只需实现 `AgentRuntimeAdapter`、声明 capability、接入事件归一化和 replay。
- [ ] 删除 adapter 外部对 Kun/Codex 私有协议的直接依赖。

## P7：冗余链路清理

- [ ] 删除入口层或 UI 层重复的 runtime 分支策略，只保留 capability 驱动的唯一逻辑。
- [ ] 删除与公共治理层重复的 turn queue、timeout、tool storm、状态收束实现。
- [ ] 删除 Kun-only 文案、设置名和测试断言中的过时命名。
- [ ] 确保所有 LLM 相关请求仍只通过 model router 或 agent runtime。

## 回归测试

- [ ] 公共层单测覆盖 turn 排队、预算、状态收束、synthetic event 持久化顺序。
- [ ] 公共层单测覆盖工具事件 fingerprint、软阈值 steer、硬阈值 interrupt。
- [ ] Kun 回归测试确认已有 ToolStormBreaker 不被公共层重复 suppress。
- [ ] Codex 回归测试用重复同族命令事件验证不会无限执行工具。
- [ ] Claw/Discord/Feishu 端到端测试覆盖值守入口的工具循环保护和更严格预算。
- [ ] 设置迁移测试覆盖旧字段读取、新字段写回、UI 文案不再依赖 Kun-only 命名。
- [ ] typecheck 和相关单测通过。

## 验收标准

- 多 runtime 调用链路统一经过 `AgentRuntimeHost` 附近的公共治理层。
- UI、写作、Claw、Schedule 等入口不再直接依赖具体 runtime 协议。
- 公共层只处理协议无关的治理策略，不改写 Codex 或 Kun 原生协议。
- 工具循环保护是通用能力，不依赖具体命令、模型、平台或用户话术。
- Kun 后续稳定性治理能通过共享层惠及 Codex；Codex 原生 approval、sandbox、file change、thread 语义不被破坏。
- 新 runtime 只要实现 adapter 合同并声明 capability，就能接入公共治理层。
- 冗余旁路被删除后，同一功能只有一条最终逻辑。
