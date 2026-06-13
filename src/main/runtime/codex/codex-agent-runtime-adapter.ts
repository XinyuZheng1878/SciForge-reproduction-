import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeInputQuestion,
  AgentRuntimeItem,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeToolKind,
  AgentRuntimeTurn
} from '../../../shared/agent-runtime-contract'
import { createDefaultAgentRuntimeCapabilities } from '../../../shared/agent-runtime-contract'
import type {
  CodexChatBlock,
  CodexNormalizedThread,
  CodexThreadEventPayload
} from './codex-runtime-api'
import type { AgentRuntimeAdapter } from '../agent-runtime/adapter'
import type { CodexRuntimeService } from './codex-service'

export function createCodexAgentRuntimeAdapter(service: CodexRuntimeService): AgentRuntimeAdapter {
  return {
    id: 'codex',
    transport: 'jsonrpc_stdio',

    async connect() {
      const result = await service.connect()
      if (!result.ok) throw codexFailure(result)
    },

    async capabilities() {
      return codexCapabilities()
    },

    async listThreads(_context, input) {
      const result = await service.listThreads({
        limit: input.limit,
        search: input.search,
        includeArchived: input.includeArchived,
        archivedOnly: input.archivedOnly
      })
      if (!result.ok) throw codexFailure(result)
      return result.threads.map(mapCodexThread)
    },

    async startThread(_context, input) {
      const result = await service.startThread({
        workspace: input.workspace,
        title: input.title,
        model: input.model
      })
      if (!result.ok) throw codexFailure(result)
      return mapCodexThread(result.thread)
    },

    async readThread(_context, input) {
      const result = await service.readThread(input.threadId)
      if (!result.ok) throw codexFailure(result)
      return mapCodexDetail(input.threadId, result.detail)
    },

    async startTurn(_context, input) {
      const result = await service.startTurn({
        threadId: input.threadId,
        text: input.text,
        displayText: input.displayText,
        workspace: input.workspace,
        model: input.model,
        reasoningEffort: input.reasoningEffort
      })
      if (!result.ok) throw codexFailure(result)
      return {
        threadId: result.threadId,
        turnId: result.turnId,
        userMessageItemId: result.userMessageItemId
      }
    },

    async interruptTurn(_context, input) {
      const result = await service.interruptTurn(input.threadId, input.turnId, { discard: input.discard })
      if (!result.ok) throw codexFailure(result)
    },

    async steerTurn(_context, input) {
      const result = await service.steerTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        text: input.text
      })
      if (!result.ok) throw codexFailure(result)
    },

    async renameThread(_context, input) {
      const result = await service.renameThread(input.threadId, input.title)
      if (!result.ok) throw codexFailure(result)
    },

    async deleteThread(_context, input) {
      const result = await service.deleteThread(input.threadId)
      if (!result.ok) throw codexFailure(result)
    },

    async *subscribeEvents(_context, input) {
      const events = typeof service.subscribeEvents === 'function'
        ? service.subscribeEvents(input.threadId, input.sinceSeq ?? 0, input.signal)
        : await service.readStoredEvents(input.threadId, input.sinceSeq ?? 0)
      for await (const event of events) {
        for (const mapped of mapCodexStoredEvent(event)) {
          if (input.signal?.aborted) return
          yield mapped
        }
      }
    },

    async compactThread(_context, input) {
      const result = await service.compactThread(input.threadId, input.reason)
      if (!result.ok) throw codexFailure(result)
    },

    async resolveApproval(_context, input) {
      const result = await service.resolveApproval({
        requestId: input.approvalId,
        decision: input.decision === 'allowed' ? 'allowed' : 'denied',
        message: input.message
      })
      if (!result.ok) throw codexFailure(result)
    },

    async resolveUserInput(_context, input) {
      const result = await service.resolveUserInput({
        requestId: input.requestId,
        answers: input.answers
      })
      if (!result.ok) throw codexFailure(result)
    },

    async usage(_context, input) {
      if (typeof service.usage === 'function') return service.usage(input)
      return {
        supported: false,
        reason: 'usage unsupported',
        groupBy: input.groupBy,
        buckets: [],
        totals: {}
      }
    },

    async auxiliary(_context, input) {
      switch (input.operation) {
        case 'getRuntimeInfo':
          return codexRuntimeInfo()
        case 'getToolDiagnostics':
          return codexToolDiagnostics()
        case 'listSkills':
          return []
        case 'archiveThread': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('archiveThread requires payload.threadId.')
          const result = await service.archiveThread(threadId, payload.archived === true)
          if (!result.ok) throw codexFailure(result)
          return undefined
        }
        default:
          throw new Error(`codex AgentRuntimeAdapter does not support ${input.operation}.`)
      }
    }
  }
}

