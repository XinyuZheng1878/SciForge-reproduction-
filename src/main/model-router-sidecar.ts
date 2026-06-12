import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_KUN_MODEL,
  getKunRuntimeSettings,
  getModelProviderProfile,
  getModelRouterSettings,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsV1
} from '../shared/app-settings'
import { checkModelRouterHealth } from './model-router-health'

const ROUTER_RUNTIME_KEY_ENV = 'DEEPSEEK_GUI_MODEL_ROUTER_RUNTIME_API_KEY'
const TEXT_REASONER_KEY_ENV = 'DEEPSEEK_GUI_MODEL_ROUTER_TEXT_API_KEY'
const VISION_TRANSLATOR_KEY_ENV = 'DEEPSEEK_GUI_MODEL_ROUTER_VISION_API_KEY'

let modelRouterChild: ChildProcess | null = null

type ModelRouterProviderConfig = {
  provider: string
  baseUrl: string
  apiKeyEnv: string
  model: string
}

type ModelRouterSidecarConfig = {
  defaultProfile: string
  publicModelAlias: string
  profiles: Record<string, {
    traceRoot: string
    textReasoner: ModelRouterProviderConfig
    translators: {
      vision?: ModelRouterProviderConfig
    }
  }>
}

export type ModelRouterSidecarLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  configPath: string
  config?: ModelRouterSidecarConfig
}

export type ModelRouterSidecarLaunchResult =
  | { ok: true; launch: ModelRouterSidecarLaunch }
  | { ok: false; reason: string }

export function buildModelRouterSidecarLaunch(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    env?: NodeJS.ProcessEnv
    npmCommand?: string
  }
): ModelRouterSidecarLaunchResult {
  const router = getModelRouterSettings(settings)
  if (!router.enabled) return { ok: false, reason: 'Model Router is disabled.' }
  if (!router.autoStart) return { ok: false, reason: 'Model Router auto-start is disabled.' }
  if (!router.baseUrl.trim()) return { ok: false, reason: 'Model Router base URL is required.' }
  if (!router.runtimeApiKey.trim()) return { ok: false, reason: 'Model Router runtime API key is required.' }
  if (!router.publicModelAlias.trim()) return { ok: false, reason: 'Model Router public model alias is required.' }

  const port = localPortFromRouterBaseUrl(router.baseUrl)
  if (!port) return { ok: false, reason: 'Model Router base URL must be a local http://127.0.0.1 or localhost URL with a port.' }

  const configPath = modelRouterConfigPath(options.userDataDir)
  const baseEnv = options.env ?? process.env
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const textReasoner = router.profiles.default.textReasoner
  const vision = router.profiles.default.translators.vision
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    [ROUTER_RUNTIME_KEY_ENV]: router.runtimeApiKey,
    [TEXT_REASONER_KEY_ENV]: textReasoner.apiKey.trim() || provider.apiKey.trim()
  }
  if (vision.apiKey.trim()) {
    env[VISION_TRANSLATOR_KEY_ENV] = vision.apiKey.trim()
  }

  const npmCommand = options.npmCommand ?? (process.platform === 'win32' ? 'npm.cmd' : 'npm')
  return {
    ok: true,
    launch: {
      command: npmCommand,
      args: [
        '--workspace',
        '@sciforge/model-router',
        'run',
        'start',
        '--',
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--config',
        configPath,
        '--workspace-root',
        settings.workspaceRoot || join(options.userDataDir, 'model-router'),
        '--quiet'
      ],
      env,
      configPath
    }
  }
}

export function modelRouterConfigPath(userDataDir: string): string {
  return join(userDataDir, 'model-router', 'config.json')
}

export async function ensureModelRouterConfigFile(
  settings: AppSettingsV1,
  options: { userDataDir: string }
): Promise<{ path: string; created: boolean }> {
  const path = modelRouterConfigPath(options.userDataDir)
  await mkdir(join(options.userDataDir, 'model-router'), { recursive: true })
  const config = defaultModelRouterSidecarConfig(settings, options.userDataDir)
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { path, created: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return { path, created: false }
    throw error
  }
}

export async function ensureModelRouterSidecar(
  settings: AppSettingsV1,
  options: {
    userDataDir: string
    env?: NodeJS.ProcessEnv
    spawnImpl?: typeof spawn
    log?: (message: string) => void
  }
): Promise<void> {
  if (modelRouterChild && modelRouterChild.exitCode === null && modelRouterChild.signalCode === null) return
  const health = await checkModelRouterHealth(settings).catch(() => null)
  if (health?.status === 'healthy') return

  const launch = buildModelRouterSidecarLaunch(settings, {
    userDataDir: options.userDataDir,
    env: options.env
  })
  if (!launch.ok) {
    options.log?.(launch.reason)
    return
  }
  await ensureModelRouterConfigFile(settings, { userDataDir: options.userDataDir })
  const spawnImpl = options.spawnImpl ?? spawn
  modelRouterChild = spawnImpl(launch.launch.command, launch.launch.args, {
    env: launch.launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  const child = modelRouterChild
  child.once('exit', () => {
    if (modelRouterChild === child) modelRouterChild = null
  })
}

function defaultModelRouterSidecarConfig(
  settings: AppSettingsV1,
  userDataDir: string
): ModelRouterSidecarConfig & { runtimeApiKeyEnv: string } {
  const router = getModelRouterSettings(settings)
  const runtime = getKunRuntimeSettings(settings)
  const provider = getModelProviderProfile(settings, runtime.providerId)
  const textReasoner = router.profiles.default.textReasoner
  const vision = providerConfig(router.profiles.default.translators.vision, VISION_TRANSLATOR_KEY_ENV)
  const configRoot = join(userDataDir, 'model-router')

  return {
    defaultProfile: 'default',
    publicModelAlias: router.publicModelAlias,
    runtimeApiKeyEnv: ROUTER_RUNTIME_KEY_ENV,
    profiles: {
      default: {
        traceRoot: join(configRoot, 'traces'),
        textReasoner: {
          provider: textReasoner.provider.trim() || provider.id || 'openai-compatible',
          baseUrl: provider.baseUrl.trim() || textReasoner.baseUrl.trim(),
          apiKeyEnv: TEXT_REASONER_KEY_ENV,
          model: runtime.model.trim() || textReasoner.model.trim() || DEFAULT_KUN_MODEL
        },
        translators: {
          ...(vision ? { vision } : {})
        }
      }
    }
  }
}

export async function stopModelRouterSidecar(): Promise<void> {
  const child = modelRouterChild
  if (!child) return
  modelRouterChild = null
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

function providerConfig(
  provider: ModelRouterMemberProviderSettingsV1,
  apiKeyEnv: string
): ModelRouterProviderConfig | null {
  if (!provider.provider.trim() || !provider.baseUrl.trim() || !provider.model.trim()) return null
  return {
    provider: provider.provider,
    baseUrl: provider.baseUrl,
    apiKeyEnv,
    model: provider.model
  }
}

function localPortFromRouterBaseUrl(baseUrl: string): number | null {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== 'localhost')) return null
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}
