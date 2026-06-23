import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  getCodexRuntimeSettings,
  isComputerUseEnabledForRuntime,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  buildResearchSearchMcpArgs,
  GUI_RESEARCH_MCP_SERVER_NAME,
  researchSearchMcpEnv,
  resolveResearchSearchMcpCommand,
  type ResearchSearchMcpLaunchConfig
} from '../../research-search-mcp-config'
import {
  buildClawScheduleMcpArgs,
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  resolveClawScheduleMcpCommand,
  type ClawScheduleMcpLaunchConfig
} from '../../claw-schedule-mcp-config'
import {
  buildComputerUseMcpArgs,
  computerUseMcpEnvForLaunch,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  resolveComputerUseMcpCommand,
  type ComputerUseMcpLaunchConfig
} from '../../computer-use-mcp-config'
import {
  buildWorkflowMcpArgs,
  GUI_WORKFLOW_INTERNAL_SECRET_ENV,
  GUI_WORKFLOW_MCP_SERVER_NAME,
  resolveWorkflowMcpCommand,
  type WorkflowMcpLaunchConfig,
  workflowMcpEnv
} from '../../workflow-mcp-config'
import {
  buildWorkspaceIntelMcpArgs,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  resolveWorkspaceIntelMcpCommand,
  type WorkspaceIntelMcpLaunchConfig,
  workspaceIntelMcpEnv
} from '../../workspace-intel-mcp-config'
import {
  buildPaperRadarMcpArgs,
  GUI_PAPER_RADAR_MCP_SERVER_NAME,
  paperRadarMcpEnv,
  resolvePaperRadarMcpCommand,
  type PaperRadarMcpLaunchConfig
} from '../../paper-radar-mcp-config'
import {
  buildWriteAssistMcpArgs,
  GUI_WRITE_ASSIST_MCP_SERVER_NAME,
  resolveWriteAssistMcpCommand,
  type WriteAssistMcpLaunchConfig,
  writeAssistMcpEnv
} from '../../write-assist-mcp-config'
import {
  buildRuntimeInspectorMcpArgs,
  GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  resolveRuntimeInspectorMcpCommand,
  runtimeInspectorMcpEnv,
  type RuntimeInspectorMcpLaunchConfig
} from '../../runtime-inspector-mcp-config'

const RUNTIME_API_KEY_ENV = 'SCIFORGE_RUNTIME_API_KEY'
const LEGACY_RUNTIME_API_KEY_ENV = 'DEEPSEEK_GUI_RUNTIME_API_KEY'
const CODEX_MANAGED_DIRS = ['sessions', 'memories', 'logs'] as const
const UPSTREAM_PROVIDER_SECRET_ENVS = [
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
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

export type CodexAppServerLaunchConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  codexHome: string
}

export async function prepareCodexAppServerLaunch(options: {
  settings: AppSettingsV1
  workspace?: string
  env?: NodeJS.ProcessEnv
  managedCodexHome?: string
  scheduleMcpLaunch?: ClawScheduleMcpLaunchConfig
  researchMcpLaunch?: ResearchSearchMcpLaunchConfig
  workflowMcpLaunch?: WorkflowMcpLaunchConfig
  workspaceIntelMcpLaunch?: WorkspaceIntelMcpLaunchConfig
  paperRadarMcpLaunch?: PaperRadarMcpLaunchConfig
  writeAssistMcpLaunch?: WriteAssistMcpLaunchConfig
  runtimeInspectorMcpLaunch?: RuntimeInspectorMcpLaunchConfig
  computerUseMcpLaunch?: ComputerUseMcpLaunchConfig
}): Promise<CodexAppServerLaunchConfig> {
  const runtime = getCodexRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Codex command is required.')
  const codexHome = expandHome(options.managedCodexHome || runtime.codexHome)
  if (!codexHome) throw new Error('Codex CODEX_HOME is required.')
  const modelRouter = codexModelRouterConfig(options.settings)
  const computerUseMcpLaunch = isComputerUseEnabledForRuntime(options.settings, 'codex')
    ? options.computerUseMcpLaunch
    : undefined
  const cwd = resolveCodexWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Codex workspace is required.')
  await prepareManagedCodexHome(
    codexHome,
    modelRouter,
    options.settings,
    options.scheduleMcpLaunch,
    options.researchMcpLaunch,
    options.workflowMcpLaunch,
    options.workspaceIntelMcpLaunch,
    options.paperRadarMcpLaunch,
    options.writeAssistMcpLaunch,
    options.runtimeInspectorMcpLaunch,
    computerUseMcpLaunch,
    options.env ?? process.env
  )
  return {
    command,
    args: ['app-server', '--listen', 'stdio://', ...codexAppServerExtraArgs(runtime.extraArgs)],
    cwd,
    env: codexRuntimeEnv(
      options.env ?? process.env,
      codexHome,
      modelRouter.apiKey,
      {
        ...(options.scheduleMcpLaunch && options.settings.schedule.internal.secret.trim()
          ? { [GUI_SCHEDULE_INTERNAL_SECRET_ENV]: options.settings.schedule.internal.secret.trim() }
          : {}),
        ...(options.workflowMcpLaunch && options.settings.workflow.webhookSecret.trim()
          ? { [GUI_WORKFLOW_INTERNAL_SECRET_ENV]: options.settings.workflow.webhookSecret.trim() }
          : {})
      }
    ),
    codexHome
  }
}

