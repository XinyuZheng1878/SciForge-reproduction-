import type { AppSettingsV1 } from '../shared/app-settings'
import { GUI_SCHEDULE_MCP_LAUNCH_FLAG } from './schedule-mcp-server'
import { SCHEDULE_TOOL_SIDE_EFFECTS } from '../../packages/workers/schedule/src/contract'
import {
  buildExternalKunMcpJson,
  buildManagedGuiKunMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  managedGuiMcpNames,
  resolveKunMcpJsonPath,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  syncExternalKunMcpJson,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

export { resolveKunMcpJsonPath } from './managed-gui-mcp-config'

export const GUI_SCHEDULE_MCP_SERVER_NAME = 'gui_schedule'
const GUI_SCHEDULE_MCP_NODE_ENTRY = 'out/main/schedule-mcp-node-entry.js'
export const GUI_SCHEDULE_MCP_TIMEOUT_MS = 5_000
export const GUI_SCHEDULE_INTERNAL_SECRET_ENV = 'GUI_SCHEDULE_INTERNAL_SECRET'

export type ScheduleMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type ScheduleMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_SCHEDULE_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_SCHEDULE_MCP_SERVER_NAME,
  nodeEntry: GUI_SCHEDULE_MCP_NODE_ENTRY,
  launchFlag: GUI_SCHEDULE_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS,
  enabledTools: scheduleMcpEnabledTools
}

export function buildScheduleMcpArgs(
  settings: AppSettingsV1,
  launch: ScheduleMcpLaunchConfig
): string[] {
  const args: string[] = [
    resolveScheduleMcpNodeEntryPath(launch),
    GUI_SCHEDULE_MCP_LAUNCH_FLAG,
    '--base-url',
    `http://127.0.0.1:${settings.schedule.internal.port}`
  ]
  return args
}

export function resolveScheduleMcpNodeEntryPath(launch: ScheduleMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_SCHEDULE_MCP_NODE_ENTRY)
}

export function resolveScheduleMcpCommand(
  launch: ScheduleMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildScheduleMcpServerConfig(
  settings: AppSettingsV1,
  launch: ScheduleMcpLaunchConfig
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_SCHEDULE_MCP_DESCRIPTOR,
    launch,
    args: buildScheduleMcpArgs(settings, launch),
    env: { ...ELECTRON_RUN_AS_NODE_ENV }
  })
}

export function buildScheduleKunMcpServerConfig(
  settings: AppSettingsV1,
  launch: ScheduleMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  return buildManagedGuiKunMcpServerConfig({
    descriptor: GUI_SCHEDULE_MCP_DESCRIPTOR,
    launch,
    args: buildScheduleMcpArgs(settings, launch),
    env: { ...ELECTRON_RUN_AS_NODE_ENV },
    existing
  })
}

export function scheduleMcpEnabledTools(): string[] {
  return Object.keys(SCHEDULE_TOOL_SIDE_EFFECTS)
}

export function buildSyncedScheduleMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: ScheduleMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalKunMcpJson(existing, managedGuiMcpNames(GUI_SCHEDULE_MCP_DESCRIPTOR))
}

export function scheduleMcpSettingsChanged(prev: AppSettingsV1, next: AppSettingsV1): boolean {
  return (
    prev.schedule.internal.port !== next.schedule.internal.port ||
    prev.schedule.internal.secret.trim() !== next.schedule.internal.secret.trim()
  )
}

export async function syncScheduleMcpConfig(
  settings: AppSettingsV1,
  launch: ScheduleMcpLaunchConfig,
  paths: ScheduleMcpConfigPaths = {}
): Promise<void> {
  void settings
  void launch
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()

  await syncExternalKunMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_SCHEDULE_MCP_DESCRIPTOR))
}
