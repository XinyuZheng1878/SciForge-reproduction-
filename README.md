<p align="center">
  <img src="src/asset/img/logo.png" width="96" alt="SciForge 图标">
</p>

# SciForge

[English](./README.en.md) | 简体中文

> SciForge 是面向科研与复杂项目的本地 AI 工作台：把代码、论文、数据、写作、手机入口和可审计工作流放进同一个桌面环境，并让所有模型调用统一经过 Model Router。

[官网](https://sciforge.ai) | [下载](https://sciforge.ai)

[![GitHub release](https://img.shields.io/github/v/release/XingYu-Zhong/SciForge?label=github)](https://github.com/XingYu-Zhong/SciForge/releases)
[![License](https://img.shields.io/github/license/XingYu-Zhong/SciForge)](./LICENSE)

<p align="center">
  <a href="src/asset/img/code.gif">
    <img src="src/asset/img/code.gif" width="720" alt="SciForge Code 工作台演示">
  </a>
</p>

## 为什么做 SciForge

科研和复杂工程已经不再是一段聊天可以完成的事情。一个真实任务里通常同时出现论文、代码、实验数据、图表、日志、软件界面、手机消息、第三方工具、失败记录和后续计划。通用聊天窗口能回答问题，却很难把这些对象组织成一个长期可追踪、可复盘、可交接的工作环境。

SciForge 的目标是做一个 **research-native AI workbench**。它仍然保留通用 Agent 的自由度，但把长期科研工作需要的几件事变成默认结构：

- **统一入口**：Code、Workflow、Write、连接手机和定时任务共享同一套 Agent Runtime 与设置治理。
- **统一模型出口**：所有 LLM 能力进入本地 Model Router，再由用户配置 provider、alias、密钥和远端服务。
- **统一证据轨迹**：文件改动、工具调用、命令输出、运行日志、审批动作和失败原因都尽量留在可审查的记录里。
- **统一本地边界**：工作区、设置、运行时数据和中间产物默认保留在本机；远端调用只发生在用户显式配置的 provider 链路里。
- **统一发布边界**：源码、资产、依赖、模型权重和第三方参考来源有单独的审计文档与发布前检查。

这不是一个“聊天壳”。SciForge 更像一张科研工作台：你把项目放上来，让 Agent 帮你读、写、运行、验证、记录和继续推进。

## 独特性

| 能力 | SciForge 的取向 |
| --- | --- |
| 科研工作台 | 同时承载代码库、论文、数据、实验脚本、证据链、报告草稿和长期任务状态。 |
| Model Router | 模型 API 只有一个治理出口，provider、base URL、token 和模型 alias 由用户自配。 |
| Workflow | 用可视化节点把搜索、LLM、HTTP、代码、条件、循环、合并、人工审批和输出串成可复跑流程。 |
| Write | 独立 Markdown 写作空间，支持 live 编辑、导出、选区 inline agent、短补全和跨文档检索增强。 |
| Connect phone | 把桌面 Agent 接到飞书 / Lark / 微信和定时任务，让科研助手不只停留在桌面聊天里。 |
| 本地 runtime | SciForge Runtime 在本机托管 agent loop、工具调用、缓存纪律、事件流和长期会话。 |
| 发布边界 | 通过 THIRD_PARTY_NOTICES、license scan、package audit 和资产来源记录管理许可证风险。 |

## 工作台组成

### Code：项目与科研任务入口

Code 是 SciForge 的主工作台。你可以选择本地工作目录，让 Agent 围绕真实项目读取文件、运行命令、修改代码、总结结构、排查错误、生成计划和审查改动。

它适合这些任务：

- 维护一个真实代码库，而不是复制片段到聊天窗口。
- 复现论文、整理实验脚本、分析失败日志和补齐缺失步骤。
- 在同一个线程里保留需求、计划、命令输出、文件改动和后续 Todo。
- 用 `/plan`、`/review`、`/goal`、旁支对话和会话压缩管理长周期工作。
- 在 diff 面板里检查 Agent 产生的文件改动，再决定继续、修正或提交。

### Workflow：把科研操作变成可复跑流程

Workflow 面向那些不该每次重新手写 prompt 的任务。它把触发器、模型节点、数据处理、HTTP 请求、代码执行、条件分支、循环、合并、人工审批和输出节点放到同一张图上。

它的重点不是堆功能，而是让工作链路可治理：

- LLM 节点只使用 Model Router 提供的模型出口。
- 节点运行有实时日志、历史结果和错误状态，便于复盘。
- 手动触发、计划触发和 webhook 触发共享同一套 workflow 数据结构。
- 可复用流程可以作为 MCP worker 暴露给 Runtime 或其它工具链。
- 旧逻辑和新目标冲突时，优先删除旧旁路，保持流程链路统一。

### Write：研究写作空间

Write 是独立于 Code 会话的写作工作台，面向论文笔记、综述草稿、实验记录、技术文档和研究报告。

它提供：

- `~/.sciforge/write_workspace` 与自定义写作空间管理。
- Markdown 文件树、新建、重命名、删除和保存状态。
- Live / Source / Split / Preview 编辑模式。
- 当前文档导出为 `HTML / PDF / DOC / DOCX`。
- 选中文本后唤起 inline writing agent。
- 经过 Model Router 的短补全和灵感长补全。
- 基于写作空间的 BM25 + 关键词检索，帮助模型延续术语、事实和风格。

### Connect phone：把 Agent 带到 IM 和定时任务

连接手机让 SciForge 不只等待用户在桌面输入。你可以为飞书 / Lark / 微信等渠道配置后台 Agent，让它在独立线程里处理消息、调用工具和执行计划任务。

典型用法：

- 给团队 IM 配一个科研助理或项目助理。
- 把 webhook / relay 接入个人自动化流程。
- 创建一次性、每日、间隔或手动运行的定时任务。
- 让后台任务记录 runtime id，避免不同运行时的线程映射混在一起。

### Model Router：模型能力的唯一出口

SciForge 的模型治理原则很简单：应用层不直接散落 provider API key、base URL 或默认模型权重。所有需要 LLM 的地方都走 Model Router。

Model Router 负责：

- 暴露本地 Responses-compatible 接口。
- 管理 public model alias、provider profile、runtime API key 和能力声明。
- 把 Code、Workflow、Write、语音、视觉、多模态 worker、computer-use 等入口收束到同一条模型链路。
- 支持用户自配 OpenAI-compatible provider 或远端服务。
- 让发布包不默认夹带特定闭源模型权重或第三方密钥。

这让 SciForge 可以在同一个桌面工作台里服务不同模型供应商，同时把审计边界放在一个地方。

## SciForge Runtime

SciForge Runtime 是默认本地 Agent 运行时。它以本地 HTTP/SSE 服务连接 GUI 和 agent loop，负责线程、事件、工具调用、审批、缓存、上下文整理和长期会话状态。

Runtime 的设计重点是 **高 Token ROI**：

- 稳定 system prompt、工具 schema 和不可变前缀，让 provider 缓存更容易命中。
- 对超长工具结果、长参数、base64 payload 和重复工具循环做边界压缩。
- 用 MCP search / describe / call 渐进发现工具，避免每轮都塞入完整工具目录。
- 记录 cache hit/miss、token 用量、事件状态和错误原因。
- 让 Code、Write、Workflow、连接手机和定时任务共享同一套运行时纪律。

高级用户可以显式选择 Codex app-server 作为可选运行时。Renderer 只消费中性的 thread、turn、event 和 capability；具体 runtime 差异留在 adapter 层。完整接口见 [docs/agent-runtime-contract.md](docs/agent-runtime-contract.md)。

简化架构：

```text
Renderer (React)
  -> preload: window.sciforge.*
  -> main: AgentRuntimeHost
  -> SciForge Runtime adapter
  -> local runtime service (HTTP + SSE)
  -> Model Router
  -> user-configured provider or remote service
```

更多运行时细节：

- [docs/local-runtime-architecture.md](docs/local-runtime-architecture.md)
- [docs/local-runtime-cache-optimization.md](docs/local-runtime-cache-optimization.md)
- [docs/local-runtime-contributing.md](docs/local-runtime-contributing.md)
- [SciForge Runtime 包 README](kun/README.md)

## 科研扩展能力

SciForge 的 worker 和插件体系把科研常用能力拆成可以单独启动、测试和审计的模块：

- `workflow`：可视化流程执行与 MCP facade。
- `write-assist`：写作辅助、导出和补全相关能力。
- `research-memory`：研究记忆、状态同步和证据记录。
- `paper-radar`：论文发现与研究线索收集。
- `evidence-dag`：证据关系、引用链和审查视图。
- `sci-modality-router` / `vision-router-service`：经 Model Router 管理的视觉与科学多模态 translator worker。
- `workspace-intel`、`runtime-inspector`、`search`、`schedule` 等 worker：为本地工作台补齐检索、巡检、调度和工作区理解能力。

这些模块的共同原则是：相同功能走统一链路，不额外生成绕过主链路的旁路；能由用户配置的 provider 和服务不写成内置硬编码。

## 可审计发布边界

SciForge 当前仓库使用 MIT 许可证发布。发布前仍需要确认源码、历史来源、资产、依赖、模型权重、服务配置和打包产物都处在可解释边界内。

本仓库为这件事保留了几类材料：

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：第三方依赖、参考来源和资产来源说明。
- [docs/license-risk-scan.md](docs/license-risk-scan.md)：Kun 历史 blob exact-hit 扫描方法。
- [docs/commercial-release-boundary.md](docs/commercial-release-boundary.md)：历史商业风险清理记录与当前发布边界说明。
- [src/asset/img/README.md](src/asset/img/README.md)：项目内图片资产来源与生成关系。
- `scripts/license-risk-scan.mjs`：源码 exact-hit 检查工具。
- `npm run license:package-audit`：安装包发布审计入口。

默认发布策略：

- 不在应用包中默认夹带第三方模型权重。
- 不在应用层硬编码 provider API key、base URL 或默认闭源服务。
- 外部参考项目只作为 reference / inspiration 记录，不复制源码、测试或资产。
- 资产、二进制和安装包在发布前重新扫描。

这不是法律意见，但它让发布前需要确认的事实尽量变成可复查的工程证据。

## 下载安装

### 预构建安装包

前往 [GitHub Releases](https://github.com/XingYu-Zhong/SciForge/releases) 下载：

| 平台 | 安装包 |
| --- | --- |
| macOS | `.dmg` 或 `.zip`，支持 Intel 与 Apple Silicon |
| Windows | `.exe`，NSIS 安装器，x64 |
| Linux | `.AppImage`，x64 |

首次启动时，建议先完成 Model Router 配置：设置本地 runtime API key、public model alias 和至少一个 provider profile。上游 provider 凭据只写入 Model Router 配置。

### 从源码运行

```bash
git clone https://github.com/XingYu-Zhong/SciForge.git
cd SciForge
npm install
npm run dev
```

环境要求：

- Node.js 20+
- 可用的上游模型 provider 或远端 Model Router 服务
- 首次安装依赖时需要联网

中国大陆访问较慢时，可以使用 npm 镜像：

```bash
npm install --registry=https://registry.npmmirror.com
```

## 常用命令

```bash
npm run dev                    # 开发模式
npm run typecheck              # TypeScript 检查
npm run test                   # 单元测试
npm run build                  # 生产构建
npm run dist:mac               # macOS 安装包
npm run dist:win               # Windows 安装包
npm run dist:linux             # Linux AppImage
npm run license:package-audit  # 安装包发布边界审计
```

常用 worker：

```bash
npm run model-router:start
npm run workflow:start
npm run write-assist:start
npm run research-memory:start
npm run schedule:start
```

## 首次使用

1. 打开 SciForge。
2. 选择界面语言。
3. 在设置页配置 Model Router。
4. 选择默认工作目录。
5. 在 Code 工作台创建线程，描述你的任务。
6. 按需进入 Workflow、Write 或连接手机继续扩展工作链路。

设置页还可以管理主题、字体、通知、运行时端口、sandbox、approval policy、Skill、MCP、Webhook、Relay、定时任务和错误日志。

## 卸载与本地数据

卸载应用不会默认删除本地设置、会话、工作区或运行时数据。彻底清理前请确认没有需要保留的研究记录。

| 平台 | 应用数据位置 |
| --- | --- |
| macOS | `~/Library/Application Support/SciForge` |
| Windows | `%APPDATA%\SciForge` |
| Linux | `~/.config/SciForge` |

SciForge Runtime 数据通常位于 `~/.sciforge/runtime` 或设置中指定的 runtime data dir。

macOS 本地未公证构建如果被系统拦截，可先运行：

```bash
npm run mac:unquarantine -- '/Applications/SciForge.app'
```

## 文档入口

| 文档 | 内容 |
| --- | --- |
| [docs/agent-runtime-contract.md](docs/agent-runtime-contract.md) | Runtime 中性 contract、事件、capability 和 adapter 边界 |
| [docs/local-runtime-architecture.md](docs/local-runtime-architecture.md) | SciForge Runtime 架构、HTTP/SSE 合约和 GUI 边界 |
| [docs/local-runtime-cache-optimization.md](docs/local-runtime-cache-optimization.md) | Token economy、缓存命中、MCP search 和工具输出压缩 |
| [docs/runtime-governance-design.zh-CN.md](docs/runtime-governance-design.zh-CN.md) | Runtime guard、公共治理层和多 runtime 接入原则 |
| [docs/license-risk-scan.md](docs/license-risk-scan.md) | 许可证风险 exact-hit 扫描流程 |
| [docs/commercial-release-boundary.md](docs/commercial-release-boundary.md) | 历史商业风险清理记录与当前发布边界 |
| [docs/CONTRIBUTING.zh-CN.md](docs/CONTRIBUTING.zh-CN.md) | 贡献说明 |
| [docs/DEVELOPMENT.zh-CN.md](docs/DEVELOPMENT.zh-CN.md) | 本地开发流程 |
| [SECURITY.md](SECURITY.md) | 安全漏洞披露方式 |

## 贡献

欢迎提交 bug 修复、UI/UX 优化、文档改进、本地化内容、worker 能力、构建发布流程和运行时集成改动。

协作建议：

- 日常集成分支为 `develop`，稳定发布分支为 `master`。
- 新功能和修复从最新 `develop` 拉出短期分支。
- PR 默认提交到 `develop`。
- 高风险改动先说明范围、验证方式和回滚策略。
- 发起 PR 前运行 `npm run typecheck`、`npm run test` 和必要的构建命令。
- 改动影响使用方式时，同步更新相关 README 或 docs。

## 致谢

SciForge 从多个先行项目和产品形态中获得启发。相关来源只作为 reference / inspiration 记录；当前仓库不复制这些项目的源码、测试或资产。具体说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢所有为 SciForge 提交 issue、建议、代码、测试、文档和研究反馈的人。

<a href="https://github.com/XingYu-Zhong/SciForge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=XingYu-Zhong/SciForge" alt="SciForge contributors" />
</a>

## 许可证

[MIT](./LICENSE)

## Star 历史

[![Star History Chart](https://api.star-history.com/chart?repos=XingYu-Zhong/SciForge&type=date&legend=top-left)](https://www.star-history.com/?repos=XingYu-Zhong%2FSciForge&type=date&logscale=&legend=top-left)
