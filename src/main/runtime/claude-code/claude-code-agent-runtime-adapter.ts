import type {
  AgentRuntimeCapabilities,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail
} from '../../../shared/agent-runtime-contract'
import { createDefaultAgentRuntimeCapabilities } from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter } from '../agent-runtime/adapter'
import type {
  ClaudeCodeRuntimeFailure,
  ClaudeCodeRuntimeService
} from './claude-code-service'

export function createClaudeCodeAgentRuntimeAdapter(
  service: ClaudeCodeRuntimeService
): AgentRuntimeAdapter {
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

    async listThreads(_context, input): Promise<AgentRuntimeThread[]> {
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
        title: input.title
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
        workspace: input.workspace
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
      const result = await service.steerTurn()
      if (!result.ok) throw claudeFailure(result)
    },

    async renameThread(_context, input) {
      const result = await service.renameThread(input.threadId, input.title)
      if (!result.ok) throw claudeFailure(result)
    },

    async deleteThread(_context, input) {
      const result = await service.deleteThread(input.threadId)
      if (!result.ok) throw claudeFailure(result)
    },

    async *subscribeEvents(_context, input) {
      yield* service.subscribeEvents(input.threadId, input.sinceSeq ?? 0, input.signal)
    },

    async usage(_context, input) {
      return service.usage(input)
    },

    async auxiliary(_context, input) {
      switch (input.operation) {
        case 'getRuntimeInfo':
          return claudeRuntimeInfo(await service.runtimeInfo())
        case 'getToolDiagnostics':
          return {
            providers: [],
            mcpServers: [],
            webProviders: [],
            attachments: { count: 0 },
            skills: {
              enabled: false,
              roots: [],
              skills: []
            }
          }
        case 'listSkills':
          return []
        case 'listMemories':
          return []
        case 'updateMemory':
        case 'deleteMemory':
          throw new Error('Claude Code runtime does not support memory operations.')
        case 'listThreadChildren': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('listThreadChildren requires payload.threadId.')
          return service.listThreadChildren({
            threadId,
            parentTurnId: stringValue(payload.turnId) || stringValue(payload.parentTurnId) || undefined,
            activeOnly: payload.activeOnly === true,
            cursor: stringValue(payload.cursor) || undefined,
            limit: numberValue(payload.limit)
          })
        }
        case 'readChildTranscript': {
          const payload = recordValue(input.payload)
          const parentThreadId = stringValue(payload.parentThreadId) || stringValue(payload.threadId)
          const childId = stringValue(payload.childId)
          if (!parentThreadId) throw new Error('readChildTranscript requires payload.parentThreadId.')
          if (!childId) throw new Error('readChildTranscript requires payload.childId.')
          return service.readChildTranscript({
            parentThreadId,
            parentTurnId: stringValue(payload.parentTurnId) || stringValue(payload.turnId) || undefined,
            childId,
            transcriptRef: payload.transcriptRef,
            cursor: stringValue(payload.cursor) || undefined,
            limit: numberValue(payload.limit)
          })
        }
        case 'archiveThread': {
          const payload = recordValue(input.payload)
          const threadId = stringValue(payload.threadId)
          if (!threadId) throw new Error('archiveThread requires payload.threadId.')
          const result = await service.archiveThread(threadId, payload.archived === true)
          if (!result.ok) throw claudeFailure(result)
          return undefined
        }
        default:
          throw new Error(`Claude Code AgentRuntimeAdapter does not support ${input.operation}.`)
      }
    }
  }
}

function claudeRuntimeInfo(info: Record<string, unknown>): Record<string, unknown> {
  const caps = claudeCapabilities()
  return {
    host: 'claude-code',
    port: 0,
    dataDir: '',
    startedAt: new Date().toISOString(),
    ...info,
    capabilities: {
      contractVersion: 1,
      model: {
        id: caps.model.id ?? 'claude',
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

function claudeCapabilities(): AgentRuntimeCapabilities {
  const unavailable = { available: false, reason: 'unsupported' }
  const caps = createDefaultAgentRuntimeCapabilities({
    runtimeId: 'claude',
    transport: 'cli_process'
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
      available: false,
      streaming: false,
      visibility: 'none',
      source: 'backend_redacted'
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
      mcp: { available: false, reason: 'Claude Code MCP diagnostics are not exposed through this service yet.' },
      web: { available: false, reason: 'Claude Code web capabilities are not exposed through this service yet.' },
      research: { available: false, reason: 'Claude Code research search is not exposed through this service yet.' },
      skills: { available: false, reason: 'Claude Code skills are not exposed through this service yet.' },
      subagents: { available: true },
      diagnostics: { available: false, reason: 'Claude Code tool diagnostics are not exposed through this service yet.' }
    },
    controls: {
      interrupt: true,
      steer: false,
      approval: 'unsupported',
      userInput: 'unsupported',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    storage: {
      guiOwnedThreads: true,
      backendThreadIdStable: false,
      usage: false,
      attachments: unavailable,
      memory: unavailable
    }
  }
}

function claudeFailure(result: ClaudeCodeRuntimeFailure): Error {
  const error = new Error(result.message)
  ;(error as Error & { code?: string; recoverable?: boolean }).code = result.code
  ;(error as Error & { code?: string; recoverable?: boolean }).recoverable = result.recoverable
  return error
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}
