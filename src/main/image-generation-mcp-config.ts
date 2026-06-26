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
  IMAGE_GENERATION_MCP_FLAG,
  IMAGE_GENERATION_TOOL_SIDE_EFFECTS
} from '../../packages/workers/image-generation/src/contract'
import type { ImageGenerationSettingsV1 } from '../shared/app-settings'

export const GUI_IMAGE_GENERATION_MCP_SERVER_NAME = 'image_generation'
const GUI_IMAGE_GENERATION_MCP_NODE_ENTRY = 'out/main/image-generation-mcp-node-entry.js'
export const GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS = 120_000
export const GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG = IMAGE_GENERATION_MCP_FLAG

export type ImageGenerationMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_IMAGE_GENERATION_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
  nodeEntry: GUI_IMAGE_GENERATION_MCP_NODE_ENTRY,
  launchFlag: GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
  enabledTools: imageGenerationMcpEnabledTools
}

export function buildImageGenerationMcpArgs(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveImageGenerationMcpNodeEntryPath(launch),
    GUI_IMAGE_GENERATION_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolveImageGenerationMcpNodeEntryPath(launch: ImageGenerationMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_IMAGE_GENERATION_MCP_NODE_ENTRY)
}

export function resolveImageGenerationMcpCommand(
  launch: ImageGenerationMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildImageGenerationMcpServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  imageGeneration?: ImageGenerationSettingsV1
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, normalizedWorkspaceRoot),
    env: imageGenerationMcpEnv(launch, imageGeneration),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildImageGenerationKunMcpServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string,
  imageGeneration?: ImageGenerationSettingsV1
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, workspaceRoot?.trim()),
    env: imageGenerationMcpEnv(launch, imageGeneration),
    existing
  })
}

export function buildImageGenerationMcpJsonServerConfig(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  imageGeneration?: ImageGenerationSettingsV1
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
    launch,
    args: buildImageGenerationMcpArgs(launch, workspaceRoot?.trim()),
    env: imageGenerationMcpEnv(launch, imageGeneration)
  })
}

export function buildImageGenerationMcpConfigFragment(
  launch: ImageGenerationMcpLaunchConfig,
  workspaceRoot?: string,
  imageGeneration?: ImageGenerationSettingsV1
): JsonRecord {
  return {
    servers: {
      [GUI_IMAGE_GENERATION_MCP_SERVER_NAME]: buildImageGenerationMcpServerConfig(
        launch,
        workspaceRoot,
        imageGeneration
      )
    }
  }
}

export function imageGenerationMcpEnabledTools(): string[] {
  return Object.keys(IMAGE_GENERATION_TOOL_SIDE_EFFECTS)
}

export function imageGenerationMcpEnv(
  launch: ImageGenerationMcpLaunchConfig,
  imageGeneration?: ImageGenerationSettingsV1
): Record<string, string> {
  void launch
  const env: Record<string, string> = { ...ELECTRON_RUN_AS_NODE_ENV }
  if (!imageGeneration?.enabled || !imageGeneration.apiKey.trim() || !imageGeneration.baseUrl.trim()) return env
  env.SCIFORGE_IMAGE_API_KEY = imageGeneration.apiKey.trim()
  env.SCIFORGE_IMAGE_BASE_URL = imageGeneration.baseUrl.trim()
  if (imageGeneration.model.trim()) env.SCIFORGE_IMAGE_MODEL = imageGeneration.model.trim()
  return env
}