function codexCapabilities(): AgentRuntimeCapabilities {
  const unavailable = { available: false, reason: 'unsupported' }
  const caps = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'codex',
    transport: 'jsonrpc_stdio'
  })
  return {
    ...caps,
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'ipc'
    },
    threadMaterialization: 'after_first_user_message',
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: 'summary',
      source: 'runtime_summary'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true
    },
    tools: {
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: { available: false, reason: 'Codex MCP diagnostics are not exposed through this service yet.' },
      web: { available: false, reason: 'Codex web capabilities are not exposed through this service yet.' },
      skills: { available: false, reason: 'Codex skills are not exposed through this service yet.' },
      subagents: { available: false, reason: 'Codex subagents are not exposed through this service yet.' },
      diagnostics: { available: false, reason: 'Codex tool diagnostics are not exposed through this service yet.' }
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: 'async',
      userInput: 'async',
      compact: 'noop',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    storage: {
      guiOwnedThreads: true,
      backendThreadIdStable: false,
      usage: true,
      attachments: unavailable,
      memory: unavailable
    }
  }
}

function codexRuntimeInfo(): Record<string, unknown> {
  const caps = codexCapabilities()
  return {
    host: 'codex',
    port: 0,
    dataDir: '',
    model: caps.model.id ?? 'codex',
    startedAt: new Date().toISOString(),
    capabilities: {
      contractVersion: 1,
      model: {
        id: caps.model.id ?? 'codex',
        inputModalities: caps.model.inputModalities,
        outputModalities: caps.model.outputModalities,
        supportsToolCalling: caps.model.supportsToolCalling,
        contextWindowTokens: caps.model.contextWindowTokens,
        messageParts: ['text']
      },
      cli: {
        serve: coreCapability({ available: true }),
        run: coreCapability({ available: true }),
        chat: coreCapability({ available: true }),
        exec: coreCapability({ available: true })
      },
      mcp: {
        ...coreCapability(caps.tools.mcp),
        configuredServers: 0,
        connectedServers: 0,
        toolCount: caps.tools.mcp.toolCount ?? 0,
        search: {
          enabled: false,
          mode: 'direct',
          active: false,
          indexedToolCount: 0,
          advertisedToolCount: 0
        }
      },
      web: {
        ...coreCapability(caps.tools.web),
        fetch: coreCapability(caps.tools.web.fetch),
        search: coreCapability(caps.tools.web.search)
      },
      skills: {
        ...coreCapability(caps.tools.skills),
        configuredRoots: 0,
        discoveredSkills: 0
      },
      subagents: {
        ...coreCapability(caps.tools.subagents),
        maxParallel: caps.tools.subagents.maxParallel ?? 0,
        maxChildRuns: caps.tools.subagents.maxChildren ?? 0
      },
      attachments: {
        ...coreCapability(caps.storage.attachments),
        maxImageBytes: 0,
        maxImageDimension: 0,
        allowedMimeTypes: []
      },
      memory: {
        ...coreCapability(caps.storage.memory),
        scopes: [],
        maxInjectedRecords: 0
      }
    }
  }
}

function codexToolDiagnostics(): Record<string, unknown> {
  return {
    mcpServers: [],
    webProviders: [],
    skills: {
      enabled: false,
      roots: [],
      skills: []
    }
  }
}

