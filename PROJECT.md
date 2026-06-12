# DeepSeek GUI Runtime API via Model Router 迁移任务板

最后更新：2026-06-12

## 当前目标

保留本项目现有运行时能力，不要求删除 Kun；但要把 **所有运行时使用的 LLM provider
API** 统一收敛到 Model Router。

换句话说：

- Kun 可以保留。
- Codex 可以保留。
- 设置页是否继续让用户选择运行时，可以按现有产品策略保留。
- 但无论当前运行时是 Kun、Codex，还是未来新增运行时，只要它需要调用 LLM provider，
  都必须通过 Model Router，不允许直连 DeepSeek / OpenAI / Qwen / 其它兼容 provider。

你已经把 SciForge 的 Model Router 和 `vision-router-service` 拷贝到：

```text
packages/workers/model-router/
```

这个目录就是 Model Router 的独立迁移单元。Model Router 及其成员模块都应留在这里，
方便后续整体组合、迁移、发布或替换。

## 新产品约束

- 运行时不再是本阶段要删除的对象；本阶段目标是统一运行时的模型 API 出口。
- Model Router 是唯一 LLM provider 调用边界。
- Kun、Codex、Write inline completion、视觉预处理、Computer Use / Browser 的模型辅助和
  未来后台入口都不能直连上游模型 provider。
- `vision-router-service` 不是总 LLM API gateway；它是 Model Router 下的视觉翻译成员模块，
  负责把图像转成 textual evidence。
- 非 LLM API 不走 Model Router，例如文件系统、git、系统通知、GUI 更新、Feishu / 微信、
  Browser 网络读取等工具能力。

## 目标模块布局

Model Router 作为一个可整体迁移的独立模块目录：

```text
packages/workers/model-router/
  package.json
  README.md
  src/
    cli.ts
    cli-options.ts
    index.ts
    manifest.ts
    router.ts
    trace-audit.ts
    trace-redaction.ts
    *.test.ts

  vision-router-service/
    package.json
    package-lock.json
    tsconfig.json
    .env.example
    README.md
    src/
      index.ts
      server.ts
      qwen.ts
      types.ts
      server.test.ts
```

边界原则：

- `packages/workers/model-router` 是迁移单元。
- `vision-router-service` 是 Model Router 的成员模块，可以先保留独立 package。
- 本项目主程序只通过 HTTP API 调用 Model Router，不 import router 内部实现。
- Model Router 内部可以调用自己的成员模块，或把成员模块代码折叠为 internal adapter；
  这属于 router 内部实现，主程序不关心。

## SciForge 参考事实

SciForge 的当前口径是：

- Codex / Agent Host 是唯一智能体。
- Agent Host 的模型能力统一来自 Model Router `/v1/responses`。
- Model Router 是 OpenAI-compatible / Responses-compatible 的模型 facade。
- Model Router 负责 provider / protocol / modality translation、profile routing、
  trace redaction 和短期 vision translation cache。
- Model Router 不负责用户任务规划、工具选择、approval、repair、completion truth 或
  final answer。

本项目不必照搬 SciForge 的“Codex 唯一智能体”产品判断；本项目当前目标是借用
Model Router 的 API 边界，把所有 runtime 的 provider 调用统一起来。

## 目标架构

```text
Renderer
  Code / Write / Connect phone / Schedule
        |
        v
Preload IPC
  dsGui.agentRuntime.*
        |
        v
Main process
  RuntimeHost
    - Kun adapter
    - Codex adapter
    - future runtime adapters
        |
        | runtime model/provider config points only to local Model Router
        v
packages/workers/model-router
  /health
  /healthz
  /manifest
  /v1/models
  /v1/responses
        |
        +--> textReasoner provider
        |
        +--> translators.vision
              -> vision-router-service
              -> Qwen vision provider
```

关键边界：

- renderer 不知道上游 provider，也不保存 provider API key。
- main process 不直接 fetch 上游 LLM endpoint，除非是在启动 / health check 本地
  Model Router。
