# SciForge 精简与风险清理任务板

更新时间：2026-06-26

## 当前目标

从第一次提交开始审查项目历史，删除与最终目标冲突的旧逻辑、冗余旁路和过度工程，修复通用风险点，并保持同类功能只有一条统一工作链路。

本轮继续使用多个 sub agent 并行审查和实现。已确认能安全收敛的点直接落地；涉及较大架构取舍的更简洁方案记录在“需决策候选方案”，后续再决定是否实施。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 model router。
- 相同功能的工作链路需要统一，不要额外生出旁路;删除冗余,代码尽可能精简
- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- 用户可见文案和公开 API 不暴露 Kun 影子；默认本地 runtime 对外称 SciForge Runtime / local runtime。

---

## 本轮多 agent 清理

- [x] 删除已无真实调用的 `RuntimeHost` legacy request/SSE 兼容层和对应测试，事件链路统一到 `AgentRuntimeHost` / adapter。
- [x] 收紧 Research Memory `prepare_pr.files`，在 schema 层拒绝绝对路径和 `..` 逃逸路径，避免把任意路径交给 `git add`。
- [x] Research Memory PR staging 改为 `git --literal-pathspecs add`，避免 Git pathspec magic / glob 被解释成非字面路径。
- [x] 更新 runtime 文档，明确禁止恢复 `runtimeRequest` / `startSse` renderer 旁路，并修正已重命名的 local-runtime 源码路径。
- [x] 删除 tracked `.kunsdd` 旧计划/草稿状态，并加入 `.gitignore`，只保留 `.sciforge/plan` 作为当前计划路径。
- [x] 清理 Local Runtime 公开文档中的 direct-provider 配置残留，只保留 Model Router / local runtime 配置链路。
- [x] 删除 renderer 缺失 runtime id 时默认路由到 SciForge 的 fallback，线程绑定操作必须 fail closed 或带明确 runtime id。
- [x] 删除 `request_user_input` 不支持时转成排队用户消息加 interrupt 的兼容旁路，统一走中性 runtime user-input 响应链路。
- [x] 收敛 Plan contract/helper 重复实现，避免 renderer/runtime/create-plan-tool 三处各自清洗路径。
- [x] 简化 `runtimeGuards.toolStorm` 暴露面，只保留 runtime 实际支持的 `enabled` / `windowSize` / `threshold` 契约。
- [x] 清理 DESIGN/架构文档中的 Kun 内部命名泄露和旧默认 runtime 表述。
- [x] 审查并删除 Write inline completion 直接 provider 字段，移除已被 Model Router 统一链路取代的 API key/base URL/model override 暴露。
- [x] 收敛 Connect phone/Claw 线程映射，停止把 `threadId` / `localThreadId` 当作第二套 canonical runtime mapping 写入。
- [x] 修复 computer-use browser CDP 导航 URL scheme allowlist，默认只允许 `http:` / `https:`，本地文件另行显式授权。
- [x] 修复 runtime-inspector `git diff -- <path>` pathspec magic 风险，统一使用 literal pathspec 或更严格路径校验。
- [x] 修复 `local-runtime-process` 测试对固定 `8899` 端口空闲的假设，健康探测用例改为动态端口。
- [x] 修复 dev browser bridge `/events` 未鉴权与 mutating route allowlist 过宽问题，默认只开放只读/状态/订阅入口。
- [x] 清理 release workflow、issue templates、公开 release notes/artifact 命名里的 DeepSeek-GUI / 旧 runtime 影子。
- [x] 收敛 `deepseek-file:` 历史自定义协议，生成 `sciforge-file:` 并仅保留 legacy parse。
- [x] 收紧 Write Markdown Preview 链接 allowlist，删除任意 scheme 通配，避免把非网页链接交给 `openExternal`。
- [x] 清理 runtime 缺 key 文案里的 DeepSeek API Key 旧提示，统一为 Model Router runtime key。
- [x] 审查 Paper Radar / workflow / schedule / dev-browser 等本地 HTTP bridge 的鉴权、body limit 与 mutating route 默认关闭策略。
- [x] 修复 Paper Radar HTTP service 无鉴权、无 body cap、写路由默认开放问题，强制 `PAPER_RADAR_RUNTIME_TOKEN` 并默认 fail closed。
- [x] 清理 README、docs、release 和 locale 中用户可见的旧品牌 / OpenClaw / 直连 provider 文案，保留真实 provider、模型 ID 和底层协议边界。
- [x] 清理 WeChat 安装流程中的旧 OpenClaw 用户可见文案，并统一已有连接分支的 account id 传递。
- [x] 修复 schedule/workflow internal HTTP 默认空 secret 可绕过 MCP confirmation 的问题，生成并持久化非空 internal secret。
- [x] 为 Model Router、SciForge Runtime、Weixin bridge、vision/sci-modality translator 等本地 HTTP body 读取增加 size cap。
- [x] 修复 Model Router trace 写入落到 workspace symlink 的风险：relative `traceRoot` 统一解析到独立 trace data root，workspace 内 trace root 直接拒绝，最终 trace JSON no-follow 写入。
- [x] 修复 Evidence DAG 本地 HTTP 服务缺鉴权与无 body cap：服务端强制非空 Bearer token，JSON body 同时限制 `Content-Length` 与 chunked 读取，GUI feed 缺 token 时 no-op。
- [x] 清理 README/cache 优化文档中 `runtimeRequest` / `startSse` 兼容 shim 旧描述，统一为 `AgentRuntimeProvider` / `agentRuntime:*` 边界。
- [x] 统一 renderer 外链打开链路，抽取安全 helper 并删除各组件直接调用 `openExternal` / `window.open` 的重复旁路。
- [x] 清理公开 README/release/governance 中剩余用户可见 `kun` / Claw 命名，并把连接手机示意图资产改为中性命名。
- [x] 将主进程 window-open 与 renderer 外链判断统一到共享 external URL policy，默认只允许安全外部协议。
- [x] 为 vision-router 与 sci-modality-router 增加 runtime Bearer token，provider 侧强制 API key 与 body cap，Model Router 调用 sci-modality 时必须带服务 token。
- [x] 修复 Model Router workspace 文件物化 symlink 逃逸风险，真实路径必须留在 workspace 内才允许交给 provider。
- [x] 收敛 Codex app-server approval alias 判定表，避免 server-request/event-normalizer 两套重复方法识别。
- [x] 收敛 Codex app-server server-request method 兼容面，旧 user-input/dynamic tool name alias fail closed，保留当前 approval 与 user-input 协议方法。
- [x] 修复 runtime-inspector Git checkpoint preview 的 symlink 逃逸读取风险，metadata/patch 共用安全 checkpoint 文件读取链路。
- [x] 修复主进程 Git checkpoint service 写入/恢复边界：appData checkpoint 文件不跟随 symlink，metadata untracked 路径和 restore 目标必须留在 repo/root 内。
- [x] 修复 workspace mutating write path 的 symlink/path traversal 风险，文件写入、目录创建、剪贴板图片和 PDF annotation sidecar 共用安全写入 resolver。
- [x] 删除 Local Runtime settings 中 `runtimeGuards.toolStorm.softThreshold/hardThreshold`、`agents.sciforge.apiKey/baseUrl` 等旧兼容读取，endpoint/key 只走 Model Router。
- [x] 清理 Local Runtime model profile 旧兼容路径，只保留 `models.profiles[model].contextCompaction`。
- [x] 修复 Research Memory `.agent`、`.agent/artifacts.yml`、`.agent/research-memory/*` symlink 逃逸写入/读取风险，workspace 文件操作统一 no-follow 与真实路径边界。
- [x] 收紧 Schedule worker 写操作确认链路：启用型 create、危险 update、delete、run 统一确认指纹，并限制 internal HTTP 只允许 loopback 白名单 endpoint。
- [x] 修复 Write Markdown 图片 `file://` 渲染旁路，本地图片必须经 `readWorkspaceImage` workspace 校验后以 `data:` 渲染，并从 renderer CSP 移除 `img-src file:`。
- [x] 收紧 Dev Browser/webview popup 策略，webview 弹窗默认 deny，允许的本地预览 URL 回流到面板内导航，外链统一走 shared external URL policy。
- [x] 移除 Dev Browser 与 workspace HTML preview iframe 的 `allow-popups` sandbox 权限，避免浏览器 fallback 绕过统一 opener。
- [x] 修复 workspace HTML preview 本地服务读取旁路：预览 URL 增加不可猜 token，服务端校验 token，并把静态资源读取范围收敛到当前 HTML 文件目录。
- [x] 移除 workspace HTML preview iframe 的 `allow-same-origin` 权限，避免预览脚本以同源身份读取本地 preview server 其他路径。
- [x] 移除 Dev Browser fallback iframe 的 `allow-same-origin` 权限，Electron webview 继续承接真实内嵌预览与 popup policy。
- [x] 修复 Write export 最终目标写入旁路，导出目标必须留在 workspace 内并复用 safe-write/no-follow primitive，避免保存到 symlink 目标。
- [x] 收敛 macOS Screen Recording 系统设置外链，只允许 exact `x-apple.systempreferences:` 常量经共享 policy helper 打开。
- [x] 统一 embedded media URL policy，Write preview、chat timeline、write export 共用协议/MIME allowlist，本地 workspace 图片继续经主进程校验。
- [x] 收敛 GUI/main/shared 对 `kun/src` 的直接 import：引入本地 wrapper 和唯一 local-runtime contract 入口，避免 runtime internals 继续泄漏到 shared/renderer 边界。
- [x] 完成连接手机/远程通道命名低风险切片：新生成 prompt heading、IM help/status/model reply、新建线程标题和 locale value 不再暴露 Claw/OpenClaw，旧标题/prompt 仅作为 legacy 解析识别保留。
- [x] 新增 connect-phone / remote-channel 公共 API：`window.sciforge` preload、shared types、dev bridge 与 renderer 调用点优先中性命名。
- [x] 将 connect-phone / remote-channel IPC 从旧 `remoteChannel:*` 切换到 `connectPhone:*` / `remoteChannel:*`，删除 preload/dev bridge 旧 Claw API alias 与 renderer fallback 旁路。
- [x] 将 remote-channel webhook canonical 从 `/claw/im` / `sciforge.remoteChannel-im` 切换到 `/remote-channel/webhook` / `sciforge.remote-channel.binding.v1`，旧 internal GUI-plan endpoint 不再特殊成功处理。
- [x] 完成 renderer `route === 'claw'` 删除切片：Connect phone 改为 `route: 'chat'` + 明确 panel state，调用侧不再写旧 route。
- [x] 删除重复的 connect-phone task run API/IPC，任务执行只保留 `schedule:task:run` / `runScheduleTask` 单一链路。
- [x] 删除 settings patch schema 的旧 key 静默剥离入口，旧 provider/runtime patch key 现在由 strict schema 直接拒绝。
- [x] 清理架构文档里的 `window.dsGui` / legacy request-SSE shim / Connect phone 旧 route/settings 描述，统一到 `window.sciforge`、AgentRuntime 与 `remoteChannel`/`connectPhone`。
- [x] 删除 WeChat 安装错误格式化里的 OpenClaw Gateway 兼容文案特判，保留当前 bridge/network 错误通用处理。
- [x] 将新建连接手机/remote-channel 默认工作区从 `~/.sciforge/claw` 收敛到 `~/.sciforge/remote-channel`，旧路径只保留为内部 workspace 识别输入。
- [x] 明确并精简 `plugins/vision-router-service` 生命周期：默认链路不依赖 standalone 服务，已移除 root workspace/scripts/package-lock 与 packaging 合约残留，保留 Model Router `translators.vision` 与 sci-modality 真实链路。
- [x] 收敛 local-runtime 打包入口：root build/postinstall 与 electron-builder after-pack 复用 `scripts/local-runtime-package.cjs` 的 install/build/prune/validate 链路，不把 `kun/` 纳入 root workspaces。
- [x] 清理 Kun Skills legacy `SKILL.md` package fallback，Skills package 入口收敛为 manifest-only。
- [x] 抽统一 appData store 写入 helper，迁移 runtime goals/context ledger/shared memory/computer-use status 与 Codex/Claude thread snapshot JSON store 到 no-follow 读写、root boundary 和 temp+rename 原子写入链路。
- [x] 删除 release-all macOS 兼容 wrapper、`release.sh` 旧入口与 `release:all` 误导脚本，release 入口收敛到当前 macOS/Windows 分平台脚本。
- [x] 整合剩余 sub agent 的历史审查结果，继续拆分下一轮互不重叠的清理任务。
- [x] 统一 Plan 工作链路，只保留当前 `.sciforge/plan` 路径，删除历史兼容旁路。
- [x] 统一 runtime config IPC/API 命名，删除旧 `deepseek:config:*` / `kun:config:*` GUI 通道。
- [x] 收紧 Research Memory worker，避免 `status.html` 生成路径旁路。
- [x] 清理用户可见 Kun 文案，让默认本地 runtime 对外呈现为 SciForge Runtime。
- [x] 修复 workspace 无根路径、dev browser bridge、terminal PTY owner token 等高风险旁路。
- [x] 清理 runtime-inspector MCP 外露工具/资源/env/CLI 命名，改为 local runtime 契约。
- [x] 运行针对性测试、worker 包测试、`kun` typecheck/test、root typecheck、dev-browser/release/write/file-reference 测试、Evidence DAG Python 测试、完整根测试 224 files / 1700 tests 与 `git diff --check`，确认精简后链路一致。

