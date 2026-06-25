# SciForge Research Memory MCP 任务板

更新时间：2026-06-25

## 当前目标

实现一个 MCP-first 的 Research Memory 能力，让学生在本地使用 agent 做科研工作，同时把经过压缩和确认的项目状态同步到 GitHub。

本功能不新增 extension UI。GUI 只保留必要的人类交互；真实能力放到 `packages/workers/research-memory`，通过 MCP 给 Kun、Codex、Claude Code 等 runtime 复用。

---

## 不可变原则

- GUI 只是方便用户交互的壳子；新增 GUI 前必须先问：这一步是否真的需要人类交互？
- 能由 agent 在后台完成的流程，不进 renderer，不做 dashboard，不做冗余面板。
- `packages/workers/**` 是模块化 MCP 能力边界；纯 Node 后端能力、长生命周期或缓存服务、agent/MCP 复用工具面优先放这里。
- 主进程只保留 Electron/native、窗口、权限、设置、生命周期、打包启动、runtime 执行引擎和 internal HTTP/MCP 配置注入边界。
- Renderer 不保留 Research Memory 私有业务逻辑。
- Research Memory 的核心形态是 `MCP first, Skill required, Plugin optional, Extension UI 不做`。
- Plugin 只作为可选分发/安装入口，不等于必须有 UI。
- Skill 只定义 agent 行为规范；真实读写和安全检查必须在 MCP worker 中实现。
- GitHub 是项目记忆层，不是真实事实源。
- 本地 workspace 和 `.agent/artifacts.yml` 是事实引用源。
- `status.html` 是 GitHub 项目状态展示页，由 MCP 生成或更新，不手写成事实源。
- Agent 不得自动合并 PR、关闭重大 issue、标记 validated、发布 public claim。
- 中高风险内容、validated 结论、public claim 必须由人类确认。

---

## 第一阶段：Research Memory Worker 骨架

- [ ] 新增 `packages/workers/research-memory` workspace。
- [ ] 定义 `contract.ts`：tool names、zod schemas、结果类型、side-effect annotations。
- [ ] 定义服务边界：artifact index、policy check、draft generation、status HTML、GitHub adapter。
- [ ] 新增 worker README，说明它是 MCP worker，不是 renderer 功能。
- [ ] 添加 worker typecheck/test scripts，并接入 root workspace scripts。

## 第二阶段：Local Artifact Index

- [ ] 支持读取 `.agent/artifacts.yml`。
- [ ] 支持创建和更新 artifact 记录。
- [ ] 支持 ID 规则：`HYP-*`、`EXP-*`、`RUN-*`、`DEC-*`、`DOC-*`、`ART-*`。
- [ ] 支持按 ID 查询 artifact。
- [ ] 记录 GitHub issue、PR、doc 链接。
- [ ] 拒绝把本地绝对路径同步到 GitHub 输出。
- [ ] 添加 artifact index 单元测试。

## 第三阶段：Policy、Draft 与 status.html

- [ ] 实现 evidence level：`observation`、`preliminary`、`reproduced`、`validated`。
- [ ] 实现 claim scope：`local-note`、`internal-summary`、`public-claim`。
- [ ] 实现 risk level：`low`、`medium`、`high`。
- [ ] 实现 policy check，识别本地路径、密钥、服务器信息和敏感信息风险。
- [ ] 实现 GitHub issue/comment/PR 草稿生成。
- [ ] 实现实验卡片和决策记录模板生成。
- [ ] 实现稳定、静态、可 diff 的 `status.html` 生成。
- [ ] `status.html` MVP 不使用 JavaScript，CSS 保持少量内联。
- [ ] 添加 policy、draft、HTML snapshot 测试。

## 第四阶段：MCP Server