- 对 Kun、Codex 和未来 runtime adapter 来说，Model Router 必须表现得像一个普通的
  Responses-compatible LLM API provider；调用方只替换 `base_url`、`api_key` 和 `model`。
- Kun runtime 不直连外部 LLM provider；它的 base URL / API key 应指向本地 Model Router。
- Codex runtime 不直连外部 LLM provider；它的 model provider 应指向本地 Model Router
  `/v1` public alias。
- Codex runtime 不使用用户全局 `~/.codex` 配置；它必须使用 DeepSeek-GUI 管理的本地
  `CODEX_HOME` 和本地生成的 `config.toml`。
- provider API key 只进入 Model Router 或 Model Router 成员模块。
- Model Router 输出的是 bounded model output、trace refs 和 diagnostics，不拥有用户级
  final answer。

## Model Router 外部 API 契约

Model Router 内部可以有 provider routing、profile routing、vision translation、
trace redaction 和成员模块调用；但这些复杂度不能泄漏到 runtime 调用方。

外部调用方看到的形态应该等价于一个普通的 Responses-compatible LLM API：

- base URL：本地 Model Router `/v1`，例如 `http://127.0.0.1:3892/v1`。
- auth：标准 `Authorization: Bearer <runtimeApiKey>`。
- model：public model alias，例如 `deepseek-gui-router`。
- models：`GET /v1/models` 返回可选 public model aliases。
- generation：`POST /v1/responses`，请求体使用普通 Responses API 形态，例如 `model`、
  `input`、`instructions`、`tools`、`tool_choice`、`stream`。
- response：普通 Responses-compatible response / streaming event / error shape。

运行时不应该需要知道或传入：

- 上游 provider base URL。
- 上游 provider API key。
- Model Router internal profile 名称。
- `vision-router-service` URL。
- 自定义必填 `x-*` header。
- 只为 Model Router 内部实现存在的 role / trace / translator 参数。

如果确实需要区分 text、vision、tool-use、inline completion 等路线，优先通过 public
model alias、普通 `input` 内容和 Model Router 内部配置决定，而不是要求 runtime 使用
专用协议。`/health`、`/healthz` 和 `/manifest` 是 sidecar 管理接口，不应成为普通
LLM client 发起模型调用时必须理解的 API。

## 不可变原则

- [x] 不要求删除 Kun。
- [x] 不要求把产品收敛为 Codex-only。
- [x] 所有 LLM provider 调用必须经过 Model Router。
- [x] Model Router 对运行时暴露的接口必须保持普通 Responses-compatible LLM API 形态；
  运行时不使用 Model Router 私有协议。
- [x] Model Router 及成员模块必须集中在 `packages/workers/model-router/`。
- [x] 本项目主程序只通过 HTTP API 使用 Model Router；不 import router 内部文件。
- [x] provider API key 只能由 Model Router / 成员模块使用；GUI settings 不作为运行时直连
  provider 的凭据来源。
- [x] 缺少 Model Router URL、Runtime API key、public model alias、router 内部 provider
  凭据或返回非法响应时 fail closed，展示可恢复错误，不静默 fallback 到直连 provider。
- [x] Codex app-server 必须使用 GUI 管理的本地 `CODEX_HOME`；不能读取或继承用户全局
  `~/.codex`、`CODEX_USER_HOME`、`CODEX_CONFIG_HOME`。
- [x] Vision Router 只做视觉翻译，不做最终推理，不声明任务完成。
- [x] 新 contract 必须有测试覆盖；迁移时每个阶段都要跑 focused tests 和 typecheck。

## Codex Runtime Home

Codex 需要和 SciForge 一样使用受控本地配置，而不是读取用户全局 Codex 配置。

默认路径：

```text
开发期:
  <repo>/.codex-runtime/
    codex-home/
      config.toml
      sessions/
      memories/
      logs / sqlite state files managed by Codex
    logs/

打包后:
  <app userData>/runtime-codex/
    codex-home/
      config.toml
      sessions/
      memories/
    logs/
```

启动规则：

