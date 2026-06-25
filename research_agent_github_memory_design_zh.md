# 科研 Agent 的 GitHub 项目记忆与协作方案

## 1. 设计目标

本方案要支持一种简单、可靠、学生真的愿意使用的科研协作方式：

> 学生在本地或服务器使用 agent 做真实科研工作；导师、同学和合作者在 GitHub 看到经过整理的项目进展，提出建议，review 变更，并参与协作。

这里的 GitHub 不是完整科研工作区，也不是所有事实的存储地。它更像一个面向合作者的“项目记忆层”：只保存经过压缩、整理和确认的信息。

本地工作区保留完整事实，包括数据、代码、实验日志、模型 checkpoint、agent 轨迹和内部笔记。GitHub 只暴露合作者需要看到、可以讨论、可以审计的摘要。

一句话版本：

> 本地 agent 产出事实和草稿；学生确认要不要同步；GitHub Issues 收建议，Pull Requests 更新正式项目记忆，`status.html` 展示当前状态。

---

## 2. 当前结论

这个功能应采用：

```text
MCP first
Skill required
Plugin optional
Extension UI 不做
```

含义是：

- 核心能力放到 `packages/workers/research-memory`，以 MCP worker 形式提供给 agent。
- Skill 负责告诉 agent 什么时候、如何使用这套工具，并遵守科研协作边界。
- Plugin 只作为可选的安装和发现方式，不等于必须有 UI。
- 不新增 extension UI。GitHub、PR、issue 和 chat 已经能承载 MVP 的人类交互。

GUI 的职责应该保持很薄：

- 聊天。
- 设置。
- 必要确认。
- 显示 agent 运行状态。

其他能力尽量由 agent 在后台通过 MCP 或 HTTP service 完成。

---

## 3. 设计原则

### 3.1 本地是真实事实源

科研工作的完整事实应该留在本地或服务器环境中。

包括：

- 原始数据。
- 处理后数据。
- 代码和实验配置。
- 完整实验日志。
- 模型 checkpoint。
- agent trajectory。
- 内部笔记和临时想法。
- 合作方敏感信息。

GitHub 上的内容只是“可协作摘要”，不是完整事实本身。

### 3.2 GitHub 是项目记忆，不是完整工作区

GitHub 应该帮助合作者快速理解：

- 项目现在处于什么阶段。
- 最近发生了哪些重要变化。
- 哪些实验支持或削弱了当前假设。
- 当前 blocker 是什么。
- 哪里需要合作者输入。
- 哪些决策已经做出。

GitHub 不应该存放：

- 原始数据。
- 完整实验日志。
- checkpoint。
- 密钥或凭证。
- 服务器路径。
- 完整 agent scratchpad。
- 未经确认的强科学结论。

### 3.3 学生是正式状态的责任人

Agent 可以执行任务、总结进展、生成草稿、提出判断，但不应该替代学生决定项目正式状态。

学生需要确认：

- 哪些本地进展值得同步到 GitHub。
- 哪些摘要可以成为正式项目记忆。
- evidence level 是否合理。
- 某个结果是否可以作为 claim。
- 中高风险内容是否可以让合作者看到，或是否可以对外公开。

### 3.4 Agent 是助手，不是项目管理者

Local Agent 的职责是降低学生的协作成本，而不是接管项目治理。

Agent 应该擅长：

- 记录 artifact。
- 根据本地事件生成 issue、comment 或 PR 草稿。
- 生成或更新 `status.html` 草稿。
- 检查是否泄露敏感信息。
- 标注 evidence level、claim scope 和 risk level。
- 读取 GitHub 反馈，并转成本地任务或回复草稿。

Agent 不应该：

- 直接修改 main 分支。
- 自动合并 PR。
- 自动把结果标记为 validated。
- 自动发布 public claim。
- 单方面关闭重大 issue。
- 单方面改变研究方向。

### 3.5 用 GitHub 原生能力，少造系统

方案应优先使用 GitHub 已有对象：

- Issue 用于提问、建议、任务和实验请求。
- PR 用于更新正式项目记忆。
- Label 用于分类和路由。
- Milestone 用于阶段目标。
- Branch protection 用于避免直接修改 main。
- GitHub Pages 可选用于展示 `status.html`。

