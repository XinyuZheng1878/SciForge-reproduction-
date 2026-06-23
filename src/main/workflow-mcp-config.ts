import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import type { AppSettingsV1 } from '../shared/app-settings'
import {
  resolveClawScheduleMcpCommand,
  resolveKunMcpJsonPath,
  type ClawScheduleMcpLaunchConfig
} from './claw-schedule-mcp-config'
import { GUI_WORKFLOW_MCP_LAUNCH_FLAG } from './workflow-mcp-server'

export const GUI_WORKFLOW_MCP_SERVER_NAME = 'gui_workflow'
const GUI_WORKFLOW_MCP_NODE_ENTRY = 'out/main/workflow-mcp-node-entry.js'
const WORKFLOW_MCP_TIMEOUT_MS = 30_000
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }
export const GUI_WORKFLOW_INTERNAL_SECRET_ENV = 'GUI_WORKFLOW_INTERNAL_SECRET'
const WORKFLOW_ENABLED_TOOLS = [
  'gui_workflow_list',
  'gui_workflow_run',
  'gui_workflow_status',
  'gui_workflow_stop',
  'gui_workflow_validate',
  'gui_workflow_import',
  'gui_workflow_export'
] as const

type JsonRecord = Record<string, unknown>

export type WorkflowMcpLaunchConfig = ClawScheduleMcpLaunchConfig

type WorkflowMcpConfigPaths = {
  mcpJsonPath?: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

export function resolveWorkflowMcpNodeEntryPath(launch: WorkflowMcpLaunchConfig): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, GUI_WORKFLOW_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, GUI_WORKFLOW_MCP_NODE_ENTRY)
}

export function resolveWorkflowMcpCommand(
  launch: WorkflowMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildWorkflowMcpArgs(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig
): string[] {
  const args = [
    resolveWorkflowMcpNodeEntryPath(launch),
    GUI_WORKFLOW_MCP_LAUNCH_FLAG,
    '--base-url',
    `http://127.0.0.1:${settings.workflow.webhookPort}`
  ]
  return args
}

export function workflowMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function workflowMcpEnabledTools(): string[] {
  return [...WORKFLOW_ENABLED_TOOLS]
}

export function buildWorkflowMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isRecord(existing) ? existing : {}
  return {
    ...record,
    command: resolveWorkflowMcpCommand(launch),
    args: buildWorkflowMcpArgs(settings, launch),
    env: workflowMcpEnv(stringRecord(record.env)),
    url: null,
    connect_timeout: null,
    execute_timeout: null,
    read_timeout: null,
    disabled: false,
    enabled: true,
    required: false,
    enabled_tools: workflowMcpEnabledTools(),
    disabled_tools: []
  }
}

export function buildSyncedWorkflowMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig
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
      [GUI_WORKFLOW_MCP_SERVER_NAME]: buildWorkflowMcpServerConfig(
        settings,
        launch,
        servers[GUI_WORKFLOW_MCP_SERVER_NAME]
      )
    }
  }
}

export async function syncWorkflowMcpConfig(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig,
  paths: WorkflowMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  const current = await readJsonFile(mcpJsonPath)
  const next = buildSyncedWorkflowMcpJson(current, settings, launch)
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
