import { createHash } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type CodexDynamicMcpServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabledTools?: string[]
  disabled?: boolean
}

export type CodexAppServerDynamicToolFunctionSpec = {
  namespace?: string
  name: string
  description: string
  inputSchema: unknown
  deferLoading?: boolean
}
export type CodexAppServerDynamicToolSpec = CodexAppServerDynamicToolFunctionSpec

export type CodexAppServerDynamicToolCallRequest = {
  requestId: string | number
  threadId?: string
  turnId?: string
  callId?: string
  namespace?: string
  tool: string
  arguments: unknown
}

export type CodexAppServerDynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }

export type CodexAppServerDynamicToolCallResponse = {
  contentItems: CodexAppServerDynamicToolCallOutputContentItem[]
  success: boolean
}

export type McpToolDescriptor = {
  name: string
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: { title?: string }
}

export type CodexDynamicMcpClient = {
  listTools(options?: {
    cursor?: string
    signal?: AbortSignal
    timeout?: number
  }): Promise<{ tools: McpToolDescriptor[]; nextCursor?: string }>
  callTool(
    input: { name: string; arguments: Record<string, unknown> },
    options?: { signal?: AbortSignal; timeout?: number }
  ): Promise<unknown>
  close(): Promise<void>
}

export type CodexDynamicMcpToolBridgeOptions = {
  servers: readonly CodexDynamicMcpServerConfig[]
  clientFactory?: (server: CodexDynamicMcpServerConfig) => Promise<CodexDynamicMcpClient>
}

type CatalogTool = McpToolDescriptor & {
  originalName: string
  dynamicName: string
  flatName?: string
}

type ServerState = {
  config: CodexDynamicMcpServerConfig
  namespace: string
  client?: CodexDynamicMcpClient
  clientPromise?: Promise<CodexDynamicMcpClient>
  catalog?: CatalogTool[]
  catalogPromise?: Promise<CatalogTool[]>
}

const GUI_COMPUTER_USE_MCP_SERVER_ID = 'gui_computer_use'
const GUI_COMPUTER_USE_TOOL_NAME = 'computer_use'
const DEFAULT_TIMEOUT_MS = 30_000

export function createCodexDynamicMcpToolBridge(
  options: CodexDynamicMcpToolBridgeOptions
): CodexDynamicMcpToolBridge {
  return new CodexDynamicMcpToolBridge(options)
}

export class CodexDynamicMcpToolBridge {
  private readonly states: ServerState[]
  private readonly statesByNamespace = new Map<string, ServerState>()
  private readonly clientFactory: (server: CodexDynamicMcpServerConfig) => Promise<CodexDynamicMcpClient>

  constructor(options: CodexDynamicMcpToolBridgeOptions) {
    this.clientFactory = options.clientFactory ?? createSdkMcpClient
    const usedNamespaces = new Set<string>()
    this.states = options.servers
      .filter((server) => !server.disabled && server.id.trim() && server.command.trim())
      .map((server) => {
        const namespace = uniqueDynamicName(`mcp_${slug(server.id)}`, server.id, usedNamespaces, 64)
        const state: ServerState = {
          config: {
            ...server,
            args: server.args ?? [],
            timeoutMs: server.timeoutMs ?? DEFAULT_TIMEOUT_MS
          },
          namespace
        }
        this.statesByNamespace.set(namespace, state)
        return state
      })
  }

  hasConfiguredServers(): boolean {
    return this.states.length > 0
  }

  async dynamicTools(): Promise<CodexAppServerDynamicToolSpec[]> {
    const entries = await this.availableCatalogEntries()
    assignFlatToolNames(entries)
    return entries.map(({ tool }) => ({
      name: tool.flatName ?? tool.dynamicName,
      description: tool.description || tool.title || `MCP tool ${tool.originalName}`,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
    }))
  }