export function codexAppServerExtraArgs(args: readonly string[]): string[] {
  const filtered: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--profile-v2') continue
    if (arg === '--profile' || arg === '-p') {
      index += 1
      continue
    }
    if (arg.startsWith('--profile=')) continue
    filtered.push(arg)
  }
  return filtered
}

export function resolveCodexWorkspace(settings: AppSettingsV1, workspace?: string): string {
  return expandHome(workspace || settings.workspaceRoot || '~')
}

export function codexRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  codexHome: string,
  runtimeApiKey?: string,
  localSecrets: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    CODEX_HOME: codexHome,
    ...localSecrets
  }
  delete env.CODEX_USER_HOME
  delete env.CODEX_CONFIG_HOME
  for (const key of UPSTREAM_PROVIDER_SECRET_ENVS) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key)) {
      delete env[key]
    }
  }
  if (runtimeApiKey !== undefined) {
    env[RUNTIME_API_KEY_ENV] = runtimeApiKey
    env[LEGACY_RUNTIME_API_KEY_ENV] = runtimeApiKey
  }
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

export function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
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

async function prepareManagedCodexHome(
  codexHome: string,
  modelRouter: CodexModelRouterConfig,
  settings: AppSettingsV1,
  scheduleMcpLaunch: ClawScheduleMcpLaunchConfig | undefined,
  researchMcpLaunch: ResearchSearchMcpLaunchConfig | undefined,
  workflowMcpLaunch: WorkflowMcpLaunchConfig | undefined,
  workspaceIntelMcpLaunch: WorkspaceIntelMcpLaunchConfig | undefined,
  paperRadarMcpLaunch: PaperRadarMcpLaunchConfig | undefined,
  writeAssistMcpLaunch: WriteAssistMcpLaunchConfig | undefined,
  runtimeInspectorMcpLaunch: RuntimeInspectorMcpLaunchConfig | undefined,
  computerUseMcpLaunch: ComputerUseMcpLaunchConfig | undefined,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await mkdir(codexHome, { recursive: true })
  await Promise.all(
    CODEX_MANAGED_DIRS.map((dir) => mkdir(join(codexHome, dir), { recursive: true }))
  )
  await writeFile(
    join(codexHome, 'config.toml'),
    codexConfigToml(
      modelRouter,
      settings,
      scheduleMcpLaunch,
      researchMcpLaunch,
      workflowMcpLaunch,
      workspaceIntelMcpLaunch,
      paperRadarMcpLaunch,
      writeAssistMcpLaunch,
      runtimeInspectorMcpLaunch,
      computerUseMcpLaunch,
      env
    ),
    'utf8'
  )
}

type CodexModelRouterConfig = {
  baseUrl: string
  apiKey: string
}

function codexModelRouterConfig(settings: AppSettingsV1): CodexModelRouterConfig {
  const router = resolveRuntimeModelRouterSettings(settings)
  const baseUrl = router.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Codex Model Router base URL is required.')
  if (!baseUrl.endsWith('/v1')) {
    throw new Error('Codex Model Router base URL must end with /v1.')
  }
  if (!isLocalHttpUrl(baseUrl)) {
    throw new Error('Codex Model Router base URL must be local.')
  }
  if (!router.apiKey) throw new Error('Codex Model Router runtime API key is required.')
  if (
    (router.model || DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS) !==
    DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
  ) {
    throw new Error(`Codex Model Router model must be ${DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS}.`)
  }
  return {
    baseUrl,
    apiKey: router.apiKey
  }
}