## 暂停状态

- [x] 2026-06-26 按用户要求暂停继续清理；本轮 sub agents 已关闭，后续不再自动开启新切片。
- [x] 本轮最后验证：完整根测试 `npm test` 通过 224 files / 1700 tests；`npm run typecheck` 通过；最新 remote-channel workspace 默认路径切片的目标测试通过 5 files / 53 tests。
- [x] 当前已落地的最后一批通用清理：settings domain 迁移、strict settings patch、connect-phone task run 重复链路删除、`window.sciforge` 文档同步、OpenClaw 错误特判删除、remote-channel 默认工作区迁移。

## 下次继续 TODO

- [ ] 删除未挂载的旧 Connect phone 独立页/旧大弹窗链路：评估并移除 `ConnectPhoneView` 组件本体、`SidebarClawDialog.tsx`、`SidebarClawDialogSections.tsx`、`SidebarClawDialogStepContent.tsx` 及只覆盖旧链路的测试；保留当前 `ConnectPhoneSidebarPanel`、`ConnectPhoneDialog` 和共享 helper。
- [ ] 删除 Local Runtime 旧 singular user-input HTTP endpoint `/v1/user-input/:id`，只保留 canonical `/v1/user-inputs/:id`；同步 `kun` HTTP server 测试。
- [ ] 评估并清理 settings normalizer 中旧 `threadId` / `localThreadId` / `lastThreadId` 折叠到 `agentThreadIds.sciforge` 的迁移窗口，关闭后只读 canonical `agentThreadIds`。
- [ ] 将 renderer `managedBy: 'claw'` 分类值迁到 `managedBy: 'remoteChannel'`；如需读取历史快照，只允许 legacy read，不再生成旧值。
- [ ] 将 Settings route section 的 `'claw'` 内部枚举清名为 `'connectPhone'`，同步 `SettingsView`、sidebar 和测试；这不是 app route 旁路，可单独低风险处理。
- [ ] 清理 local-runtime 打包 helper 里的 `Kun` 命名，例如 `KUN_INSTALL_REQUIRED_PATHS`、`hasProjectKunInstall`、`buildProjectKun`；保留实际包目录 `kun/` 和底层协议名。
- [ ] 评估 `weixin-bridge-runtime` 的 `openclaw.json` / 旧 credentials token 运行态兼容窗口；确认可关后只读当前 `weixin-bridge.json` 与 per-account token。
- [ ] 评估 Codex app-server capsule 的 compatibility re-export，逐步把 JSON-RPC client / event normalizer 边界收敛到 `src/main/runtime/codex/app-server/`。

