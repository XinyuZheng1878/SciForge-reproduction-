import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getClaudeRuntimeSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'

const UPSTREAM_PROVIDER_SECRET_ENVS = [
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'OPENROUTER_API_KEY',
  'AZURE_OPENAI_API_KEY'
] as const
const UPSTREAM_PROVIDER_ENV_PREFIXES = [
  'OPENAI',
  'DEEPSEEK',
  'ANTHROPIC',
  'QWEN',
  'DASHSCOPE',
  'GEMINI',
  'GOOGLE',
  'GROQ',
  'MISTRAL',
  'COHERE',
  'OPENROUTER',
  'AZURE_OPENAI'
] as const
const UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES = [
  'MODEL',
  'BASE_URL',
  'API_BASE',
  'API_BASE_URL'
] as const
const UPSTREAM_PROVIDER_CONFIG_ENVS = ['MODEL_PROVIDER'] as const
export const DEFAULT_CLAUDE_CODE_CLI_MODEL = 'sonnet'

export type ClaudeCodeLaunchConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  configDir: string
  model: string
  permissionMode: string
}

export async function prepareClaudeCodeTurnLaunch(options: {
  settings: AppSettingsV1
  text: string
  workspace?: string
  sessionId?: string
  env?: NodeJS.ProcessEnv
  managedConfigDir?: string
}): Promise<ClaudeCodeLaunchConfig> {
  const runtime = getClaudeRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Claude Code command is required.')
  const configDir = expandHome(options.managedConfigDir || runtime.configDir)
  if (!configDir) throw new Error('Claude Code config directory is required.')
  const router = claudeModelRouterConfig(options.settings)
  const cwd = resolveClaudeWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Claude Code workspace is required.')
  await mkdir(configDir, { recursive: true })
  const permissionMode = claudePermissionMode(runtime)
  const cliModel = claudeCodeCliModel(runtime.model, router.model)
  const args = [
    '-p',
    options.text,
    '--output-format',
    'stream-json',
    '--verbose',
    '--bare',
    '--model',
    cliModel,
    '--permission-mode',
    permissionMode,
    ...(options.sessionId ? ['--resume', options.sessionId] : []),
    ...claudeCodeExtraArgs(runtime.extraArgs)
  ]
  return {
    command,
    args,
    cwd,
    env: claudeCodeRuntimeEnv(options.env ?? process.env, {
      configDir,
      baseUrl: claudeCodeAnthropicBaseUrl(router.baseUrl),
      apiKey: router.apiKey,
      model: cliModel
    }),
    configDir,
    model: cliModel,
    permissionMode
  }
}

export function resolveClaudeWorkspace(settings: AppSettingsV1, workspace?: string): string {
  return expandHome(workspace || settings.workspaceRoot || '~')
}

export function claudeCodeRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  runtime: {
    configDir: string
    baseUrl: string
    apiKey: string
    model: string
  }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  for (const key of UPSTREAM_PROVIDER_SECRET_ENVS) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key)) {
      delete env[key]
    }
  }
  env.ANTHROPIC_BASE_URL = claudeCodeAnthropicBaseUrl(runtime.baseUrl)
  env.ANTHROPIC_API_KEY = runtime.apiKey
  env.ANTHROPIC_AUTH_TOKEN = runtime.apiKey
  env.ANTHROPIC_MODEL = runtime.model
  env.ANTHROPIC_SMALL_FAST_MODEL = runtime.model
  env.CLAUDE_CONFIG_DIR = runtime.configDir
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

export function claudeCodeExtraArgs(args: readonly string[]): string[] {
  const controlledWithValue = new Set([
    '-p',
    '--print',
    '--output-format',
    '--input-format',
    '--cwd',
    '--model',
    '--permission-mode',
    '--resume',
    '--settings',
    '--append-system-prompt',
    '--system-prompt'
  ])
  const controlledFlags = new Set([
    '--verbose',
    '--bare',
    '--continue',
    '--dangerously-skip-permissions'
  ])
  const filtered: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (controlledFlags.has(arg)) continue
    if (controlledWithValue.has(arg)) {
      index += 1
      continue
    }
    if ([...controlledFlags].some((flag) => arg.startsWith(`${flag}=`))) continue
    if ([...controlledWithValue].some((flag) => arg.startsWith(`${flag}=`))) continue
    filtered.push(arg)
  }
  return filtered
}

export function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

export function claudeCodeCliModel(configuredModel: string | undefined, routerModel: string): string {
  const model = typeof configuredModel === 'string' ? configuredModel.trim() : ''
  if (model && model !== routerModel && isClaudeCodeCliModel(model)) return model
  return DEFAULT_CLAUDE_CODE_CLI_MODEL
}

export function claudeCodeAnthropicBaseUrl(routerBaseUrl: string): string {
  return routerBaseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
}

function claudeModelRouterConfig(settings: AppSettingsV1): {
  baseUrl: string
  apiKey: string
  model: string
} {
  const router = resolveRuntimeModelRouterSettings(settings)
  const baseUrl = router.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Claude Code Model Router base URL is required.')
  if (!baseUrl.endsWith('/v1')) {
    throw new Error('Claude Code Model Router base URL must end with /v1.')
  }
  if (!isLocalHttpUrl(baseUrl)) {
    throw new Error('Claude Code Model Router base URL must be local.')
  }
  if (!router.apiKey) throw new Error('Claude Code Model Router runtime API key is required.')
  return {
    baseUrl,
    apiKey: router.apiKey,
    model: router.model || DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  }
}

function claudePermissionMode(runtime: {
  sandboxMode: SandboxMode
  approvalPolicy: ApprovalPolicy
}): string {
  if (runtime.sandboxMode === 'read-only') return 'plan'
  if (
    runtime.sandboxMode === 'danger-full-access' &&
    (runtime.approvalPolicy === 'never' || runtime.approvalPolicy === 'auto')
  ) {
    return 'bypassPermissions'
  }
  return 'acceptEdits'
}

function isClaudeCodeCliModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return normalized === 'sonnet' ||
    normalized === 'opus' ||
    normalized === 'fable' ||
    normalized === 'haiku' ||
    normalized.startsWith('claude-')
}

function appendNoProxyLoopbacks(value: string | undefined): string {
  const required = ['127.0.0.1', 'localhost', '::1']
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const existing = new Set(parts.map((part) => part.toLowerCase()))
  for (const entry of required) {
    if (!existing.has(entry.toLowerCase())) parts.push(entry)
  }
  return parts.join(',')
}

function isUpstreamProviderConfigEnv(key: string): boolean {
  if (UPSTREAM_PROVIDER_CONFIG_ENVS.includes(key as typeof UPSTREAM_PROVIDER_CONFIG_ENVS[number])) {
    return true
  }
  if (/^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key)) {
    return true
  }
  return UPSTREAM_PROVIDER_ENV_PREFIXES.some((prefix) =>
    UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES.some((suffix) => key === `${prefix}_${suffix}`)
  )
}

function isLocalHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}