function codexConfigToml(
  modelRouter: CodexModelRouterConfig,
  settings: AppSettingsV1,
  scheduleMcpLaunch: ClawScheduleMcpLaunchConfig | undefined,
  researchMcpLaunch: ResearchSearchMcpLaunchConfig | undefined,
  workflowMcpLaunch: WorkflowMcpLaunchConfig | undefined,
  workspaceIntelMcpLaunch: WorkspaceIntelMcpLaunchConfig | undefined,
  paperRadarMcpLaunch: PaperRadarMcpLaunchConfig | undefined,
  writeAssistMcpLaunch: WriteAssistMcpLaunchConfig | undefined,
  runtimeInspectorMcpLaunch: RuntimeInspectorMcpLaunchConfig | undefined,
  computerUseMcpLaunch: ComputerUseMcpLaunchConfig | undefined,
  env: NodeJS.ProcessEnv
): string {
  return [
    `model = "${tomlString(DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS)}"`,
    `model_provider = "${tomlString(DEFAULT_MODEL_ROUTER_PROVIDER_ID)}"`,
    '',
    `[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`,
    'name = "SciForge Model Router"',
    `base_url = "${tomlString(modelRouter.baseUrl)}"`,
    `env_key = "${RUNTIME_API_KEY_ENV}"`,
    'wire_api = "responses"',
    ...(scheduleMcpLaunch ? codexScheduleMcpServerToml(settings, scheduleMcpLaunch) : []),
    ...(researchMcpLaunch ? codexResearchMcpServerToml(researchMcpLaunch, env) : []),
    ...(workflowMcpLaunch ? codexWorkflowMcpServerToml(settings, workflowMcpLaunch) : []),
    ...(workspaceIntelMcpLaunch ? codexWorkspaceIntelMcpServerToml(settings, workspaceIntelMcpLaunch) : []),
    ...(paperRadarMcpLaunch ? codexPaperRadarMcpServerToml(paperRadarMcpLaunch) : []),
    ...(writeAssistMcpLaunch ? codexWriteAssistMcpServerToml(settings, writeAssistMcpLaunch) : []),
    ...(runtimeInspectorMcpLaunch ? codexRuntimeInspectorMcpServerToml(settings, runtimeInspectorMcpLaunch) : []),
    ...(computerUseMcpLaunch ? codexComputerUseMcpServerToml(computerUseMcpLaunch) : []),
    ''
  ].join('\n')
}

function codexScheduleMcpServerToml(
  settings: AppSettingsV1,
  launch: ClawScheduleMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_SCHEDULE_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveClawScheduleMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildClawScheduleMcpArgs(settings, launch))}`,
    'env = { ELECTRON_RUN_AS_NODE = "1" }'
  ]
}

function codexResearchMcpServerToml(
  launch: ResearchSearchMcpLaunchConfig,
  env: NodeJS.ProcessEnv
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_RESEARCH_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveResearchSearchMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildResearchSearchMcpArgs(launch))}`,
    `env = ${tomlInlineStringTable(researchSearchMcpEnv(env))}`
  ]
}

function codexWorkflowMcpServerToml(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_WORKFLOW_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveWorkflowMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildWorkflowMcpArgs(settings, launch))}`,
    `env = ${tomlInlineStringTable(workflowMcpEnv())}`
  ]
}

function codexWorkspaceIntelMcpServerToml(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_WORKSPACE_INTEL_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveWorkspaceIntelMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildWorkspaceIntelMcpArgs(settings, launch))}`,
    `env = ${tomlInlineStringTable(workspaceIntelMcpEnv())}`
  ]
}

function codexPaperRadarMcpServerToml(
  launch: PaperRadarMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_PAPER_RADAR_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolvePaperRadarMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildPaperRadarMcpArgs(launch))}`,
    `env = ${tomlInlineStringTable(paperRadarMcpEnv())}`
  ]
}

function codexWriteAssistMcpServerToml(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_WRITE_ASSIST_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveWriteAssistMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildWriteAssistMcpArgs(settings, launch))}`,
    `env = ${tomlInlineStringTable(writeAssistMcpEnv())}`
  ]
}

function codexRuntimeInspectorMcpServerToml(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveRuntimeInspectorMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildRuntimeInspectorMcpArgs(settings, launch))}`,
    `env = ${tomlInlineStringTable(runtimeInspectorMcpEnv())}`
  ]
}

function codexComputerUseMcpServerToml(
  launch: ComputerUseMcpLaunchConfig
): string[] {
  return [
    '',
    `[mcp_servers.${GUI_COMPUTER_USE_MCP_SERVER_NAME}]`,
    `command = "${tomlString(resolveComputerUseMcpCommand(launch))}"`,
    `args = ${tomlStringArray(buildComputerUseMcpArgs(launch))}`,
    `env = ${tomlInlineStringTable(computerUseMcpEnvForLaunch(launch))}`
  ]
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

function tomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((value) => `"${tomlString(value)}"`).join(', ')}]`
}

function tomlInlineStringTable(value: Record<string, string>): string {
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${tomlKey(key)} = "${tomlString(item)}"`)
  return `{ ${entries.join(', ')} }`
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : `"${tomlString(value)}"`
}
