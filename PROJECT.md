# SciForge Agent Computer Use 任务板

更新时间：2026-06-23

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走 model router。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。


## 新任务：多 Agent Computer Use

目标：让主 agent 和所有 subagent 都能使用统一的 `computer_use` 能力。图像模态、截图理解和模型协议转换一律走 model router；runtime 只负责采集截图、执行桌面动作、维护 agent 级 session/target/lease，并保证不同 agent 的操作不会互相干扰。

### 范围边界

- [x] 不做虚拟桌面、VM、VNC、Xvfb 或浏览器隔离方案。
- [x] Phase 1 先实现真实宿主桌面的全局后端，通过 lease/lock 串行化动作，保证 main agent 和 subagent 都能安全使用。
- [x] Phase 2A 实现 macOS app/window-scoped experimental backend：通过 System Events 枚举/激活真实 app/window target，再在全局锁保护下委托真实宿主桌面 backend 执行动作。
- [x] 同一个 app/window 已被 agent 申请时，其他 agent 再申请必须被拒绝，并返回明确拒绝理由；不排队、不抢占。
- [x] 不允许为 main agent 和 subagent 分别实现旁路工具，所有 agent 复用同一套 computer-use contract、权限、审计和模型输入路径。

### 独立扩展包与 Runtime 接入

- [x] `computer_use` 作为 `packages/workers/computer-use` 下的独立 worker extension package 实现，不放进某个 runtime 的私有目录。
- [x] extension package 以 stdio MCP server 作为统一入口，runtime 只注入 server launch config，不复制 backend、lease 或动作执行逻辑。
- [x] GUI-managed Kun、Codex runtime 和 Claude Code runtime 都注入同一个 `gui_computer_use` MCP server。
- [x] 打包配置必须包含 worker package、MCP node entry 和 native host-control 依赖，避免生产包启动时找不到 computer-use server。
- [x] 新增其他 runtime 时只能接入同一个 MCP server，不允许新增 runtime 专属 computer-use 工具链路。

### Computer Use Contract

- [x] 定义统一 `computer_use` 工具协议，支持 `list_targets`、`bind_target`、`release_target`、`screenshot`、`cursor_position`、`mouse_move`、`click`、`drag`、`scroll`、`type`、`key`、`wait`。
- [x] 为每个 agent 分配独立 `computerUseSessionId`，并记录 `agentId`、`threadId`、`turnId`、`targetId`、`backend`、`leaseState` 和软件光标状态。
- [x] `bind_target` 必须返回 target metadata、lease 信息和拒绝原因；拒绝原因需要可展示、可进入 tool result、可用于模型自我纠正。
- [x] `screenshot` 输出统一为 model-visible image tool result，不把 base64 当普通 JSON 文本塞入上下文。
- [x] 工具结果中的图片、文本摘要、屏幕尺寸、坐标空间说明必须结构化，便于 model router 转成对应 provider 协议。

### Agent 与 Subagent 权限

- [x] 主 agent 默认可使用 `computer_use`。
- [x] subagent 默认也可使用 `computer_use`，但必须拥有自己的 session、target lease 和审计记录。
- [x] subagent 不继承父 agent 的 target lease；如需操作同一 app/window，必须显式申请并因冲突被拒绝。
- [x] 所有 agent 的 computer-use 调用都进入统一权限策略、确认策略和 action budget。
- [x] 支持按 runtime 设置关闭全部 computer use，或只关闭 experimental app/window-scoped backend。

### Backend 设计

- [x] 抽象 `ComputerUseBackend` 接口，隐藏真实执行差异，统一暴露 target discovery、lease、screenshot、pointer、keyboard、wait 和 diagnostics。
- [x] 实现 `global-native` backend：复用上游 Kun 的 host-control 思路，使用真实桌面截图和鼠标键盘控制；同一时间只允许一个 active action。
- [x] `global-native` backend 对不同 target lease 仍保持全局 action lock，避免真实 OS 鼠标、键盘、前台焦点互相抢夺。
- [x] 实现 `mac-app-scoped` backend 的实验接口：按 app/window target 维护 session 和软件光标，能发现/激活真实 macOS app/window；底层能力不足时降级为拒绝或全局锁保护。
- [x] backend diagnostics 必须能说明当前平台、权限、后端可用性、active lease、拒绝原因和最近错误。

### Model Router 与图像模态

- [x] Kun runtime 的 Model Router Responses 路径不再把 tool result 图片拆成 provider 私有 `image_url`/`input_image` 旁路，只产出标准 `function_call_output.output` image tool result。
- [x] model router 负责把截图、read-tool 图片和其他 model-visible image 转为 OpenAI Responses、Chat Completions、Anthropic Messages 等上游协议。
- [x] model router 能直接解析标准 `computer_screenshot` / MCP image content tool result，并把图片作为内部 vision modality 路由。
- [x] 对不支持图像输入的模型，model router 必须降级为文本摘要，并明确说明图片未发送。
- [x] 历史压缩、token economy 和 request hygiene 必须按视觉 token 预算处理截图，不能按 base64 文本长度估算。
- [x] 只保留最近有限数量的截图图片载荷，旧截图降级为文本占位，避免长时间 desktop task 撑爆上下文。

### macOS 权限与 UI

- [x] 接入 macOS Accessibility 和 Screen Recording 权限检测。
- [x] 区分“未授权”和“系统设置已授权但当前进程需重启生效”。
- [x] 设置页展示 computer-use 开关、backend 状态、权限状态、active leases 和最近拒绝原因。
- [x] 开启 computer use 时，提示它会操控真实电脑，并说明 main/subagent 都可能使用该能力。
- [x] macOS 上处理 native automation 触发 AppKit/Dock 图标的问题，避免运行时多出无用 Dock 图标。

### 安全与确认

- [x] 复用统一确认策略：删除、上传、发消息、提交表单、改系统设置、交易、敏感数据传输等风险动作必须在动作前确认。
- [x] computer-use action budget 按 agent session 和 turn 双维度限制，防止 runaway。
- [x] 用户停止 run 时，必须中断当前 action、释放 lease，并记录释放原因。
- [x] tool result 中不得泄漏不必要的敏感截图 base64；持久日志只保存必要摘要和可配置数量的截图引用。
- [x] 拒绝第三方内容诱导的权限扩大、系统设置修改或敏感数据传输。

### 测试与验收

- [x] 覆盖 target lease：不同 agent 申请同一 app/window 必须拒绝并返回原因。
- [x] 覆盖 main agent 和 subagent 都能看到并调用 `computer_use`，且走同一工具协议。
- [x] 覆盖 `global-native` backend 的全局 action lock，确保并发 action 不交错执行。
- [x] 覆盖截图 image tool result 进入 model router 的路径，不把 base64 作为普通文本发送。
- [x] 覆盖不支持图像模型的降级行为。
- [x] 覆盖 macOS 权限状态、重启提示和设置页展示。
- [x] 用两个并发 agent 验证：不同 target 不互相污染 session 状态；相同 target 明确拒绝。
- [x] 用真实 macOS 桌面验证：`SCIFORGE_COMPUTER_USE_REAL_MAC=1 npm run computer-use:smoke:mac` 已覆盖 TextEdit window target 的截图、点击、输入、滚动、停止 run、重新绑定和释放 lease 完整闭环。
