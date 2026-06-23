# DeepSeek GUI MCP Worker 模块化迁移任务板

更新时间：2026-06-23

## 核心目标

将适合复用、适合独立生命周期、适合 agent 调用的后端能力逐步迁移到 `packages/workers`，并按需要以 MCP server 或 sidecar service 形式提供服务。

本任务的目标不是把所有 IPC 或主进程逻辑搬走，而是让 DeepSeek-GUI 的能力边界更清晰：主进程负责 Electron 生命周期、权限、设置、窗口和安全转发；worker 负责纯 Node 服务、长生命周期任务、缓存/索引、协议适配和 agent 可调用工具。

## 不可变原则

- [ ] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [ ] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [ ] LLM API 只能走 model router；任何 worker 不得绕过 model router 直接接入上游模型。
- [ ] 相同功能的工作链路需要统一，不要额外生出旁路。
- [ ] MCP worker 是共享能力边界，不允许为 Kun、Codex、Claude Code、GUI renderer 分别复制一套私有实现。
- [ ] 先拆服务 contract 和 service，再接 MCP/server/主进程注入；不要在 MCP tool handler 里堆业务逻辑。
- [ ] Electron 原生能力留在主进程，worker 只能通过受控 contract 请求必要信息或执行窄口径动作。
- [ ] 有副作用的 MCP tool 必须区分 read-only、write、destructive 三类权限，并具备确认、审计和可解释失败结果。
- [ ] 任何迁移都必须保持现有用户工作链路不变；renderer 和 runtime 只更换后端入口，不改变产品语义。

## Worker 与 MCP 边界

- [ ] `packages/workers` 可以包含两类服务：stdio MCP server 和 HTTP/sidecar service；不是所有 worker 都必须暴露 MCP。
- [ ] 适合 MCP 的能力：agent 需要直接调用、需要结构化 tool result、可被多个 runtime 复用、可用资源 URI 暴露只读大对象。
- [ ] 适合普通 sidecar 的能力：模型路由、长连接、内部 HTTP 服务、仅 GUI 内部消费且不需要 agent tool surface 的后端能力。
- [ ] 不得把 UI 页面状态、路由状态、tab/filter/localStorage 展示状态包装为 MCP tool。
- [ ] 不得把原始 settings 写入、secret/token 保存、系统权限弹窗、文件选择、剪贴板、外部链接打开、BrowserWindow 打印/PDF 渲染放入通用 MCP。
- [ ] 可拆分能力必须优先找已有主进程 service 或 plugin sidecar，按现有 contract 迁移，不重新发明第二套数据模型。

## 标准 Worker 包结构

每个新增 worker package 默认使用以下结构，除非有明确理由简化：

- [ ] `src/contract.ts`：公开类型、输入输出 schema、错误码、资源 URI 约定。
- [ ] `src/service.ts`：纯业务服务，不依赖 MCP SDK，不依赖 Electron。
- [ ] `src/mcp-server.ts`：MCP transport 适配，只做 schema 校验、service 调用、tool/resource 注册。
- [ ] `src/cli.ts`：本地启动入口，支持 `stdio` 或必要的 HTTP 模式。
- [ ] `src/index.ts`：导出 public contract 和 service factory。
- [ ] `src/*/*.test.ts`：覆盖 service、schema、MCP structured result、错误路径。

每个 package 的 `package.json` 必须保持一致：

- [ ] `type: module`。
- [ ] `bin`、`exports`、`files` 明确声明。
- [ ] `scripts.start` 使用统一启动方式。
- [ ] `sciforge.lifecycleLayer` 标记为 `workers`。
- [ ] `sciforge.publicContract`、`runtimeAdapter`、`mcpServer` 按实际能力声明。
- [ ] `sideEffects` 必须如实声明：`none`、`filesystem`、`network`、`host-ui`、`process` 或组合说明。

## MCP Tool 设计约束

- [ ] tool 名称必须稳定、可读、以能力域为前缀，例如 `gui_schedule_list`、`gui_workspace_preview`。
- [ ] 输入必须使用 schema 校验，禁止透传任意 JSON 到内部服务。
- [ ] 输出必须优先使用 `structuredContent`；文本 `content` 只放摘要和可读说明。
- [ ] 大文本、大列表、二进制、图片、索引状态优先通过 MCP resources 或分页参数暴露，不把巨大 payload 塞进单次 tool result。
- [ ] tool 失败必须返回模型可理解的错误结果，包含错误码、原因、是否可重试、建议修正方式；除真正 abort 外不应直接杀掉 turn。
- [ ] read-only tool 默认不得产生持久副作用；缓存写入必须可解释、可清理，并不能改变用户数据语义。
- [ ] write/destructive tool 必须支持 dry-run 或 preview；危险操作必须经主进程确认策略和审计记录。
- [ ] 任何包含 secret、token、prompt、截图、文件内容的结果必须做最小化输出和日志脱敏。

