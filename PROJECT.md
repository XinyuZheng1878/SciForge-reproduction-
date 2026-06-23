# SciForge MCP / Computer Use 清理任务板

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

## 当前结论

- [x] 已完成并行只读调查：`src/main/**` 未发现仍完整保留旧 MCP schema/tool handler/business handler 的大套实现，`src/main/*-mcp-server.ts` 主要是 worker launch adapter。
- [x] 已确认应保留边界：`src/main/*-mcp-node-entry.ts`、`src/main/*-mcp-config.ts`、thin `src/main/*-mcp-server.ts`、`schedule-runtime`、`workflow-runtime`、`paper-radar-sidecar`、Electron/native 文件与 Git 可变更能力。
- [x] 已确认真实清理方向：优先清理 LSP、write retrieval/PDF、workspace reference 的双实现；其次清理 MCP tool list、Codex/Kun 暴露路径、legacy flag/name、打包模型和配置模板重复。
- [x] 已确认后续清理策略：能进入 MCP worker/shared MCP package 的通用能力优先迁入 MCP 部分，方便独立测试、独立打包和跨 runtime 复用。
- [x] 旧的 Computer Use 已完成实施任务已从本文件删除；MCP worker 已完成历史保留在 `PROJECT_mcp.md`。

## 模块化迁移判定

- [x] 为每个待清理能力先做 MCP 模块化判定：若能力不依赖 Electron 窗口、OS 权限、用户设置写入、native lifecycle 或 runtime 执行引擎，则默认迁到 `packages/workers/**` 或共享 MCP package。
- [x] 对仍需 GUI IPC 的能力，保持 IPC channel 名称和 renderer 语义稳定，但 handler 只调用 MCP worker/shared MCP service，不再在 `src/main/services/**` 内保留第二份业务逻辑。
- [x] 对仍需 AgentRuntimeHost auxiliary 的能力，优先改为调用同一 MCP worker/shared MCP service；只有无法表达为 MCP tool 或必须访问 runtime 内存态时才保留 host-only adapter。
- [x] 新增能力时先建立 worker contract、service、MCP server、package tests，再接入 Kun/Codex/Claude Code/main IPC；禁止先在 runtime 私有目录落一份临时业务实现。
- [x] 已迁入 MCP 部分的能力必须能独立测试，且 contract/tool schema、side effect、confirmation/audit 元数据与 runtime 注入配置由同一来源派生。

## 第一阶段：业务实现去重

- [x] LSP code navigation 去重：将 `AgentRuntimeHost` 的 `runCodeNavigation` 迁到 `packages/workers/runtime-inspector` 的 LSP service/contract；只有 contract 需要被非 MCP 调用时才抽共享 MCP package；随后删除 `src/main/services/lsp-code-navigation-service.ts` 及只覆盖旧实现的测试。
- [x] Write retrieval/PDF text 去重：让 `write:retrieve-context` IPC、inline completion retrieval 和 MCP `write-assist` 共用 `packages/workers/write-assist` service/contract；只有 Electron/native 文件选择或 UI 状态留在 main adapter；随后删除 `src/main/services/write-retrieval-service.ts`、`src/main/services/write-pdf-text-service.ts` 中重复的纯 Node 业务逻辑。
- [x] Workspace reference 去重：保留 GUI IPC、renderer UX 和 host-service 语义，底层统一到 `packages/workers/workspace-intel` service/contract；只有需要 Electron/native 写操作或窗口状态的部分留在 main adapter；随后删除或瘦身 `src/main/services/workspace-reference-service.ts` 中重复的 reference list/preview 逻辑。
- [x] Skill/file preview 边界审计：确认 `src/main/services/skill-service.ts`、workspace file preview、workspace-intel worker 之间是否存在重复发现/预览逻辑；只保留 Electron/native 写操作与 UI 专用能力，纯只读发现逻辑归并到唯一实现。
- [x] Paper Radar sidecar/worker 边界审计：明确 `plugins/paper-radar-service` 与 `packages/workers/paper-radar` 是否长期采用 sidecar HTTP 加 worker facade，还是统一到 worker 本地 service；删除重复的 sync/search/rank/digest/profile 业务实现，只保留一个权威数据路径。

## 第二阶段：MCP 暴露与配置去重

