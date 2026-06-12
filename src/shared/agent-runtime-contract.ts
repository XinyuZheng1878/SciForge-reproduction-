export type AgentRuntimeId = 'kun' | 'codex'

export type AgentRuntimeTransport = 'http_sse' | 'jsonrpc_stdio'

export type AgentRuntimeEventDelivery = 'sse' | 'ipc' | 'async_iterable'

export type AgentRuntimeThreadMaterialization = 'immediate' | 'after_first_user_message'

export type AgentRuntimeThreadRelation = 'primary' | 'fork' | 'side'

export type AgentRuntimePhase =
  | 'process_start'
  | 'initialize_start'
  | 'initialize_done'
  | 'thread_start_done'
  | 'turn_start_sent'
  | 'first_delta'
  | 'turn_done'
  | 'tool_running'

export type ReasoningVisibility = 'none' | 'summary' | 'trace' | 'full_runtime_text'

export type ReasoningSource = 'model' | 'runtime_summary' | 'backend_redacted' | 'unknown'

export type AgentRuntimeControlSupport =
  | 'unsupported'
  | 'sync'
  | 'async'
  | 'fail_closed'

export type AgentRuntimeCompactSupport = 'unsupported' | 'native' | 'noop'

export type AgentRuntimeModality = 'text' | 'image'

export type AgentRuntimeToolKind = 'tool_call' | 'command_execution' | 'file_change'

export type AgentRuntimeErrorSeverity = 'info' | 'warning' | 'error'

export type AgentRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: AgentRuntimeFailure }

export type AgentRuntimeFailure = {
  code: string
  message: string
  recoverable: boolean
  severity: AgentRuntimeErrorSeverity
  details?: unknown
}

export type CapabilityState = {
  available: boolean
  reason?: string
  degraded?: boolean
}

export type AgentRuntimeThread = {
  id: string
  runtimeId: AgentRuntimeId
  title: string
  updatedAt: string
  createdAt?: string
  model?: string
  mode?: string
  workspace?: string
  status?: string
  archived?: boolean
  preview?: string
  latestTurnId?: string
  latestTurnStatus?: string
  backendThreadId?: string
  relation?: AgentRuntimeThreadRelation
  parentThreadId?: string
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
}

export type AgentRuntimeThreadDetail = AgentRuntimeThread & {
  latestSeq: number
  turns?: AgentRuntimeTurn[]
  items?: AgentRuntimeItem[]
  usage?: AgentRuntimeUsage
}

export type AgentRuntimeTurn = {
  id: string
  threadId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted' | 'steered'
  startedAt?: string
  completedAt?: string
  durationMs?: number
  items?: AgentRuntimeItem[]
}

export type AgentRuntimeTurnHandle = {
  threadId: string
  turnId: string
  userMessageItemId?: string
}

export type AgentRuntimeThreadListInput = {
  runtimeId?: AgentRuntimeId
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  summary?: boolean
}

export type AgentRuntimeThreadStartInput = {
  runtimeId?: AgentRuntimeId
  workspace?: string
  title?: string
  mode?: string
  model?: string
}

export type AgentRuntimeThreadReadInput = {
  runtimeId?: AgentRuntimeId
  threadId: string
}

export type AgentRuntimeTurnStartInput = {
  runtimeId?: AgentRuntimeId
  threadId: string
  text: string
  workspace?: string
  mode?: string
  model?: string
  reasoningEffort?: string
  displayText?: string
  guiPlan?: {
    operation: 'draft' | 'refine'
    workspaceRoot: string
    relativePath: string
    planId: string
    sourceRequest?: string
    title?: string
  }
  attachmentIds?: string[]
}

export type AgentRuntimeTurnTargetInput = {
  runtimeId?: AgentRuntimeId
  threadId: string
  turnId: string
  discard?: boolean
}

export type AgentRuntimeTurnSteerInput = {
  runtimeId?: AgentRuntimeId
  threadId: string
  turnId: string
  text: string
}

export type AgentRuntimeUsage = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  modelContextWindow?: number | null
  costUsd?: number
}

export type AgentRuntimeUsageGroupBy = 'day' | 'model' | 'thread'

export type AgentRuntimeUsageQuery = {
  runtimeId?: AgentRuntimeId
  groupBy: AgentRuntimeUsageGroupBy
  from?: string
  to?: string
  timezone?: string
  threadId?: string
}

