import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultClaudeRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
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
      kun: defaultKunRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        command: 'claude',
        configDir: '~/.deepseekgui/claude-code',
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
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
      ANTHROPIC_MODEL: 'opus'
    }, {
      configDir: '/tmp/claude-config',
      baseUrl: 'http://127.0.0.1:49876/v1',
      apiKey: 'local-runtime-router-key',
      model: 'sonnet'
    })

    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
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
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.sdkOptions.mcpServers).toMatchObject({
      gui_computer_use: {
        type: 'stdio',
        command: '/tmp/deepseek-gui-test-app/SciForge',
        args: [
          '/tmp/deepseek-gui-test-app/out/main/computer-use-mcp-node-entry.js',
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
            kun: true,
            codex: true,
            claude: true
          },
          backend: 'global-native',
          experimentalAppScopedBackend: false
        }
      },
      text: 'hello',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
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
            kun: true,
            codex: true,
            claude: false
          },
          backend: 'global-native',
          experimentalAppScopedBackend: false
        }
      },
      text: 'hello',
      workspace: '/tmp/workspace',
      managedConfigDir: '/tmp/claude-managed',
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.sdkOptions.mcpServers).toBeUndefined()
  })

  it('uses Claude CLI model aliases instead of the router public alias', () => {
    expect(claudeCodeCliModel('', 'deepseek-gui-router')).toBe('sonnet')
    expect(claudeCodeCliModel('deepseek-gui-router', 'deepseek-gui-router')).toBe('sonnet')
    expect(claudeCodeCliModel('opus', 'deepseek-gui-router')).toBe('opus')
    expect(claudeCodeCliModel('claude-sonnet-4-5', 'deepseek-gui-router')).toBe('claude-sonnet-4-5')
  })

  it('strips the /v1 suffix for Claude CLI base URL handling', () => {
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1')).toBe('http://127.0.0.1:3892')
    expect(claudeCodeAnthropicBaseUrl('http://127.0.0.1:3892/v1/')).toBe('http://127.0.0.1:3892')
  })
})
