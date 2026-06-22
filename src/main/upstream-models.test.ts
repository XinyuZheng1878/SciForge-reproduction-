import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { fetchUpstreamModelIds, readConfiguredKunModelIds } from './upstream-models'

function settings(dataDir: string, model = 'settings-model'): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: {
      ...provider,
      providers: [
        ...provider.providers,
        {
          id: 'custom-provider',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'responses',
          models: ['custom-provider-model']
        }
      ]
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'sciforge-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        dataDir,
        model,
        providerId: 'custom-provider'
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
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('upstream model picker list', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes Kun config model profiles, aliases, and the configured agent model', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({
        contextCompaction: {
          modelProfiles: {
            'legacy-model': {}
          }
        },
        models: {
          profiles: {
            'custom-model': {
              aliases: ['vendor/custom-model']
            }
          }
        }
      }),
      'utf8'
    )

    const ids = await readConfiguredKunModelIds(settings(dataDir))

    expect(ids).toEqual(expect.arrayContaining([
      'auto',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'sciforge-router',
      'legacy-model',
      'custom-model',
      'vendor/custom-model'
    ]))
  })

  it('queries the local Model Router /v1/models with the runtime API key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    await mkdir(dataDir, { recursive: true })
    await writeFile(
      join(dataDir, 'config.json'),
      JSON.stringify({
        models: {
          profiles: {
            'deepseek-v4-flash': {
              aliases: ['deepseek-chat', 'deepseek-reasoner']
            }
          }
        }
      }),
      'utf8'
    )
    const calls: Array<{ url: string; method: string | undefined; headers: HeadersInit | undefined }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers
      })
      return new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'sciforge-router', object: 'model' }]
      }), { status: 200 })
    })

    const result = await fetchUpstreamModelIds(settings(dataDir, 'local-only-model'), 'sk-direct-provider')

    expect(result).toMatchObject({ ok: true })
    expect(calls).toEqual([
      expect.objectContaining({
        url: 'http://127.0.0.1:49876/v1/models',
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer local-runtime-router-key'
        })
      })
    ])
    if (result.ok) {
      expect(result.modelIds).toContain('sciforge-router')
      expect(result.modelIds).toContain('custom-provider-model')
      expect(result.modelGroups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          providerId: 'custom-provider',
          label: 'Custom Provider',
          modelIds: expect.arrayContaining(['custom-provider-model'])
        }),
        expect.objectContaining({
          providerId: 'deepseek',
          label: 'DeepSeek',
          modelIds: expect.arrayContaining(['deepseek-chat', 'deepseek-reasoner'])
        })
      ]))
    }
  })

  it('fails closed without a Model Router runtime key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    const appSettings = settings(dataDir, 'local-only-model')
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      runtimeApiKey: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchUpstreamModelIds(appSettings, 'sk-direct-provider')

    expect(result).toMatchObject({
      ok: false,
      message: 'Missing Model Router runtime API key; cannot query local /v1/models.'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed without a Model Router base URL', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'deepseek-gui-models-'))
    const appSettings = settings(dataDir, 'local-only-model')
    appSettings.modelRouter = {
      ...appSettings.modelRouter!,
      baseUrl: ''
    }
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await fetchUpstreamModelIds(appSettings, 'sk-direct-provider')

    expect(result).toMatchObject({
      ok: false,
      message: 'Missing Model Router base URL; cannot query local /v1/models.'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
