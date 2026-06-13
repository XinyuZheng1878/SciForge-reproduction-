# DeepSeek GUI Runtime 基础稳定性任务板

更新时间：2026-06-13

## 核心目标

从 Kun 更新中引入 runtime 基础稳定性修复，但保持 DeepSeek-GUI 现有产品形态、配置结构和工作链路不变。

本任务聚焦桌面管理的本地 runtime：启动、健康检查、重启、SSE 传输、事件保留、线程存储性能。

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

- [ ] runtime 启动 ready 判定增加 `/health` 探测兜底，避免 stdout ready marker 延迟导致误判。
- [ ] 启动 ready deadline / timeout 文案更明确，保留 stderr tail 便于诊断。
- [ ] 桌面侧 watchdog：runtime 长时间不健康时自动重启。
- [ ] crash restart budget：短窗口内多次崩溃后 circuit-break，不无限重启。
- [ ] runtime 状态事件统一：starting / running / restarting / crashed / failed / stopped。
- [ ] SSE IPC 批量发送，减少流式输出高频 IPC 压力。
- [ ] event bus 每个 thread 只保留有限近期事件，避免长会话内存持续增长。
- [ ] thread/session store I/O 性能优化，只合入不改变数据语义的部分。

## 不引入范围

- [ ] 不引入 Kun 品牌化、数据目录迁移、资源替换。
- [ ] 不引入 Kun settings 页面重构。
- [ ] 不引入 hooks 扩展机制。
- [ ] 不改变 DeepSeek-GUI 现有 Model Router / provider 配置。
- [ ] 不改变用户发起 turn 的主路径。

## 并行边界

建议单独 worker 负责本任务，避免和 `PROJECT_AGENT_TOOL_SAFETY.md` 同时改同一 runtime loop 文件。

优先修改范围：

- `src/main/kun-process.ts`
- `src/main/kun-runtime-supervisor.ts`（如当前没有，可按 DeepSeek-GUI 命名创建等价 supervisor）
- `src/main/index.ts`
- `src/main/runtime-sse-ipc.ts`
- `kun/src/adapters/in-memory-event-bus.ts`
- `kun/src/adapters/hybrid/*store.ts`
- 对应测试文件

不要修改：

- IM channel 业务逻辑，留给 `PROJECT_IM_STABILITY.md`。
- agent loop / tool policy，留给 `PROJECT_AGENT_TOOL_SAFETY.md`。
- renderer 视觉与设置页。

## 参考来源

- Kun `src/main/kun-process.ts`
- Kun `src/main/kun-runtime-supervisor.ts`
- Kun `src/main/runtime-sse-ipc.ts`
- Kun `kun/src/adapters/in-memory-event-bus.ts`
- Kun `kun/src/adapters/hybrid/hybrid-thread-store.ts`

## 验收清单

- [ ] runtime 已经监听但 stdout ready marker 延迟时，桌面能通过 `/health` 判定成功。
- [ ] runtime 连续崩溃不会无限重启，最终进入可解释 failed/crashed 状态。
- [ ] runtime 恢复健康后 restart budget 能重置。
- [ ] 长时间流式输出不会造成明显 IPC backlog。
- [ ] 长会话事件量增长不会导致 event bus 无限占用内存。
- [ ] 现有聊天、计划、写作、IM 发起 turn 的路径不变。
