import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildModelRouterSidecarLaunch,
  ensureModelRouterConfigFile,
  modelRouterConfigPath
} from './model-router-sidecar'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-key',
      profiles: {
        default: {
          textReasoner: {
            provider: 'openai-compatible',
            baseUrl: 'https://text-provider.example/v1',
            apiKey: 'text-secret',
            model: 'text-model'
          },
          translators: {
            vision: {
              provider: 'qwen-compatible',
              baseUrl: 'https://vision-provider.example/v1',
              apiKey: 'vision-secret',
              model: 'vision-model'
            }
          }
        }
      }
    },
    activeAgentRuntime: 'kun',
    agents: {
      kun: defaultKunRuntimeSettings()
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

describe('buildModelRouterSidecarLaunch', () => {
  it('builds a dev workspace launch without writing provider secrets into config', () => {
    const result = buildModelRouterSidecarLaunch(settings(), {
      userDataDir: '/tmp/deepseek-gui-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.command).toBe('npm')
    expect(result.launch.args).toEqual([
      '--workspace',
      '@sciforge/model-router',
      'run',
      'start',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '4567',
      '--config',
      '/tmp/deepseek-gui-user-data/model-router/config.json',
      '--workspace-root',
      '/tmp/workspace',
      '--quiet'
    ])
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.config).toBeUndefined()
  })

  it('builds a launch when the text reasoner member is incomplete in UI settings', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''
    current.modelRouter!.profiles.default.textReasoner.baseUrl = ''
    current.modelRouter!.profiles.default.textReasoner.model = ''

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/deepseek-gui-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.configPath).toBe('/tmp/deepseek-gui-user-data/model-router/config.json')
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
  })

  it('builds a launch against the local config file without requiring member settings in the UI', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner = {
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: ''
    }

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/deepseek-gui-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.configPath).toBe('/tmp/deepseek-gui-user-data/model-router/config.json')
    expect(result.launch.config).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY).toBe('')
    expect(result.launch.args).toContain('/tmp/deepseek-gui-user-data/model-router/config.json')
  })

  it('creates a local Model Router config template without overwriting an existing file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'deepseek-gui-router-config-'))
    try {
      const current = settings()
      current.provider.apiKey = 'text-secret'
      current.provider.baseUrl = 'https://text.example/v1'
      current.agents.kun.model = 'deepseek-v4-pro'

      const created = await ensureModelRouterConfigFile(current, { userDataDir })
      const content = await readFile(created.path, 'utf8')

      expect(created.created).toBe(true)
      expect(created.path).toBe(modelRouterConfigPath(userDataDir))
      expect(content).toContain('"publicModelAlias": "deepseek-gui-router"')
      expect(content).toContain('"baseUrl": "https://text.example/v1"')
      expect(content).toContain('"apiKeyEnv": "DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY"')
      expect(content).toContain('"model": "deepseek-v4-pro"')
      expect(content).not.toContain('text-secret')

      await ensureModelRouterConfigFile(current, { userDataDir })
      const afterSecondEnsure = await readFile(created.path, 'utf8')
      expect(afterSecondEnsure).toBe(content)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