GitHub Projects、Discussions、自动化看板等都可以后加，不应该成为 MVP 的前置条件。

### 3.6 结论必须带证据等级

科研项目中最危险的事情之一，是把初步观察写成稳定结论。

所以任何实验结论进入 GitHub 时，都应该同时带上：

- Artifact ID：它对应哪个本地事实。
- Evidence level：这个证据有多可靠。
- Claim scope：这个说法可以传播到什么范围。

---

## 4. MCP、Skill、Plugin、Extension UI 的关系

### 4.1 MCP 是能力层

MCP 提供 agent 可以调用的真实工具能力。

Research Memory MCP 负责：

- 读写 `.agent/artifacts.yml`。
- 生成 GitHub 同步草稿。
- 生成 `status.html`。
- 生成实验卡片和决策记录草稿。
- 检查 risk / evidence / claim scope。
- 读取 GitHub feedback。
- 在确认后创建 issue、comment 或 PR。

它应该放在：

```text
packages/workers/research-memory/
```

原因：

- 这是纯 Node 后端能力。
- 它可能需要缓存 GitHub feedback 或 artifact index。
- 它需要给 Kun、Codex、Claude Code 等不同 agent runtime 复用。
- 它属于 agent/MCP 工具面，不应该写进 renderer 或某个 runtime 私有逻辑。

### 4.2 Skill 是行为层

Skill 负责教 agent 如何使用 Research Memory MCP。

Skill 应说明：

- 什么时候应该同步到 GitHub。
- 什么时候只保留本地。
- 如何避免夸大科研结论。
- 如何使用 artifact ID、evidence level、claim scope 和 risk level。
- 中高风险内容必须先让学生确认。
- 不得自动合并 PR、关闭重大 issue 或发布 public claim。

Skill 不负责执行真实操作。真实操作必须由 MCP 工具完成。

### 4.3 Plugin 是分发层

Plugin 可以作为安装入口，把 MCP 和 Skill 打包给用户。

但是 plugin 不等于 UI，也不等于核心能力。

MVP 不需要为 Research Memory 做 extension UI。后续如果需要，可以通过 plugin marketplace 提供“一键启用 Research Memory MCP + Skill”。

### 4.4 Extension UI 是最后手段

只有当某个步骤必须人类交互，并且 chat、GitHub issue、GitHub PR 都无法承载时，才考虑 extension UI。

MVP 不做：

- artifact 浏览器。
- status dashboard。
- feedback inbox。
- PR 草稿管理面板。
- 项目记忆看板。

这些功能会让主应用变重，而且 GitHub 与 agent chat 已经能承担大部分交互。

---

## 5. 宏观架构

整个系统分三层。

```text
┌──────────────────────────────┐
│ Local Workspace               │
│ 完整事实：数据、代码、日志、轨迹 │
└───────────────┬──────────────┘
                │
                v
┌──────────────────────────────┐
│ Research Memory MCP           │
│ artifact、policy、draft、HTML  │
└───────────────┬──────────────┘
                │
                v
┌──────────────────────────────┐
│ GitHub Project Memory         │
│ issue、PR、status.html、记录   │
└──────────────────────────────┘
```

### 5.1 Local Workspace

Local Workspace 是科研生产现场。它可以在学生电脑、本地服务器或实验室集群上。

这一层保存完整事实，不直接暴露给 GitHub。

### 5.2 Research Memory MCP

Research Memory MCP 是中间层。

它维护本地 artifact index，生成同步草稿，执行安全检查，并在学生确认后把合适内容同步到 GitHub。

它不拥有科研结论的最终解释权，只提供工具和检查。

### 5.3 GitHub Project Memory

GitHub Project Memory 是合作者看到的协作界面。

它应该足够完整，让一个不看本地工作区的人也能理解项目状态；但又必须足够克制，不泄露重资产、敏感信息和未经确认的强结论。

---

## 6. GitHub 项目记忆的最小形态

MVP 仓库结构应该少而稳定。

```text
research-project-hub/
├── README.md
├── status.html
├── docs/
│   ├── log/
│   ├── experiments/
│   └── decisions/
└── .github/
    ├── ISSUE_TEMPLATE/
    └── PULL_REQUEST_TEMPLATE.md
```

