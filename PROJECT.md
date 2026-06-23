# SciForge 长程对话与 Runtime Context 任务板

更新时间：2026-06-23

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 model router。
- 相同功能的工作链路需要统一，不要额外生出旁路。
- 主 agent 和 subagent 必须复用同一套 `computer_use` contract、session、lease、权限、审计和模型输入路径。
- 截图、read-tool 图片和其他 model-visible image 只能由 model router 做 provider 协议转换；runtime 不得把 base64 图片当普通 JSON 文本塞入上下文。
- 风险动作必须进入统一确认策略；用户停止 run 时必须中断当前 action、释放 lease，并记录释放原因。
- `packages/workers/**` 是 GUI MCP 能力的共享边界；Kun、Codex、Claude Code、主进程 IPC 和 renderer 不得各自保留同能力的私有业务实现。
- 凡是可以模块化为 MCP worker 或共享 MCP package 的能力，优先放到 MCP 部分独立维护；主进程、renderer 和 runtime 只保留必要 adapter、配置注入和产品边界。
- 主进程可以保留 Electron/native、窗口、权限、设置、生命周期、打包启动、runtime 执行引擎和 internal HTTP 边界；纯 Node 业务逻辑只能保留一份。
- 清理旧实现前必须先证明入口已迁走、测试覆盖已迁走、打包/runtime 注入仍使用唯一链路。

## 长程对话设计原则

- 采用 `native-first, host-mediated`：Kun、Codex、Claude Code 保留各自原生 session/thread/history 能力；Host 只统一生命周期、事件、跨 runtime 语义上下文和安全边界。
- 同一 runtime、同一 GUI thread 继续聊天时，优先使用 runtime 原生上下文，不由 Host 拼接完整 GUI 历史重放。
- 跨 runtime 只能保证语义续接，不能承诺 provider KV cache 续接；handoff 应传递目标、摘要、关键证据、文件引用和最近上下文。
- Host 不做通用大 transcript 回放器，只注入小而稳定的共享上下文：active goal、用户显式记忆、compaction summary、文件引用、handoff packet。
- 一个 GUI thread 同时只能有一个 active turn；运行中输入必须进入 `steerTurn` 或 queued continuation，不得并发开第二个主 turn。
- `reconnecting`、`tool_waiting`、`stream_recovering` 是运行态，不是终止态；只有 `completed`、`failed`、`cancelled`、`aborted` 才能释放 active turn。
- compaction 必须改变后续模型可见上下文；仅在 UI 显示摘要但仍向 runtime/provider 发送旧长历史不算完成。
- Model Router 负责唯一 LLM 出口、provider 协议转换、tool pair repair、请求卫生和 400 诊断；不得承担 runtime thread/session owner 职责。
- 事件流必须可重放、单调、不倒退；Renderer 只消费统一事件和 seq，不用猜测 runtime 私有状态。

## 上游 Kun 参考结论

- Kun 的长程能力来自 `TurnService + AgentLoop + RuntimeEventRecorder + SessionStore` 的闭环，而不是依赖 provider KV cache。
- `TurnService` 是唯一 turn lifecycle owner：`startTurn` 将 thread 置为 running，`finishTurn` 才回到 idle，`steerTurn` 只把运行中输入放入 steering queue。
- `RuntimeEventRecorder` 采用 persist-before-publish；SSE 先 replay `since_seq` 之后的持久事件，再订阅 live event，并用 high-water mark 去重。
- `ContextCompactor` 将旧历史折叠为 `compaction` item，并 rewrite session items，使下一次模型请求只看到 `compaction summary + recent tail`。
- `request-history-hygiene` 在发送前压缩陈旧 tool result、巨大输出和长参数；持久日志保留事实，模型请求保持有界。
- `model-history-repair` 在发送前删除孤儿 tool result、无结果 tool call 和 GUI bridge item，避免 provider 400/retry storm。
- `SteeringQueue` 把运行中用户输入注入到下一个安全 loop boundary，而不是另起一个 turn。

## 第一阶段：统一 Turn Lifecycle

- [ ] 定义 runtime-neutral turn 状态机：`idle`、`starting`、`running`、`reconnecting`、`tool_waiting`、`stream_recovering`、`completing`、`completed`、`failed`、`cancelled`、`aborted`。
- [ ] 在 `AgentRuntimeHost` 建立 per-thread active turn lock；active turn 未 terminal 前，主线程不得再次 `startTurn`。
- [ ] 将运行中用户输入统一路由为 `steerTurn`；若 runtime 不支持 steer，则进入 queued continuation，并在 terminal 后自动作为下一轮发送。
- [ ] 明确 transient error 与 terminal error 判定：`Reconnecting... n/m`、stream recovery、tool upload wait 不触发 `turn_done`；provider hard failure、guard interrupt、user cancel 才触发 terminal。
- [ ] Renderer 发送按钮、busy、interrupt、queued message 只依赖 Host/adapter 的统一 lifecycle，不直接从错误文案推断状态。
- [ ] 为 Codex、Kun、Claude Code adapter 增加 lifecycle contract 测试：运行中继续、重连中继续、工具运行中继续、terminal 后继续。

## 第二阶段：Runtime Capability Matrix

