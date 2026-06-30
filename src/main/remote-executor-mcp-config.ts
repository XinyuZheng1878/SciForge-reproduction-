import { GUI_REMOTE_EXECUTOR_MCP_LAUNCH_FLAG } from './remote-executor-mcp-server'
import { REMOTE_EXECUTOR_TOOL_NAMES } from '../../packages/workers/remote-executor/src/contract'
import {
  getRemoteExecutorSettings,
  type AppSettingsV1,
  type RemoteExecutorTargetV1
} from '../shared/app-settings'
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

export const GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME = 'remote_executor'
const GUI_REMOTE_EXECUTOR_MCP_NODE_ENTRY = 'out/main/remote-executor-mcp-node-entry.js'
export const GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS = 30_000

export type RemoteExecutorMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type RemoteExecutorMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
  nodeEntry: GUI_REMOTE_EXECUTOR_MCP_NODE_ENTRY,
  launchFlag: GUI_REMOTE_EXECUTOR_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
  enabledTools: remoteExecutorMcpEnabledTools
}

export function resolveRemoteExecutorMcpNodeEntryPath(launch: RemoteExecutorMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_REMOTE_EXECUTOR_MCP_NODE_ENTRY)
}

export function resolveRemoteExecutorMcpCommand(
  launch: RemoteExecutorMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildRemoteExecutorMcpArgs(launch: RemoteExecutorMcpLaunchConfig): string[] {
  return [
    resolveRemoteExecutorMcpNodeEntryPath(launch),
    GUI_REMOTE_EXECUTOR_MCP_LAUNCH_FLAG
  ]
}

export function remoteExecutorMcpEnv(
  existingEnv: Record<string, string> = {},
  settings?: AppSettingsV1
): Record<string, string> {
  const targetsJson = remoteExecutorTargetsJson(settings)
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV,
    ...(targetsJson ? { SCIFORGE_REMOTE_EXECUTOR_TARGETS_JSON: targetsJson } : {})
  }
}

export function remoteExecutorMcpEnabledTools(): string[] {
  return [...REMOTE_EXECUTOR_TOOL_NAMES]
}

export function buildRemoteExecutorMcpServerConfig(
  launch: RemoteExecutorMcpLaunchConfig,
  existing: unknown = {},
  enabled = true,
  settings?: AppSettingsV1
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
    launch,
    args: buildRemoteExecutorMcpArgs(launch),
    env: remoteExecutorMcpEnv(env, settings),
    existing,
    enabled
  })
}

export function buildRemoteExecutorLocalRuntimeMcpServerConfig(
  launch: RemoteExecutorMcpLaunchConfig,
  existing: unknown = {},
  enabled = true,
  settings?: AppSettingsV1
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
    launch,
    args: buildRemoteExecutorMcpArgs(launch),
    env: remoteExecutorMcpEnv(env, settings),
    existing,
    enabled
  })
}

function remoteExecutorTargetsJson(settings?: AppSettingsV1): string {
  if (!settings) return ''
  const remoteExecutor = getRemoteExecutorSettings(settings)
  if (!remoteExecutor.enabled) return ''
  const targets = remoteExecutor.targets
    .map(remoteExecutorTargetEnvRecord)
    .filter((target): target is Record<string, unknown> => target !== null)
  return targets.length > 0 ? JSON.stringify(targets) : ''
}

function remoteExecutorTargetEnvRecord(target: RemoteExecutorTargetV1): Record<string, unknown> | null {
  const host = target.ssh?.host?.trim()
  if (!host) return null
  const record: Record<string, unknown> = {
    id: target.id,
    label: target.label,
    kind: 'ssh',
    host,
    disabled: target.enabled === false,
    capabilities: {
      directRun: true,
      stdin: true,
      deploy: true,
      slurm: target.kind === 'slurm'
    }
  }
  if (target.ssh?.user?.trim()) record.user = target.ssh.user.trim()
  if (target.ssh?.port) record.port = target.ssh.port
  if (target.remoteWorkspaceRoot.trim()) record.workspaceRoot = target.remoteWorkspaceRoot.trim()
  return record
}

export function buildSyncedRemoteExecutorMcpJson(
  existing: unknown,
  launch: RemoteExecutorMcpLaunchConfig
): JsonRecord {
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR))
}

export async function syncRemoteExecutorMcpConfig(
  launch: RemoteExecutorMcpLaunchConfig,
  paths: RemoteExecutorMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR))
}
