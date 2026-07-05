# SciForge 架构图集（Report 配图）

> 本文件包含 5 张关键架构图，使用 Mermaid 语法。
> 在 VS Code（装 "Markdown Preview Mermaid Support" 插件）、GitHub、Typora 中可直接渲染。
> 导出 PNG/SVG：`npx @mermaid-js/mermaid-cli -i ARCHITECTURE-DIAGRAMS.md -o out.png`

---

## 图 1：SciForge 三层整体架构

> 用途：Report「系统复现」章节的开篇图，一眼看清整个平台的分层。

```mermaid
flowchart TB
    subgraph FE["前端 Frontend（React 19 + Zustand）"]
        UI["Workbench / Write / Plan / Chat<br/>渲染进程 UI"]
    end

    subgraph BE["后端 Backend（Electron 主进程）"]
        PRELOAD["Preload Bridge<br/>window.sciforge.*"]
        HOST["AgentRuntimeHost<br/>运行时编排与治理"]
        ROUTER["Model Router<br/>唯一 LLM 网关 /v1/responses"]
        MCP["MCP Registry<br/>13 个 MCP Server"]
    end

    subgraph RT["Agent 运行时（可插拔）"]
        SCIFORGE["SciForge Runtime<br/>HTTP/SSE server（默认）"]
        CODEX["Codex<br/>JSON-RPC stdio"]
        CLAUDE["Claude Code"]
    end

    subgraph WK["Workers（16 个独立包）"]
        W1["Search / Paper Radar"]
        W2["Scientific Plotting / Canvas"]
        W3["Evidence DAG / Multi-Agent"]
    end

    UI -->|IPC| PRELOAD
    PRELOAD --> HOST
    HOST --> SCIFORGE
    HOST --> CODEX
    HOST --> CLAUDE
    HOST --> ROUTER
    HOST --> MCP
    MCP --> WK
    SCIFORGE -->|LLM 调用| ROUTER
    ROUTER -->|用户配置的 Provider| PROVIDERS["外部模型<br/>Provider / Translator"]

    style FE fill:#e3f2fd,stroke:#1976d2
    style BE fill:#f3e5f5,stroke:#7b1fa2
    style RT fill:#e8f5e9,stroke:#388e3c
    style WK fill:#fff3e0,stroke:#f57c00
```

---

## 图 2：中性 AgentRuntime 契约（可插拔运行时）

> 用途：证明你理解了 SciForge 最核心的设计——前端与底层运行时解耦。

```mermaid
flowchart LR
    RENDERER["Renderer<br/>只消费中性接口<br/>thread / turn / event / capability"]

    CONTRACT{{"AgentRuntime Contract<br/>中性接口层"}}

    subgraph ADAPTERS["运行时适配器"]
        A1["SciForge Adapter"]
        A2["Codex Adapter"]
        A3["Claude Code Adapter"]
    end

    subgraph BACKENDS["底层运行时（协议各异）"]
        B1["SciForge Runtime<br/>HTTP + SSE"]
        B2["Codex app-server<br/>JSON-RPC / stdio"]
        B3["Claude Code Service"]
    end

    RENDERER <-->|"统一 IPC<br/>agentRuntime:*"| CONTRACT
    CONTRACT --> A1 --> B1
    CONTRACT --> A2 --> B2
    CONTRACT --> A3 --> B3

    style CONTRACT fill:#ffecb3,stroke:#ff6f00,stroke-width:3px
    style RENDERER fill:#e3f2fd,stroke:#1976d2
```

---

## 图 3：Runtime HTTP/SSE 通信时序

> 用途：讲清楚你之前问的「Runtime HTTP/SSE server」到底怎么工作。

```mermaid
sequenceDiagram
    participant R as Renderer（前端）
    participant M as Main Process
    participant RT as SciForge Runtime<br/>(HTTP/SSE server)
    participant MR as Model Router

    R->>M: IPC: startTurn(threadId, input)
    M->>RT: HTTP POST /threads/{id}/turns
    RT-->>M: 200 OK（turn 已创建）

    Note over RT: Agent Loop 开始执行

    RT->>MR: LLM 请求（流式）
    MR-->>RT: token 流

    loop 实时事件推送
        RT-->>M: SSE: token / tool_call / reasoning
        M-->>R: IPC 转发事件
        R->>R: 实时渲染 MessageTimeline
    end

    RT-->>M: SSE: turn_completed
    M-->>R: IPC: turn 完成
```

---

## 图 4：自主科研编排系统 —— 四阶段闭环 ⭐

> 用途：Report 核心章节配图，展示你的原创贡献。这是最重要的一张。