- [ ] 暴露只读工具：`gui_research_memory_status`、`gui_research_memory_artifact_list`、`gui_research_memory_artifact_get`、`gui_research_memory_feedback_read`、`gui_research_memory_policy_check`。
- [ ] 暴露本地写入工具：`gui_research_memory_artifact_upsert`、`gui_research_memory_draft_sync`、`gui_research_memory_write_experiment_card`、`gui_research_memory_write_decision_record`、`gui_research_memory_render_status_html`。
- [ ] 暴露 GitHub 写入工具：`gui_research_memory_create_issue`、`gui_research_memory_create_comment`、`gui_research_memory_prepare_pr`、`gui_research_memory_create_pr`。
- [ ] 所有写入工具支持 `dry_run` 或 `preview`。
- [ ] GitHub 写入工具需要 `confirmed: true`。
- [ ] 不提供 `merge_pr`、`close_major_issue`、`mark_validated`、`publish_public_claim`。
- [ ] 添加 MCP stdio server 测试。

## 第五阶段：GitHub Adapter

- [ ] 优先复用已有认证方式，例如 `gh` CLI、环境变量或用户已配置的 GitHub MCP。
- [ ] 支持读取 issue、comment、PR、review comment、mention。
- [ ] 支持 label 过滤：`question`、`suggestion`、`experiment-request`、`decision-needed`、`needs-student-review`、`risk-high`。
- [ ] 支持创建 issue 和 comment。
- [ ] 支持创建分支、提交项目记忆文件、打开 PR。
- [ ] PR body 自动包含 artifact ID、evidence level、claim scope、risk level 和检查清单。
- [ ] 中高风险、`validated`、`public-claim` 时返回确认需求，不直接写入。
- [ ] 添加 GitHub adapter 单元测试，真实网络测试默认跳过。

## 第六阶段：GUI-managed MCP 接入

- [ ] 新增 `src/main/research-memory-mcp-config.ts`。
- [ ] 新增 `src/main/research-memory-mcp-node-entry.ts`。
- [ ] 新增 `src/main/research-memory-mcp-server.ts`。
- [ ] 在 `src/main/gui-mcp-registry.ts` 注册 Research Memory MCP。
- [ ] 确保 Codex、Kun 可复用同一 MCP 配置。
- [ ] 不新增 extension UI。
- [ ] 不在 renderer 中实现 Research Memory 业务逻辑。
- [ ] 添加 registry/config 测试。

## 第七阶段：Research Memory Skill

- [ ] 新增 Research Memory skill，说明何时调用 MCP。
- [ ] 明确 agent 必须先草稿、再确认、再同步。
- [ ] 明确不得自动合并 PR、关闭重大 issue、发布 public claim。
- [ ] 明确所有 GitHub 摘要必须包含 artifact ID 和 evidence level。
- [ ] 明确 `status.html` 由 MCP 生成，GitHub PR 承载 review。
- [ ] 添加最小示例：实验完成、blocker 更新、合作者 issue 反馈。

## 验收标准

- [ ] Agent 可以通过 MCP 创建或更新 `.agent/artifacts.yml`。
- [ ] Agent 可以生成 `status.html` 草稿，并通过 PR 更新 GitHub 项目记忆。
- [ ] Agent 可以读取 GitHub feedback，并生成本地任务或回复草稿。
- [ ] 中高风险内容不会在没有人类确认时写入 GitHub。
- [ ] 不存在 Research Memory extension UI。
- [ ] Renderer 没有 Research Memory 私有业务逻辑。
- [ ] `packages/workers/research-memory` 测试通过。
- [ ] 相关 MCP config / registry 测试通过。
- [ ] `npm run typecheck` 通过。

## 暂缓事项

- [ ] GitHub Projects 自动化。
- [ ] GitHub Discussions。
- [ ] Research Memory dashboard。
- [ ] Artifact 浏览器。
- [ ] Feedback inbox UI。
- [ ] 自动合并。
- [ ] 多 agent review 治理层。
- [ ] 更完整的数据库式 artifact registry。
