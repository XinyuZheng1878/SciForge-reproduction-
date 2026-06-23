import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_COMPUTER_USE_MCP_LAUNCH_FLAG } from './computer-use-mcp-server'
import type { AgentRuntimeId } from '../shared/app-settings'

export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_computer_use'
const GUI_COMPUTER_USE_MCP_NODE_ENTRY = 'out/main/computer-use-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
export const COMPUTER_USE_STATUS_PATH_ENV = 'SCIFORGE_COMPUTER_USE_STATUS_PATH'
export const COMPUTER_USE_DEFAULT_AGENT_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_AGENT_ID'
export const COMPUTER_USE_DEFAULT_THREAD_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_THREAD_ID'
export const COMPUTER_USE_DEFAULT_TURN_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_TURN_ID'
export const COMPUTER_USE_DEFAULT_SESSION_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_SESSION_ID'
export const COMPUTER_USE_MCP_TIMEOUT_MS = 30_000
export const COMPUTER_USE_MCP_AGENT_RUNTIME_IDS = ['kun', 'codex', 'claude'] as const satisfies readonly AgentRuntimeId[]

type MissingComputerUseMcpRuntime = Exclude<AgentRuntimeId, typeof COMPUTER_USE_MCP_AGENT_RUNTIME_IDS[number]>
const _computerUseMcpRuntimeCoverage: MissingComputerUseMcpRuntime extends never ? true : MissingComputerUseMcpRuntime = true
void _computerUseMcpRuntimeCoverage

type JsonRecord = Record<string, unknown>

export type ComputerUseMcpLaunchConfig = ClawScheduleMcpLaunchConfig & {
  statusPath?: string
  defaultAgentId?: string
  defaultThreadId?: string
  defaultTurnId?: string
  defaultSessionId?: string
}

type ComputerUseMcpConfigPaths = {
  mcpJsonPath?: string
  enabled?: boolean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveComputerUseMcpNodeEntryPath(launch: ComputerUseMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
}

export function resolveComputerUseMcpCommand(
  launch: ComputerUseMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildComputerUseMcpArgs(launch: ComputerUseMcpLaunchConfig): string[] {
  return [
    resolveComputerUseMcpNodeEntryPath(launch),
    GUI_COMPUTER_USE_MCP_LAUNCH_FLAG
  ]
}

export function computerUseMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV,
    ...(existingEnv[COMPUTER_USE_STATUS_PATH_ENV]
      ? { [COMPUTER_USE_STATUS_PATH_ENV]: existingEnv[COMPUTER_USE_STATUS_PATH_ENV] }
      : {})
  }
}

export function computerUseMcpEnvForLaunch(
  launch: ComputerUseMcpLaunchConfig,
  existingEnv: Record<string, string> = {}
): Record<string, string> {
  return computerUseMcpEnv({
    ...existingEnv,
    ...(launch.statusPath ? { [COMPUTER_USE_STATUS_PATH_ENV]: launch.statusPath } : {}),
    ...(launch.defaultAgentId ? { [COMPUTER_USE_DEFAULT_AGENT_ID_ENV]: launch.defaultAgentId } : {}),
    ...(launch.defaultThreadId ? { [COMPUTER_USE_DEFAULT_THREAD_ID_ENV]: launch.defaultThreadId } : {}),
    ...(launch.defaultTurnId ? { [COMPUTER_USE_DEFAULT_TURN_ID_ENV]: launch.defaultTurnId } : {}),
    ...(launch.defaultSessionId ? { [COMPUTER_USE_DEFAULT_SESSION_ID_ENV]: launch.defaultSessionId } : {})
  })
}

export function buildComputerUseMcpServerConfig(
  launch: ComputerUseMcpLaunchConfig,
  existing: unknown = {},
  enabled = true
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveComputerUseMcpCommand(launch),
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnvForLaunch(launch, stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: !enabled,
    enabled,
    required: false,
    enabled_tools: ['computer_use'],
    disabled_tools: []
  }
}

export function buildSyncedComputerUseMcpJson(
  existing: unknown,
  launch: ComputerUseMcpLaunchConfig,
  enabled = true
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
      [GUI_COMPUTER_USE_MCP_SERVER_NAME]: buildComputerUseMcpServerConfig(
        launch,
        servers[GUI_COMPUTER_USE_MCP_SERVER_NAME],
        enabled
      )
    }
  }
}

export async function syncComputerUseMcpConfig(
  launch: ComputerUseMcpLaunchConfig,
  paths: ComputerUseMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedComputerUseMcpJson(current, launch, paths.enabled !== false)
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

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}
