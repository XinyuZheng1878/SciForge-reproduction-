import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG } from './write-assist-mcp-server'

export const GUI_WRITE_ASSIST_MCP_SERVER_NAME = 'gui_write_assist'
const GUI_WRITE_ASSIST_MCP_NODE_ENTRY = 'out/main/write-assist-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
const WRITE_ASSIST_ENABLED_TOOLS = [
  'gui_write_retrieve_context',
  'gui_pdf_extract_text'
] as const

type JsonRecord = Record<string, unknown>

export type WriteAssistMcpLaunchConfig = ClawScheduleMcpLaunchConfig

type WriteAssistMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveWriteAssistMcpNodeEntryPath(launch: WriteAssistMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_WRITE_ASSIST_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_WRITE_ASSIST_MCP_NODE_ENTRY)
}

export function resolveWriteAssistMcpCommand(
  launch: WriteAssistMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildWriteAssistMcpArgs(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig
): string[] {
  const args = [
    resolveWriteAssistMcpNodeEntryPath(launch),
    GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  return args
}

export function writeAssistMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function writeAssistMcpEnabledTools(): string[] {
  return [...WRITE_ASSIST_ENABLED_TOOLS]
}

export function buildWriteAssistMcpServerConfig(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveWriteAssistMcpCommand(launch),
    args: buildWriteAssistMcpArgs(settings, launch),
    env: writeAssistMcpEnv(stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: writeAssistMcpEnabledTools(),
    disabled_tools: []
  }
}

export function buildSyncedWriteAssistMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig
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
      [GUI_WRITE_ASSIST_MCP_SERVER_NAME]: buildWriteAssistMcpServerConfig(
        settings,
        launch,
        servers[GUI_WRITE_ASSIST_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncWriteAssistMcpConfig(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig,
  paths: WriteAssistMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedWriteAssistMcpJson(current, settings, launch)
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