function coreCapability(state: { available?: boolean; reason?: string; degraded?: boolean } | undefined): Record<string, unknown> {
  const available = state?.available === true
  return {
    status: available ? 'available' : 'unavailable',
    enabled: available,
    available,
    ...(state?.reason ? { reason: state.reason } : {}),
    ...(state?.degraded ? { degraded: state.degraded } : {})
  }
}

function mapCodexThread(thread: CodexNormalizedThread): AgentRuntimeThread {
  return {
    id: thread.id,
    runtimeId: 'codex',
    title: thread.title || thread.preview || 'Codex thread',
    updatedAt: thread.updatedAt || new Date().toISOString(),
    model: thread.model || undefined,
    mode: thread.mode || undefined,
    workspace: thread.workspace,
    status: thread.status,
    archived: thread.archived,
    preview: thread.preview,
    latestTurnId: thread.latestTurnId,
    latestTurnStatus: thread.latestTurnStatus,
    backendThreadId: thread.id
  }
}

function mapCodexDetail(threadId: string, detail: {
  blocks: CodexChatBlock[]
  latestSeq: number
  threadStatus?: string
  latestTurnId?: string
  latestUserMessageId?: string
  usage?: AgentRuntimeThreadDetail['usage']
}): AgentRuntimeThreadDetail {
  const mappedItems = detail.blocks.map(mapCodexBlock).filter(Boolean) as AgentRuntimeItem[]
  const fallbackTurnId = detail.latestTurnId || (mappedItems.length > 0 ? 'codex-turn' : '')
  const items = fallbackTurnId
    ? mappedItems.map((item) => item.turnId ? item : { ...item, turnId: fallbackTurnId })
    : mappedItems
  const turnIds = [...new Set(items.map((item) => item.turnId?.trim() ?? '').filter(Boolean))]
  const turnId = detail.latestTurnId || turnIds.at(-1) || ''
  const latestStatus = normalizeTurnStatus(detail.threadStatus)
  const turns = turnIds.map((id): AgentRuntimeTurn => {
    const turnItems = items.filter((item) => item.turnId === id)
    return {
      id,
      threadId,
      status: id === turnId ? latestStatus ?? inferTurnStatus(turnItems) : inferTurnStatus(turnItems),
      items: turnItems
    }
  })
  return {
    id: threadId,
    runtimeId: 'codex',
    title: 'Codex thread',
    updatedAt: new Date().toISOString(),
    ...(turnId && detail.threadStatus ? { status: detail.threadStatus } : {}),
    ...(turnId ? { latestTurnId: turnId } : {}),
    latestSeq: detail.latestSeq,
    turns,
    items,
    usage: detail.usage,
    backendThreadId: threadId
  }
}

function mapCodexBlock(block: CodexChatBlock): AgentRuntimeItem | null {
  if (block.kind === 'user') {
      return {
        id: block.id,
        kind: 'user_message',
        text: block.displayText?.trim() || block.text,
        ...(block.turnId ? { turnId: block.turnId } : {}),
        createdAt: block.createdAt
      }
  }
  if (block.kind === 'assistant') {
    return {
      id: block.id,
      kind: 'assistant_message',
      text: block.text,
      ...(block.turnId ? { turnId: block.turnId } : {}),
      createdAt: block.createdAt
    }
  }
  if (block.kind === 'reasoning') {
    return {
      id: block.id,
      kind: 'reasoning',
      text: block.text,
      ...(block.turnId ? { turnId: block.turnId } : {}),
      createdAt: block.createdAt
    }
  }
  if (block.kind === 'tool') {
    const pendingRequest = mapCodexRequestBlock(block)
    if (pendingRequest) return pendingRequest

    return {
      id: block.id,
      kind: 'tool',
      summary: block.summary,
      status: block.status,
      toolKind: normalizeToolKind(block.toolKind),
      detail: block.detail,
      meta: block.filePath ? { filePath: block.filePath, ...block.meta } : block.meta,
      ...(block.turnId ? { turnId: block.turnId } : {}),
      createdAt: block.createdAt
    }
  }
  if (block.kind === 'system') {
    return {
      id: block.id,
      kind: 'system',
      text: block.text,
      detail: block.detail,
      status: block.severity === 'error' ? 'error' : undefined,
      meta: block.code ? { code: block.code, severity: block.severity } : { severity: block.severity },
      ...(block.turnId ? { turnId: block.turnId } : {}),
      createdAt: block.createdAt
    }
  }
  return null
}

