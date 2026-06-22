import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_MODEL_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from './app-settings'
import { DeepseekCompatModelClient } from '../../kun/src/adapters/model/deepseek-compat-model-client'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: {
      ...defaultModelProviderSettings(),
      providers: [
        ...defaultModelProviderSettings().providers,
        {
          id: 'custom',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'messages',
          models: ['custom-model']
        }
      ]
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        providerId: 'custom',
        model: 'custom-model'
      }
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

describe('model provider settings', () => {
  it('keeps the DeepSeek provider allowlist stable during product rebrands', () => {
    const provider = defaultModelProviderSettings()
    const defaultProvider = provider.providers[0]
    const compatClient = new DeepseekCompatModelClient({
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      fetchImpl: (() => {
        throw new Error('fetch should not be called')
      }) as typeof fetch
    })

    expect(DEFAULT_MODEL_PROVIDER_ID).toBe('deepseek')
    expect(DEFAULT_DEEPSEEK_BASE_URL).toBe('http://127.0.0.1:3892/v1')
    expect(provider.apiKey).toBe('')
    expect(defaultProvider).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'http://127.0.0.1:3892/v1',
      endpointFormat: 'chat_completions',
      models: ['deepseek-v4-pro', 'deepseek-v4-flash']
    })
    expect(compatClient.provider).toBe('deepseek-compat')
    expect(compatClient.model).toBe('deepseek-v4-pro')
  })

  it('resolves Kun runtime credentials only from the local Model Router boundary', () => {
    const runtime = resolveKunRuntimeSettings(settings())

    expect(runtime.apiKey).toBe('local-runtime-router-key')
    expect(runtime.baseUrl).toBe('http://127.0.0.1:3892/v1')
    expect(runtime.endpointFormat).toBe('responses')
    expect(runtime.model).toBe(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)
  })
})