- main process 在启动 Codex app-server 前创建 runtime root 和 `codex-home`。
- main process 生成或修复 `<codex-home>/config.toml`。
- 启动环境强制设置 `CODEX_HOME=<managed codex-home>`。
- 启动环境删除 `CODEX_USER_HOME` 和 `CODEX_CONFIG_HOME`，避免继承全局配置。
- `config.toml` 中的 provider 只能指向本地 Model Router `/v1`。
- `model_provider` 和 `model` 必须使用 DeepSeek-GUI 的 Model Router public alias。
- 缺 runtime home、Model Router URL、runtime API key、public model alias 或本地 config
  不合法时 fail closed。
- 默认禁用会绕过本地配置边界的 Codex 插件 / remote plugin 同步；后续如需启用，必须
  通过 DeepSeek-GUI 管理的本地配置显式开启。

建议环境变量命名：

```text
DEEPSEEK_GUI_RUNTIME_ROOT
DEEPSEEK_GUI_CODEX_HOME
DEEPSEEK_GUI_MODEL_ROUTER_BASE_URL
DEEPSEEK_GUI_RUNTIME_API_KEY
```

## Settings 目标形态

Settings 可以继续保留运行时选择，但 provider 配置要从“运行时直连上游”改成
“运行时连接 Model Router”。示意：

```json
{
  "activeAgentRuntime": "kun",
  "agents": {
    "kun": {
      "autoStart": true,
      "baseUrl": "http://127.0.0.1:3892/v1",
      "apiKey": "local-runtime-router-key",
      "model": "deepseek-gui-router"
    },
    "codex": {
      "command": "codex",
      "autoStart": true,
      "codexHome": "<managed: dev .codex-runtime/codex-home, packaged userData/runtime-codex/codex-home>",
      "profile": "deepseek-gui-runtime",
      "model": "deepseek-gui-router",
      "modelProvider": "deepseek-gui-model-router",
      "approvalPolicy": "on-request",
      "sandboxMode": "workspace-write",
      "extraArgs": []
    }
  },
  "modelRouter": {
    "enabled": true,
    "baseUrl": "http://127.0.0.1:3892/v1",
    "autoStart": true,
    "publicModelAlias": "deepseek-gui-router",
    "runtimeApiKey": "",
    "profiles": {
      "default": {
        "textReasoner": {
          "provider": "openai-compatible",
          "baseUrl": "http://35.220.164.252:3888/v1",
          "apiKey": "sk-SCcnTVACVn8G5xpoL3Biv3xQR0TJgaGhVm9F7eTG8gjfB979",
          "model": "bailian/deepseek-v4-flash"
        },
        "translators": {
          "vision": {
            "provider": "qwen-compatible",
            "baseUrl": "http://35.220.164.252:3888/v1",
            "apiKey": "sk-SCcnTVACVn8G5xpoL3Biv3xQR0TJgaGhVm9F7eTG8gjfB979",
            "model": "Qwen3.7-Plus"
          }
        }
      }
    }
  }
}
```

迁移策略：

- 旧 `activeAgentRuntime` 保留。
- 旧 `agents.kun` 保留，但其 LLM base URL / API key / model 要迁移为指向 Model Router。
- 旧 `agents.codex` 保留，但其 Codex config 要生成 Model Router provider。
- 旧 `agents.codex.codexHome` 不再默认信任为可直连使用；如果它指向用户全局 `~/.codex`
  或其它非 GUI 管理目录，迁移到本地 managed runtime home。
- 旧 provider API key 不再被 main / renderer 直接用于运行时调用。若用户同意迁移，可拷贝到
  Model Router 成员 profile；否则首次启动时要求用户重新配置 Model Router provider。

## 任务分解

### P0：重置项目约束和文档入口

目标：删除“Codex-only / 删除 Kun”和“Vision Router 是唯一 LLM gateway”的旧表述。

- [x] 更新 `PROJECT.md`：明确 Kun 不需要删除，目标是所有运行时 API 走 Model Router。
- [x] 更新 README / DESIGN / docs 中的产品事实：运行时可以多种，LLM provider 边界只有
  Model Router。
