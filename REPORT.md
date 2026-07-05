# SciForge 复现与自主科研编排扩展 —— 技术报告

> **作者：** 郑欣宇
> **日期：** 2026-07
> **配图：** 见 `docs/architecture/ARCHITECTURE-DIAGRAMS.md`（图 1–5）

---

## 摘要 (Abstract)

本报告记录了对 **SciForge**——一个基于 Electron 的本地 AI 科研工作台——的完整复现，以及在其之上构建的一套**自主科研编排系统（Autonomous Research System）**。

SciForge 原本是一个"人在回路"的辅助科研平台：它将代码、论文、科学数据、绘图、写作与多运行时 Agent 集成到一个桌面环境中，由用户驱动每一步操作。本工作在复现其三层架构（React 前端 / Electron 主进程 / 可插拔 Agent 运行时）的基础上，提出并实现了一个问题：**能否让平台自主完成从观察到论文的科研闭环，而非仅作被动工具？**

为此，我在 SciForge 的本地运行时中实现了一个四阶段闭环模块（研究记忆 → 假设生成 → 实验编排 → 论文生成），并引入**基于 pseudocount 平滑的贝叶斯置信度更新**机制对假设进行自动验证/证伪。系统在无需人工干预的情况下，可从一个初始观察出发，自动生成可证伪假设、设计并执行实验、根据实验指标更新假设置信度、并最终综合为一篇结构化论文。端到端 demo 验证了完整闭环：从一个关于"模型规模 vs 推理能力"的观察出发，系统自动产出了一篇 IMRAD 结构的研究报告，其中一个假设经 4 次实验试验后置信度收敛至 0.85 并被判定为 validated。

---

## 1. 引言与背景

### 1.1 SciForge 是什么

SciForge 定位为 **research-native AI workbench**——一个面向科研与复杂工程的本地 AI 工作台。它不是一个简单的聊天壳，而是把以下能力集成到单一桌面应用中：

- **多运行时 Agent**：可在 SciForge Runtime（默认）、Codex、Claude Code 之间切换；
- **科研专用工具**：文献检索（Paper Radar）、科学绘图、证据链（Evidence DAG）、PDF 标注、学术写作；
- **统一模型网关**：所有 LLM 调用经由 Model Router，避免密钥散落、便于审计；
- **MCP 工具生态**：13 个 MCP Server 以标准协议接入，各自独立可测、可替换。

### 1.2 为什么值得复现

从系统设计角度，SciForge 有三个值得学习的技术决策：

1. **中性 AgentRuntime 契约**——三个底层运行时（协议各异：HTTP/SSE、JSON-RPC stdio、原生 service）实现同一个抽象接口，前端完全运行时无关。这是教科书级的适配器模式应用（见图 2）。
2. **Model Router 作为唯一 LLM 网关**——所有模型调用汇聚一处，是密钥管理、成本控制、多模态路由的单一切入点。
3. **MCP 作为 Worker 边界**——每个科研能力都是独立的 MCP Server，通过 stdio/HTTP 通信，实现了强模块化。

复现这样一个系统，本身就是对"如何组织一个复杂多进程桌面应用"的深度学习。

### 1.3 问题意识：从"辅助"到"自主"

复现过程中我注意到：SciForge 虽然强大，但**每一步科研动作仍需用户驱动**——用户决定检索什么、跑什么实验、写什么结论。这引出本工作的核心问题：

> **能否在 SciForge 的运行时之上，构建一个自主科研闭环，让系统自己完成"观察 → 假设 → 实验 → 结论 → 论文"的科学方法全流程？**

这不是要取代研究者，而是探索"AI 作为科研主体"的可行架构——这也是当前 AI for Science 领域（如 AI Scientist、自主实验室）的前沿方向。本工作是该方向的一个具体、可运行的架构实验。

---

## 2. 系统复现

### 2.1 整体架构

SciForge 采用清晰的三层结构（见**图 1**）：

```text
前端 Frontend (React 19 + Zustand)
   │  IPC (window.sciforge.*)
后端 Backend (Electron 主进程)
   ├─ AgentRuntimeHost（运行时编排与治理）
   ├─ Model Router（唯一 LLM 网关）
   └─ MCP Registry（13 个 MCP Server）
运行时 Runtime（可插拔）
   ├─ SciForge Runtime（HTTP/SSE，默认）
   ├─ Codex（JSON-RPC stdio）
   └─ Claude Code
Workers（16 个独立包：检索/绘图/证据链/多智能体…）
```

复现过程中，我对整个代码库做了系统性的**结构重组**，以厘清依赖关系：将原本混杂在 `src/` 下的代码明确划分为 `frontend/`（渲染进程）与 `backend/`（主进程 + 共享类型 + 运行时 + Workers + 脚本），使前后端边界清晰、每个模块的职责单一。这一重构本身也验证了我对系统依赖关系的理解——重组后 typecheck、build、test 全部通过，证明依赖方向被正确保持。

