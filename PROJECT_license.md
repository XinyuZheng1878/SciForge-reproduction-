# SciForge 历史商业使用风险清理任务板

更新时间：2026-06-27

> 当前项目许可证为 [MIT](./LICENSE)。本文档保留此前围绕商业使用风险清理形成的工程证据、决策和验收记录；当前对外发布应以根 `LICENSE` 为准。

## 当前目标

清理从 Kun 改为非商用许可证后引入或精确命中的代码、资产与依赖风险，并保留可审计的许可证证据链。

本任务板只管理商业使用风险清理。实现时优先删除或重写风险来源，不保留旧兼容旁路；每完成一个切片后必须重新跑 exact blob 扫描和相关测试。

本轮用户已确认：先清当前 `HEAD` 和最终源码包，不先重写 git 历史；公开完整历史时通过发布说明标注风险边界。Workflow 功能保留，但必须重写为最小可用新版本。模型能力全部走 Model Router，由用户自配 provider 或远端服务。来源不明资产直接替换或移除。NOTICE 先做到足够可审计，再逐步自动化。

---

## 不可变原则

- 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- 所有修改必须通用，不能为特色例子写硬编码补丁。
- LLM API 只能走 model router。
- 相同功能的工作链路需要统一，不要额外生出旁路;删除冗余,代码尽可能精简

---

## 风险基线

- [x] 固化 Kun MIT 边界：以 `5472bed3b878854d296851820834145f5fe1a353^` / `363fdf566657cd4d60801f62b0b8f3aa8dfbf2fc` 作为改证前最后 MIT tree。
- [x] 固化当前发布目标：先清理 `DeepSeek-GUI` 当前 `HEAD` / 工作树和最终源码包，不先改写 git 历史。
- [x] 记录当前 exact-hit 基线：`2026-06-26T17:29:08.869Z` 本地扫描显示当前 `HEAD` 有 11 个文件 / 11 个 blob 精确匹配 Kun 改证后历史、且不在改证前 MIT tree 中；并行清理前工作树还有 2 个文件 / 2 个 blob 命中。
- [x] 记录历史/其它 ref 基线：初始扫描显示 `all refs exact hits` 为 24 个 unique blob / 24 个 path hit；清理后开发仓库最新扫描为 23 个 all-ref blob，其中 12 个仅历史或其它 ref 命中；这些历史 refs 不进入商业源码包。
- [x] 建立可重复的本地扫描命令或脚本，输出 `current HEAD exact hits`、`worktree exact hits`、`all refs exact hits` 三类结果：见 [docs/license-risk-scan.md](docs/license-risk-scan.md) 与 `scripts/license-risk-scan.mjs`。

## 已确认决策

- [x] 发布边界选择 A+C：本轮只清当前 `HEAD`、工作树和最终源码包；暂不重写完整 git 历史，但发布说明需要明确源码包不包含历史风险 blob。
- [x] Workflow 策略选择 B：保留 workflow 功能，但删除当前 exact-hit 实现，重写为最小可用新版本。
- [x] 小文件 exact-hit 全部重写：不因低风险而保留命中 blob，验收目标统一为当前发布包 exact-hit 为 0。
- [x] 模型/服务策略：商业包不内置许可证不确定的模型能力；全部 LLM 能力经 Model Router，由用户自配 provider 或远端服务。
- [x] 资产策略：无法确认来源、商标或商业授权的图片、视频、logo、截图直接替换或移除。
- [x] NOTICE 策略：第一版先做足够可审计的 `NOTICE` / `THIRD_PARTY_NOTICES`，覆盖实际分发内容，后续再自动化生成。

## 当前 HEAD 精确命中清理

