import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG } from './workspace-intel-mcp-server'

export const GUI_WORKSPACE_INTEL_MCP_SERVER_NAME = 'gui_workspace_intel'
const GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY = 'out/main/workspace-intel-mcp-node-entry.js'
const WORKSPACE_INTEL_MCP_TIMEOUT_MS = 30_000
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
const WORKSPACE_INTEL_ENABLED_TOOLS = [
  'gui_workspace_list',
  'gui_workspace_read',
  'gui_workspace_preview',
  'gui_workspace_reference_list',
  'gui_workspace_reference_preview',
  'gui_workspace_skill_list',
  'gui_workspace_skill_read'
] as const

type JsonRecord = Record<string, unknown>

export type WorkspaceIntelMcpLaunchConfig = ClawScheduleMcpLaunchConfig

type WorkspaceIntelMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveWorkspaceIntelMcpNodeEntryPath(launch: WorkspaceIntelMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY)
}

export function resolveWorkspaceIntelMcpCommand(
  launch: WorkspaceIntelMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildWorkspaceIntelMcpArgs(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig
): string[] {
  const args = [
    resolveWorkspaceIntelMcpNodeEntryPath(launch),
    GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG,
    '--include-global-skills'
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  return args
}

export function workspaceIntelMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function workspaceIntelMcpEnabledTools(): string[] {
  return [...WORKSPACE_INTEL_ENABLED_TOOLS]
}

export function buildWorkspaceIntelMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveWorkspaceIntelMcpCommand(launch),
    args: buildWorkspaceIntelMcpArgs(settings, launch),
    env: workspaceIntelMcpEnv(stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: workspaceIntelMcpEnabledTools(),
    disabled_tools: []
  }
}

export function buildSyncedWorkspaceIntelMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig
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
      [GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]: buildWorkspaceIntelMcpServerConfig(
        settings,
        launch,
        servers[GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncWorkspaceIntelMcpConfig(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig,
  paths: WorkspaceIntelMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedWorkspaceIntelMcpJson(current, settings, launch)
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