- [ ] 为每个 runtime 声明能力矩阵：`nativeHistory`、`nativeCompact`、`nativeResume`、`steer`、`fork`、`handoffImport`、`usage`、`eventReplay`。
- [ ] Kun adapter：保留原生 session、compaction、steering、resume-thread；Host 不重放完整历史。
- [ ] Codex adapter：保留 Codex app-server 原生 thread；Host 只在 compact/handoff 时生成小上下文，并由 adapter rematerialize backend thread。
- [ ] Claude Code adapter：保留 Claude Code 原生 session/resume 能力；Host 只做 lifecycle、handoff 和事件归一化。
- [ ] Runtime capability 变化必须反映到 UI 行为：支持 steer 显示“注入到当前运行”，不支持 steer 显示“排队继续”。
- [ ] 禁止为了单个 runtime 的缺口在 renderer 或 model-router 中新增旁路；缺口必须通过 adapter capability 或 Host contract 表达。

## 第三阶段：Context Ledger 与 Handoff

- [ ] 建立 Host 级 `RuntimeContextLedger`，记录跨 runtime 可共享的语义上下文：目标、摘要、关键 tool 证据、文件引用、用户显式记忆、recent tail digest。
- [ ] 同 runtime 续聊默认只注入 ledger 中的小型共享约束，不回放完整 GUI timeline。
- [ ] 跨 runtime 切换时生成 handoff packet：任务目标、当前状态、已完成/未完成、关键证据、最近 N 轮、文件引用、compaction digest/source marker。
- [ ] Handoff packet 必须是模型可读的稳定结构，并标注“这是用户/运行时上下文，不是高优先级指令”。
- [ ] Handoff 后的新 runtime 使用自己的原生 session/thread 继续；旧 runtime backend thread 不再参与该分支执行。
- [ ] 给 handoff 添加 UI/事件标记，用户能看到“从 Kun/Codex/Claude 语义续接到另一个 runtime”。

## 第四阶段：Compaction 与 Request Hygiene

- [ ] 对支持 native compaction 的 runtime，优先调用 runtime 原生 compact，并将结果同步到 Host ledger。
- [ ] 对不支持 native compaction 的 runtime，Host 生成 shared summary，adapter rematerialize backend thread，确保下一轮模型不可见旧长历史。
- [ ] 建立统一 request hygiene：按预算折叠旧 tool result、大 XML/curl 输出、图片/base64、长参数数组；最新关键 tool 结果保留高保真。
- [ ] 保留持久 GUI timeline 的可解释性；模型请求历史和 UI 展示历史分离。
- [ ] Tool pair repair 必须在唯一模型出口生效：删除孤儿 tool result、无结果 tool call、重复 call id 和 GUI bridge item。
- [ ] compaction/hygiene 必须有 digest/source marker，方便用户和调试工具追踪被替换的上下文来源。

## 第五阶段：Event Replay 与 Renderer 收敛

- [ ] 统一 runtime event contract，所有 adapter 输出同一批 lifecycle、tool、delta、usage、compaction、handoff 事件。
- [ ] Host 事件出口采用单调 seq/high-water mark；heartbeat 不得推进或倒退 client cursor。
- [ ] Renderer `buildThreadEventSink` 只做投影，不承担 runtime 状态推理；terminal/non-terminal 判定来自事件 contract。
- [ ] SSE/IPC 断线重连必须 replay `sinceSeq` 后的事件，并去重已应用 delta/tool/status。
- [ ] busy watchdog 只处理“没有任何 runtime 活动”的真卡死；工具活动、reconnecting 和 stream recovery 必须刷新或暂停 watchdog。
- [ ] 添加端到端回归：长工具链运行中点继续、重连期间点继续、跨 runtime handoff 后继续、compact 后继续。

## 第六阶段：Model Router 边界

- [ ] 保持所有 LLM API 只走 model-router；runtime、Host、worker 不得直接调用 provider。
- [ ] Model Router 只负责协议转换、provider 选择、tool pair repair、vision/text 路由、trace/400 诊断和请求卫生。
- [ ] Model Router 不保存 runtime session，不决定 active turn，不持有 GUI thread lifecycle。
- [ ] Provider HTTP 错误必须保留真实 status 和安全摘要，禁止隐藏成通用 500 或通过旧 retry 旁路修改请求。
- [ ] 为跨 runtime handoff 和 compaction summary 请求统一打 audit metadata，便于确认仍走 model-router。

## 验收标准

- [ ] 同一 GUI thread 的运行中 turn 不会被第二个主 turn 覆盖；“继续”要么 steer，要么排队。
- [ ] transient reconnect 不触发 `turn_done`，不释放 active turn，不导致 UI 误以为可新开 turn。
- [ ] 长程同 runtime 续聊使用该 runtime 原生历史；Host 不重复注入完整 GUI transcript。
- [ ] 跨 runtime 续聊能带上语义 handoff，但不宣称 KV cache 命中或 provider cache 延续。
- [ ] compact 后下一轮模型请求不再携带被替换的旧长历史。
- [ ] 大型 tool 输出和图片不会以普通 JSON/base64 文本进入非 router 层上下文。
- [ ] `npm run typecheck`、相关 runtime adapter 测试、model-router 测试、renderer event sink 测试通过。