- [x] 删除当前 workflow exact-hit 实现，重写最小可用 workflow editor：保留创建、编辑、连接、运行、查看结果这些核心能力，其余旧复杂功能不做兼容迁移。
- [x] 重写 `src/renderer/src/components/workflow/WorkflowEditorView.tsx`，按当前产品需求重新组织组件、状态和交互，不沿用命中 blob 的结构。
- [x] 重写 `src/renderer/src/components/workflow/ModelPicker.tsx`，模型选择只能复用现有 Model Router/provider 配置链路，不新增直接 provider/API key/model 旁路。
- [x] 重写 `src/renderer/src/components/workflow/WorkflowRunHistory.tsx`，运行历史展示只保留一条 canonical workflow run 数据链路。
- [x] 重写 `src/renderer/src/components/workflow/WorkflowRunLogPanel.tsx`，实时日志展示与运行历史共用同一结果模型，不新增并行状态源。
- [x] 重写 `src/shared/workflow-dsl.ts`，重新定义通用导入/导出 schema 与校验流程，并禁止携带 secret。导出/导入统一走 portable workflow 净化：禁用运行态、清空 history/status，并置空 secret env 值。
- [x] 重写 `src/renderer/src/styles/workflow-canvas.css`，样式按当前 design token 重新组织，不沿用命中 blob 的结构与注释表达。
- [x] 重写 `kun/src/contracts/attachments.ts` 的 attachment schema，保留当前必要字段，但重新组织命名、校验和类型边界。
- [x] 重写 `kun/src/server/routes/attachments.ts` 的 upload/read/diagnostics 路由胶水，复用现有通用 JSON/body/auth/error helper，不新增本地 HTTP 旁路。
- [x] 重写 `src/renderer/src/components/terminal/terminal-session.ts`，保留 workspace 隔离目标，但实现为项目内通用 terminal session id helper。
- [x] 重写 `src/renderer/src/components/terminal/terminal-session.test.ts`，按新 helper 行为重新覆盖 workspace 隔离、稳定性和长路径场景。
- [x] 重写 `src/shared/write-retrieval.ts`，保留 Write retrieval 对外契约所需类型，但重新收敛到当前 write-assist / model-router 统一链路。

## 历史/其它 ref 命中处理

- [x] 列出全 refs 中的 post-change exact blob，标注所在 ref、首次引入提交和是否仍会进入发布包：`node scripts/license-risk-scan.mjs` 最新输出 23 个 all-ref unique blob，其中 12 个不在当前 `HEAD` exact-hit 集合中；实际源码包隔离扫描为 0。
- [x] 本轮不重写完整 git 历史；历史/其它 ref 命中不阻塞当前源码包清理。
- [x] 发布说明中明确：发布源码包基于清理后的 tree，历史 refs 中的 post-change exact blob 不进入发布包。见 [docs/commercial-release-boundary.md](docs/commercial-release-boundary.md)。
- [x] 对 `write-pdf-text-service*`、`write-retrieval-service*`、`WorkflowNodes`、`workflow-types`、`app-settings-workflow`、`workflow-output-descriptors` 等历史命中确认当前 HEAD 是否已重写或删除。最新扫描中这些文件只出现在 historic-only 集合；隔离源码包扫描 all refs 为 0。
- [x] 发布前对实际导出的源码包重新跑 exact-hit 扫描，确保不受本地 refs 或未跟踪文件影响。已按 `docs/commercial-release-boundary.md` 导出临时源码包，扫描结果：`current HEAD exact hits: 0`、`worktree exact hits: 0`、`all refs exact hits: 0`、`historic-only exact hits: 0`。

## 来源与许可证元数据

- [x] 给 root `package.json`、`kun/package.json` 和 workspace packages 明确 `license` 或 `private`，避免 npm 元数据与根 `LICENSE` 不一致。当前项目自有包统一使用 `MIT`，并同步 root、Kun 与相关 package lockfile 中的包元数据。
- [x] 新增 `NOTICE` 或 `THIRD_PARTY_NOTICES`，覆盖 npm 依赖、Electron/Chromium、native 模块、字体、图片、视频和 vendored 代码。已新增 `THIRD_PARTY_NOTICES.md` 作为当前源码包的第三方审计入口。
- [x] 确认 `vendor/openclaw-shim` 是否完全自写；若有上游派生，补版权和许可证声明。当前文件为项目本地兼容 shim，已标注 `private: true`、`license: MIT` 和 provenance；若未来拷入上游实现，需另补上游声明。
- [x] 确认 README 中 Reasonix、OpenHanako、LobsterAI 相关描述是否仅为思想/设计参考；如存在代码派生，补来源许可证或重写。已把高风险措辞改为 reference/inspiration only，并在 `THIRD_PARTY_NOTICES.md` 记录无源码、测试、资产复制。
- [x] 确认 `src/asset/img` 下图片、视频、logo、截图的来源和商标授权；无法确认的素材直接替换为自有或可商用素材，或从商业包移除。已删除 DeepSeek/Feishu 品牌素材和来源不明视频；按项目 owner 偏好恢复旧 SciForge 图标与 `code.gif` 演示资产，其余保留插图为自生成资产，并由 `src/asset/img/README.md` 记录 provenance。
- [x] 确认 `plugins/paper-radar-service` 与 `plugins/vision-router-service` 的授权状态是否符合分发目标；若随产品发布，改为明确项目内授权或私有不分发。当前已使用 `private: true` + `MIT`，并在 package metadata 与 `THIRD_PARTY_NOTICES.md` 中写明不作为公共 npm 包发布。

## 模型与服务链路合规

