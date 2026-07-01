import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  buildModelRouterSidecarLaunch,
  ensureModelRouterSidecar,
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
      publicModelAlias: 'sciforge-router',
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
              model: 'vision-model',
              maxSupplementRounds: 1
            }
          }
        }
      }
    },
    activeAgentRuntime: 'sciforge',
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

describe('buildModelRouterSidecarLaunch', () => {
  it('builds a dev workspace launch without writing provider secrets into config', () => {
    const result = buildModelRouterSidecarLaunch(settings(), {
      userDataDir: '/tmp/sciforge-user-data',
      appRoot: '/repo/sciforge',
      env: {
        OPENAI_API_KEY: 'outer-openai-key',
        OPENAI_BASE_URL: 'https://outer-openai.example/v1',
        OPENAI_MODEL: 'outer-openai-model',
        DEEPSEEK_API_KEY: 'outer-deepseek-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com/v1',
        ANTHROPIC_API_KEY: 'outer-anthropic-key',
        ANTHROPIC_AUTH_TOKEN: 'outer-anthropic-token',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'outer-sonnet',
        QWEN_API_KEY: 'outer-qwen-key',
        QWEN_BASE_URL: 'https://dashscope.example/v1',
        MODEL_PROVIDER: 'outer-provider',
        KUN_BASE_URL: 'https://old-runtime-provider.example/v1',
        SCIFORGE_TEXT_API_KEY: 'outer-standalone-text-key',
        SCIFORGE_TEXT_BASE_URL: 'https://outer-standalone-text.example/v1',
        SCIFORGE_TEXT_MODEL: 'outer-standalone-text-model',
        SCIFORGE_VISION_API_KEY: 'outer-standalone-vision-key',
        SCIFORGE_VISION_BASE_URL: 'https://outer-standalone-vision.example/v1',
        SCIFORGE_VISION_MODEL: 'outer-standalone-vision-model',
        SCIFORGE_IMAGE_API_KEY: 'outer-image-key',
        SCIFORGE_IMAGE_BASE_URL: 'https://direct-image-provider.example/v1',
        SCIFORGE_IMAGE_MODEL: 'outer-image-model',
        SCIFORGE_IMAGE_ALLOW_PLACEHOLDER: '1',
        EDAG_LLM_BASE_URL: 'https://direct-edag-provider.example/v1',
        EDAG_LLM_API_KEY: 'outer-edag-key',
        EDAG_LLM_MODEL: 'outer-edag-model',
        EXPERT_PROVIDER_BASE_URL: 'http://127.0.0.1:8001/v1',
        EXPERT_PROVIDER_API_KEY: 'outer-expert-token',
        SCIMODALITY_ROUTER_PORT: '3898',
        SCIMODALITY_ROUTER_RUNTIME_TOKEN: 'outer-router-token',
        SCIFORGE_SCIMODALITY_SERVICE_URL: 'http://127.0.0.1:3898',
        SCIFORGE_SCIMODALITY_SERVICE_TOKEN: 'sci-modality-token',
        SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS: '12345'
      },
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.command).toBe('npm')
    expect(result.launch.cwd).toBe('/repo/sciforge')
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
      '/tmp/sciforge-user-data/model-router/config.json',
      '--workspace-root',
      '/tmp/workspace',
      '--quiet'
    ])
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(result.launch.env.OPENAI_BASE_URL).toBeUndefined()
    expect(result.launch.env.OPENAI_MODEL).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(result.launch.env.DEEPSEEK_BASE_URL).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(result.launch.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(result.launch.env.QWEN_API_KEY).toBeUndefined()
    expect(result.launch.env.QWEN_BASE_URL).toBeUndefined()
    expect(result.launch.env.MODEL_PROVIDER).toBeUndefined()
    expect(result.launch.env.KUN_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_TEXT_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_VISION_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_BASE_URL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_MODEL).toBeUndefined()
    expect(result.launch.env.SCIFORGE_IMAGE_ALLOW_PLACEHOLDER).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_BASE_URL).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_API_KEY).toBeUndefined()
    expect(result.launch.env.EDAG_LLM_MODEL).toBeUndefined()
    expect(result.launch.env.EXPERT_PROVIDER_BASE_URL).toBeUndefined()
    expect(result.launch.env.EXPERT_PROVIDER_API_KEY).toBeUndefined()
    expect(result.launch.env.SCIMODALITY_ROUTER_PORT).toBeUndefined()
    expect(result.launch.env.SCIMODALITY_ROUTER_RUNTIME_TOKEN).toBeUndefined()
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_URL).toBe('http://127.0.0.1:3898')
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN).toBe('sci-modality-token')
    expect(result.launch.env.SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS).toBe('12345')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('text-secret')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_VISION_API_KEY).toBe('vision-secret')
    expect(result.launch.config?.profiles.default.textReasoner).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:3892/v1',
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_TEXT_API_KEY',
      model: 'deepseek-v4-pro'
    })
    expect(JSON.stringify(result.launch.config)).not.toContain('text-secret')
    expect(JSON.stringify(result.launch.config)).not.toContain('vision-secret')
    expect(result.launch.config?.profiles.default.translators.vision).toEqual({
      provider: 'qwen-compatible',
      baseUrl: 'https://vision-provider.example/v1',
      apiKeyEnv: 'SCIFORGE_MODEL_ROUTER_VISION_API_KEY',
      model: 'vision-model',
      maxSupplementRounds: 1
    })
  })

  it('builds a launch when the text reasoner member is incomplete in UI settings', () => {
    const current = settings()
    current.modelRouter!.profiles.default.textReasoner.apiKey = ''
    current.modelRouter!.profiles.default.textReasoner.baseUrl = ''
    current.modelRouter!.profiles.default.textReasoner.model = ''

    const result = buildModelRouterSidecarLaunch(current, {
      userDataDir: '/tmp/sciforge-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.configPath).toBe('/tmp/sciforge-user-data/model-router/config.json')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY).toBe('local-runtime-key')
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
      userDataDir: '/tmp/sciforge-user-data',
      env: {},
      npmCommand: 'npm'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.launch.configPath).toBe('/tmp/sciforge-user-data/model-router/config.json')
    expect(result.launch.config?.profiles.default.textReasoner.apiKeyEnv).toBe('SCIFORGE_MODEL_ROUTER_TEXT_API_KEY')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('')
    expect(result.launch.env.SCIFORGE_MODEL_ROUTER_TEXT_API_KEY).toBe('')
    expect(result.launch.args).toContain('/tmp/sciforge-user-data/model-router/config.json')
  })

  it('creates a local Model Router config template without overwriting an existing file', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-config-'))
    try {
      const current = settings()
      current.provider.apiKey = 'text-secret'
      current.provider.baseUrl = 'https://text.example/v1'
      current.agents.sciforge.model = 'deepseek-v4-pro'

      const created = await ensureModelRouterConfigFile(current, { userDataDir })
      const content = await readFile(created.path, 'utf8')

      expect(created.created).toBe(true)
      expect(created.path).toBe(modelRouterConfigPath(userDataDir))
      expect(content).toContain('"publicModelAlias": "sciforge-router"')
      expect(content).toContain('"baseUrl": "https://text.example/v1"')
      expect(content).toContain('"apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY"')
      expect(content).toContain('"model": "deepseek-v4-pro"')
      expect(content).not.toContain('text-secret')

      await ensureModelRouterConfigFile(current, { userDataDir })
      const afterSecondEnsure = await readFile(created.path, 'utf8')
      expect(afterSecondEnsure).toBe(content)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('spawns from the explicit app root and logs sidecar output and unexpected exits', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-'))
    const current = settings()
    current.modelRouter!.baseUrl = 'http://127.0.0.1:45987/v1'
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const log = vi.fn()

    try {
      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledWith(
        'npm',
        expect.arrayContaining(['--workspace', '@sciforge/model-router']),
        expect.objectContaining({
          cwd: '/repo/sciforge',
          stdio: ['ignore', 'pipe', 'pipe']
        })
      )

      child.stderr?.emit('data', Buffer.from('router boot failed\n'))
      child.emit('exit', 1, null)

      expect(log).toHaveBeenCalledWith('Starting Model Router sidecar from /repo/sciforge.')
      expect(log).toHaveBeenCalledWith('Model Router sidecar stderr: router boot failed')
      expect(log).toHaveBeenCalledWith('Model Router sidecar exited unexpectedly (code=1, signal=null).')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('rewrites the managed config before spawning the sidecar', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-config-'))
    const current = settings()
    current.modelRouter!.baseUrl = 'http://127.0.0.1:45990/v1'
    current.modelRouter!.profiles.default.textReasoner = {
      provider: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      model: ''
    }
    current.provider.apiKey = 'provider-secret'
    current.provider.baseUrl = 'http://127.0.0.1:48767/v1'
    current.agents.sciforge.model = 'deepseek-v4-pro'
    const child = fakeChildProcess()
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn

    try {
      await mkdir(join(userDataDir, 'model-router'), { recursive: true })
      await writeFile(modelRouterConfigPath(userDataDir), '{"publicModelAlias":"stale-router"}\n', 'utf8')

      await ensureModelRouterSidecar(current, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl
      })

      const content = await readFile(modelRouterConfigPath(userDataDir), 'utf8')
      const parsed = JSON.parse(content)
      expect(parsed.publicModelAlias).toBe('sciforge-router')
      expect(parsed.profiles.default.textReasoner.baseUrl).toBe('http://127.0.0.1:48767/v1')
      expect(parsed.profiles.default.textReasoner.model).toBe('deepseek-v4-pro')
      expect(content).toContain('"apiKeyEnv": "SCIFORGE_MODEL_ROUTER_TEXT_API_KEY"')
      expect(content).not.toContain('provider-secret')
      expect(spawnImpl).toHaveBeenCalledTimes(1)
      child.emit('exit', 0, null)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('restarts a managed sidecar when the derived router config changes', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-config-restart-'))
    const firstChild = fakeChildProcess()
    const secondChild = fakeChildProcess()
    const children = [firstChild, secondChild]
    const spawnImpl = vi.fn(() => children.shift() ?? fakeChildProcess()) as unknown as typeof spawn
    const log = vi.fn()

    try {
      const firstSettings = settings()
      firstSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45991/v1'
      firstSettings.provider.baseUrl = 'http://127.0.0.1:48767/v1'
      firstSettings.modelRouter!.profiles.default.textReasoner.baseUrl = ''

      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      const secondSettings = settings()
      secondSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45991/v1'
      secondSettings.provider.baseUrl = 'http://127.0.0.1:48768/v1'
      secondSettings.modelRouter!.profiles.default.textReasoner.baseUrl = ''

      await ensureModelRouterSidecar(secondSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(2)
      expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM')
      expect(log).toHaveBeenCalledWith('Model Router sidecar launch settings changed; restarting sidecar.')
      secondChild.emit('exit', 0, null)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it('reuses matching sidecars and restarts when managed launch settings change', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-router-sidecar-restart-'))
    const firstChild = fakeChildProcess()
    const secondChild = fakeChildProcess()
    const children = [firstChild, secondChild]
    const spawnImpl = vi.fn(() => children.shift() ?? fakeChildProcess()) as unknown as typeof spawn
    const log = vi.fn()

    try {
      const firstSettings = settings()
      firstSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })
      await ensureModelRouterSidecar(firstSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      const secondSettings = settings()
      secondSettings.modelRouter!.baseUrl = 'http://127.0.0.1:45988/v1'
      secondSettings.modelRouter!.runtimeApiKey = 'local-runtime-key-2'
      await ensureModelRouterSidecar(secondSettings, {
        userDataDir,
        appRoot: '/repo/sciforge',
        env: {},
        spawnImpl,
        log
      })

      expect(spawnImpl).toHaveBeenCalledTimes(2)
      expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM')
      expect(log).toHaveBeenCalledWith('Model Router sidecar launch settings changed; restarting sidecar.')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess & {
    stdout: NonNullable<ChildProcess['stdout']>
    stderr: NonNullable<ChildProcess['stderr']>
    exitCode: number | null
    signalCode: NodeJS.Signals | null
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    child.exitCode = 0
    child.signalCode = typeof signal === 'string' ? signal : null
    child.emit('exit', child.exitCode, child.signalCode)
    return true
  }) as unknown as ChildProcess['kill']
  return child
}
