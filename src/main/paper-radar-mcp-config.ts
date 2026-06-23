import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_PAPER_RADAR_MCP_LAUNCH_FLAG } from './paper-radar-mcp-server'

export const GUI_PAPER_RADAR_MCP_SERVER_NAME = 'gui_paper_radar'
const GUI_PAPER_RADAR_MCP_NODE_ENTRY = 'out/main/paper-radar-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
const PAPER_RADAR_ENABLED_TOOLS = [
  'gui_paper_profile_list',
  'gui_paper_profile_save',
  'gui_paper_profile_sync',
  'gui_paper_search',
  'gui_paper_rank',
  'gui_paper_digest'
] as const

type JsonRecord = Record<string, unknown>

export type PaperRadarMcpLaunchConfig = ClawScheduleMcpLaunchConfig & {
  dbPath: string
  profilesPath: string
}

type PaperRadarMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolvePaperRadarMcpNodeEntryPath(launch: PaperRadarMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_PAPER_RADAR_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_PAPER_RADAR_MCP_NODE_ENTRY)
}

export function resolvePaperRadarMcpCommand(
  launch: PaperRadarMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildPaperRadarMcpArgs(launch: PaperRadarMcpLaunchConfig): string[] {
  return [
    resolvePaperRadarMcpNodeEntryPath(launch),
    GUI_PAPER_RADAR_MCP_LAUNCH_FLAG,
    '--db',
    launch.dbPath,
    '--profiles',
    launch.profilesPath
  ]
}

export function paperRadarMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function paperRadarMcpEnabledTools(): string[] {
  return [...PAPER_RADAR_ENABLED_TOOLS]
}

export function buildPaperRadarMcpServerConfig(
  launch: PaperRadarMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolvePaperRadarMcpCommand(launch),
    args: buildPaperRadarMcpArgs(launch),
    env: paperRadarMcpEnv(stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: paperRadarMcpEnabledTools(),
    disabled_tools: []
  }
}

export function buildSyncedPaperRadarMcpJson(
  existing: unknown,
  launch: PaperRadarMcpLaunchConfig
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
      [GUI_PAPER_RADAR_MCP_SERVER_NAME]: buildPaperRadarMcpServerConfig(
        launch,
        servers[GUI_PAPER_RADAR_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncPaperRadarMcpConfig(
  launch: PaperRadarMcpLaunchConfig,
  paths: PaperRadarMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedPaperRadarMcpJson(current, launch)
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