export type AgentRuntimeUsageResponse =
  | {
      supported: true
      groupBy: AgentRuntimeUsageGroupBy
      from?: string
      to?: string
      timezone?: string
      buckets: Array<Record<string, unknown>>
      days?: Array<Record<string, unknown>>
      totals: Record<string, unknown>
    }
  | {
      supported: false
      reason?: string
      groupBy?: AgentRuntimeUsageGroupBy
      buckets?: []
      days?: []
      totals?: Record<string, unknown>
    }

export type AgentRuntimeAuxiliaryOperation =
  | 'reviewThread'
  | 'getRuntimeInfo'
  | 'getToolDiagnostics'
  | 'listSkills'
  | 'uploadAttachment'
  | 'getAttachmentContent'
  | 'listMemories'
  | 'updateMemory'
  | 'deleteMemory'
  | 'updateThreadWorkspace'
  | 'archiveThread'
  | 'getThreadGoal'
  | 'setThreadGoal'
  | 'clearThreadGoal'
  | 'getThreadTodos'
  | 'setThreadTodos'
  | 'clearThreadTodos'
  | 'cancelUserInput'

export type AgentRuntimeAuxiliaryInput = {
  runtimeId?: AgentRuntimeId
  operation: AgentRuntimeAuxiliaryOperation
  payload?: Record<string, unknown>
}

export type AgentRuntimeItem = {
  id: string
  kind:
    | 'user_message'
    | 'assistant_message'
    | 'reasoning'
    | 'tool'
    | 'compaction'
    | 'review'
    | 'system'
    | 'approval'
    | 'user_input'
  text?: string
  summary?: string
  status?: 'pending' | 'running' | 'success' | 'error' | 'completed' | 'failed' | 'aborted'
  toolKind?: AgentRuntimeToolKind
  detail?: string
  meta?: Record<string, unknown>
  createdAt?: string
}

export type AgentRuntimeInputOption = {
  label: string
  description?: string
}

export type AgentRuntimeInputQuestion = {
  id: string
  header: string
  question: string
  options: AgentRuntimeInputOption[]
}

export type AgentRuntimeTodoStatus = 'pending' | 'in_progress' | 'completed'

export type AgentRuntimeTodoItem = {
  id: string
  content: string
  status: AgentRuntimeTodoStatus
}

export type AgentRuntimeBaseEvent = {
  threadId: string
  runtimeId?: AgentRuntimeId
  turnId?: string
  itemId?: string
  seq?: number
  createdAt?: string
}

export type AgentRuntimeEvent =
  | (AgentRuntimeBaseEvent & {
      kind: 'thread_lifecycle'
      state: 'created' | 'updated' | 'archived'
      thread?: AgentRuntimeThread
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'turn_lifecycle'
      state: 'started' | 'completed' | 'failed' | 'aborted' | 'steered'
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'runtime_status'
      phase?: AgentRuntimePhase
      message?: string
      latencyMs?: number
      metadata?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_message'
      itemId: string
      text: string
      displayText?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'assistant_delta'
      itemId: string
      text: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'reasoning_delta'
      itemId: string
      text: string
      visibility: ReasoningVisibility
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'item_snapshot'
      item: AgentRuntimeItem
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'tool_event'
      itemId: string
      status: 'running' | 'success' | 'error'
      toolKind?: AgentRuntimeToolKind
      summary?: string
      detail?: string
      filePath?: string
      meta?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'approval_requested'
      approvalId: string
      summary: string
      toolName?: string
      meta?: Record<string, unknown>
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'approval_resolved'
      approvalId: string
      decision: 'allowed' | 'denied' | 'error'
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_input_requested'
      requestId: string
      questions: AgentRuntimeInputQuestion[]
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'user_input_resolved'
      requestId: string
      status: 'submitted' | 'cancelled' | 'error'
      answers?: Array<{ id: string; label?: string; value: string }>
      message?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'compaction_event'
      status: 'running' | 'success' | 'error'
      summary: string
      detail?: string
      auto?: boolean
      messagesBefore?: number
      messagesAfter?: number
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'review_event'
      status: 'running' | 'success' | 'error'
      title: string
      reviewText?: string
      output?: unknown
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'goal_event'
      objective?: string
      status?: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete'
      cleared?: boolean
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'todo_event'
      items: AgentRuntimeTodoItem[]
      cleared?: boolean
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'usage'
      usage: AgentRuntimeUsage
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'error'
      recoverable: boolean
      severity: AgentRuntimeErrorSeverity
      message: string
      code?: string
      detail?: string
    })
  | (AgentRuntimeBaseEvent & {
      kind: 'heartbeat'
    })