- [x] 删除或重写所有“只支持 Codex 一个运行时”的说明。
- [x] 删除或重写所有“Vision Router 是唯一 LLM API gateway”的说明。

验收：

- [x] `rg -n "Codex 是唯一|只支持 Codex|删除 Kun|Vision Router.*唯一|vision-router-service.*唯一" PROJECT.md README* docs`
  无当前目标命中。

### P1：整理 Model Router 独立目录

目标：确认 `packages/workers/model-router/` 是完整、可整体迁移的模块目录。

- [x] 保留 `packages/workers/model-router/package.json`、`README.md`、`src/` 和 tests。
- [x] 保留 `packages/workers/model-router/vision-router-service/` 作为成员模块。
- [x] 清理拷贝产生的无关文件，例如 `.DS_Store`。
- [x] 更新 root `package.json` workspaces，至少包含：

```json
{
  "workspaces": [
    "packages/workers/model-router",
    "packages/workers/model-router/vision-router-service"
  ]
}
```

- [x] 增加 root scripts：

```json
{
  "scripts": {
    "model-router:start": "npm --workspace @sciforge/model-router run start",
    "model-router:test": "npm --workspace @sciforge/model-router run test",
    "vision-router:start": "npm --workspace sciforge-vision-router-service run start",
    "vision-router:test": "npm --workspace sciforge-vision-router-service run test",
    "vision-router:typecheck": "npm --workspace sciforge-vision-router-service run typecheck"
  }
}
```

验收：

- [x] 整个 `packages/workers/model-router/` 可以作为一个目录整体移动。
- [x] root 项目可以通过 workspace script 启动和测试 router / vision 成员模块。
- [x] main / renderer 没有 import `packages/workers/model-router/src/*`。

### P2：接入 Model Router Responses-compatible HTTP contract

目标：把本地 Model Router 固化成所有运行时的模型 API 入口。

- [x] 固化 Model Router HTTP contract：`GET /health`、`GET /healthz`、`GET /manifest`、
  `GET /v1/models`、`POST /v1/responses`。
- [x] 固化 runtime-facing model API：运行时按普通 Responses-compatible provider 调用
  `POST /v1/responses`，请求体不包含 Model Router 私有必填字段。
- [x] 固化认证方式：运行时使用标准 `Authorization: Bearer <runtimeApiKey>`。
- [x] 定义本项目的 public model alias，例如 `deepseek-gui-router`。
- [x] 定义本项目的 local runtime API key，只用于 runtime -> Model Router 本地认证。
- [x] Model Router internal profile / provider / translator 选择由 public model alias、普通 input
  内容和 router 内部配置决定，不要求运行时传入自定义 `x-*` header、internal profile 或
  vision service URL。
- [x] 当 Model Router 未配置或 `/healthz` 不通过时，所有运行时启动或发起 turn 都应
  fail closed。

验收：

- [x] 运行时配置只看到本地 Model Router `/v1` endpoint、runtime API key 和 public model
  alias。
- [x] 运行时配置中不出现真实 provider base URL 或上游 API key。
- [x] 使用普通 Responses-compatible client fixture，可以在不传 Model Router 私有参数的情况下
  调用 `POST /v1/responses`。
- [x] 如果开启 streaming，streaming event shape 与普通 Responses-compatible client 预期一致。
- [x] 错误返回使用普通 LLM API client 可识别的 status code / error body，不泄露上游 secret。
- [x] `rg -n "api.deepseek.com|dashscope|openai.com"` 的生产代码命中只允许出现在
  Model Router member config 示例或文档中。

### P3：Kun 通过 Model Router 调用模型

目标：保留 Kun，但 Kun 不再直连 DeepSeek / OpenAI-compatible 上游。

- [x] 修改 Kun 启动配置同步逻辑：GUI 写入 Kun 的 `baseUrl`、`apiKey`、`model` 指向
  Model Router。