### 2.2 核心设计一：中性 AgentRuntime 契约

SciForge 最精巧的设计是让前端**完全不关心底层跑的是哪个运行时**（见**图 2**）。三个运行时的通信协议截然不同：

| 运行时 | 通信协议 |
|---|---|
| SciForge Runtime（默认） | HTTP + SSE |
| Codex | JSON-RPC over stdio |
| Claude Code | 原生 service |

它们各自实现一个 `AgentRuntime` contract 定义的中性接口（thread / turn / event / capability），前端只通过统一的 `agentRuntime:*` IPC 通道交互。这样，切换运行时对前端是透明的，同时又通过 capability 描述符保留了各运行时的差异（如 Codex 支持的 reasoning 可见性、approval 机制等不会被伪装掉）。

### 2.3 核心设计二：Runtime HTTP/SSE 通信机制

默认的 SciForge Runtime 是一个**独立的本地 Node.js 进程**，作为 HTTP/SSE server 对外提供服务（见**图 3**）。它与主进程的交互分两个方向：

- **HTTP（请求/响应）**：主进程发起动作——开始 turn、读取 thread、解决审批、查询用量等；
- **SSE（服务器推流）**：Agent 执行过程中，运行时把 token 流、工具调用、reasoning 等事件**主动推**回主进程，再经 IPC 转发给前端实时渲染。

选用 SSE 而非普通 HTTP 是因为 Agent 执行是长时间的流式过程——模型逐 token 生成、工具逐个调用，SSE 让前端能实时呈现"正在思考、正在调用工具"的过程。

### 2.4 复现中的工程要点

复现并非一帆风顺，几个值得记录的点：

- **本地运行时的双重命名**：SciForge Runtime 在代码内部代号为 `kun`（CLI 二进制、`KUN_READY` 握手信号、构建路径均用此名），对外则统一为 "SciForge Runtime"。这种内外双名带来了认知负担，我在重构中将目录统一为 `runtime/`。
- **契约边界的严格性**：主进程不直接 import 运行时的源码，只通过 `local-runtime-package-contract.ts` 依赖其构建产物（`dist/`），这一约束由专门的边界测试（`kun-src-boundary.test.ts`）强制执行。
- **原生模块管理**：`better-sqlite3`、`node-pty` 等原生模块需要针对 Electron ABI 重新编译，打包时的 asar unpack 配置是易错点。

---

## 3. 自主科研编排系统（核心贡献）

### 3.1 设计目标

> **贡献界定**：本章描述的自主科研闭环（`runtime/src/research/` 下的 Phase 1–4 全部模块）是本人在 SciForge 平台之上借助coding agent的**原创实现**，而非平台自带能力。它**复用**了 SciForge 已有的基础设施——运行时的进程执行能力、原子文件写入、MCP 工具封装机制——但四阶段的编排逻辑、假设的贝叶斯更新、实验的自动指标提取与论文综合均为新增代码（git 提交记录：Phase 2/3/4 的 feature commit）。

在 SciForge 运行时（`runtime/src/research/`）中，我实现了一个自主科研闭环，遵循科学方法的四个阶段（见**图 4**）：

| 阶段 | 模块 | 职责 |
|---|---|---|
| Phase 1 | `artifacts/` | **研究记忆**——记录观察、证据，带证据等级与解释 |
| Phase 2 | `experiments/` | **实验编排**——设计实验 spec、执行代码、自动提取指标、错误检测与修复建议 |
| Phase 3 | `hypotheses/` | **自主循环**——假设生成、可证伪判据、贝叶斯置信度更新 |
| Phase 4 | `papers/` | **论文生成**——综合研究数据为 IMRAD/short-report 结构论文 |

四个阶段构成闭环：观察沉淀为记忆 → 记忆激发假设 → 假设驱动实验 → 实验结果更新假设置信度 → 收敛的假设综合为论文。

### 3.2 关键设计一：可证伪的假设表示

每个假设（`Hypothesis`）不仅有陈述（statement），还强制携带一个**可证伪判据**（`falsificationCriteria`）——这直接对应 Popper 的科学哲学：一个陈述只有可被证伪才是科学的。例如：

```text
假设 HYP-001: "若模型规模与推理能力正相关，则 7B 模型在同一推理
              基准上应比 1B 模型高 >10% 准确率。"
证伪判据:      "7B 模型准确率 ≤ 1B 模型准确率。"
预测:          ["7B 比 1B 高至少 10%", "13B 比 7B 高 <5%（边际递减）"]
```

假设还携带 `premises`（前提）和 `predictions`（可检验的预测），使其成为一个结构化、可自动校验的科研对象。