### 6.1 README.md

README 是稳定入口，不需要频繁更新。

它回答：

- 这个项目是什么。
- 当前研究目标是什么。
- 合作者如何参与。
- 到哪里看当前状态。

README 应链接到 `status.html`。如果启用 GitHub Pages，则链接到渲染后的状态页；否则链接到仓库中的 HTML 文件和相关 PR。

### 6.2 status.html

`status.html` 是最重要的项目记忆页面。

它回答：

- 当前阶段是什么。
- 活跃假设是什么。
- 最近证据有什么变化。
- 正在进行或刚完成的实验是什么。
- 当前 blocker 是什么。
- 需要合作者帮助什么。
- 下一步需要做什么决定。

`status.html` 的规则：

- 由 Research Memory MCP 生成或更新。
- 默认静态 HTML。
- MVP 不需要 JavaScript。
- CSS 尽量少，可以内联。
- 输出要稳定，方便 PR diff。
- 不作为真实事实源，真实事实仍在本地 workspace 和 `.agent/artifacts.yml`。
- 所有实验或结论都必须链接 artifact ID。

### 6.3 docs/log/

记录周报或 milestone 总结。

它不追求完整复盘，只记录对合作者有帮助的压缩进展。

### 6.4 docs/experiments/

存放值得沉淀的实验卡片。

实验卡片不放完整日志，只放目标、方法摘要、结果摘要、局限性、evidence level 和 artifact ID。

### 6.5 docs/decisions/

存放重要且相对稳定的决策。

临时想法不要写成决策记录。只有当它影响后续方向、资源投入或解释项目状态时，才需要记录。

### 6.6 暂缓加入的内容

为了保持简单，以下内容不作为 MVP 的默认要求：

- `ROADMAP.md`：早期可先用 `status.html` 或 GitHub milestone 表达路线。
- `DECISIONS.md` 汇总页：决策变多后再自动生成。
- GitHub Projects：issue 和 PR 多到难以浏览后再启用。
- GitHub Discussions：开放式讨论明显多于任务型 issue 后再启用。

---

## 7. 信息模型

这套方案只需要四个核心字段：artifact ID、evidence level、claim scope、risk level。

### 7.1 Artifact ID

Artifact ID 用来连接 GitHub 摘要和本地事实。

示例：

```yaml
- id: EXP-014
  type: experiment
  title: Unseen species generalization experiment
  status: completed
  evidence_level: preliminary
  claim_scope: internal-summary
  visibility: github-summary-only
  local_ref: internal-only
  linked_github_issue: 23
  linked_github_pr: 41
```

GitHub 可以写：

```text
Artifact: EXP-014
```

但不应该写：

```text
/mnt/lab/server/private/project/runs/exp014
```

### 7.2 Evidence Level

Evidence level 描述结果本身有多可靠。

```text
observation     观察到的现象
preliminary     初步证据
reproduced      已复现证据
validated       已充分验证结果
```

规则：

- Agent 可以提出 evidence level。
- 学生必须确认进入 GitHub 正式记忆的 evidence level。
- `validated` 默认需要学生或导师确认。
- 摘要必须避免把初步结果写成最终结论。

推荐表达：

```text
EXP-014 提供了初步证据，表明在当前实验设置下方法 A 可能优于 baseline。

Evidence level: preliminary
Artifact: EXP-014
```

### 7.3 Claim Scope

Claim scope 描述这个说法可以传播到什么范围。

```text
local-note        只用于本地内部笔记
internal-summary  可进入 GitHub 内部协作摘要
public-claim      可对外公开主张
```

规则：

- `public-claim` 必须由人类确认。
- `public-claim` 不等于 `validated`，但通常应该有强证据支持。
- 未投稿核心创新、专利相关内容、合作方敏感内容，默认不得成为 `public-claim`。

### 7.4 Risk Level

Risk level 描述同步内容进入 GitHub 的风险。

```text
low       周报、非敏感 blocker、issue 状态回复、文档格式修正
medium    实验摘要、evidence level 更新、小幅状态变化、失败路线总结
high      强科学结论、重大路线转向、未投稿核心创新、投稿/专利/隐私/安全风险
```

默认处理：