- [x] Kun 把 Model Router 当作普通 Responses-compatible provider 使用，不新增 Kun 专用
  router protocol、custom header 或 internal profile 参数。
- [x] 删除或禁用 Kun settings 中“助手专用上游 Base URL / API Key”直连语义，改成
  Model Router member profile 配置入口。
- [x] Kun health / diagnostics 显示 Model Router readiness，而不是上游 provider readiness。
- [x] focused tests 覆盖：Kun runtime settings 不能保存为 remote provider endpoint。

验收：

- [x] Kun turn 的 LLM 请求只会命中本地 Model Router。
- [x] Kun turn request 不包含 Model Router 私有必填字段。
- [x] 缺 Model Router 时 Kun turn fail closed。

### P4：Codex 通过 Model Router 调用模型

目标：Codex app-server 不直连外部 LLM provider。

- [x] 新增 DeepSeek-GUI managed Codex runtime home 解析：开发期默认 `<repo>/.codex-runtime`，
  打包后默认 `<app userData>/runtime-codex`。
- [x] 启动 Codex 前创建 `codex-home`、`sessions`、`memories`、`logs` 等目录。
- [x] 启动 Codex 前生成 / 修复 `<codex-home>/config.toml`。
- [x] 启动 Codex 时强制设置 `CODEX_HOME=<managed codex-home>`。
- [x] 启动 Codex 时删除继承的 `CODEX_USER_HOME` 和 `CODEX_CONFIG_HOME`。
- [x] 本地 `config.toml` 禁止写入 remote provider endpoint，只允许写入 Model Router。
- [x] Codex config 生成层只写入普通 provider 配置：本地 Model Router `/v1` base URL、
  runtime API key 和 public model alias。
- [x] Codex model provider 使用 public alias，例如 `deepseek-gui-model-router`。
- [x] Codex 不依赖 Model Router 私有协议；从 Codex 看，Model Router 就是普通
  Responses-compatible provider。
- [x] Runtime API key 只用于 Codex -> Model Router 本地认证，不等同于上游 provider key。
- [x] 当 Model Router 未配置或 `/healthz` 不通过时，Codex turn start fail closed。

验收：

- [x] Codex app-server 进程环境中的 `CODEX_HOME` 指向 managed local runtime home。
- [x] Codex app-server 进程环境不包含继承的 `CODEX_USER_HOME` / `CODEX_CONFIG_HOME`。
- [x] Codex 不读取用户全局 `~/.codex/config.toml`。
- [x] Codex app-server runtime 配置只看到本地 Model Router endpoint。
- [x] Codex config 中不出现真实 provider base URL 或上游 API key。
- [x] Codex 发起模型请求时不需要 internal profile、vision service URL 或自定义必填 header。

### P5：Model Router 成员模块策略

目标：把视觉翻译留在 Model Router 独立目录内，避免外部旁路。

- [x] Model Router 的 `translators.vision` role 可以调用内置逻辑，也可以调用
  `vision-router-service`。
- [x] 外部主程序不直接调用 `vision-router-service`；如果需要视觉能力，优先通过
  Model Router `/v1/responses` 的普通 input object、public model alias 和内部 routing rule。
- [x] 如果短期保留 runtime turn 前的 image preextract，必须把它标记为临时过渡路径，并最终收敛到
  Model Router。
- [x] 视觉翻译只产出 observation / textual evidence，不产出 final answer 或 task completion。

验收：

- [x] 视觉相关 provider secret 只在 Model Router 或成员模块中读取。
- [x] 文档不再把 Vision Router 描述为本项目唯一 LLM API gateway。

### P6：设置、启动和 sidecar 管理

目标：用户能配置和运行 Model Router，桌面端能检查服务健康。

- [x] Settings 增加 Model Router 配置区：base URL、auto-start、runtime API key、
  public model alias、member text provider、member vision provider。
- [x] main process 增加 Model Router health / healthz check。
- [x] dev 模式支持自动启动 Model Router。
- [x] packaged app 方案明确：打包 `packages/workers/model-router` 整个目录、使用编译后 JS、
  或要求外部部署。
