import type { AgentRuntimeId } from '../shared/app-settings'
import type { AgentRuntimeCapabilities } from '../shared/agent-runtime-contract'
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
export const COMPUTER_USE_MCP_TOOL_NAME = 'computer_use'
export const COMPUTER_USE_MCP_BACKEND = 'browser-cdp'
export const GUI_COMPUTER_USE_MCP_LAUNCH_FLAG = '--gui-computer-use-mcp-server'
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

export type ComputerUseRuntimeMcpServerConfig = {
  id: typeof GUI_COMPUTER_USE_MCP_SERVER_NAME
  command: string
  args: string[]
  env: Record<string, string>
  timeoutMs: typeof COMPUTER_USE_MCP_TIMEOUT_MS
  enabledTools: [typeof COMPUTER_USE_MCP_TOOL_NAME]
}

export type ComputerUseClaudeCodeMcpServerConfig = {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  timeout: typeof COMPUTER_USE_MCP_TIMEOUT_MS
  alwaysLoad: true
}

export type ComputerUseMcpDiagnosticsServer = {
  id: typeof GUI_COMPUTER_USE_MCP_SERVER_NAME
  status: 'configured'
  toolCount: 1
  tools: [typeof COMPUTER_USE_MCP_TOOL_NAME]
}

export type ComputerUseMcpRuntimeInfoState = {
  enabled: boolean
  available: boolean
  server: 'mcp'
  toolName: typeof COMPUTER_USE_MCP_TOOL_NAME
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
  return [COMPUTER_USE_MCP_TOOL_NAME]
}

export function buildComputerUseRuntimeMcpServerConfig(
  launch: ComputerUseMcpLaunchConfig
): ComputerUseRuntimeMcpServerConfig {
  return {
    id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
    command: resolveComputerUseMcpCommand(launch),
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnvForLaunch(launch),
    timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
    enabledTools: [COMPUTER_USE_MCP_TOOL_NAME]
  }
}

export function buildComputerUseClaudeCodeMcpServerConfig(
  launch: ComputerUseMcpLaunchConfig
): ComputerUseClaudeCodeMcpServerConfig {
  const config = buildComputerUseRuntimeMcpServerConfig(launch)
  return {
    type: 'stdio',
    command: config.command,
    args: config.args,
    env: config.env,
    timeout: config.timeoutMs,
    alwaysLoad: true
  }
}

export function configuredComputerUseCapability(): AgentRuntimeCapabilities['tools']['computerUse'] {
  return {
    available: true,
    server: 'mcp',
    toolName: COMPUTER_USE_MCP_TOOL_NAME,
    backend: COMPUTER_USE_MCP_BACKEND,
    inputIsolation: 'agent-isolated',
    affectsUserInput: false,
    requiresHostFocus: false,
    usesHostClipboard: false
  }
}

export function unavailableComputerUseCapability(
  reason: string
): AgentRuntimeCapabilities['tools']['computerUse'] {
  return { available: false, reason }
}

export function computerUseMcpDiagnosticsServer(): ComputerUseMcpDiagnosticsServer {
  return {
    id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
    status: 'configured',
    toolCount: 1,
    tools: [COMPUTER_USE_MCP_TOOL_NAME]
  }
}

export function computerUseMcpRuntimeInfoState(configured: boolean): ComputerUseMcpRuntimeInfoState {
  return {
    enabled: configured,
    available: configured,
    server: 'mcp',
    toolName: COMPUTER_USE_MCP_TOOL_NAME
  }
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
