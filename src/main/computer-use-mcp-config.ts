import { GUI_COMPUTER_USE_MCP_LAUNCH_FLAG } from './computer-use-mcp-server'
import type { AgentRuntimeId } from '../shared/app-settings'
import {
  buildExternalKunMcpJson,
  buildManagedGuiKunMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  managedGuiMcpNames,
  resolveKunMcpJsonPath,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  stringRecord,
  syncExternalKunMcpJson,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_computer_use'
const GUI_COMPUTER_USE_MCP_NODE_ENTRY = 'out/main/computer-use-mcp-node-entry.js'
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

export type ComputerUseMcpLaunchConfig = ManagedGuiMcpLaunchConfig & {
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

export const GUI_COMPUTER_USE_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_COMPUTER_USE_MCP_SERVER_NAME,
  nodeEntry: GUI_COMPUTER_USE_MCP_NODE_ENTRY,
  launchFlag: GUI_COMPUTER_USE_MCP_LAUNCH_FLAG,
  timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
  enabledTools: computerUseMcpEnabledTools
}

export function resolveComputerUseMcpNodeEntryPath(launch: ComputerUseMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
}

export function resolveComputerUseMcpCommand(
  launch: ComputerUseMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
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

export function computerUseMcpEnabledTools(): string[] {
  return ['computer_use']
}

export function buildComputerUseMcpServerConfig(
  launch: ComputerUseMcpLaunchConfig,
  existing: unknown = {},
  enabled = true
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_COMPUTER_USE_MCP_DESCRIPTOR,
    launch,
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnvForLaunch(launch, env),
    existing,
    enabled
  })
}

export function buildComputerUseKunMcpServerConfig(
  launch: ComputerUseMcpLaunchConfig,
  enabled = true,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiKunMcpServerConfig({
    descriptor: GUI_COMPUTER_USE_MCP_DESCRIPTOR,
    launch,
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnvForLaunch(launch, env),
    existing,
    enabled
  })
}

export function buildSyncedComputerUseMcpJson(
  existing: unknown,
  launch: ComputerUseMcpLaunchConfig,
  enabled = true
): JsonRecord {
  void launch
  void enabled
  return buildExternalKunMcpJson(existing, managedGuiMcpNames(GUI_COMPUTER_USE_MCP_DESCRIPTOR))
}

export async function syncComputerUseMcpConfig(
  launch: ComputerUseMcpLaunchConfig,
  paths: ComputerUseMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveKunMcpJsonPath()
  void launch
  void paths.enabled
  await syncExternalKunMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_COMPUTER_USE_MCP_DESCRIPTOR))
}
