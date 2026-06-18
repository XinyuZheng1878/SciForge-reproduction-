import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultClaudeRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  claudeCodeAnthropicBaseUrl,
  claudeCodeCliModel,
  claudeCodeExtraArgs,
  claudeCodeRuntimeEnv,
  prepareClaudeCodeTurnLaunch
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

  it('prepares stream-json print args without allowing controlled overrides', async () => {
    const launch = await prepareClaudeCodeTurnLaunch({
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

    expect(launch.args).toEqual(expect.arrayContaining([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--bare',
      '--model',
      'sonnet',
      '--resume',
      'session-1',
      '--allowedTools',
      'Edit'
    ]))
    expect(launch.args).not.toContain('--cwd')
    expect(launch.cwd).toBe('/tmp/workspace')
    expect(launch.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(claudeCodeExtraArgs([
      '--model',
      'opus',
      '--bare',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Edit'
    ])).toEqual(['--allowedTools', 'Edit'])
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