## Runtime id 深迁移

- [x] 将公开/持久化 runtime id 从 `kun` 迁移为 `sciforge`，覆盖 settings、IPC schema、schedule/claw/thread 映射、renderer store。
- [x] 将 `agents.kun` 设置 key 迁移为 `agents.sciforge`，删除 settings/IPC 里的旧 key 写入路径。
- [x] 将 runtime-inspector checkpoint 公开 schema 的 runtime id 迁移为 `sciforge`。
- [x] 将公开文档从 `kun-*` / `KUN_CONFIG` 重命名为 local-runtime 系列，并同步 README、AGENTS、architecture/config 文档。
- [x] 将默认本地 runtime 数据目录改为 `~/.sciforge/runtime`，旧 `.sciforge/kun` 仅作为历史默认路径识别。
- [x] 将公开 runtime status/error/default 常量命名改为 local runtime 命名。
- [x] 收敛内部 `Kun*` helper/type/file 命名；仅保留 `kun/` 包名、CLI、`KUN_*` env、`KUN_READY`、`service: 'kun'` 等底层协议边界。
- [x] 删除 Local Runtime credential override 和旧 tool-storm settings 兼容入口，统一走 Model Router/provider 与 `runtimeGuards`。
- [x] 统一 Schedule AgentRuntime 执行链路，复用共享 `runPromptViaRuntime`，删除本地重复等待/readThread 链路。
- [x] 删除旧 webhook secret header 成功路径，只接受 `Authorization: Bearer` 和 `x-sciforge-secret`。
- [x] 重新运行 typecheck、根测试、Local Runtime 子包测试与 runtime-inspector 测试，修复深迁移后的隐性编译/行为问题。