- [x] 所有 secret 在日志和 UI 中做 redaction。

验收：

- [x] Settings 能显示 Model Router healthy / unavailable / provider-auth blocked。
- [x] 保存 provider key 后日志不泄露明文。

### P7：清理 LLM API 调用旁路

目标：找出并删除所有绕过 Model Router 的 LLM provider 路径。

- [x] 审计 main / renderer / shared / write / schedule / claw 中所有 `fetch`、SDK、
  provider client、base URL、API key 使用。
- [x] Write inline completion 改走 Model Router，不能再直连 DeepSeek FIM。
- [x] Connect phone / Schedule 的模型调用按其所用 runtime 执行，但 runtime provider
  仍必须指向 Model Router。
- [x] 删除旧 model provider UI 或把它改为 Model Router member profile 配置。
- [x] 删除不再需要的 OpenAI-compatible URL helper，除非它被 Model Router 使用。

验收：

- [x] 生产代码中所有 LLM provider credential 读取点都在 Model Router 或其启动配置层。
- [x] `rg -n "apiKey|baseUrl|chat/completions|responses|messages|fim"` 的生产代码命中都能解释为
  Model Router 路径或非 LLM API。

### P8：测试和发布检查

目标：每个迁移阶段都有证据，不靠手动猜。

- [x] Model Router package：`npm --workspace @sciforge/model-router run test`。
- [x] Vision member package：`npm --workspace sciforge-vision-router-service run test`。
- [x] Vision member package：`npm --workspace sciforge-vision-router-service run typecheck`。
- [x] App typecheck：`npm run typecheck`。
- [x] Focused Kun tests：Kun config routing、health failure、no direct provider endpoint。
- [x] Focused Codex tests：Codex config routing、approval/user input、event store。
- [x] Focused settings tests：Model Router config 保存和 redaction。
- [x] Focused compatibility tests：用普通 Responses-compatible client 调用 Model Router，
  不传 custom header / internal profile / vision URL。
- [x] Focused API audit tests：禁止生产代码直接引用上游 LLM endpoint。
- [x] Manual smoke：启动 Model Router，分别用 Kun / Codex 发起文本 turn。
- [x] Manual smoke：上传图片，确认 Model Router vision role 被调用，runtime 收到文本 observation。

Manual smoke 证据：本地 fake provider + 真实 Model Router + Kun/Codex runtime 均已完成端到端验证；
Kun 图片上传 smoke 已确认 attachment id、vision role 调用和 runtime assistant 文本 observation。

## 第一批执行顺序

1. 提交本 `PROJECT.md` 任务板更新。
2. 清理 `packages/workers/model-router/` 中的拷贝杂物，例如 `.DS_Store`。
3. 接 root workspaces 和 scripts。
4. 跑 Model Router / Vision member 自测，修正路径、依赖和 lockfile 问题。
5. 接 Model Router settings、health check 和 sidecar 启动。
6. 先改 Kun 的 provider config，使 Kun 走 Model Router。
7. 再改 Codex 的 provider config，使 Codex 走 Model Router。
8. 审计所有 LLM provider direct call，逐个改到 Model Router。

## 已确认决策

- Kun 不需要删除。
- 不需要把产品收敛为 Codex-only。
- Model Router 和成员模块集中放在 `packages/workers/model-router/`。
- Model Router 对外必须表现为普通 Responses-compatible LLM API；调用方只需要
  `base_url`、`api_key` 和 `model`。
- `vision-router-service` 是 Model Router 成员模块，不是本项目唯一 LLM API gateway。
- “所有 API 调用”按“所有 LLM provider API 调用”解释；普通 GUI 更新、文件系统、git、
  系统通知、Feishu / 微信、Browser 网络读取等非 LLM API 不属于 Model Router。

## 待确认但不阻塞当前任务板

- `vision-router-service` 是否长期保留为独立 nested package，还是并入
  `packages/workers/model-router/src/adapters/vision`。
- packaged app 中 Model Router 是内置 sidecar 自动启动，还是允许用户外部部署。