- [x] Codex MCP 双暴露去重：在 Codex `config.toml` 原生 MCP `[mcp_servers.gui_*]` 和 `CodexDynamicMcpToolBridge` dynamicTools 之间二选一，避免同一 GUI MCP server 通过两条路径暴露给 Codex。
- [x] Runtime MCP server registry 收敛：Kun、Codex、Claude Code 的 GUI MCP server 列表、enabledTools、命令、env、timeout 和 disabled 状态统一由共享 registry/descriptor 派生，不再各 runtime 手写一份。
- [x] Worker contract 派生 enabledTools：`schedule`、`workflow`、`paper-radar` 等 main config 中的 enabledTools 从 `packages/workers/*/src/contract.ts` 派生，删除重复手写 tool name list。
- [x] MCP server 启动分发去重：把 `src/main/index.ts` 中多组 `running*` flag 和长 `else if` MCP server dispatch 改成注册表式 dispatcher；保留必须的 Electron launch 边界。
- [x] MCP config helper 中立化：将 `resolveScheduleMcpCommand`、node-entry path、args/env、JSON read/write、timeouts、enabled/disabled 等重复模板整理为通用 managed GUI MCP config helper。
- [x] Kun MCP 注入路径去重：把 `~/.kun/mcp.json` 定位为用户编辑/外部 server 来源，GUI 内置 MCP 直接从共享 registry 合成到 Kun config，避免“写出再读回再覆盖”。

## 第三阶段：旧入口、命名与打包清理

- [x] Schedule legacy 命名清理：删除旧 schedule MCP flag/name/path/alias/TOML 清理逻辑，只保留 `gui_schedule` worker entry 与 `schedule-mcp-node-entry`。
- [x] 直接 main flag 入口审计：确认没有外部脚本直接运行 `out/main/index.js --gui-*` 后，删除或收敛 `src/main/index.ts` 中直接启动 MCP server 的 legacy flag 分支；标准路径使用 `out/main/*-mcp-node-entry.js`。
- [x] Worker CLI 与 main wrapper 双入口审计：保留 Electron 必需胶水；若运行模型统一为 node-entry，删除 raw worker CLI runtime 校验；若统一为 worker CLI，则移除 Vite node-entry 和对应 wrapper。
- [x] 打包模型二选一：在 bundled node-entry 与 raw `packages/workers/*` runtime copy/asarUnpack 之间明确权威路径，清理 `electron-builder.config.cjs`、`electron.vite.config.ts`、`scripts/after-pack.cjs` 的重复校验。
- [x] Retired/legacy compatibility 清单：列出必须长期保留的兼容项和可删除旧实现，优先覆盖 retired `gui_plan_create`、legacy schedule config、旧 settings/provider/env alias。

## 回归守卫

- [x] Computer Use 图像路径回归守卫：增加测试防止截图绕过 model router，或以 provider 私有 `image_url` / `input_image` 旁路进入非 router 层。
- [x] AgentRuntimeHost auxiliary audit：逐项检查旧 auxiliary operation 是否已被 MCP worker 替代；可删则删，必须保留则路由到共享 worker/service contract。
- [x] IPC handler audit：GUI-facing IPC 可以保留，但纯 Node parsing/indexing/retrieval 业务必须调用共享 package service 或 worker adapter，不得复制实现。
- [x] 测试分层收敛：行为测试放到 worker/shared package；main 测试只覆盖 launch、lifecycle、IPC adapter、runtime 注入和配置写入。
- [x] 完成每个清理项后用 `rg` 证明同能力只有一个业务实现入口，且 Kun、Codex、Claude Code、GUI/renderer 仍走同一 contract。
- [x] 清理完成后运行 `npm run typecheck -- --pretty false` 和相关 worker/main 测试；所有已完成清理任务必须在本文件打勾。

## 不要作为冗余直接删除

- `src/main/schedule-runtime.ts`：保留定时器、settings、power/system、agent runtime 执行、internal HTTP endpoint。
- `src/main/workflow-runtime.ts`：保留 workflow 执行引擎、approval、loop、webhook/cron/internal endpoint。
- `src/main/paper-radar-sidecar.ts` 与 `plugins/paper-radar-service`：在 Paper Radar 边界决策前保留 sidecar lifecycle、SQLite/storage/source/ranking 职责。
- `src/main/*-mcp-node-entry.ts`：保留 packaged app 的 Electron/Helper MCP worker 启动入口，除非整体改为 worker CLI 启动模型。
- Thin `src/main/*-mcp-server.ts`：保留 worker launch adapter，除非配置已统一为直接启动 worker CLI/bin。
- `src/main/services/workspace-files.ts`、`workspace-editors.ts`、`workspace-paths.ts`、`git-service.ts`、`git-checkpoint-service.ts`：保留 Electron/native 文件、编辑器、Git 可变更边界；只清理与 worker read-only 能力重复的纯业务逻辑。