```mermaid
flowchart TB
    START(["研究目标<br/>Research Goal"]) --> P1

    subgraph P1["Phase 1：研究记忆 Artifacts"]
        OBS["记录观察 / 证据<br/>evidenceLevel + interpretation"]
    end

    subgraph P3["Phase 3：自主循环 Hypotheses"]
        HYP["生成假设<br/>+ 可证伪判据 falsificationCriteria<br/>+ 先验置信度 prior"]
    end

    subgraph P2["Phase 2：实验编排 Experiments"]
        EXP["设计实验 spec<br/>执行代码（Python/JS）<br/>自动提取指标 regex extractor"]
    end

    subgraph BAYES["贝叶斯更新"]
        UPDATE["记录试验结果<br/>prior → posterior<br/>支持 / 反驳"]
        DECIDE{"置信度收敛？"}
    end

    subgraph P4["Phase 4：论文生成 Papers"]
        PAPER["综合成 IMRAD 论文<br/>Introduction / Method /<br/>Results / Discussion"]
    end

    P1 --> P3
    P3 --> P2
    P2 --> UPDATE
    UPDATE --> DECIDE
    DECIDE -->|"未收敛<br/>继续试验"| EXP
    DECIDE -->|"validated / falsified"| P4
    P4 --> DONE(["导出 Markdown 论文"])

    style P1 fill:#e3f2fd,stroke:#1976d2
    style P2 fill:#fff3e0,stroke:#f57c00
    style P3 fill:#e8f5e9,stroke:#388e3c
    style P4 fill:#fce4ec,stroke:#c2185b
    style BAYES fill:#f3e5f5,stroke:#7b1fa2
    style DECIDE fill:#ffecb3,stroke:#ff6f00,stroke-width:2px
```

---

## 图 5：假设置信度的贝叶斯更新流程

> 用途：Report 中最有「研究味」的部分，展示方法论深度。
> 公式与阈值均与 `runtime/src/research/hypotheses/store.ts`（update 方法）一致。

```mermaid
flowchart TB
    subgraph INIT["初始化（create）"]
        PRIOR["status = draft<br/>prior = posterior = 0.5（默认）<br/>totalTrials = 0"]
    end

    subgraph TRIAL["每次 recordTrial"]
        RUN["执行实验并提取指标"]
        JUDGE{"指标满足<br/>预测阈值？"}
        SUPPORT["supporting += 1"]
        CONTRA["contradicting += 1"]
    end

    subgraph POST["贝叶斯后验更新（pseudocount = 0.5）"]
        CALC["posterior =<br/>(supporting + 0.5·prior)<br/>/ (total + 1)<br/>再裁剪到 [0, 1]"]
    end

    subgraph STATUS["状态判定（仅当 total ≥ 3 才终判）"]
        CHECK{"total ≥ 3 ？"}
        EARLY["active<br/>试验不足，继续探索"]
        V{"posterior ≥ 0.8 ？"}
        F{"posterior ≤ 0.1 ？"}
        VALID["validated ✓"]
        FALSE["falsified ✗"]
        MID["supported / contradicted<br/>（比较 posterior 与 prior）"]
    end

    PRIOR --> RUN
    RUN --> JUDGE
    JUDGE -->|是| SUPPORT
    JUDGE -->|否| CONTRA
    SUPPORT --> CALC
    CONTRA --> CALC
    CALC --> CHECK
    CHECK -->|否| EARLY
    CHECK -->|是| V
    V -->|是| VALID
    V -->|否| F
    F -->|是| FALSE
    F -->|否| MID
    EARLY -.->|下一轮 trial| RUN
    MID -.->|可继续 trial| RUN

    style PRIOR fill:#e3f2fd,stroke:#1976d2
    style CALC fill:#ffecb3,stroke:#ff6f00,stroke-width:2px
    style VALID fill:#c8e6c9,stroke:#388e3c
    style FALSE fill:#ffcdd2,stroke:#d32f2f
    style MID fill:#fff9c4,stroke:#f9a825
```

> **Report 写作提示（诚实标注，加分项）：**
>
> - 后验用的是带 **pseudocount 平滑的伯努利/Beta 估计**（`pseudocount=0.5`），
>   不是完整的连续贝叶斯推断——这是为了让假设能在少量试验内快速收敛。
> - `falsificationCriteria` 字段是**声明性的**（记录科研意图与证伪标准），
>   但**实际的 falsified 判定由数值阈值 `posterior ≤ 0.1 且 trials ≥ 3` 触发**，
>   两者当前未打通。这是一个诚实的局限，也是很好的「未来工作」点。
> - `total < 3` 时状态一律停在 `active`，这解释了 demo 为何要「额外跑 3 轮加速收敛」。

---

## 使用说明

**查看渲染效果：**

- VS Code：安装插件 "Markdown Preview Mermaid Support"，然后预览此文件
- GitHub：直接推送后在网页查看（原生支持 Mermaid）
- Typora / Obsidian：直接打开

**导出为图片（用于 Word/PPT report）：**

```bash
# 安装 mermaid CLI
npm install -g @mermaid-js/mermaid-cli

# 导出单张图（需先把某张图的 mermaid 代码存成 .mmd 文件）
mmdc -i diagram.mmd -o diagram.png -w 1600 -H 1200
```

**颜色含义：**

- 🔵 蓝色 = 前端 / 输入
- 🟣 紫色 = 后端主进程 / 贝叶斯核心
- 🟢 绿色 = 运行时 / 验证成功
- 🟠 橙色 = Workers / 关键决策点
- 🔴 红/粉 = 论文生成 / 证伪