- [x] 确认 GUI-Owl、Qwen3-VL、Esm2Text、Prot2Text、BioT5+、C2S-Scale 等模型权重许可证允许目标商业使用、服务端调用和再分发。当前商业包不分发这些模型权重，也不默认启动本地权重服务；安装包审计未发现 `.safetensors` / `.gguf` / `.onnx` / `.pt` / `.pth` / `.ckpt` / `.mlmodel` / `.tflite` 等模型权重类文件。用户自配 provider 或远端服务的商业授权由用户/部署方确认。
- [x] 模型能力分发策略：全部走 Model Router，由用户自配 provider 或远端服务。
- [x] 若模型许可证不允许商业使用或无法确认，默认禁用对应内置能力；商业包不分发权重、启动脚本或默认连接配置。已将 GUI computer-use 改为只调用 Model Router `/v1/responses`，本地 GUI 模型 serve helper 和 sci-modality 本地 expert provider 默认拒绝启动，必须显式 opt-in 并提供外部 licensed weights；vision translator 不再默认具体模型。
- [x] 视觉、多模态、写作、workflow 等所有 LLM 调用重新核对，只能经 Model Router 统一出口。已用 `rg` 核对本切片及 write/workflow 主链路：workflow/write/speech 使用 `buildModelRouterResponsesUrl`，GUI computer-use 使用 `CUA_MODEL_ROUTER_*`，sci-modality 仅由 Model Router 通过 `SCIFORGE_SCIMODALITY_SERVICE_URL` 调用；剩余 `/chat/completions` 位于 Model Router 内部 provider hop、managed translator worker 内部 provider hop或相关测试。
- [x] 删除任何绕过 Model Router 的默认 provider 链路；确需保留的服务只能作为 Model Router 管理的 translator/worker。已移除 GUI computer-use 旧 `CUA_MODEL*` / `CUA_GROUNDER*` 默认链路，vision-router-service 改为无默认模型的 managed worker，sci-modality provider/deploy 脚本加 `SCIFORGE_ENABLE_LOCAL_EXPERT_PROVIDER=1` license gate，Model Router manifest 增加 `scientific_translation` 能力。

## 验收标准

- [x] 当前发布 commit 的 `HEAD` 与工作树对 Kun 改证后历史的 exact blob 命中为 0，改证前 MIT tree 已有 blob 不计入风险。当前发布清理 `HEAD` 扫描结果：`current HEAD exact hits: 0`、`worktree exact hits: 0`。
- [x] 最终源码包 exact blob 命中为 0，并附扫描输出。隔离源码包临时仓库扫描结果：`current HEAD exact hits: 0`、`worktree exact hits: 0`、`all refs exact hits: 0`、`historic-only exact hits: 0`。
- [x] `rg -i "polyform|noncommercial|non-commercial|commercial use|agpl|gpl|cc-by-nc|commons clause|sspl|business source"` 无未解释的高风险命中。已解释命中：ChatNT non-commercial 明确标为 unsupported；`jszip` dual license 使用 MIT 选项；模型 commercial-use 文案为发布 gate；`existingPlan` / `browserAddressPlaceholder` / lockfile integrity 为字符串误命中。
- [x] `npm run typecheck` 通过。
- [x] 与被改动功能相关的 targeted tests 通过；若删除 workflow 功能，删除或更新只覆盖旧链路的测试。已通过：workflow/runtime tests、terminal/write/IPC targeted tests、Kun attachment test、Model Router 92 tests、sci-modality 13 tests + typecheck、vision-router 8 tests + typecheck、GUI computer-use contract 10 tests。
- [x] 完整 `npm test` 在发布前通过。最新结果：226 个 test files / 1713 个 tests 全部通过。
- [x] 最终安装包重扫依赖、NOTICE、二进制和资产清单，结果归档到本任务板。已构建 `release/license-audit-20260627-015621/SciForge-0.1.0-mac-arm64.dmg` 并运行 `node scripts/package-release-audit.mjs --target release/license-audit-20260627-015621`：required notices present，legacy risky media names 0，model-weight-like files 0，findings none；native binaries 与 media assets 已输出清单。

## 执行顺序建议

- [x] 第一阶段：先清理当前 HEAD 的 11 个 exact-hit 文件，优先重写最小可用 workflow 功能。工作树 exact-hit 已为 0；发布 commit 后复跑 HEAD gate。
- [x] 第二阶段：补许可证元数据、NOTICE、vendored 和资产来源。
- [x] 第三阶段：核模型/服务链路，确保 LLM API 只走 Model Router。
- [x] 第四阶段：处理历史/其它 ref 的 post-change blob 风险。本轮选择不重写完整 git 历史，已用源码包边界文档和隔离源码包扫描隔离风险。
- [x] 第五阶段：对源码包和安装包做最终扫描与测试归档。源码包 strict 扫描、完整 `npm test`、mac arm64 安装包构建与 package audit 均已完成并归档在本任务板。