- `low`：可以由 agent 生成草稿，学生快速确认。
- `medium`：默认走 PR，学生 review 后合并。
- `high`：agent 只能生成草稿和风险说明，必须由学生或导师确认。

---

## 8. 同步流程

### 8.1 什么时候同步

只有当本地事件改变以下任一状态时，才考虑同步：

1. 项目状态。
2. 证据状态。
3. 协作需求。
4. 决策状态。

应该同步：

- 关键实验完成。
- 某个假设被支持、削弱或否定。
- milestone 状态变化。
- blocker 出现或解决。
- 研究方向被暂停或恢复。
- 重要决策发生。
- 需要合作者输入。
- 周报或 milestone 总结到期。

不应该同步：

- 临时 debug。
- 没有结论的单次失败训练。
- 小参数调整。
- 原始日志。
- agent scratchpad。
- 重复性执行细节。

### 8.2 同步到哪里

```text
问题、建议、协作请求      → GitHub issue
低风险状态回复            → issue comment
当前正式项目状态          → PR 修改 status.html
值得沉淀的实验            → PR 新增/修改 docs/experiments/
重要方向性决策            → PR 新增/修改 docs/decisions/
周报或 milestone 总结      → PR 新增/修改 docs/log/
```

### 8.3 最小同步闭环

```text
学生本地工作
  ↓
Agent 调用 Research Memory MCP 记录 artifact
  ↓
MCP 生成 issue/comment/PR/status.html 草稿
  ↓
学生确认是否同步
  ↓
低风险反馈：issue/comment
正式记忆更新：PR
  ↓
合作者 review 或评论
  ↓
Agent 读取反馈，转成本地任务或回复草稿
```

---

## 9. 默认权限与安全边界

默认配置应该偏保守。

```yaml
agent_can_create_issue: true
agent_can_comment_when_mentioned: true
agent_can_create_pr: true
agent_can_update_status_via_pr: true
agent_can_modify_main_directly: false
agent_can_merge_pr: false
agent_can_close_major_issue: false
agent_can_mark_validated: false
agent_can_publish_public_claim: false
auto_merge_pr: false
human_required_for_medium_or_high_risk: true
human_required_for_validated_claim: true
human_required_for_public_claim: true
main_branch_requires_pr: true
```

解释：

- Agent 可以帮助创建协作入口，但不能替代学生决定正式状态。
- 正式项目记忆默认通过 PR 更新。
- main 分支应该使用 branch protection，避免绕过 review。
- 中高风险内容、public claim、validated 结论都需要人类确认。

---

## 10. GitHub 反馈如何进入本地

GitHub 不只是输出层，也是输入层。

Agent 应通过 Research Memory MCP 周期性读取：

- 新 issue。
- 新 comment。
- 新 PR。
- review comment。
- mention。
- 带有指定 label 的事项。

推荐 label：

```text
question
suggestion
experiment-request
bug
decision-needed
agent-draft
needs-student-review
risk-high
```

反馈分类：

```text
suggestion
bug
question
decision-request
collaboration-request
review-comment
experiment-request
```

处理方式：

- 低风险问题生成回复草稿。
- 有价值建议转成本地任务。
- 实验请求关联 artifact ID。
- 方向性问题加 `decision-needed`。
- 高风险或敏感问题升级给学生。

---

## 11. MCP 工具面

MVP 工具应少而清晰。

### 11.1 只读工具

```text
gui_research_memory_status
gui_research_memory_artifact_list
gui_research_memory_artifact_get
gui_research_memory_feedback_read
gui_research_memory_policy_check
```

### 11.2 本地写入工具

```text
gui_research_memory_artifact_upsert
gui_research_memory_draft_sync
gui_research_memory_write_experiment_card
gui_research_memory_write_decision_record
gui_research_memory_render_status_html
```

### 11.3 GitHub 写入工具

```text
gui_research_memory_create_issue
gui_research_memory_create_comment
gui_research_memory_prepare_pr
gui_research_memory_create_pr
```

这些工具必须支持 dry run 或 preview。真正写 GitHub 前必须有明确确认。

### 11.4 不提供的工具

```text
merge_pr
close_major_issue
mark_validated
publish_public_claim
```

这些动作应该保留给人类。

---

## 12. MVP 实现计划