function mapCodexStoredEvent(event: CodexThreadEventPayload): AgentRuntimeEvent[] {
  const common = {
    threadId: event.threadId,
    runtimeId: 'codex' as const,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(typeof event.seq === 'number' ? { seq: event.seq } : {})
  }
  const mapped: AgentRuntimeEvent[] = []
  if (event.userMessage) {
    mapped.push({
      ...common,
      kind: 'user_message',
      turnId: event.userMessage.turnId || event.turnId,
      itemId: event.userMessage.itemId,
      text: event.userMessage.text,
      createdAt: event.userMessage.createdAt
    })
  }
  for (const [index, delta] of (event.deltas ?? []).entries()) {
    if (delta.kind === 'agent_reasoning') {
      mapped.push({
        ...common,
        kind: 'reasoning_delta',
        itemId: `codex-reasoning-${event.seq ?? 'event'}-${index}`,
        text: delta.text,
        visibility: 'summary'
      })
    } else {
      mapped.push({
        ...common,
        kind: 'assistant_delta',
        itemId: `codex-delta-${event.seq ?? 'event'}-${index}`,
        text: delta.text
      })
    }
  }
  if (event.tool) {
    const pendingRequest = mapCodexRequestEvent(common, event.tool)
    if (pendingRequest) {
      mapped.push(pendingRequest)
    } else {
      mapped.push({
        ...common,
        kind: 'tool_event',
        itemId: event.tool.itemId,
        status: event.tool.status,
        toolKind: normalizeToolKind(event.tool.toolKind),
        summary: event.tool.summary,
        detail: event.tool.detail,
        filePath: event.tool.filePath,
        meta: event.tool.meta
      })
    }
  }
  if (event.runtimeError) {
    mapped.push({
      ...common,
      kind: 'error',
      itemId: event.runtimeError.itemId,
      createdAt: event.runtimeError.createdAt,
      recoverable: event.runtimeError.severity !== 'error',
      severity: event.runtimeError.severity ?? 'error',
      message: event.runtimeError.message,
      code: event.runtimeError.code,
      detail: stringifyDetail(event.runtimeError.details)
    })
  }
  if (event.runtimeStatus) {
    mapped.push({
      ...common,
      kind: 'runtime_status',
      itemId: event.runtimeStatus.itemId,
      phase: event.runtimeStatus.phase,
      message: event.runtimeStatus.message,
      latencyMs: event.runtimeStatus.latencyMs,
      createdAt: event.runtimeStatus.createdAt
    })
  }
  if (event.usage) {
    mapped.push({
      ...common,
      kind: 'usage',
      usage: event.usage
    })
  }
  if (event.turnComplete) {
    mapped.push({
      ...common,
      kind: 'turn_lifecycle',
      state: 'completed'
    })
  }
  return mapped
}

function mapCodexRequestBlock(block: Extract<CodexChatBlock, { kind: 'tool' }>): AgentRuntimeItem | null {
  const meta = block.meta ?? {}
  const requestKind = codexRequestKind(meta)
  if (!requestKind) return null

  const requestId = codexRequestId(meta, block.id)
  const status = requestItemStatus(block.status)
  if (requestKind === 'approval') {
    const toolName = approvalToolName(meta.codexRequestMethod, block.toolKind)
    return {
      id: block.id,
      kind: 'approval',
      summary: block.summary,
      status,
      toolKind: normalizeToolKind(block.toolKind),
      detail: block.detail,
      meta: {
        ...meta,
        approvalId: requestId,
        ...(toolName ? { toolName } : {})
      },
      createdAt: block.createdAt
    }
  }

  const questions = requestQuestions(meta)
  return {
    id: block.id,
    kind: 'user_input',
    summary: block.summary,
    status,
    toolKind: normalizeToolKind(block.toolKind),
    detail: block.detail,
    meta: {
      ...meta,
      requestId,
      questions
    },
    createdAt: block.createdAt
  }
}

