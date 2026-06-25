# SciForge Runtime Agent 与模型配置说明

本文说明 SciForge / SciForge Runtime 的本地配置文件在哪里、哪些字段由 UI 管理、哪些字段适合手工扩展，以及模型上下文压缩阈值应该如何配置。

## 配置文件分层

SciForge 有两层配置。

1. GUI settings

   这是桌面应用自己的设置文件，保存设置页里的 Agent 运行时选项。

   - macOS: `~/Library/Application Support/SciForge/sciforge-settings.json`
   - Windows: `%APPDATA%/SciForge/sciforge-settings.json`
   - Linux: `~/.config/SciForge/sciforge-settings.json`

   Agent 运行时设置在 `agents.sciforge` 下，例如端口、data dir、默认模型、审批策略、sandbox、token economy 等。多数用户通过设置页修改这些字段。

2. SciForge Runtime config

   这是 SciForge Runtime 本地运行时读取的高级配置文件。默认路径是：

   ```text
   ~/.sciforge/runtime/config.json
   ```

   如果 `agents.sciforge.dataDir` 改成了别的目录，实际路径就是：

   ```text
   <dataDir>/config.json
   ```

   standalone runtime 可以通过 `--config <path>` 显式指定配置文件；如果没有指定，SciForge Runtime 会尝试读取 `{dataDir}/config.json`。

## 启动时的读取顺序

GUI 启动 SciForge Runtime 时会按下面的顺序合并配置。

1. GUI 读取 `sciforge-settings.json`，得到 `agents.sciforge` 和本地 Model Router 配置。
2. GUI 在启动 SciForge Runtime 前同步 `<dataDir>/config.json`，写入 UI 管理的 token economy、默认压缩摘要参数、默认模型 profiles、runtime tuning、MCP search 和附件能力。
3. SciForge Runtime serve 读取 `<dataDir>/config.json` 或 `--config` 指定的文件。
4. CLI 参数和环境变量会覆盖 `serve` 里的基础启动字段，例如 `--model`、`--port`、`SCIFORGE_MODEL`、`SCIFORGE_PORT`。
5. AgentLoop、review loop 和子 Agent 都从同一份模型配置加载模型能力与上下文压缩阈值。

## 推荐的 config.json 结构

```json
{
  "serve": {
    "host": "127.0.0.1",
    "port": 8899,
    "dataDir": "~/.sciforge/runtime",
    "runtimeToken": "",
    "apiKey": "local-runtime-router-key",
    "baseUrl": "http://127.0.0.1:3892/v1",
    "model": "sciforge-router",
    "approvalPolicy": "auto",
    "sandboxMode": "workspace-write"
  },
  "models": {
    "profiles": {
      "sciforge-router": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  },
  "contextCompaction": {
    "defaultSoftThreshold": 16000,
    "defaultHardThreshold": 24000,
    "summaryMode": "heuristic",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 1200,
    "summaryInputMaxBytes": 98304
  }
}
```

## 模型配置写在哪里

模型相关配置写在顶层 `models.profiles`。

每个 key 是模型 ID。GUI 启动 SciForge Runtime 时，这个 ID 应优先是 Model Router 的 public model alias，例如 `sciforge-router`。模型 ID 会按小写匹配，也支持 provider 前缀，例如请求模型是 `vendor/deepseek-v4-pro` 时，也可以匹配 `deepseek-v4-pro`。

