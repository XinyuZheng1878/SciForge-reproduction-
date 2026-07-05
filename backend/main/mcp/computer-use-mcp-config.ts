import type { AgentRuntimeCapabilities } from '../../shared/agent-runtime-contract'
import {
  buildExternalLocalRuntimeMcpJson,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type JsonRecord
} from './managed-gui-mcp-config'

export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_computer_use'
export const COMPUTER_USE_MCP_TOOL_NAME = 'computer_use'
export const RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES = [GUI_COMPUTER_USE_MCP_SERVER_NAME] as const

type ComputerUseMcpConfigPaths = {
  mcpJsonPath?: string
}

export function configuredComputerUseCapability(): AgentRuntimeCapabilities['tools']['computerUse'] {
  return {
    available: true,
    server: 'service',
    toolName: COMPUTER_USE_MCP_TOOL_NAME,
    backend: 'gui-owl',
    inputIsolation: 'host-approved',
    affectsUserInput: true,
    requiresHostFocus: true,
    usesHostClipboard: false
  }
}

export function unavailableComputerUseCapability(
  reason: string
): AgentRuntimeCapabilities['tools']['computerUse'] {
  return { available: false, reason }
}

export function buildSyncedComputerUseMcpJson(existing: unknown): JsonRecord {
  return buildExternalLocalRuntimeMcpJson(existing, RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES)
}

export async function syncComputerUseMcpConfig(
  paths: ComputerUseMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES)
}