## 主进程接入约束

- [ ] 主进程只负责 worker launch config、生命周期、权限、设置读取、Electron 原生动作和 GUI 状态同步。
- [ ] 新 MCP server 需要独立的 `GUI_*_MCP_LAUNCH_FLAG` 和 `GUI_*_MCP_SERVER_NAME`。
- [ ] 新 MCP server 需要补齐 node-entry、runtime 注入、Kun MCP config 同步、Codex dynamic MCP 注入；Claude Code 是否注入按能力风险单独决定。
- [ ] packaged app 中运行的 worker 必须更新 `electron-builder.config.cjs`、`electron.vite.config.ts` 和 `scripts/after-pack.cjs` 的包含与校验规则。
- [ ] env allowlist 必须显式声明；secret 通过 env key 引用，不写入 MCP config。
- [ ] 运行时关闭、用户 stop、应用退出时，主进程必须能中断 worker 请求、释放 lease/session、记录释放原因。

## 第一阶段：Worker 基础标准化

- [ ] 梳理现有 `packages/workers/computer-use`、`packages/workers/search`、`packages/workers/model-router` 的共同 package 约定。
- [ ] 建立新增 worker 的最小模板，明确 `contract/service/mcp-server/cli/index` 边界。
- [ ] 统一 MCP node-entry、launch flag、server name、runtime 注入和 packaged app 打包校验方式。
- [ ] 检查现有 search worker 在开发和生产包中的启动路径，确认不会因 raw package 未包含而失效。
- [ ] 给 worker 增加统一 diagnostics 约定：版本、transport、健康状态、最近错误、可用能力。

## 第二阶段：Schedule Worker 样板

目标：将已经半 MCP 化的调度能力迁入 `packages/workers/schedule`，作为后续迁移样板。

- [ ] 迁移 schedule MCP schema、stdio server、internal HTTP client 到 worker package。
- [ ] 主进程保留 `ScheduleRuntime`、settings、power/system 能力和 agent runtime 执行。
- [ ] MCP tools 覆盖 `gui_schedule_list/create/update/delete/status/run/detect_from_text`。
- [ ] resources 覆盖 `schedule://tasks`、`schedule://task/{id}`、`schedule://status`。
- [ ] 测试 fake internal HTTP server、schema 校验、错误结果、MCP stdio e2e。

## 第三阶段：Workspace Intel / Write Retrieval

目标：把 workspace 只读理解、文件预览、引用构建、PDF 文本抽取和写作检索索引拆成可复用服务。

- [ ] 优先实现 read-only `packages/workers/workspace-intel`，提供 tree、preview、reference list、skill list/read。
- [ ] 路径解析必须复用 workspace root guard，覆盖 path traversal、symlink、二进制文件、超大文件。
- [ ] `write-retrieval` 和 `pdf-text` 可作为 `packages/workers/write-assist` 或 workspace-intel 子服务，迁移前先确认包边界。
- [ ] MCP tools 可包括 `gui_workspace_list/read/preview`、`gui_workspace_reference_list/preview`、`gui_write_retrieve_context`、`gui_pdf_extract_text`。
- [ ] resources 可包括 `workspace://tree`、`workspace://file/{path}`、`write-index://workspace/{id}/stats`、`pdf://{path}/text`。
- [ ] 第一阶段不迁移 delete/rename/write/clipboard image；这些保留在主进程或后续带确认迁移。

## 第四阶段：Workflow MCP Facade

目标：先暴露 workflow 的 agent-facing MCP facade，不急着迁移完整执行引擎。

- [ ] 新建 `packages/workers/workflow`，通过现有 `/workflow/internal/*` 调用主进程 runtime。
- [ ] MCP tools 覆盖 `gui_workflow_list/run/status/stop/validate/import/export`。
- [ ] resources 覆盖 `workflow://callable`、`workflow://run/{runId}`、`workflow://schema/{workflowId}`。
- [ ] code node、approval、loop、webhook、cron 调度仍由现有 runtime 执行。
- [ ] 完整图执行引擎迁移必须另开任务，先设计 sandbox、approval、run state 恢复和并发模型。

