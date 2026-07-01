import { describe, expect, it } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultClaudeRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  claudeCodeAnthropicBaseUrl,
  claudeCodeCliModel,
  claudeCodeSdkExtraArgs,
  claudeCodeRuntimeEnv,
  prepareClaudeCodeSdkLaunch
} from './claude-code-config'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        command: 'claude',
        configDir: '~/.sciforge/claude-code',
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('claude-code config launch helpers', () => {
  it('forces Claude Code traffic through the Model Router env', () => {
    const env = claudeCodeRuntimeEnv({
      OPENAI_API_KEY: 'sk-openai',
      DEEPSEEK_API_KEY: 'sk-deepseek',
      ANTHROPIC_API_KEY: 'sk-anthropic',
      ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_MODEL: 'opus',
      SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
      SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
      SCIFORGE_IMAGE_MODEL: 'outer-image-model',
      SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
      SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
      SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'outer-sci-modality-token',
      SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345',
      EDAG_LLM_BASE_URL: 'https://direct-edag-provider.example/v1',
      EDAG_LLM_API_KEY: 'outer-edag-key',
      EDAG_LLM_MODEL: 'outer-edag-model'
    }, {
      configDir: '/tmp/claude-config',
      baseUrl: 'http://127.0.0.1:49876/v1',
      apiKey: 'local-runtime-router-key',
      model: 'sonnet'
    })

    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBeUndefined()
    expect(env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBeUndefined()
    expect(env.EDAG_LLM_BASE_URL).toBeUndefined()
    expect(env.EDAG_LLM_API_KEY).toBeUndefined()
    expect(env.EDAG_LLM_MODEL).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(env.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(env.ANTHROPIC_MODEL).toBe('sonnet')
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/claude-config')
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
  })

  it('prepares SDK launch options without allowing controlled CLI overrides', async () => {
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: {
        ...settings(),
        agents: {
          ...settings().agents,
          claude: {
            ...defaultClaudeRuntimeSettings(),
            extraArgs: ['--model', 'opus', '--allowedTools', 'Edit']
          }
        }
      },
      text: 'hello',
      workspace: '/tmp/workspace',
      sessionId: 'session-1',
      managedConfigDir: '/tmp/claude-managed'
    })

    expect(launch.prompt).toBe('hello')
    expect(launch.sdkOptions).toMatchObject({
      cwd: '/tmp/workspace',
      model: 'sonnet',
      resume: 'session-1',
      extraArgs: { allowedTools: 'Edit' }
    })
    expect(launch.sdkOptions.extraArgs).not.toHaveProperty('model')
    expect(launch.sdkOptions.extraArgs).not.toHaveProperty('cwd')
    expect(launch.cwd).toBe('/tmp/workspace')
    expect(launch.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(claudeCodeSdkExtraArgs([
      '--model',
      'opus',
      '--bare',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Edit'
    ])).toEqual({ allowedTools: 'Edit' })
  })

  it('injects the shared computer-use MCP server into SDK options', async () => {
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: settings(),
      text: 'hello',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      computerUseMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.sdkOptions.mcpServers).toMatchObject({
      gui_computer_use: {
        type: 'stdio',
        command: '/tmp/sciforge-test-app/SciForge',
        args: [
          '/tmp/sciforge-test-app/out/main/computer-use-mcp-node-entry.js',
          '--gui-computer-use-mcp-server'
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        },
        timeout: 30000,
        alwaysLoad: true
      }
    })
  })

  it('does not inject the shared computer-use MCP server when computer use is disabled', async () => {
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: {
        ...settings(),
        computerUse: {
          enabled: false,
          runtimeEnabled: {
            sciforge: true,
            codex: true,
            claude: true
          }
        }
      },
      text: 'hello',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      computerUseMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.sdkOptions.mcpServers).toBeUndefined()
  })

  it('does not inject the shared computer-use MCP server when Claude runtime access is disabled', async () => {
    const launch = await prepareClaudeCodeSdkLaunch({
      settings: {
        ...settings(),
        computerUse: {
          enabled: true,
          runtimeEnabled: {
            sciforge: true,
            codex: true,
            claude: false
          }
        }
      },
      text: 'hello',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      computerUseMcpLaunch: {
        appPath: '/tmp/sciforge-test-app',
        execPath: '/tmp/sciforge-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.sdkOptions.mcpServers).toBeUndefined()
  })

  it('uses Claude CLI model aliases instead of the router public alias', () => {
    expect(claudeCodeCliModel('', 'sciforge-router')).toBe('sonnet')
    expect(claudeCodeCliModel('sciforge-router', 'sciforge-router')).toBe('sonnet')
    expect(claudeCodeCliModel('opus', 'sciforge-router')).toBe('opus')
    expect(claudeCodeCliModel('claude-sonnet-4-5', 'sciforge-router')).toBe('claude-sonnet-4-5')
  })

  it('strips the /v1 suffix for Claude CLI base URL handling', () => {
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1')).toBe('http://127.0.0.1:3892')
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1/')).toBe('http://127.0.0.1:3892')
  })
})
