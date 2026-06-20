import { createDefaultAgentRuntimeCapabilities } from '../../../shared/agent-runtime-contract'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter } from '../agent-runtime/adapter'
import type { ClaudeRuntimeFailure, ClaudeRuntimeService } from './claude-service'

export function createClaudeAgentRuntimeAdapter(service: ClaudeRuntimeService): AgentRuntimeAdapter {
  return {
    id: 'claude',
    transport: 'cli_process',

    async connect() {
      const result = await service.connect()
      if (!result.ok) throw claudeFailure(result)
    },

    async capabilities() {
      return claudeCapabilities()
    },

    async listThreads(_context, input) {
      const result = await service.listThreads({
        limit: input.limit,
        search: input.search,
        includeArchived: input.includeArchived,
        archivedOnly: input.archivedOnly
      })
      if (!result.ok) throw claudeFailure(result)
      return result.threads
    },

    async startThread(_context, input): Promise<AgentRuntimeThread> {
      const result = await service.startThread({
        workspace: input.workspace,
        title: input.title,
        model: input.model
      })
      if (!result.ok) throw claudeFailure(result)
      return result.thread
    },

    async readThread(_context, input): Promise<AgentRuntimeThreadDetail> {
      const result = await service.readThread(input.threadId)
      if (!result.ok) throw claudeFailure(result)
      return result.detail
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
      if (!result.ok) throw claudeFailure(result)
      return {
        threadId: result.threadId,
        turnId: result.turnId,
        userMessageItemId: result.userMessageItemId
      }
    },

    async interruptTurn(_context, input) {
      const result = await service.interruptTurn(input.threadId, input.turnId)
      if (!result.ok) throw claudeFailure(result)
    },

    async steerTurn() {
      throw new Error('claude AgentRuntimeAdapter does not support steer.')
    },

    async renameThread(_context, input) {
      const result = await service.renameThread(input.threadId, input.title)
      if (!result.ok) throw claudeFailure(result)
    },

    async deleteThread(_context, input) {
      const result = await service.deleteThread(input.threadId)
      if (!result.ok) throw claudeFailure(result)
    },

    async *subscribeEvents(_context, input): AsyncIterable<AgentRuntimeEvent> {
      for await (const event of service.subscribeEvents(input.threadId, input.sinceSeq ?? 0, input.signal)) {
        if (input.signal?.aborted) return
        yield event
      }
    },

    async publishSyntheticEvent(_context, event) {
      return service.publishSyntheticEvent(event)
    },

    async compactThread() {
      return undefined
    },

    async usage(_context, input) {
      const result = await service.usage()
      if (!result.ok) throw claudeFailure(result)
      return {
        supported: false,
        reason: 'Claude Code CLI usage aggregation is not available yet.',
        groupBy: input.groupBy,
        buckets: [],
        totals: result.totals
      }
    },

    async auxiliary(_context, input) {
      switch (input.operation) {
        case 'getRuntimeInfo':
          return service.runtimeInfo()
        case 'getToolDiagnostics':
          return claudeToolDiagnostics()
        default:
          throw new Error(`claude AgentRuntimeAdapter does not support ${input.operation}.`)
      }
    }
  }
}

function claudeCapabilities(): AgentRuntimeCapabilities {
  const capabilities = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'claude',
    transport: 'cli_process'
  })
  return {
    ...capabilities,
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'async_iterable'
    },
    threadMaterialization: 'immediate',
    latency: {
      phaseEvents: true,
      firstTokenMetric: false,
      turnDurationMetric: false,
      supportedPhases: ['initialize_done', 'turn_done']
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true
    },
    tools: {
      ...capabilities.tools,
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: { available: true, search: { available: false } },
      skills: { available: true },
      diagnostics: { available: true }
    },
    controls: {
      ...capabilities.controls,
      interrupt: true,
      compact: 'noop'
    },
    guard: {
      toolStorm: 'observe'
    },
    storage: {
      ...capabilities.storage,
      guiOwnedThreads: true,
      backendThreadIdStable: true,
      usage: false
    }
  }
}

function claudeToolDiagnostics(): Record<string, unknown> {
  return {
    runtimeId: 'claude',
    transport: 'cli_process',
    providers: [{ id: 'claude-cli', status: 'available' }]
  }
}

function claudeFailure(error: ClaudeRuntimeFailure): Error {
  const result = new Error(error.message)
  result.name = error.code ?? 'ClaudeRuntimeError'
  return result
}