export const AGENT_RUNTIME_EVENT_KINDS = [
  'thread_lifecycle',
  'turn_lifecycle',
  'runtime_status',
  'user_message',
  'assistant_delta',
  'reasoning_delta',
  'item_snapshot',
  'tool_event',
  'approval_requested',
  'approval_resolved',
  'user_input_requested',
  'user_input_resolved',
  'compaction_event',
  'review_event',
  'goal_event',
  'todo_event',
  'usage',
  'error',
  'heartbeat'
] as const satisfies ReadonlyArray<AgentRuntimeEvent['kind']>

export type AgentRuntimeEventKind = typeof AGENT_RUNTIME_EVENT_KINDS[number]

export type AgentRuntimeCapabilities = {
  contractVersion: 1
  runtimeId: AgentRuntimeId
  transport: AgentRuntimeTransport
  events: {
    live: boolean
    replayable: boolean
    sequenced: boolean
    delivery: AgentRuntimeEventDelivery
  }
  threadMaterialization: AgentRuntimeThreadMaterialization
  latency: {
    phaseEvents: boolean
    firstTokenMetric: boolean
    turnDurationMetric: boolean
    supportedPhases?: AgentRuntimePhase[]
  }
  reasoning: {
    available: boolean
    streaming: boolean
    visibility: ReasoningVisibility
    source: ReasoningSource
  }
  model: {
    id?: string
    inputModalities: AgentRuntimeModality[]
    outputModalities: AgentRuntimeModality[]
    supportsToolCalling: boolean
    contextWindowTokens?: number
  }
  tools: {
    toolCalling: boolean
    commandExecution: CapabilityState
    fileChange: CapabilityState
    mcp: CapabilityState & { search?: CapabilityState; toolCount?: number }
    web: CapabilityState & { fetch?: CapabilityState; search?: CapabilityState }
    skills: CapabilityState
    subagents: CapabilityState & { maxParallel?: number; maxChildren?: number }
    diagnostics: CapabilityState
  }
  controls: {
    interrupt: boolean
    steer: boolean
    approval: AgentRuntimeControlSupport
    userInput: AgentRuntimeControlSupport
    compact: AgentRuntimeCompactSupport
    fork: boolean
    review: boolean
    goals: boolean
    todos: boolean
    resumeSession: boolean
  }
  storage: {
    guiOwnedThreads: boolean
    backendThreadIdStable: boolean
    usage: boolean
    attachments: CapabilityState
    memory: CapabilityState
  }
}

export function createUnavailableCapabilityState(reason?: string): CapabilityState {
  return reason ? { available: false, reason } : { available: false }
}

export function createDefaultAgentRuntimeCapabilities(input: {
  runtimeId: AgentRuntimeId
  transport: AgentRuntimeTransport
}): AgentRuntimeCapabilities {
  const unsupported = () => createUnavailableCapabilityState('unsupported')
  return {
    contractVersion: 1,
    runtimeId: input.runtimeId,
    transport: input.transport,
    events: {
      live: false,
      replayable: false,
      sequenced: false,
      delivery: 'async_iterable'
    },
    threadMaterialization: 'immediate',
    latency: {
      phaseEvents: false,
      firstTokenMetric: false,
      turnDurationMetric: false,
      supportedPhases: []
    },
    reasoning: {
      available: false,
      streaming: false,
      visibility: 'none',
      source: 'unknown'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false
    },
    tools: {
      toolCalling: false,
      commandExecution: unsupported(),
      fileChange: unsupported(),
      mcp: {
        ...unsupported(),
        search: unsupported()
      },
      web: {
        ...unsupported(),
        fetch: unsupported(),
        search: unsupported()
      },
      skills: unsupported(),
      subagents: { ...unsupported() },
      diagnostics: unsupported()
    },
    controls: {
      interrupt: false,
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
      guiOwnedThreads: false,
      backendThreadIdStable: false,
      usage: false,
      attachments: unsupported(),
      memory: unsupported()
    }
  }
}