## 需决策候选方案

- [x] 暂不将 `kun/` 纳入根 npm workspaces；已抽唯一 local-runtime packaging 脚本，集中 `npm --prefix kun` install/build/prune 与 after-pack 校验，降低 release 打包风险后再评估 workspace 化。
- [x] 建立稳定的 local runtime contract/package 边界：GUI/main/shared 只通过本地 wrapper 与唯一 package contract 入口触达 runtime contracts，边界测试约束直接 `kun/src` import；保留 `kun` CLI、`KUN_READY`、`KUN_*` env、`service: "kun"` 等底层协议边界。
- [x] 将 renderer/main 的 embedded media policy 进一步拆成明确的 `external-open` / `embedded-image` / `frame-url` 策略，收敛 message timeline、write preview、export hidden window 的远程媒体规则。
- [x] 收紧 Dev Browser/Webview popup 策略：默认 deny webview child window，必要时把允许的本地预览 URL 回流到面板内导航。
- [x] 审查并移除不必要的 iframe `allow-popups` sandbox 权限；确实需要弹窗时改走共享 URL policy 校验的 bridge。
- [x] runtime guard 本轮选择短期干净方案：只保留实际生效的 `toolStorm.threshold`，不继续暴露未实现的高级 guard UI。
- [x] 将 Write/inline completion 的模型选择收敛到 Model Router public alias，删除直接 base URL / API key / model 字段。
- [x] 完成 settings 持久化域迁移：远程通道归 `settings.remoteChannel`，连接手机 bridge 归 `settings.connectPhone`，计划任务只归 `settings.schedule.tasks`；读写与 patch 路径不再透传旧域。
- [x] 明确 `plugins/vision-router-service` 生命周期：默认链路不依赖 standalone 服务；已移除 root scripts/workspace、package-lock link/extraneous 项与 packaging 合约残留。源码保留为目录内可运行的 standalone 模块，Model Router 视觉输入继续走 `translators.vision` 的 OpenAI-compatible chat-completions 链路。
- [x] 抽统一 appData store 写入 helper，已覆盖 runtime goals/context ledger/shared memory/computer-use status 与 Codex/Claude thread snapshot JSON store 的 root boundary、no-follow 与 atomic JSON 语义。
- [x] 继续收敛 appData JSONL append stores：Codex event/usage、Claude event/session transcript 等 append 链路统一 no-follow append 与按 store 串行化策略。
