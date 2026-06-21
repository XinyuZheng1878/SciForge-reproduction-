# DeepSeek GUI Paper Radar PR #17 集成任务板

更新时间：2026-06-21

## 不可变原则

- [x] 旧逻辑代码和最终目标冲突时，删除旧逻辑，直接实现新版本，不做兼容，保持代码干净。
- [x] 所有修改必须通用，不能为特色例子写硬编码补丁。
- [x] LLM API 只能走model router
- [x] 在能提高时间效率的前提下，尽可能使用 sub agent 并行推进；并行任务必须拆清边界，避免不同 worker 修改同一文件造成冲突。
- [x] 相同功能的工作链路需要统一，不要额外生出旁路。

## 新任务：PR #17 Add Paper Radar 独立扩展集成

目标：吸收 PR #17 的论文雷达能力，但不直接把新面板固定进主界面。功能先进入 `Plugins → Extensions`，用户启用后才在 Workbench 右侧工具栏出现 Paper Radar；服务作为独立 npm workspace/sidecar 存放在 `plugins/paper-radar-service`，默认不自动联网同步。

### 集成边界

- [x] 保留现有 `gui` 主分支功能，避免 PR #17 覆盖 `packages/workers/search`、研究模式、现有插件页等当前代码。
- [x] 新增 `plugins/paper-radar-service` 作为独立扩展服务，不把服务端代码 import 到 renderer。
- [x] 根 `package.json` 纳入 Paper Radar workspace，并补 `paper-radar:start/test/typecheck` 脚本。
- [x] Paper Radar sidecar 只在开发模式、扩展启用、用户进入 Paper Radar 面板并触发 IPC 后按需启动。
- [x] 默认 `PAPER_RADAR_AUTO_SYNC=0`，不在服务启动时自动同步 arXiv/bioRxiv。
- [x] app 退出时关闭已托管的 Paper Radar sidecar，避免残留本地进程。

### UI 与插件页

- [x] `Plugins` 页面新增 `Extensions` 分类。
- [x] Paper Radar 以扩展卡片出现，点击启用后写入本地 installed plugin state。
- [x] Workbench 顶栏仅在启用 Paper Radar 扩展后展示论文雷达按钮。
- [x] Paper Radar 面板复用右侧工具栏区域，提供 topic profile、metadata 同步、搜索、排行 digest 和复制 markdown 日报。
- [x] 未启用或非开发模式时不显示 Paper Radar 面板入口。

### IPC 与数据边界

- [x] 新增 shared Paper Radar 类型，统一 renderer/preload/main/service 的请求和返回结构。
- [x] 新增 Zod IPC schema，所有 Paper Radar payload 在启动 sidecar 前校验。
- [x] preload 和 dev browser bridge 暴露同一组 Paper Radar IPC 方法。
- [x] main 进程封装 `paperRadar:*` handlers，统一返回 `{ ok, data/message }` 结果，不让面板直接访问服务端实现。
- [x] sidecar health check 只接受 `sciforge.paper-radar` 服务，避免误连旧服务。

### 验证

- [x] Paper Radar service 单元/e2e 测试覆盖 profile、sync/search/rank/digest API。
- [x] main sidecar 测试覆盖启动命令、用户数据路径、默认禁用 auto sync 和 base URL 规范化。
- [x] IPC 测试覆盖无效 payload 不启动 sidecar、有效请求按需启动并调用 service client。
- [x] preload 测试覆盖 Paper Radar bridge channel 映射。
- [x] renderer 测试覆盖扩展开关存储和顶栏按钮启用/隐藏。
- [x] 文档更新插件服务边界和 Paper Radar 默认不自动同步策略。
