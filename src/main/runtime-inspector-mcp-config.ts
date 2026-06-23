import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  getKunRuntimeSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG } from './runtime-inspector-mcp-server'

export const GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME = 'gui_runtime_inspector'
const GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY = 'out/main/runtime-inspector-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
const RUNTIME_INSPECTOR_ENABLED_TOOLS = [
  'gui_git_status',
  'gui_git_branches',
  'gui_git_diff_preview',
  'gui_git_checkpoint_list',
  'gui_git_checkpoint_preview',
  'gui_runtime_ports',
  'gui_runtime_health',
  'gui_runtime_dependency_report',
  'gui_runtime_model_router_status',
  'gui_runtime_kun_status',
  'gui_lsp_status',
  'gui_lsp_query'
] as const

type JsonRecord = Record<string, unknown>

export type RuntimeInspectorMcpLaunchConfig = ClawScheduleMcpLaunchConfig & {
  checkpointDataDir: string
}

type RuntimeInspectorMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveRuntimeInspectorMcpNodeEntryPath(launch: RuntimeInspectorMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY)
}

export function resolveRuntimeInspectorMcpCommand(
  launch: RuntimeInspectorMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildRuntimeInspectorMcpArgs(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig
): string[] {
  const runtime = getKunRuntimeSettings(settings)
  const modelRouter = resolveRuntimeModelRouterSettings(settings)
  const args = [
    resolveRuntimeInspectorMcpNodeEntryPath(launch),
    GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG,
    '--checkpoint-data-dir',
    launch.checkpointDataDir,
    '--model-router-base-url',
    modelRouter.baseUrl,
    '--kun-base-url',
    runtimeBaseUrl(runtime.baseUrl, runtime.port)
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  return args
}

export function runtimeInspectorMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function runtimeInspectorMcpEnabledTools(): string[] {
  return [...RUNTIME_INSPECTOR_ENABLED_TOOLS]
}

export function buildRuntimeInspectorMcpServerConfig(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveRuntimeInspectorMcpCommand(launch),
    args: buildRuntimeInspectorMcpArgs(settings, launch),
    env: runtimeInspectorMcpEnv(stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: runtimeInspectorMcpEnabledTools(),
    disabled_tools: []
  }
}

export function buildSyncedRuntimeInspectorMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig
): JsonRecord {
  const base = isRecord(existing) ? existing : {}
  const servers = isRecord(base.servers) ? base.servers : {}
  const timeouts = isRecord(base.timeouts)
    ? base.timeouts
    : {
        connect_timeout: 10,
        execute_timeout: 60,
        read_timeout: 120
      }

  return {
    ...base,
    timeouts,
    servers: {
      ...servers,
      [GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]: buildRuntimeInspectorMcpServerConfig(
        settings,
        launch,
        servers[GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncRuntimeInspectorMcpConfig(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig,
  paths: RuntimeInspectorMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedRuntimeInspectorMcpJson(current, settings, launch)
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  const currentText = current === null ? '' : `${JSON.stringify(current, null, 2)}\n`
  if (nextText === currentText) return

  await mkdir(dirname(mcpJsonPath), { recursive: true })
  await writeFile(mcpJsonPath, nextText, 'utf8')
}

async function readJsonFile(path: string): Promise<unknown | null> {
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return null
    throw error
  }

  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Kun MCP config at ${path}: ${message}`, { cause: error })
  }
}

function runtimeBaseUrl(baseUrl: string, port: number): string {
  const trimmed = baseUrl.trim()
  if (trimmed) return trimmed.replace(/\/+$/, '')
  return `http://127.0.0.1:${port}`
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}
