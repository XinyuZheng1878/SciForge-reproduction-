import {
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'
import {
  SCIFORGE_CANVAS_MCP_FLAG,
  SCIFORGE_CANVAS_TOOL_SIDE_EFFECTS
} from '../../packages/workers/canvas/src/contract'

export const GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME = 'sciforge_canvas'
const GUI_SCIFORGE_CANVAS_MCP_NODE_ENTRY = 'out/main/sciforge-canvas-mcp-node-entry.js'
export const GUI_SCIFORGE_CANVAS_MCP_TIMEOUT_MS = 30_000
export const GUI_SCIFORGE_CANVAS_MCP_LAUNCH_FLAG = SCIFORGE_CANVAS_MCP_FLAG

export type SciforgeCanvasMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME,
  nodeEntry: GUI_SCIFORGE_CANVAS_MCP_NODE_ENTRY,
  launchFlag: GUI_SCIFORGE_CANVAS_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_SCIFORGE_CANVAS_MCP_TIMEOUT_MS,
  enabledTools: sciforgeCanvasMcpEnabledTools
}

export function buildSciforgeCanvasMcpArgs(
  launch: SciforgeCanvasMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveSciforgeCanvasMcpNodeEntryPath(launch),
    GUI_SCIFORGE_CANVAS_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolveSciforgeCanvasMcpNodeEntryPath(launch: SciforgeCanvasMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_SCIFORGE_CANVAS_MCP_NODE_ENTRY)
}

export function resolveSciforgeCanvasMcpCommand(
  launch: SciforgeCanvasMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildSciforgeCanvasMcpServerConfig(
  launch: SciforgeCanvasMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR,
    launch,
    args: buildSciforgeCanvasMcpArgs(launch, normalizedWorkspaceRoot),
    env: workerMcpEnv(launch),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildSciforgeCanvasLocalRuntimeMcpServerConfig(
  launch: SciforgeCanvasMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR,
    launch,
    args: buildSciforgeCanvasMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch),
    existing
  })
}

export function buildSciforgeCanvasMcpJsonServerConfig(
  launch: SciforgeCanvasMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_SCIFORGE_CANVAS_MCP_DESCRIPTOR,
    launch,
    args: buildSciforgeCanvasMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch)
  })
}

export function buildSciforgeCanvasMcpConfigFragment(
  launch: SciforgeCanvasMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_SCIFORGE_CANVAS_MCP_SERVER_NAME]: buildSciforgeCanvasMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function sciforgeCanvasMcpEnabledTools(): string[] {
  return Object.keys(SCIFORGE_CANVAS_TOOL_SIDE_EFFECTS)
}

function workerMcpEnv(launch: SciforgeCanvasMcpLaunchConfig): Record<string, string> {
  void launch
  return { ...ELECTRON_RUN_AS_NODE_ENV }
}