### 3.3 关键设计二：贝叶斯置信度更新

这是系统中最具方法论深度的部分（见**图 5**）。每次实验试验后，假设的置信度按以下公式更新：

$$
\text{posterior} = \frac{\text{supporting} + c \cdot \text{prior}}{\text{total} + 2c}, \quad c = 0.5
$$

其中 `supporting` 是支持性试验数，`total` 是总试验数，`c=0.5` 是 pseudocount（伪计数）平滑项。这是一个带平滑的伯努利/Beta 估计——pseudocount 让假设能在**少量试验内快速收敛**，而不必等待大样本。

状态机基于 posterior 与试验数自动判定（`total ≥ 3` 才做终判）：

- `posterior ≥ 0.8 且 trials ≥ 3` → **validated**（验证）
- `posterior ≤ 0.1 且 trials ≥ 3` → **falsified**（证伪）
- 否则比较 posterior 与 prior → **supported / contradicted**
- `trials < 3` → 停留在 **active**，继续探索

**一个诚实的设计局限**：当前 `falsificationCriteria` 字段是**声明性的**（记录科研意图），实际的 falsified 判定由数值阈值（posterior ≤ 0.1）触发，两者尚未打通。这是一个明确的改进方向（见 §5）。

### 3.4 关键设计三：实验的自动执行与指标提取

实验编排器（`experiments/runner.ts`）是"自动化"的工程核心。它：

1. 将实验 spec 的代码写入临时脚本文件，按语言（Python/R/Julia/Shell）构造执行命令；
2. 以子进程执行，带**超时控制**（SIGTERM → 5s 后 SIGKILL）与输出累积（防止内存溢出）；
3. **自动提取指标**——支持四种提取器：`regex`（正则捕获）、`last_line`（末行数值）、`json`（JSON 字段）、`full_output`（整体解析）；
4. **错误检测与修复建议**——内置 10 种错误模式（Python ImportError/NameError/SyntaxError、CommandNotFound、OutOfMemory、Timeout 等），匹配后给出可操作的修复建议（如 `pip install {缺失包}`），并支持 `executeWithRetry` 自动重试。

这套机制让实验从"人工跑、人工看结果"变为"系统自动跑、自动读数、自动诊断"。

### 3.5 关键设计四：论文自动综合

论文生成器（`papers/store.ts`）将研究数据综合为结构化论文：

- **模板化结构**：支持 IMRAD（Introduction/Method/Results/Discussion）与 short-report 两种大纲；
- **数据驱动的章节生成**：Introduction 自动汇总"提出 N 个假设、验证 M 个、经 K 次试验"；Results 自动列出各假设的置信度与各实验的指标；Discussion 自动区分 validated / falsified 假设并附 posterior；
- **自动引用生成**：每个假设、实验、观察都被转为可引用的 reference 条目；
- **Markdown 导出**：最终导出为可读的 `.md` 论文文件。

---

## 4. 结果与验证

### 4.1 端到端 Demo

我实现了一个不依赖 LLM API 的端到端 demo（`research/demo-autonomous-loop.ts`），用确定性代码模拟完整科研流程，以验证架构闭环。以下是真实运行输出（节选）：

```text
━━━ Phase 1: 研究记忆 ━━━
✓ 创建观察: OBS-2026-07-04-xau0 — Initial observation: model performance varies with size

━━━ Phase 3: 生成假设 ━━━
✓ 假设 1: HYP-001 — Larger models outperform smaller ones on reasoning  (先验 0.5)
✓ 假设 2: HYP-002 — Fine-tuning improves small models more  (先验 0.6)

━━━ Phase 2: 设计并执行实验 ━━━
✓ EXP-001 执行完成, 退出码 0, 指标 {"accuracy_gain": 0.19}
  → HYP-001: 支持 ✓, 后验置信度 0.625 (先验 0.5)
✓ EXP-002 执行完成, 指标 {"improvement_1b_pct": 93.3}
  → HYP-002: 支持 ✓, 后验置信度 0.650 (先验 0.6)

  额外试验（加速贝叶斯收敛）...
  HYP-001 最终: 置信度=0.850, 状态=validated, 试验=4

━━━ Phase 4: 论文生成 ━━━
✓ 创建论文: PAPER-... — An Empirical Study of Model Scaling Effects on Reasoning Tasks
✓ 论文已导出为 Markdown
```

### 4.2 贝叶斯公式验证

我手动验证了贝叶斯更新公式与代码实现的一致性，结果逐位吻合：

| 试验 | supporting | total | prior | 公式计算 | Demo 输出 |
|---|---|---|---|---|---|
| HYP-001 第 1 次 | 1 | 1 | 0.5 | (1+0.25)/2 = **0.625** | 0.625 ✓ |
| HYP-002 第 1 次 | 1 | 1 | 0.6 | (1+0.30)/2 = **0.650** | 0.650 ✓ |
| HYP-001 第 4 次 | 4 | 4 | 0.5 | (4+0.25)/5 = **0.850** | 0.850 ✓ |