```json
{
  "models": {
    "profiles": {
      "my-128k-model": {
        "aliases": ["vendor/my-128k-model"],
        "contextWindowTokens": 128000,
        "contextCompaction": {
          "softRatio": 0.85,
          "hardRatio": 0.93
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

可用字段：

- `aliases`: 这个 profile 还要匹配的模型别名。
- `contextWindowTokens`: 模型上下文窗口大小。
- `contextCompaction.softThreshold`: 达到多少 input tokens 后开始压缩。
- `contextCompaction.hardThreshold`: 达到多少 input tokens 后强制更激进压缩。
- `contextCompaction.softRatio`: 按 `contextWindowTokens` 比例计算 soft threshold。
- `contextCompaction.hardRatio`: 按 `contextWindowTokens` 比例计算 hard threshold。
- `inputModalities`: 输入模态，目前常用 `["text"]` 或 `["text", "image"]`。
- `outputModalities`: 输出模态，通常是 `["text"]`。
- `supportsToolCalling`: 模型是否支持 tool calling。
- `messageParts`: 模型消息 part 能力，例如 `["text"]` 或 `["text", "image_url"]`。

如果同时写了 `softThreshold` 和 `softRatio`，显式 token 阈值优先。`hardThreshold` 必须大于或等于 `softThreshold`。

## 默认模型 profile

SciForge Runtime 可以内置或同步 Model Router public alias 对应的模型画像：

```json
{
  "models": {
    "profiles": {
      "sciforge-router": {
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      },
      "sciforge-router-fast": {
        "aliases": ["deepseek-chat", "deepseek-reasoner"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 980000,
          "hardThreshold": 990000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

也就是说，router public alias 可以表达 1M 上下文能力；正常情况下接近 `980k` input tokens 才触发上下文压缩，接近 `990k` 时进入更强的压缩策略。真实上游 provider、provider API key 和 provider model name 属于 Model Router 成员 profile，不写入 SciForge Runtime 配置。

## 全局压缩配置写在哪里

全局压缩配置写在顶层 `contextCompaction`。它只负责“不知道具体模型 profile 时的兜底阈值”和“摘要行为”，不要再把模型窗口大小写在这里。

```json
{
  "contextCompaction": {
    "defaultSoftThreshold": 16000,
    "defaultHardThreshold": 24000,
    "summaryMode": "heuristic",
    "summaryTimeoutMs": 15000,
    "summaryMaxTokens": 1200,
    "summaryInputMaxBytes": 98304
  }
}
```

字段说明：

- `defaultSoftThreshold`: 未匹配到模型 profile 时，达到多少 input tokens 开始压缩。
- `defaultHardThreshold`: 未匹配到模型 profile 时，达到多少 input tokens 强制压缩。
- `summaryMode`: `heuristic` 使用本地摘要骨架，`model` 会尝试调用模型生成摘要。
- `summaryTimeoutMs`: 模型摘要调用超时时间。
- `summaryMaxTokens`: 模型摘要输出 token 上限。
- `summaryInputMaxBytes`: 摘要输入文本最大字节数。

## Agent 配置写在哪里

普通 Agent 运行时配置由 GUI settings 的 `agents.sciforge` 管理。主要字段：

```json
{
  "agents": {
    "sciforge": {
      "binaryPath": "",
      "port": 8899,
      "autoStart": true,
      "dataDir": "~/.sciforge/runtime",
      "model": "sciforge-router",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "tokenEconomyMode": false,
      "insecure": false
    }
  }
}
```

设置页会保存这些字段。GUI 模式下默认模型以设置页中的 SciForge Runtime 模型为准；`config.json` 里的 `serve.model` 更适合 standalone runtime 使用，因为 GUI 启动时会把设置页里的模型作为启动参数传给 SciForge Runtime。

## 用户如何自定义

常见做法：

1. 在设置页修改端口、data dir、默认 public model alias、审批策略、sandbox 和 token economy。
2. 打开 `<dataDir>/config.json`，在 `models.profiles` 里增加或覆盖模型 profile。
3. 如果要把自定义 router alias 作为 GUI 默认模型，把 `agents.sciforge.model` 改成该 public model alias。
4. 重启 SciForge Runtime，让新配置生效。

自定义 1M 模型并在 950k 左右开始压缩：

```json
{
  "models": {
    "profiles": {
      "vendor/my-1m-model": {
        "aliases": ["my-1m-model"],
        "contextWindowTokens": 1000000,
        "contextCompaction": {
          "softThreshold": 950000,
          "hardThreshold": 980000
        },
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text"]
      }
    }
  }
}
```

自定义图片输入模型：

```json
{
  "models": {
    "profiles": {
      "vision-model": {
        "contextWindowTokens": 128000,
        "contextCompaction": {
          "softRatio": 0.75,
          "hardRatio": 0.9
        },
        "inputModalities": ["text", "image"],
        "outputModalities": ["text"],
        "supportsToolCalling": true,
        "messageParts": ["text", "image_url"]
      }
    }
  }
}
```

## 兼容旧配置

旧版本曾支持把模型 profile 写在：

```json
{
  "contextCompaction": {
    "modelProfiles": {}
  }
}
```

这个位置仍然会被读取，以免已有用户配置失效。但新配置请使用：

```json
{
  "models": {
    "profiles": {}
  }
}
```

当两个位置都写了同一个模型时，`models.profiles` 的配置优先。

## 相关源码

- 默认 GUI Agent 设置：`src/shared/app-settings-local-runtime.ts`
- GUI 同步 `<dataDir>/config.json`：`src/main/kun-process.ts`
- SciForge Runtime config schema：`kun/src/config/kun-config.ts`
- 模型 profile 解析：`kun/src/loop/model-context-profile.ts`
- 上下文压缩器：`kun/src/loop/context-compactor.ts`
- serve 解析入口：`kun/src/cli/serve.ts`
- 示例配置：`kun/config.example.json`
