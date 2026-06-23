import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import {
  GUI_RESEARCH_MCP_LAUNCH_FLAG
} from './research-search-mcp-server'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'

export const GUI_RESEARCH_MCP_SERVER_NAME = 'gui_research'
const GUI_RESEARCH_MCP_NODE_ENTRY = 'out/main/research-search-mcp-node-entry.js'
const RESEARCH_SEARCH_MCP_TIMEOUT_MS = 30_000
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
const RESEARCH_ENV_NAMES = [
  'SCIFORGE_RESEARCH_ARXIV_ENABLED',
  'SCIFORGE_RESEARCH_BIORXIV_ENABLED',
  'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED',
  'SCIFORGE_RESEARCH_TAVILY_ENABLED',
  'SCIFORGE_RESEARCH_CNS_ENABLED',
  'SCIFORGE_RESEARCH_CNS_DOMAINS',
  'SCIFORGE_RESEARCH_MAX_RESULTS',
  'SCIFORGE_RESEARCH_TIMEOUT_MS',
  'SCIFORGE_RESEARCH_DEFAULT_SINCE_YEAR'
] as const
const RESEARCH_SECRET_ENV_NAMES = new Set([
  'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_API_KEY',
  'SCIFORGE_RESEARCH_TAVILY_API_KEY',
  'TAVILY_API_KEY'
])

type JsonRecord = Record<string, unknown>

export type ResearchSearchMcpLaunchConfig = ClawScheduleMcpLaunchConfig

type ResearchSearchMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveResearchSearchMcpNodeEntryPath(launch: ResearchSearchMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_RESEARCH_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_RESEARCH_MCP_NODE_ENTRY)
}

export function resolveResearchSearchMcpCommand(
  launch: ResearchSearchMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildResearchSearchMcpArgs(launch: ResearchSearchMcpLaunchConfig): string[] {
  return [
    resolveResearchSearchMcpNodeEntryPath(launch),
    GUI_RESEARCH_MCP_LAUNCH_FLAG
  ]
}

export function researchSearchMcpEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  existingEnv: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of RESEARCH_ENV_NAMES) {
    const value = baseEnv[name]
    if (value !== undefined) env[name] = value
  }
  return {
    ...env,
    ...nonSecretEnv(existingEnv),
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function buildResearchSearchMcpServerConfig(
  launch: ResearchSearchMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveResearchSearchMcpCommand(launch),
    args: buildResearchSearchMcpArgs(launch),
    env: researchSearchMcpEnv(process.env, stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: ['research_search'],
    disabled_tools: []
  }
}

export function buildSyncedResearchSearchMcpJson(
  existing: unknown,
  launch: ResearchSearchMcpLaunchConfig
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
      [GUI_RESEARCH_MCP_SERVER_NAME]: buildResearchSearchMcpServerConfig(
        launch,
        servers[GUI_RESEARCH_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncResearchSearchMcpConfig(
  launch: ResearchSearchMcpLaunchConfig,
  paths: ResearchSearchMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedResearchSearchMcpJson(current, launch)
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
  return nonSecretEnv(out)
}

function nonSecretEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!RESEARCH_SECRET_ENV_NAMES.has(key)) out[key] = value
  }
  return out
}