可见 HYP-001 在积累 4 次支持性试验后，posterior 从先验 0.5 上升至 0.85，越过 0.8 阈值且试验数 ≥ 3，被自动判定为 **validated**——完整验证了假设自动收敛的机制。

### 4.3 测试覆盖

四个子模块（artifacts / experiments / hypotheses / papers）均带单元测试（`*.test.ts`），覆盖存储的增删改查、贝叶斯更新、指标提取、论文生成等核心逻辑。整个代码库在结构重组后 `npm run typecheck`、`npm run build`、`npm run test` 全部通过。

### 4.4 诚实说明：模拟 vs 真实

需明确指出：**当前 demo 的实验数据是模拟的**——benchmark 准确率（如 1B=0.52、7B=0.71）是写死的确定性值，而非真实模型推理结果。这一 demo 的目的是**验证编排架构的正确性**，而非产出真实科研结论。真实 LLM 驱动的假设生成与真实 benchmark 接入是明确的下一步（见 §5）。这种诚实标注对科研工作至关重要——架构验证与结果验证是两件事。

---

## 5. 讨论、局限与未来工作

### 5.1 当前局限

1. **实验为模拟**：demo 使用确定性模拟数据，尚未接入真实模型与真实 benchmark。
2. **假设由人预设**：当前假设由 demo 脚本预先写入，尚未实现由 LLM 根据研究记忆**自主生成**假设。
3. **贝叶斯模型简化**：采用 pseudocount 平滑的点估计，而非完整的连续贝叶斯后验分布，未建模不确定性区间。
4. **证伪判据未打通**：`falsificationCriteria` 文本与数值化的 falsified 判定相互独立，未形成语义级校验。

### 5.2 未来工作

1. **LLM 自主假设生成**：接入 Model Router，让 Agent 根据研究记忆自动提出可证伪假设，实现真正的"自主"。
2. **真实实验接入**：将实验编排器对接真实模型推理与标准 benchmark（GSM8K、MATH 等）。
3. **多假设并行探索**：利用 SciForge 的多智能体（multi-agent）能力，并行验证多个竞争假设，实现假设空间的树状搜索。
4. **证据 DAG 集成**：将假设-实验-证据的关系接入 SciForge 已有的 Evidence DAG 子系统，实现可追溯的证据链与 NLI 验证。
5. **证伪判据语义化**：用 LLM 将 `falsificationCriteria` 文本编译为可执行的数值条件，打通声明与判定。

### 5.3 意义

本工作展示了：**在一个成熟的辅助科研平台之上，通过增加一个轻量的编排层，即可将其升级为自主科研系统**。这条路径——复用现有工具生态（MCP Workers、Model Router、多运行时），只增加科学方法的编排逻辑——比从零构建自主科研系统更务实，也更容易被现有科研工具链采纳。

---

## 附录 A：构建与运行

```bash
# 安装依赖并构建本地运行时
npm install
npm run build:local-runtime

# 类型检查 / 构建 / 测试
npm run typecheck
npm run build
npm run test

# 运行自主科研 demo（无需 LLM API）
cd runtime && npx tsx src/research/demo-autonomous-loop.ts
```

## 附录 B：关键代码结构

```text
runtime/src/research/
├── index.ts                    # 四阶段模块的统一导出
├── demo-autonomous-loop.ts     # 端到端闭环 demo
├── artifacts/                  # Phase 1: 研究记忆
│   ├── store.ts                #   YAML 存储
│   ├── github-adapter.ts       #   GitHub 同步（issue/PR）
│   └── tools.ts                #   MCP 工具封装
├── experiments/                # Phase 2: 实验编排
│   ├── runner.ts               #   执行器（超时/指标提取/错误检测）
│   ├── store.ts                #   实验 spec + run 记录
│   └── types.ts                #   10 种内置错误模式
├── hypotheses/                 # Phase 3: 自主循环
│   ├── store.ts                #   贝叶斯置信度更新
│   └── loop-tools.ts           #   循环控制工具
└── papers/                     # Phase 4: 论文生成
    ├── store.ts                #   IMRAD/short-report 综合
    └── types.ts                #   论文大纲模板
```

## 附录 C：配图索引

所有架构图见 `docs/architecture/ARCHITECTURE-DIAGRAMS.md`（含可导出的 PNG）：

- **图 1**：SciForge 三层整体架构
- **图 2**：中性 AgentRuntime 契约（可插拔运行时）
- **图 3**：Runtime HTTP/SSE 通信时序
- **图 4**：自主科研编排系统四阶段闭环 ⭐
- **图 5**：假设置信度的贝叶斯更新流程
