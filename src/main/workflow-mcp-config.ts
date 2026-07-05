import type { AppSettingsV1 } from '../shared/app-settings'
import { GUI_WORKFLOW_MCP_LAUNCH_FLAG } from './workflow-mcp-server'
import { WORKFLOW_TOOL_CONTRACTS } from '../../packages/workers/workflow/src/contract'
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
import { internalSecretEnv } from './internal-http-secret'

export const GUI_WORKFLOW_MCP_SERVER_NAME = 'gui_workflow'
const GUI_WORKFLOW_MCP_NODE_ENTRY = 'out/main/workflow-mcp-node-entry.js'
export const WORKFLOW_MCP_TIMEOUT_MS = 30_000
export const GUI_WORKFLOW_INTERNAL_SECRET_ENV = 'GUI_WORKFLOW_INTERNAL_SECRET'

export type WorkflowMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type WorkflowMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_WORKFLOW_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_WORKFLOW_MCP_SERVER_NAME,
  nodeEntry: GUI_WORKFLOW_MCP_NODE_ENTRY,
  launchFlag: GUI_WORKFLOW_MCP_LAUNCH_FLAG,
  timeoutMs: WORKFLOW_MCP_TIMEOUT_MS,
  enabledTools: workflowMcpEnabledTools
}

export function resolveWorkflowMcpNodeEntryPath(launch: WorkflowMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_WORKFLOW_MCP_NODE_ENTRY)
}

export function resolveWorkflowMcpCommand(
  launch: WorkflowMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
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

function workflowMcpSecretEnv(settings: AppSettingsV1, existingEnv: Record<string, string> = {}): Record<string, string> {
  return workflowMcpEnv({
    ...existingEnv,
    ...internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, settings.workflow.webhookSecret)
  })
}

export function workflowMcpEnabledTools(): string[] {
  return Object.keys(WORKFLOW_TOOL_CONTRACTS)
}

export function buildWorkflowMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_WORKFLOW_MCP_DESCRIPTOR,
    launch,
    args: buildWorkflowMcpArgs(settings, launch),
    env: workflowMcpSecretEnv(settings, env),
    existing
  })
}

export function buildWorkflowLocalRuntimeMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_WORKFLOW_MCP_DESCRIPTOR,
    launch,
    args: buildWorkflowMcpArgs(settings, launch),
    env: workflowMcpSecretEnv(settings, env),
    existing
  })
}

export function buildSyncedWorkflowMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_WORKFLOW_MCP_DESCRIPTOR))
}

export async function syncWorkflowMcpConfig(
  settings: AppSettingsV1,
  launch: WorkflowMcpLaunchConfig,
  paths: WorkflowMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void settings
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_WORKFLOW_MCP_DESCRIPTOR))
}