## 第五阶段：Research / Paper Radar

目标：让研究检索、论文同步、rank 和 digest 成为 agent 可调用知识服务。

- [ ] 优先选择：现有 plugin sidecar 增加 MCP front，或迁入 `packages/workers/paper-radar`；迁移前必须确定 DB 路径和打包策略。
- [ ] MCP tools 可包括 `gui_paper_profile_list/save/sync`、`gui_paper_search/rank/digest`。
- [ ] resources 可包括 `paper-radar://stats`、`paper-radar://profile/{name}`、`paper-radar://paper/{id}`、`paper-radar://sync-state`。
- [ ] 测试 SQLite temp DB、FTS 查询、sync state、网络 fixture、rate limit、structuredContent。

## 第六阶段：LSP / Git Read-only / Runtime Inspector

- [ ] LSP code navigation 适合独立 worker 管理 long-lived language server session，但必须处理 per-workspace 生命周期和未保存 buffer。
- [ ] Git worker 第一阶段只做 read-only：status、branches、diff preview、checkpoint list/preview。
- [ ] Git write、branch switch、restore、reset、clean 必须另行设计 confirmation、dry-run、rescue branch 和审计。
- [ ] Runtime inspector 可以暴露 ports、health、dependency report、model-router/Kun 状态；不要先迁移进程控制。

## 暂缓迁移范围

- [ ] Command execution / shell session：价值高但安全边界最高，必须等 approval、session ownership、stdin、output retention 设计完成。
- [ ] Agent Runtime thread/turn 管理：可作为长期目标，但短期不应把 streaming turn 主路径改成 MCP。
- [ ] Runtime state / memory / goals：涉及并发写、schema migration、权限隔离，先做只读 diagnostics。
- [ ] IM bridge / Discord / 飞书 / 微信：涉及 token、长连接、代理、外部发送消息，先保留在主进程和现有 runtime。
- [ ] 原始 settings/secrets 写入：不得作为通用 MCP 暴露。

## 并行边界

迁移时可以使用 sub agent 并行审查或实现，但必须按包和文件边界拆分：

- [ ] 一个 worker package 同一时间只允许一个实现 worker 主改，其他 worker 只做审查或测试补充。
- [ ] 修改 `src/main/index.ts`、`src/main/kun-process.ts`、runtime MCP 注入、打包配置时必须串行，避免多 worker 互相覆盖。
- [ ] Schedule、Workspace Intel、Workflow facade 可以分阶段并行设计，但落代码时先完成基础模板和打包规则。
- [ ] 涉及 tool safety、runtime foundation、agent loop 的修改必须对照 `PROJECT_AGENT_TOOL_SAFETY.md` 和 `PROJECT_RUNTIME_FOUNDATION.md`。

## 参考来源

- `packages/workers/computer-use`
- `packages/workers/search`
- `packages/workers/model-router`
- `src/main/claw-schedule-mcp-server.ts`
- `src/main/schedule-runtime.ts`
- `src/main/workflow-runtime.ts`
- `src/main/services/workspace-files.ts`
- `src/main/services/workspace-reference-service.ts`
- `src/main/services/write-retrieval-service.ts`
- `src/main/services/write-pdf-text-service.ts`
- `src/main/services/lsp-code-navigation-service.ts`
- `src/main/services/git-service.ts`
- `src/main/paper-radar-sidecar.ts`
- `plugins/paper-radar-service`
- `src/main/kun-process.ts`
- `src/main/runtime/codex/codex-service.ts`
- `electron.vite.config.ts`
- `electron-builder.config.cjs`
- `scripts/after-pack.cjs`

## 验收清单

- [ ] 新增 worker package 能独立运行 service 单测和 MCP stdio e2e。
- [ ] 主进程、Kun、Codex runtime 使用同一 MCP server 配置，不复制业务逻辑。
- [ ] packaged app 校验能发现缺失 worker package、node-entry 或 native/runtime 依赖。
- [ ] read-only MCP tools 不产生用户数据语义变化。
- [ ] write/destructive MCP tools 具备确认、dry-run 或 preview、审计和可解释失败。
- [ ] 大 payload 通过 resources、分页、摘要或引用传递，不污染模型上下文。
- [ ] secret、token、prompt、截图、文件内容在日志和 diagnostics 中默认脱敏。
- [ ] Electron-only 能力仍留主进程，worker 不直接依赖 Electron。
- [ ] 现有 GUI、Kun、Codex、Claude Code 工作链路保持一致，无新增旁路。
