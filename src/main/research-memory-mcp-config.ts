import {
  getResearchMemorySettings,
  isResearchMemoryEnabledForAgents,
  resolveResearchMemoryLocalPath,
  shouldUseResearchMemoryWorkspaceRoot,
  type AppSettingsV1
} from '../shared/app-settings'
import { GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG } from './research-memory-mcp-server'
import { ResearchMemoryToolNames } from '../../packages/workers/research-memory/src/contract'
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

export const GUI_RESEARCH_MEMORY_MCP_SERVER_NAME = 'gui_research_memory'
const GUI_RESEARCH_MEMORY_MCP_NODE_ENTRY = 'out/main/research-memory-mcp-node-entry.js'
export const RESEARCH_MEMORY_MCP_TIMEOUT_MS = 30_000

export type ResearchMemoryMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type ResearchMemoryMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_RESEARCH_MEMORY_MCP_SERVER_NAME,
  nodeEntry: GUI_RESEARCH_MEMORY_MCP_NODE_ENTRY,
  launchFlag: GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG,
  timeoutMs: RESEARCH_MEMORY_MCP_TIMEOUT_MS,
  enabledTools: researchMemoryMcpEnabledTools
}

export function resolveResearchMemoryMcpNodeEntryPath(launch: ResearchMemoryMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_RESEARCH_MEMORY_MCP_NODE_ENTRY)
}

export function resolveResearchMemoryMcpCommand(
  launch: ResearchMemoryMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildResearchMemoryMcpArgs(
  settings: AppSettingsV1,
  launch: ResearchMemoryMcpLaunchConfig
): string[] {
  const args = [
    resolveResearchMemoryMcpNodeEntryPath(launch),
    GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  const researchMemory = getResearchMemorySettings(settings)
  if (shouldUseResearchMemoryWorkspaceRoot(settings)) {
    args.push('--memory-root', resolveResearchMemoryLocalPath(settings))
  }
  const githubRepoUrl = researchMemory.githubRepoUrl.trim()
  if (githubRepoUrl) {
    args.push('--github-repo-url', githubRepoUrl)
    if (researchMemory.branch.trim()) {
      args.push('--github-branch', researchMemory.branch.trim())
    }
  }
  return args
}

export function researchMemoryMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function researchMemoryMcpEnabledTools(): string[] {
  return [...ResearchMemoryToolNames]
}

export function buildResearchMemoryMcpServerConfig(
  settings: AppSettingsV1,
  launch: ResearchMemoryMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR,
    launch,
    args: buildResearchMemoryMcpArgs(settings, launch),
    env: researchMemoryMcpEnv(env),
    existing,
    enabled: isResearchMemoryEnabledForAgents(settings)
  })
}

export function buildResearchMemoryLocalRuntimeMcpServerConfig(
  settings: AppSettingsV1,
  launch: ResearchMemoryMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR,
    launch,
    args: buildResearchMemoryMcpArgs(settings, launch),
    env: researchMemoryMcpEnv(env),
    existing,
    enabled: isResearchMemoryEnabledForAgents(settings)
  })
}

export function buildSyncedResearchMemoryMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: ResearchMemoryMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR))
}

export async function syncResearchMemoryMcpConfig(
  settings: AppSettingsV1,
  launch: ResearchMemoryMcpLaunchConfig,
  paths: ResearchMemoryMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void settings
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_RESEARCH_MEMORY_MCP_DESCRIPTOR))
}
