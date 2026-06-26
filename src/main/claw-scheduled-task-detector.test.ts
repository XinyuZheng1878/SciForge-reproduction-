import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { detectClawScheduledTaskRequest } from './claw-scheduled-task-detector'

function settings(): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  provider.apiKey = 'sk-remote-provider'
  provider.baseUrl = 'https://remote-provider.example/v1'
  provider.providers[0] = {
    ...provider.providers[0],
    apiKey: 'sk-remote-provider',
    baseUrl: 'https://remote-provider.example/v1',
    endpointFormat: 'chat_completions'
  }
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider,
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      sciforge: defaultLocalRuntimeSettings()
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

describe('detectClawScheduledTaskRequest Model Router calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts reminder extraction to the local Model Router Responses API', async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers,
        body: JSON.parse(String(init.body ?? '{}'))
      })
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })

    await detectClawScheduledTaskRequest(
      settings(),
      'remind me tomorrow to stretch',
      'deepseek-v4-pro',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls[0]).toMatchObject({
      url: 'http://127.0.0.1:49876/v1/responses',
      headers: {
        Authorization: 'Bearer local-runtime-router-key'
      },
      body: {
        model: 'sciforge-router',
        input: 'remind me tomorrow to stretch',
        max_output_tokens: 300,
        text: { format: { type: 'json_object' } }
      }
    })
  })

  it('fails closed without a Model Router runtime key', async () => {
    const appSettings = settings()
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      runtimeApiKey: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectClawScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      'deepseek-v4-pro',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed without a Model Router base URL', async () => {
    const appSettings = settings()
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      baseUrl: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await detectClawScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      'deepseek-v4-pro',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not fall back to a direct remote provider endpoint', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push(String(url))
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })

    await detectClawScheduledTaskRequest(
      settings(),
      'remind me tomorrow to stretch',
      'remote-provider-model',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls).toEqual(['http://127.0.0.1:49876/v1/responses'])
  })
})
