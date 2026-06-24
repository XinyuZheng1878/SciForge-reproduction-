import type {
  AgentRuntimeCapabilities,
  AgentRuntimeChild,
  AgentRuntimeChildTranscriptEntry,
  AgentRuntimeEvent,
  AgentRuntimeInputQuestion,
  AgentRuntimeItem,
  AgentRuntimeListThreadChildrenResponse,
  AgentRuntimeReadChildTranscriptResponse,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeToolKind,
  AgentRuntimeTurn
} from '../../../shared/agent-runtime-contract'
import {
  createAgentRuntimeCapabilityMatrix,
  createDefaultAgentRuntimeCapabilities,
  filterAgentRuntimeThreadChildren
} from '../../../shared/agent-runtime-contract'
import type {
  CodexChatBlock,
  CodexNormalizedThread,
  CodexThreadEventPayload
} from './codex-runtime-api'
import type { AgentRuntimeAdapter } from '../agent-runtime/adapter'
import type { CodexRuntimeService } from './codex-service'
import { isComputerUseEnabledForRuntime, type AppSettingsV1 } from '../../../shared/app-settings'
import {
  computerUseMcpDiagnosticsServer,
  computerUseMcpRuntimeInfoState,
  configuredComputerUseCapability,
  unavailableComputerUseCapability
} from '../../computer-use-mcp-config'

export function createCodexAgentRuntimeAdapter(service: CodexRuntimeService): AgentRuntimeAdapter {
  return {
    id: 'codex',
    transport: 'jsonrpc_stdio',

    async connect() {
      const result = await service.connect()
      if (!result.ok) throw codexFailure(result)
    },

    async capabilities(context) {
      return codexCapabilities(serviceMcpState(service, context.settings))
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
        reasoningEffort: input.reasoningEffort,
        fileReferences: input.fileReferences,
        metadata: input.metadata
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

    async publishSyntheticEvent(_context, event) {
      const stored = await service.publishSyntheticEvent(event)
      return mapCodexStoredEvent(stored)[0] ?? event
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
          return codexRuntimeInfo(serviceMcpState(service, _context.settings))
        case 'getToolDiagnostics':
          return codexToolDiagnostics(serviceMcpState(service, _context.settings))
        case 'listSkills':
          return []
        case 'listMemories':
          return []
        case 'updateMemory':
        case 'deleteMemory':
          throw new Error('Codex runtime does not support memory operations.')
        case 'archiveThread': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('archiveThread requires payload.threadId.')
          const result = await service.archiveThread(threadId, payload.archived === true)
          if (!result.ok) throw codexFailure(result)
          return undefined
        }
        case 'listThreadChildren': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('listThreadChildren requires payload.threadId.')
          return listCodexThreadChildren(service, {
            threadId,
            parentTurnId: stringValue(payload.parentTurnId) || stringValue(payload.turnId),
            activeOnly: payload.activeOnly === true,
            limit: numberValue(payload.limit)
          })
        }
        case 'readChildTranscript': {
          const payload = recordValue(input.payload)
          const parentThreadId = stringValue(payload.parentThreadId) || stringValue(payload.threadId)
          const parentTurnId = stringValue(payload.parentTurnId) || stringValue(payload.turnId)
          const childId = stringValue(payload.childId)
          if (!parentThreadId || !childId) {
            throw new Error('readChildTranscript requires payload.parentThreadId and payload.childId.')
          }
          return readCodexChildTranscript(service, {
            parentThreadId,
            parentTurnId,
            childId,
            limit: numberValue(payload.limit)
          })
        }
        default:
          throw new Error(`codex AgentRuntimeAdapter does not support ${input.operation}.`)
      }
    }
  }
}

type CodexMcpState = {
  mcpConfigured: boolean
  researchConfigured: boolean
  computerUseConfigured: boolean
}

const emptyCodexMcpState: CodexMcpState = {
  mcpConfigured: false,
  researchConfigured: false,
  computerUseConfigured: false
}