第一阶段只做最小闭环：

```text
.agent/artifacts.yml
  → Research Memory MCP 生成 GitHub 草稿
  → 学生确认
  → issue/comment/PR
  → 合作者评论
  → agent 读取反馈
```

需要实现四个模块。

### 12.1 Local Artifact Index

能力：

- 创建 artifact ID。
- 记录 artifact 元数据。
- 关联 GitHub issue、PR 或文档。
- 按 ID 查询 artifact。

### 12.2 Draft / Policy / HTML Generator

能力：

- 根据本地事件生成 issue、comment 或 PR 草稿。
- 自动填入 artifact ID。
- 标注 evidence level、claim scope 和 risk level。
- 生成稳定、静态、可 diff 的 `status.html`。
- 提醒学生隐藏敏感细节。

### 12.3 GitHub Adapter

能力：

- 读取 GitHub issue、comment、PR 和 mention。
- 创建 issue、comment 或 PR。
- 创建分支并提交项目记忆文件。
- 在 PR 描述中包含检查清单。

GitHub auth 优先复用现有能力，例如 `gh` CLI、环境变量或用户已配置的 GitHub MCP。不要为了 MVP 先做复杂 token UI。

### 12.4 MCP Registration

能力：

- 提供 `packages/workers/research-memory` worker。
- 提供 Electron-as-Node 启动入口。
- 注册到 GUI-managed MCP registry。
- 让 Kun、Codex 等 runtime 可以复用同一套工具。

---

## 13. 后续增强

只有当 MVP 被实际使用后，再考虑增强。

可以后加：

- 自动 issue 分类。
- 周报草稿生成。
- 实验卡片生成。
- label-based feedback routing。
- GitHub Pages 发布辅助。
- 决策索引自动生成。
- 多 agent review。
- 更完整的本地 artifact registry。

不建议一开始就做：

- 完整项目管理平台。
- extension UI。
- 自动合并。
- 多 agent 治理层。
- 复杂权限状态机。
- 把所有本地轨迹同步到 GitHub。

---

## 14. 附录：最小模板示例

以下模板只是实现时的参考。核心方案不依赖模板细节。

### 14.1 PR Template

```markdown
## Summary

这次更新改变了什么？

## Artifact IDs

- EXP-014
- RUN-021

## Evidence / Claim / Risk

- Evidence level: observation / preliminary / reproduced / validated
- Claim scope: local-note / internal-summary / public-claim
- Risk level: low / medium / high

## Hidden Details

哪些细节不应该同步到 GitHub？

## Checks

- [ ] 包含 artifact ID
- [ ] 没有暴露本地路径、密钥或服务器信息
- [ ] 没有暴露合作方敏感信息
- [ ] evidence level 合理
- [ ] claim 没有被夸大
- [ ] 不看本地上下文也能理解
- [ ] 中高风险内容已由学生或导师确认
```

### 14.2 实验卡片

```markdown
# EXP-014: 实验标题

## Goal

本实验想验证什么。

## Method Summary

简要方法描述，不包含重日志和私有路径。

## Result Summary

简洁结果摘要。

## Evidence / Claim

- Evidence level: preliminary
- Claim scope: internal-summary

## Limitations

- 局限性 1
- 局限性 2

## Artifact Reference

Artifact ID: EXP-014
完整细节：local artifact index

## Next Step

下一步行动。
```

### 14.3 status.html 内容结构

`status.html` 第一版只需要表达项目状态，不需要复杂交互。

```text
Project title
Current phase
Active hypotheses
Recent evidence
Running / recent experiments
Blockers
Help wanted
Next decisions
Updated at
Artifact references
```

---

## 15. 参考 GitHub 原生能力

- GitHub Issues：用于计划、讨论和跟踪工作。
- GitHub Pull Requests：用于提议、review 和合并变更。
- GitHub Projects：当 issue 和 PR 数量增加后，用于 board、table 和 roadmap view。
- Branch protection：用于要求 PR review 和状态检查，避免直接修改 main。
- GitHub Pages：可选用于展示静态 `status.html`。

参考文档：

- https://docs.github.com/articles/about-issues
- https://docs.github.com/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests
- https://docs.github.com/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects
- https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- https://docs.github.com/pages