  async callTool(
    request: CodexAppServerDynamicToolCallRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    const resolved = await this.resolveTool(request)
    if (!resolved) {
      const name = request.namespace ? `${request.namespace}.${request.tool}` : request.tool
      return failedDynamicToolResponse(`No configured MCP dynamic tool matched ${name}.`)
    }
    try {
      const callArguments = mcpToolArgumentsForRequest(resolved.state, resolved.tool, request)
      const result = resolved.state.client
        ? await resolved.state.client.callTool(
          { name: resolved.tool.originalName, arguments: callArguments },
          { signal: options.signal, timeout: resolved.state.config.timeoutMs }
        )
        : await this.callWithConnectedClient(resolved.state, resolved.tool, callArguments, options.signal)
      return dynamicToolResponseFromMcpResult(result)
    } catch (error) {
      return failedDynamicToolResponse(
        `MCP tool ${resolved.tool.originalName} failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.states.map(async (state) => {
      const client = state.client ?? await state.clientPromise?.catch(() => undefined)
      await client?.close().catch(() => undefined)
      state.client = undefined
      state.clientPromise = undefined
      state.catalog = undefined
      state.catalogPromise = undefined
    }))
  }

  private async callWithConnectedClient(
    state: ServerState,
    tool: CatalogTool,
    args: unknown,
    signal: AbortSignal | undefined
  ): Promise<unknown> {
    const client = await this.clientFor(state)
    return client.callTool(
      { name: tool.originalName, arguments: recordArguments(args) },
      { signal, timeout: state.config.timeoutMs }
    )
  }

  private async resolveTool(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<{ state: ServerState; tool: CatalogTool } | null> {
    const normalized = normalizeToolRequestName(request)
    if (normalized.namespace) {
      const state = this.statesByNamespace.get(normalized.namespace)
      if (!state) return null
      const catalog = await this.catalogFor(state)
      const tool = catalog.find((candidate) => candidate.dynamicName === normalized.tool || candidate.flatName === normalized.tool)
      return tool ? { state, tool } : null
    }

    const matches: Array<{ state: ServerState; tool: CatalogTool }> = []
    for (const state of this.states) {
      const catalog = await this.catalogFor(state)
      const tool = catalog.find((candidate) => dynamicToolCallNames(candidate).has(normalized.tool))
      if (tool) matches.push({ state, tool })
    }
    return matches.length === 1 ? matches[0] : null
  }

  private async availableCatalogEntries(): Promise<Array<{ state: ServerState; tool: CatalogTool }>> {
    const listed = await Promise.all(this.states.map(async (state) => {
      try {
        return { state, catalog: await this.catalogFor(state) }
      } catch {
        // A failed optional MCP server should not prevent the Codex thread from starting.
        return null
      }
    }))
    return listed.flatMap((entry) => entry
      ? entry.catalog.map((tool) => ({ state: entry.state, tool }))
      : [])
  }

  private async catalogFor(state: ServerState): Promise<CatalogTool[]> {
    if (state.catalog) return state.catalog
    if (!state.catalogPromise) {
      state.catalogPromise = this.loadCatalog(state).catch((error) => {
        state.catalogPromise = undefined
        throw error
      })
    }
    state.catalog = await state.catalogPromise
    return state.catalog
  }

  private async loadCatalog(state: ServerState): Promise<CatalogTool[]> {
    const client = await this.clientFor(state)
    const tools: McpToolDescriptor[] = []
    let cursor: string | undefined
    do {
      const listed = await client.listTools({ cursor, timeout: state.config.timeoutMs })
      tools.push(...listed.tools)
      cursor = listed.nextCursor
    } while (cursor)

    const enabled = new Set((state.config.enabledTools ?? []).filter(Boolean))
    const usedNames = new Set<string>()
    return tools
      .filter((tool) => !enabled.size || enabled.has(tool.name))
      .filter((tool) => tool.name.trim().length > 0)
      .map((tool) => ({
        ...tool,
        originalName: tool.name,
        dynamicName: uniqueDynamicName(slug(tool.name), tool.name, usedNames, 128)
      }))
  }

  private async clientFor(state: ServerState): Promise<CodexDynamicMcpClient> {
    if (state.client) return state.client
    if (!state.clientPromise) {
      state.clientPromise = this.clientFactory(state.config).then((client) => {
        state.client = client
        return client
      }).catch((error) => {
        state.clientPromise = undefined
        throw error
      })
    }
    return state.clientPromise
  }
}

async function createSdkMcpClient(server: CodexDynamicMcpServerConfig): Promise<CodexDynamicMcpClient> {
  const client = new Client({ name: `sciforge-codex-${server.id}`, version: '0.1.0' })
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: server.env,
    stderr: 'pipe'
  })
  const timeout = server.timeoutMs ?? DEFAULT_TIMEOUT_MS
  await client.connect(transport, { timeout })
  return {
    listTools: (options) => {
      const params = options?.cursor ? { cursor: options.cursor } : undefined
      return client.listTools(params, {
        signal: options?.signal,
        timeout: options?.timeout
      })
    },
    callTool: (input, options) => client.callTool(input, undefined, options),
    close: () => client.close()
  }
}

export function dynamicToolResponseFromMcpResult(
  result: unknown
): CodexAppServerDynamicToolCallResponse {
  const record = asRecord(result)
  const success = record?.isError !== true
  const contentItems: CodexAppServerDynamicToolCallOutputContentItem[] = []
  for (const item of arrayValue(record?.content)) {
    contentItems.push(...dynamicContentItemsFromMcpContent(item))
  }
  if (record && record.structuredContent !== undefined) {
    contentItems.push({
      type: 'inputText',
      text: `structuredContent:\n${jsonText(record.structuredContent)}`
    })
  }
  if (contentItems.length === 0) {
    contentItems.push({
      type: 'inputText',
      text: result === undefined ? '' : jsonText(result)
    })
  }
  return { contentItems, success }
}

function dynamicContentItemsFromMcpContent(
  item: unknown
): CodexAppServerDynamicToolCallOutputContentItem[] {
  const record = asRecord(item)
  if (!record) return [{ type: 'inputText', text: jsonText(item) }]
  const type = stringValue(record.type)
  if (type === 'text') return [{ type: 'inputText', text: stringValue(record.text) }]
  if (type === 'image') {
    const imageUrl = stringValue(record.imageUrl) || imageDataUrl(record)
    if (imageUrl) return [{ type: 'inputImage', imageUrl }]
  }
  return [{ type: 'inputText', text: jsonText(item) }]
}

function imageDataUrl(record: Record<string, unknown>): string {
  const data = stringValue(record.data)
  if (!data) return ''
  const mimeType = stringValue(record.mimeType) || 'image/png'
  if (data.startsWith('data:')) return data
  return `data:${mimeType};base64,${data}`
}

function failedDynamicToolResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    contentItems: [{ type: 'inputText', text: message }],
    success: false
  }
}

function recordArguments(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

function mcpToolArgumentsForRequest(
  state: ServerState,
  tool: CatalogTool,
  request: CodexAppServerDynamicToolCallRequest
): Record<string, unknown> {
  const args = recordArguments(request.arguments)
  if (state.config.id !== GUI_COMPUTER_USE_MCP_SERVER_ID || tool.originalName !== GUI_COMPUTER_USE_TOOL_NAME) {
    return args
  }
  const threadId = request.threadId ?? `request:${String(request.requestId)}`
  const turnId = request.turnId
  const agentId = `codex:${threadId}`
  return {
    ...args,
    agentId,
    threadId,
    ...(turnId ? { turnId } : {}),
    computerUseSessionId: agentId
  }
}

function normalizeToolRequestName(request: CodexAppServerDynamicToolCallRequest): {
  namespace?: string
  tool: string
} {
  if (request.namespace) return { namespace: request.namespace, tool: request.tool }
  const separator = request.tool.indexOf('.')
  if (separator <= 0 || separator >= request.tool.length - 1) return { tool: request.tool }
  return {
    namespace: request.tool.slice(0, separator),
    tool: request.tool.slice(separator + 1)
  }
}

function assignFlatToolNames(entries: Array<{ state: ServerState; tool: CatalogTool }>): void {
  const counts = new Map<string, number>()
  for (const { tool } of entries) {
    counts.set(tool.dynamicName, (counts.get(tool.dynamicName) ?? 0) + 1)
  }

  const used = new Set<string>()
  for (const { state, tool } of entries) {
    const baseName = counts.get(tool.dynamicName) === 1
      ? tool.dynamicName
      : `${state.namespace}_${tool.dynamicName}`
    tool.flatName = uniqueDynamicName(baseName, `${state.namespace}.${tool.originalName}`, used, 128)
  }
}

function dynamicToolCallNames(tool: CatalogTool): Set<string> {
  return new Set([
    tool.flatName,
    tool.dynamicName
  ].filter((name): name is string => Boolean(name)))
}

function uniqueDynamicName(
  rawBase: string,
  original: string,
  used: Set<string>,
  maxLength: number
): string {
  const base = (rawBase || 'tool').slice(0, maxLength)
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  const suffix = `_${createHash('sha256').update(original).digest('hex').slice(0, 8)}`
  const hashed = `${base.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`
  if (!used.has(hashed)) {
    used.add(hashed)
    return hashed
  }
  for (let index = 2; ; index += 1) {
    const indexedSuffix = `${suffix}_${index}`
    const candidate = `${base.slice(0, Math.max(1, maxLength - indexedSuffix.length))}${indexedSuffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool'
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value, null, 2)
    return text === undefined ? '' : text
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