function mapCodexRequestEvent(
  common: { threadId: string; runtimeId: 'codex'; turnId?: string; seq?: number },
  tool: NonNullable<CodexThreadEventPayload['tool']>
): AgentRuntimeEvent | null {
  const meta = tool.meta ?? {}
  const requestKind = codexRequestKind(meta)
  if (!requestKind) return null

  const requestId = codexRequestId(meta, tool.itemId)
  if (requestKind === 'approval') {
    return {
      ...common,
      kind: 'approval_requested',
      itemId: tool.itemId,
      approvalId: requestId,
      summary: tool.summary,
      toolName: approvalToolName(meta.codexRequestMethod, tool.toolKind),
      meta
    }
  }

  return {
    ...common,
    kind: 'user_input_requested',
    itemId: tool.itemId,
    requestId,
    questions: requestQuestions(meta)
  }
}

type CodexPendingRequestKind = 'approval' | 'user_input'

function codexRequestKind(meta: Record<string, unknown>): CodexPendingRequestKind | null {
  if (meta.codexRequestKind === 'approval' || meta.codexRequestKind === 'user_input') return meta.codexRequestKind
  return null
}

function codexRequestId(meta: Record<string, unknown>, fallback: string): string {
  return stringValue(meta.codexRequestId) || fallback
}

function requestItemStatus(status: 'running' | 'success' | 'error'): AgentRuntimeItem['status'] {
  if (status === 'running') return 'pending'
  if (status === 'success') return 'completed'
  return 'error'
}

function approvalToolName(method: unknown, toolKind: unknown): string | undefined {
  const methodValue = stringValue(method)
  if (methodValue.includes('/fileChange/')) return 'file change'
  if (methodValue.includes('/commandExecution/')) return 'command execution'
  const normalized = normalizeToolKind(toolKind)
  if (normalized === 'file_change') return 'file change'
  if (normalized === 'command_execution') return 'command execution'
  if (normalized === 'tool_call') return 'tool'
  return undefined
}

function requestQuestions(meta: Record<string, unknown>): AgentRuntimeInputQuestion[] {
  const value = meta.questions
  if (!Array.isArray(value)) return []
  return value.map(normalizeQuestion).filter(Boolean) as AgentRuntimeInputQuestion[]
}

function normalizeQuestion(value: unknown): AgentRuntimeInputQuestion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const question = stringValue(record.question)
  if (!id || !question) return null
  return {
    id,
    header: stringValue(record.header) || 'Question',
    question,
    options: Array.isArray(record.options)
      ? record.options.map(normalizeQuestionOption).filter(Boolean) as AgentRuntimeInputQuestion['options']
      : []
  }
}

function normalizeQuestionOption(value: unknown): AgentRuntimeInputQuestion['options'][number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const label = stringValue(record.label)
  if (!label) return null
  return {
    label,
    ...(stringValue(record.description) ? { description: stringValue(record.description) } : {})
  }
}

function normalizeToolKind(value: unknown): AgentRuntimeToolKind | undefined {
  if (value === 'tool_call' || value === 'command_execution' || value === 'file_change') return value
  return undefined
}

function normalizeTurnStatus(value: unknown): AgentRuntimeTurn['status'] | null {
  if (value === 'queued' || value === 'running' || value === 'completed' ||
    value === 'failed' || value === 'aborted' || value === 'steered') {
    return value
  }
  if (value === 'success') return 'completed'
  if (value === 'error') return 'failed'
  if (value === 'cancelled' || value === 'canceled' || value === 'interrupted') return 'aborted'
  return null
}

function inferTurnStatus(items: AgentRuntimeItem[]): AgentRuntimeTurn['status'] {
  if (items.some((item) => item.status === 'error' || item.status === 'failed')) return 'failed'
  if (items.some((item) => item.kind === 'assistant_message')) return 'completed'
  return 'running'
}

function codexFailure(error: { message: string; code?: string }): Error {
  const output = new Error(error.message)
  output.name = error.code || 'CodexRuntimeError'
  return output
}

function stringifyDetail(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
