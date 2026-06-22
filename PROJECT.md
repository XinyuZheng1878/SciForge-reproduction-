# SciForge 品牌迁移任务板

更新时间：2026-06-22

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走 model router。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。
- [x] 子智能体只能由主 agent 在回合中通过 runtime 原生能力自动启动，GUI 不提供手动启动入口。
- [x] 第一版只展示当前 active thread 的 children，不展示环境信息分组。
- [x] 产品品牌统一为 SciForge；DeepSeek 仅作为可选 provider/model 名称保留。
- [x] DeepSeek provider 相关 API key、model id、兼容客户端、模型展示名和服务商配置不得被误改为 SciForge。
- [x] 用户可见产品身份、安装包、图标、窗口标题、文档和发布渠道统一切换到 SciForge。
- [x] 本地数据目录、协议名、secret header、router/provider id 等内部命名需要迁移方案，避免用户数据丢失。
- [x] 第一阶段只做品牌替换与兼容迁移，不改变现有 runtime、model router、插件和 agent 工作流能力。
- [x] 每个替换点都要能被搜索验证，保留 DeepSeek provider 的 allowlist。

## 新任务：SciForge 品牌替换与兼容迁移

目标：把项目从 DeepSeek GUI 品牌系统迁移为 SciForge，形成面向科学研究、特别是生命科学智能体的独立产品身份；同时继续支持 DeepSeek provider。

### 品牌范围盘点

- [x] 扫描 `DeepSeek GUI`、`DeepSeek-GUI`、`deepseek-gui`、`deepseekgui`、`DEEPSEEK_GUI`、`.deepseekgui` 等产品命名。
- [x] 将命中项分为用户可见品牌、发布/打包元数据、内部命名、兼容保留、DeepSeek provider 五类。
- [x] 建立 DeepSeek provider allowlist，覆盖 `DEEPSEEK_API_KEY`、DeepSeek model id、DeepSeek provider label 和兼容客户端。
- [x] 确认已有 SciForge 命名（model router、search、vision router、paper radar 等）与新品牌命名保持一致。

### Logo 与视觉资产

- [x] 以 `src/asset/img/logo.png` 作为新 SciForge 主 logo 输入资产。
- [x] 设计并生成应用图标、tray 图标、窗口图标、文档/README 展示图所需尺寸。
- [x] 评估是否需要补充 SVG/vector 版本，保证小尺寸、深浅背景和 macOS/Windows/Linux 打包效果。
- [x] 替换旧 `deepseek.png`、`deepseek.svg`、`deepseek_gui_tray.png` 的使用点。
- [x] 验证 Electron 窗口、系统托盘、安装包图标、启动加载态中均显示 SciForge 视觉资产。

### 应用身份与发布元数据

- [x] 更新 `package.json` 中的 `name`、`productName`、homepage、repository 等产品身份字段。
- [x] 更新 `electron-builder.config.cjs` 的 `appId`、`productName`、artifactName、图标路径和发布地址。
- [x] 确认 macOS bundle id、Windows 安装包、Linux AppImage 名称是否需要兼容旧版本升级。
- [x] 规划 `DEEPSEEK_GUI_*` 环境变量到 `SCIFORGE_*` 的迁移或兼容读取策略。
- [x] 更新 release、R2、auto-update、签名和打包脚本中的品牌名称。

### 主进程与系统集成

- [x] 替换窗口标题、通知标题、菜单、tray tooltip、日志前缀中的 DeepSeek GUI 产品品牌。
- [x] 更新 app user model id、协议/URL scheme、IPC/service 名称中属于产品身份的命名。
- [x] 对 `.deepseekgui` 本地目录规划迁移到 `.sciforge`，并保留旧目录读取/迁移路径。
- [x] 对 `x-deepseek-gui-secret`、`deepseek-gui-router` 等内部标识设计兼容期或一次性迁移。

### Renderer 与本地化

- [x] 替换启动文案、标题栏、设置页、关于页、侧边栏、空状态和错误信息中的 DeepSeek GUI 文案。
- [x] 更新 `src/renderer/src/locales/en/common.json` 和 `src/renderer/src/locales/zh/common.json` 的品牌翻译。
- [x] 检查 README、docs、help text、截图说明和插件页文案中的旧品牌。
- [x] 保持 DeepSeek provider 在设置、模型选择、API key 配置中的准确展示。

### Provider 保留与回归验证

- [x] 验证 DeepSeek provider 仍可在 model router 中配置、启动和调用。
- [x] 覆盖 DeepSeek provider 相关单元测试，确保 provider id、API key、model id 不被品牌替换破坏。
- [x] 覆盖 SciForge 产品命名单元测试，确保 app identity、build config、runtime settings 使用新品牌。
- [x] 使用 `rg` 验证旧产品品牌只出现在 allowlist、迁移兼容代码或历史文档中。
- [x] 运行 `npm test`、`npm run typecheck`、必要的打包 dry run 和本地 Electron 启动验证。