function serviceMcpState(service: CodexRuntimeService, settings?: AppSettingsV1): CodexMcpState {
  const researchConfigured =
    typeof service.isResearchMcpConfigured === 'function' && service.isResearchMcpConfigured()
  const computerUseConfigured =
    (!settings || isComputerUseEnabledForRuntime(settings, 'codex')) &&
    typeof service.isComputerUseMcpConfigured === 'function' &&
    service.isComputerUseMcpConfigured(settings)
  const mcpConfigured =
    typeof service.isMcpConfigured === 'function'
      ? (researchConfigured || computerUseConfigured) && service.isMcpConfigured()
      : researchConfigured || computerUseConfigured
  return { mcpConfigured, researchConfigured, computerUseConfigured }
}

function codexCapabilities(state: CodexMcpState = emptyCodexMcpState): AgentRuntimeCapabilities {
  const unavailable = { available: false, reason: 'unsupported' }
  const mcpDiagnosticsReason = 'Codex MCP diagnostics are not exposed through this service yet.'
  const configuredMcpToolCount = Number(state.researchConfigured) + Number(state.computerUseConfigured)
  const caps = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'codex',
    transport: 'jsonrpc_stdio'
  })
  return {
    ...caps,
    matrix: createAgentRuntimeCapabilityMatrix({
      nativeHistory: true,
      nativeCompact: false,
      nativeResume: false,
      steer: true,
      fork: false,
      handoffImport: false,
      usage: true,
      eventReplay: true,
      reasons: {
        nativeCompact: 'Codex compaction is host-shared rematerialization, not native backend compaction.',
        nativeResume: 'Codex app-server thread resume is not exposed through this adapter.',
        fork: 'Codex fork is not exposed through this adapter.',
        handoffImport: 'Handoff import is provided by AgentRuntimeHost when a context ledger is configured.'
      }
    }),
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
      mcp: state.mcpConfigured
        ? {
            available: true,
            degraded: true,
            reason: mcpDiagnosticsReason,
            toolCount: configuredMcpToolCount || undefined,
            search: { available: false, reason: mcpDiagnosticsReason }
          }
        : { available: false, reason: mcpDiagnosticsReason },
      web: { available: false, reason: 'Codex web capabilities are not exposed through this service yet.' },
      research: state.researchConfigured
        ? {
            available: true,
            server: 'mcp',
            toolName: 'research_search',
            sources: ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns'],
            maxResults: 10
          }
        : { available: false, reason: 'Shared research MCP server is not configured for Codex yet.' },
      computerUse: state.computerUseConfigured
        ? configuredComputerUseCapability()
        : unavailableComputerUseCapability('Shared computer-use MCP server is not configured for Codex yet.'),
      skills: { available: false, reason: 'Codex skills are not exposed through this service yet.' },
      subagents: {
        available: true,
        degraded: true,
        reason: 'Codex child runs are visible when app-server emits native subagent/collab metadata.'
      },
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
    guard: {
      toolStorm: 'observe'
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

function codexRuntimeInfo(state: CodexMcpState = emptyCodexMcpState): Record<string, unknown> {
  const caps = codexCapabilities(state)
  const configuredMcpToolCount = Number(state.researchConfigured) + Number(state.computerUseConfigured)
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
        configuredServers: configuredMcpToolCount,
        connectedServers: 0,
        toolCount: caps.tools.mcp.toolCount ?? 0,
        computerUse: computerUseMcpRuntimeInfoState(state.computerUseConfigured),
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
      research: {
        ...coreCapability(caps.tools.research),
        server: caps.tools.research.server ?? 'mcp',
        toolName: caps.tools.research.toolName ?? 'research_search',
        sources: caps.tools.research.sources ?? [],
        maxResults: caps.tools.research.maxResults ?? 0
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

function codexToolDiagnostics(state: CodexMcpState = emptyCodexMcpState): Record<string, unknown> {
  const mcpServers: Record<string, unknown>[] = []
  if (state.researchConfigured) {
    mcpServers.push({
      id: 'gui_research',
      status: 'configured',
      toolCount: 1,
      tools: ['research_search']
    })
  }
  if (state.computerUseConfigured) {
    mcpServers.push(computerUseMcpDiagnosticsServer())
  }
  return {
    mcpServers,
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
    backendThreadId: thread.id,
    relation: thread.relation,
    parentThreadId: thread.parentThreadId
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

async function listCodexThreadChildren(
  service: CodexRuntimeService,
  input: { threadId: string; parentTurnId?: string; activeOnly?: boolean; limit?: number }
): Promise<AgentRuntimeListThreadChildrenResponse> {
  const children = await codexChildrenFromThreadEvents(service, input.threadId)
  const filtered = filterAgentRuntimeThreadChildren(children, {
    runtimeId: 'codex',
    parentThreadId: input.threadId,
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    ...(input.activeOnly ? { activeOnly: true } : {})
  })
  const limited = typeof input.limit === 'number' && input.limit > 0
    ? filtered.slice(0, Math.floor(input.limit))
    : filtered
  return {
    runtimeId: 'codex',
    threadId: input.threadId,
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    children: limited,
    metadata: {
      source: 'codex-app-server-events',
      totalChildren: filtered.length
    }
  }
}

async function readCodexChildTranscript(
  service: CodexRuntimeService,
  input: { parentThreadId: string; parentTurnId?: string; childId: string; limit?: number }
): Promise<AgentRuntimeReadChildTranscriptResponse> {
  const children = await listCodexThreadChildren(service, {
    threadId: input.parentThreadId,
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {})
  })
  const child = children.children.find((candidate) => candidate.id === input.childId)
  if (!child) {
    return degradedCodexChildTranscript(input, null, 'Codex child was not found on the parent thread.')
  }

  const childThreadId = stringValue(recordValue(child.openAsThreadRef).threadId)
  if (!childThreadId) {
    return degradedCodexChildTranscript(
      input,
      child,
      'Codex app-server did not expose a real child thread transcript.'
    )
  }

  const result = await service.readThread(childThreadId)
  if (!result.ok) {
    return degradedCodexChildTranscript(input, child, result.message)
  }

  const entries = limitTranscriptEntries(
    result.detail.blocks.flatMap((block) => childTranscriptEntriesFromBlock(block)),
    input.limit
  )
  return {
    transcript: {
      runtimeId: 'codex',
      parentThreadId: input.parentThreadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      childId: input.childId,
      child,
      transcriptRef: child.transcriptRef,
      entries,
      summary: child.summary,
      usage: child.usage ?? result.detail.usage,
      metadata: {
        source: 'openAsThreadRef',
        threadId: childThreadId
      }
    }
  }
}

async function codexChildrenFromThreadEvents(
  service: CodexRuntimeService,
  threadId: string
): Promise<AgentRuntimeChild[]> {
  const byId = new Map<string, AgentRuntimeChild>()
  const [events, threadsResult] = await Promise.all([
    typeof service.readStoredEvents === 'function'
      ? service.readStoredEvents(threadId, 0)
      : Promise.resolve([]),
    typeof service.listThreads === 'function'
      ? service.listThreads({ includeArchived: true })
      : Promise.resolve(null)
  ])
  if (threadsResult?.ok) {
    for (const thread of threadsResult.threads) {
      const child = childFromCodexThread(thread, threadId)
      if (!child) continue
      const existing = byId.get(child.id)
      byId.set(child.id, mergeCodexChild(existing, child))
    }
  }
  for (const event of events) {
    if (!event.child?.id) continue
    const child = normalizeCodexChild(event.child, event)
    const existing = byId.get(child.id)
    byId.set(child.id, mergeCodexChild(existing, child))
  }
  return [...byId.values()].sort(compareCodexChildren)
}

function childFromCodexThread(
  thread: CodexNormalizedThread,
  parentThreadId: string
): AgentRuntimeChild | null {
  if (thread.id === parentThreadId) return null
  if (thread.parentThreadId !== parentThreadId) return null
  if (thread.threadSource && thread.threadSource.trim().toLowerCase() !== 'subagent') return null
  const name = thread.agentNickname || thread.title || thread.preview || 'Codex child'
  const summary = thread.preview && thread.preview !== thread.title ? thread.preview : undefined
  return {
    id: thread.id,
    runtimeId: 'codex',
    parentThreadId,
    ...(thread.parentTurnId ? { parentTurnId: thread.parentTurnId } : {}),
    kind: 'thread',
    status: codexChildStatus(thread.latestTurnStatus || thread.status),
    name,
    ...(thread.agentRole ? { label: thread.agentRole } : {}),
    ...(summary ? { summary } : {}),
    openAsThreadRef: {
      runtimeId: 'codex',
      threadId: thread.id,
      relation: 'side',
      title: thread.title || name
    },
    transcriptRef: {
      kind: 'runtime',
      runtimeId: 'codex',
      childId: thread.id,
      transcriptId: thread.id,
      source: 'codex-thread',
      label: thread.title || name
    },
    updatedAt: thread.updatedAt,
    metadata: {
      source: 'codex.threadSource',
      threadSource: thread.threadSource || 'subagent',
      ...(thread.agentNickname ? { agentNickname: thread.agentNickname } : {}),
      ...(thread.agentRole ? { agentRole: thread.agentRole } : {})
    }
  }
}

function codexChildStatus(value: string | undefined): AgentRuntimeChild['status'] {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'succeeded' || normalized === 'success') {
    return 'completed'
  }
  if (normalized === 'failed' || normalized === 'failure' || normalized === 'error') return 'failed'
  if (normalized === 'aborted' || normalized === 'cancelled' || normalized === 'canceled' || normalized === 'interrupted') {
    return 'aborted'
  }
  if (normalized === 'queued' || normalized === 'pending') return 'queued'
  if (normalized === 'running' || normalized === 'in_progress' || normalized === 'started') return 'running'
  return 'unknown'
}

function normalizeCodexChild(
  child: AgentRuntimeChild,
  event: CodexThreadEventPayload
): AgentRuntimeChild {
  return {
    ...child,
    runtimeId: 'codex',
    parentThreadId: child.parentThreadId || event.threadId,
    ...(child.parentTurnId || event.turnId ? { parentTurnId: child.parentTurnId || event.turnId } : {})
  }
}

function mergeCodexChild(
  previous: AgentRuntimeChild | undefined,
  next: AgentRuntimeChild
): AgentRuntimeChild {
  if (!previous) return next
  return {
    ...previous,
    ...next,
    createdAt: previous.createdAt ?? next.createdAt,
    startedAt: previous.startedAt ?? next.startedAt,
    metadata: {
      ...(previous.metadata ?? {}),
      ...(next.metadata ?? {})
    }
  }
}

function compareCodexChildren(a: AgentRuntimeChild, b: AgentRuntimeChild): number {
  return childTime(a) - childTime(b)
}

function childTime(child: AgentRuntimeChild): number {
  const value = child.startedAt || child.createdAt || child.updatedAt || child.completedAt
  const ms = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(ms) ? ms : 0
}

function degradedCodexChildTranscript(
  input: { parentThreadId: string; parentTurnId?: string; childId: string; limit?: number },
  child: AgentRuntimeChild | null,
  reason: string
): AgentRuntimeReadChildTranscriptResponse {
  return {
    transcript: {
      runtimeId: 'codex',
      parentThreadId: input.parentThreadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      childId: input.childId,
      ...(child ? { child } : {}),
      ...(child?.transcriptRef ? { transcriptRef: child.transcriptRef } : {}),
      entries: limitTranscriptEntries(degradedChildTranscriptEntries(input.childId, child), input.limit),
      summary: child?.summary,
      usage: child?.usage,
      degraded: true,
      reason
    }
  }
}

function degradedChildTranscriptEntries(
  childId: string,
  child: AgentRuntimeChild | null
): AgentRuntimeChildTranscriptEntry[] {
  if (!child) return []
  const entries: AgentRuntimeChildTranscriptEntry[] = []
  if (child.prompt) {
    entries.push({
      id: `${childId}-prompt`,
      kind: 'user_message',
      text: child.prompt
    })
  }
  if (child.summary) {
    entries.push({
      id: `${childId}-summary`,
      kind: 'assistant_message',
      text: child.summary
    })
  }
  return entries
}

function childTranscriptEntriesFromBlock(block: CodexChatBlock): AgentRuntimeChildTranscriptEntry[] {
  if (block.kind === 'user') {
    return [{
      id: block.id,
      kind: 'user_message',
      text: block.displayText?.trim() || block.text,
      createdAt: block.createdAt
    }]
  }
  if (block.kind === 'assistant') {
    return [{
      id: block.id,
      kind: 'assistant_message',
      text: block.text,
      createdAt: block.createdAt
    }]
  }
  if (block.kind === 'reasoning') {
    return [{
      id: block.id,
      kind: 'reasoning',
      text: block.text,
      createdAt: block.createdAt
    }]
  }
  if (block.kind === 'tool') {
    return [{
      id: block.id,
      kind: 'tool',
      summary: block.summary,
      text: block.detail,
      status: block.status,
      createdAt: block.createdAt,
      metadata: block.meta
    }]
  }
  if (block.kind === 'system') {
    return [{
      id: block.id,
      kind: 'system',
      text: block.text,
      status: block.severity,
      createdAt: block.createdAt,
      metadata: {
        ...(block.code ? { code: block.code } : {}),
        ...(block.detail ? { detail: block.detail } : {})
      }
    }]
  }
  return []
}

function limitTranscriptEntries(
  entries: AgentRuntimeChildTranscriptEntry[],
  limit?: number
): AgentRuntimeChildTranscriptEntry[] {
  if (typeof limit !== 'number' || limit <= 0) return entries
  return entries.slice(0, Math.floor(limit))
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
      ...(event.userMessage.displayText ? { displayText: event.userMessage.displayText } : {}),
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
  if (event.child) {
    mapped.push({
      ...common,
      kind: 'child_event',
      child: event.child
    })
  }
  if (event.runtimeError) {
    const terminalState = codexRuntimeErrorTerminalState(event.runtimeError)
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
    if (terminalState) {
      mapped.push({
        ...common,
        kind: 'turn_lifecycle',
        state: terminalState,
        message: event.runtimeError.message
      })
    }
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
  if (event.goal) {
    mapped.push({
      ...common,
      kind: 'goal_event',
      itemId: event.goal.itemId,
      createdAt: event.goal.createdAt,
      objective: event.goal.objective,
      status: event.goal.status,
      cleared: event.goal.cleared
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

function codexRuntimeErrorTerminalState(
  error: NonNullable<CodexThreadEventPayload['runtimeError']>
): 'failed' | 'cancelled' | 'aborted' | null {
  const code = stringValue(error.code).toLowerCase()
  if (code === 'reconnecting' || code === 'tool_waiting' || code === 'stream_recovering') return null
  if (code === 'cancelled' || code === 'canceled') return 'cancelled'
  if (code === 'aborted' || code === 'interrupted') return 'aborted'
  if (isTransientCodexRuntimeErrorMessage(error.message)) return null
  if (error.severity && error.severity !== 'error') return null
  return 'failed'
}

function isTransientCodexRuntimeErrorMessage(message: string | undefined): boolean {
  return /^Reconnecting\.\.\.\s+\d+\s*\/\s*\d+$/iu.test(message?.trim() ?? '')
}

function inferTurnStatus(items: AgentRuntimeItem[]): AgentRuntimeTurn['status'] {
  if (items.some((item) => item.kind === 'assistant_message')) return 'completed'
  if (items.some((item) => item.status === 'running')) return 'running'
  if (items.some((item) => item.status === 'error' || item.status === 'failed')) return 'failed'
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

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
