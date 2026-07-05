import type { JsonRecord } from './mcp-config'

export const SCIENTIFIC_PLOTTING_MCP_SERVER_ID = 'scientific_plotting'
export const SCIFORGE_CANVAS_MCP_SERVER_ID = 'sciforge_canvas'
export const IMAGE_GENERATION_MCP_SERVER_ID = 'image_generation'

type McpConfigResult =
  | { ok: true; config: JsonRecord }
  | { ok: false; message: string }

export type SciforgeArtifactMcpBootstrapInput = {
  text: string
  workspaceRoot?: string
  readConfig: () => Promise<{ content: string }>
  writeConfig: (content: string) => Promise<unknown>
  forceImageGeneration?: boolean
  buildImageGenerationConfig?: (workspaceRoot?: string) => Promise<McpConfigResult>
  buildScientificPlottingConfig?: (workspaceRoot?: string) => Promise<McpConfigResult>
  buildSciforgeCanvasConfig?: (workspaceRoot?: string) => Promise<McpConfigResult>
  getToolDiagnostics?: () => Promise<{ mcpServers?: Array<Record<string, unknown>> } | null | undefined>
  waitTimeoutMs?: number
  pollIntervalMs?: number
}

export type SciforgeArtifactMcpBootstrapResult =
  | { status: 'skipped' }
  | { status: 'configured'; runtimeConnected: boolean; serverIds: string[] }
  | { status: 'unavailable'; message: string; serverIds: string[] }

export type SciforgeArtifactFlowPromptOptions = {
  canvasId?: string
  threadId?: string
  workspaceRoot?: string
}

export function isScientificPlottingRequest(text: string): boolean {
  void text
  return false
}

export function isCanvasReviewRequest(text: string): boolean {
  void text
  return false
}

export function shouldUseSciforgeArtifactFlow(text: string): boolean {
  void text
  return false
}

export function buildSciforgeArtifactFlowPrompt(
  text: string,
  options: SciforgeArtifactFlowPromptOptions = {}
): string {
  void options
  return text.trim()
}

export async function ensureSciforgeArtifactMcpsForChat(
  input: SciforgeArtifactMcpBootstrapInput
): Promise<SciforgeArtifactMcpBootstrapResult> {
  void input
  return { status: 'skipped' }
}

export function diagnosticsHaveConnectedServers(
  diagnostics: { mcpServers?: Array<Record<string, unknown>> } | null | undefined,
  serverIds: string[]
): boolean {
  const connected = new Set(
    (diagnostics?.mcpServers ?? [])
      .filter((server) => server.status === 'connected')
      .map((server) => typeof server.id === 'string' ? server.id : '')
      .filter(Boolean)
  )
  return serverIds.every((id) => connected.has(id))
}
