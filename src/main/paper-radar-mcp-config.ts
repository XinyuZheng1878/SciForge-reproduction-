import { PAPER_RADAR_MCP_TOOL_CONTRACTS } from '../../packages/workers/paper-radar/src/contract'
import { GUI_PAPER_RADAR_MCP_LAUNCH_FLAG } from './paper-radar-mcp-server'
import {
  buildExternalLocalRuntimeMcpJson,
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  managedGuiMcpNames,
  resolveLocalRuntimeMcpJsonPath,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  stringRecord,
  syncExternalLocalRuntimeMcpJson,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

export const GUI_PAPER_RADAR_MCP_SERVER_NAME = 'gui_paper_radar'
const GUI_PAPER_RADAR_MCP_NODE_ENTRY = 'out/main/paper-radar-mcp-node-entry.js'
export const PAPER_RADAR_MCP_TIMEOUT_MS = 30_000

export type PaperRadarMcpLaunchConfig = ManagedGuiMcpLaunchConfig & {
  dbPath: string
  profilesPath: string
}

type PaperRadarMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_PAPER_RADAR_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_PAPER_RADAR_MCP_SERVER_NAME,
  nodeEntry: GUI_PAPER_RADAR_MCP_NODE_ENTRY,
  launchFlag: GUI_PAPER_RADAR_MCP_LAUNCH_FLAG,
  timeoutMs: PAPER_RADAR_MCP_TIMEOUT_MS,
  enabledTools: paperRadarMcpEnabledTools
}

export function resolvePaperRadarMcpNodeEntryPath(launch: PaperRadarMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_PAPER_RADAR_MCP_NODE_ENTRY)
}

export function resolvePaperRadarMcpCommand(
  launch: PaperRadarMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
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
  return Object.keys(PAPER_RADAR_MCP_TOOL_CONTRACTS)
}

export function buildPaperRadarMcpServerConfig(
  launch: PaperRadarMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_PAPER_RADAR_MCP_DESCRIPTOR,
    launch,
    args: buildPaperRadarMcpArgs(launch),
    env: paperRadarMcpEnv(env),
    existing
  })
}

export function buildPaperRadarLocalRuntimeMcpServerConfig(
  launch: PaperRadarMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_PAPER_RADAR_MCP_DESCRIPTOR,
    launch,
    args: buildPaperRadarMcpArgs(launch),
    env: paperRadarMcpEnv(env),
    existing
  })
}

export function buildSyncedPaperRadarMcpJson(
  existing: unknown,
  launch: PaperRadarMcpLaunchConfig
): JsonRecord {
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_PAPER_RADAR_MCP_DESCRIPTOR))
}

export async function syncPaperRadarMcpConfig(
  launch: PaperRadarMcpLaunchConfig,
  paths: PaperRadarMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_PAPER_RADAR_MCP_DESCRIPTOR))
}
