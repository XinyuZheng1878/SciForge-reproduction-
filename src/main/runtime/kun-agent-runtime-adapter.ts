import {
  resolveKunRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeEvent,
  AgentRuntimeItem,
  AgentRuntimeModality,
  AgentRuntimeThread,
  AgentRuntimeThreadGoal,
  AgentRuntimeThreadDetail,
  AgentRuntimeToolKind,
  AgentRuntimeTurn,
  AgentRuntimeTurnHandle,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../shared/agent-runtime-contract'
import {
  createDefaultAgentRuntimeCapabilities,
  filterAgentRuntimeThreadChildren
} from '../../shared/agent-runtime-contract'
import {
  KUN_ATTACHMENTS_PATH,
  KUN_HEALTH_PATH,
  KUN_MEMORY_PATH,
  KUN_RUNTIME_INFO_PATH,
  KUN_RUNTIME_TOOLS_PATH,
  KUN_SKILLS_PATH,
  isKunThreadMode,
  kunAttachmentContentPath,
  kunApprovalPath,
  kunMemoryRecordPath,
  kunSessionResumePath,
  kunThreadCompactPath,
  kunThreadChildrenPath,
  kunThreadForkPath,
  kunThreadGoalPath,
  kunThreadInterruptPath,
  kunThreadPath,
  kunThreadReviewPath,
  kunThreadSteerPath,
  kunThreadTodosPath,
  kunThreadTurnsPath,
  kunUserInputPath,
  normalizeThreadMode
} from '../../shared/kun-endpoints'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext
} from './agent-runtime/adapter'

export type KunAgentRuntimeHttpInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export type KunAgentRuntimeHttpResult = {
  ok: boolean
  status: number
  body: string
}

export type KunAgentRuntimeHttpRequest = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: KunAgentRuntimeHttpInit
) => Promise<KunAgentRuntimeHttpResult>

export type KunAgentRuntimeEvents = (
  settings: AppSettingsV1,
  threadId: string,
  sinceSeq: number,
  signal: AbortSignal
) => AsyncIterable<unknown>

export type KunAgentRuntimeAdapterOptions = {
  request: KunAgentRuntimeHttpRequest
  events?: KunAgentRuntimeEvents
}

export function createKunAgentRuntimeAdapter(options: KunAgentRuntimeAdapterOptions): AgentRuntimeAdapter {
  return {
    id: 'kun',
    transport: 'http_sse',

    async connect(context) {
      await requestJson(options, context, KUN_HEALTH_PATH, { method: 'GET' })
    },

    async capabilities(context) {
      const response = await options.request(context.settings, KUN_RUNTIME_INFO_PATH, { method: 'GET' })
      if (!response.ok) return conservativeKunCapabilities()
      return mapKunCapabilities(readJson(response.body), true)
    },

    async listThreads(context, input) {
      const payload = await requestJson(options, context, `/v1/threads${threadListQuery(input)}`, { method: 'GET' })
      return arrayValue(asRecord(payload)?.threads)
        .map((thread) => mapKunThread(thread))
        .filter((thread) => thread.id)
    },

    async startThread(context, input) {
      const runtime = resolveKunRuntimeSettings(context.settings)
      const payload = await requestJson(options, context, '/v1/threads', {
        method: 'POST',
        body: JSON.stringify({
          workspace: input.workspace || context.settings.workspaceRoot || '~',
          title: input.title,
          model: resolveKunRequestModel(runtime.model, input.model),
          mode: normalizeThreadMode(input.mode),
          approvalPolicy: runtime.approvalPolicy,
          sandboxMode: runtime.sandboxMode
        })
      })
      return mapKunThread(firstRecord(payload, 'thread'))
    },

    async readThread(context, input) {
      const payload = await requestJson(options, context, kunThreadPath(input.threadId), { method: 'GET' })
      return mapKunThreadDetail(payload)
    },

    async startTurn(context, input) {
      const runtime = resolveKunRuntimeSettings(context.settings)
      const body: Record<string, unknown> = {
        prompt: input.text,
        model: resolveKunRequestModel(runtime.model, input.model)
      }
      if (input.reasoningEffort?.trim()) body.reasoningEffort = input.reasoningEffort.trim()
      if (input.displayText?.trim() && input.displayText.trim() !== input.text.trim()) {
        body.displayText = input.displayText.trim()
      }
      if (isKunThreadMode(input.mode)) body.mode = input.mode
      body.approvalPolicy = runtime.approvalPolicy
      body.sandboxMode = runtime.sandboxMode
      if (input.guiPlan) body.guiPlan = input.guiPlan
      if (input.attachmentIds?.length) body.attachmentIds = input.attachmentIds
      const modelObjectReferences = input.fileReferences
        ?.filter((reference) => reference.modelRouterObject === true && reference.relativePath.trim())
        .map((reference) => ({
          path: reference.relativePath.trim() || reference.path,
          name: reference.name,
          ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
          modelRouterObject: true
        }))
      if (modelObjectReferences?.length) body.attachments = modelObjectReferences
      const payload = await requestJson(options, context, kunThreadTurnsPath(input.threadId), {
        method: 'POST',
        body: JSON.stringify(body)
      })
      return mapTurnHandle(payload, input.threadId)
    },

    async interruptTurn(context, input) {
      await requestJson(options, context, kunThreadInterruptPath(input.threadId, input.turnId), {
        method: 'POST',
        body: JSON.stringify({ discard: input.discard === true })
      })
    },

    async steerTurn(context, input) {
      await requestJson(options, context, kunThreadSteerPath(input.threadId, input.turnId), {
        method: 'POST',
        body: JSON.stringify({ text: input.text })
      })
    },

    async renameThread(context, input) {
      await requestJson(options, context, kunThreadPath(input.threadId), {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title })
      })
    },

    async deleteThread(context, input) {
      await requestJson(options, context, kunThreadPath(input.threadId), { method: 'DELETE' })
    },

    async *subscribeEvents(context, input) {
      if (!options.events) return
      const signal = input.signal ?? new AbortController().signal
      for await (const event of options.events(context.settings, input.threadId, input.sinceSeq ?? 0, signal)) {
        const mapped = mapKunEvent(event, input.threadId)
        if (mapped) yield mapped
      }
    },

    async resolveApproval(context, input) {
      await requestJson(options, context, kunApprovalPath(input.approvalId), {
        method: 'POST',
        body: JSON.stringify({ decision: input.decision === 'allowed' ? 'allow' : 'deny' })
      })
    },

    async resolveUserInput(context, input) {
      await requestJson(options, context, kunUserInputPath(input.requestId), {
        method: 'POST',
        body: JSON.stringify({ answers: input.answers })
      })
    },

    async compactThread(context, input) {
      await requestJson(options, context, kunThreadCompactPath(input.threadId), {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason?.trim() || undefined })
      })
    },

    async forkThread(context, input) {
      const body: Record<string, unknown> = {}
      if (input.relation) body.relation = input.relation
      if (input.title) body.title = input.title
      const payload = await requestJson(options, context, kunThreadForkPath(input.threadId), {
        method: 'POST',
        ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {})
      })
      return mapKunThread(payload)
    },

    async resumeSession(context, input) {
      const runtime = resolveKunRuntimeSettings(context.settings)
      const payload = await requestJson(options, context, kunSessionResumePath(input.sessionId), {
        method: 'POST',
        body: JSON.stringify({
          workspace: context.settings.workspaceRoot || undefined,
          model: resolveKunRequestModel(runtime.model, input.model),
          mode: isKunThreadMode(input.mode) ? input.mode : undefined
        })
      })
      const record = asRecord(payload) ?? {}
      return {
        threadId: stringValue(record.threadId) || stringValue(record.thread_id),
        sessionId: stringValue(record.sessionId) || stringValue(record.session_id) || input.sessionId
      }
    },

    async updateThreadRelation(context, input) {
      await requestJson(options, context, kunThreadPath(input.threadId), {
        method: 'PATCH',
        body: JSON.stringify({ relation: input.relation })
      })
    },

    async usage(context, input) {
      const payload = await requestJson(options, context, kunUsagePath(input), { method: 'GET' })
      const response = mapUsageResponse(payload, input)
      if (input.groupBy === 'thread' && input.threadId) {
        await hydrateThreadCacheStats(options, context, input.threadId, response)
      }
      return response
    },

    async auxiliary(context, input) {
      return kunAuxiliary(options, context, input)
    }
  }
}

function resolveKunRequestModel(resolvedRuntimeModel: string, inputModel: string | undefined): string {
  const requestedModel = inputModel?.trim()
  return requestedModel && requestedModel.toLowerCase() !== 'auto'
    ? requestedModel
    : resolvedRuntimeModel
}

async function kunAuxiliary(
  options: KunAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  input: AgentRuntimeAuxiliaryInput
): Promise<unknown> {
  const payload = asRecord(input.payload) ?? {}
  switch (input.operation) {
    case 'reviewThread': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const target = payload.target
      if (target === undefined) throw missingPayload(input.operation, 'target')
      const body: Record<string, unknown> = { target }
      const model = optionalString(payload.model)
      if (model) body.model = model
      return requestJson(options, context, kunThreadReviewPath(threadId), {
        method: 'POST',
        body: JSON.stringify(body)
      })
    }
    case 'getRuntimeInfo':
      return requestJson(options, context, KUN_RUNTIME_INFO_PATH, { method: 'GET' })
    case 'getToolDiagnostics':
      return requestJson(options, context, KUN_RUNTIME_TOOLS_PATH, { method: 'GET' })
    case 'listSkills': {
      const result = await requestJson(options, context, KUN_SKILLS_PATH, { method: 'GET' })
      return arrayValue(asRecord(result)?.skills)
    }
    case 'uploadAttachment': {
      const result = await requestJson(options, context, KUN_ATTACHMENTS_PATH, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      return firstRecord(result, 'attachment')
    }
    case 'getAttachmentContent': {
      const attachmentId = requiredString(payload, 'attachmentId', input.operation)
      const optionsPayload = asRecord(payload.options) ?? {}
      return requestJson(
        options,
        context,
        `${kunAttachmentContentPath(attachmentId)}${queryString({
          thread_id: optionalString(optionsPayload.threadId),
          workspace: optionalString(optionsPayload.workspace)
        })}`,
        { method: 'GET' }
      )
    }
    case 'listMemories': {
      const optionsPayload = asRecord(payload.options) ?? payload
      let result: unknown
      try {
        result = await requestJson(
          options,
          context,
          `${KUN_MEMORY_PATH}${queryString({
            workspace: optionalString(optionsPayload.workspace),
            include_deleted: booleanOrUndefined(optionsPayload.includeDeleted)
          })}`,
          { method: 'GET' }
        )
      } catch (error) {
        if (isKunCapabilityUnavailableError(error, 'memory store is unavailable')) return []
        throw error
      }
      return arrayValue(asRecord(result)?.memories)
    }
    case 'updateMemory': {
      const memoryId = requiredString(payload, 'memoryId', input.operation)
      const patch = asRecord(payload.patch) ?? {}
      const result = await requestJson(options, context, kunMemoryRecordPath(memoryId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
      return firstRecord(result, 'memory')
    }
    case 'deleteMemory': {
      const memoryId = requiredString(payload, 'memoryId', input.operation)
      const result = await requestJson(options, context, kunMemoryRecordPath(memoryId), { method: 'DELETE' })
      return firstRecord(result, 'memory')
    }
    case 'updateThreadWorkspace': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      await requestJson(options, context, kunThreadPath(threadId), {
        method: 'PATCH',
        body: JSON.stringify({ workspace: requiredString(payload, 'workspace', input.operation) })
      })
      return undefined
    }
    case 'archiveThread': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      await requestJson(options, context, kunThreadPath(threadId), {
        method: 'PATCH',
        body: JSON.stringify({ status: payload.archived === true ? 'archived' : 'idle' })
      })
      return undefined
    }
    case 'getThreadGoal': {
      const result = await requestJson(
        options,
        context,
        kunThreadGoalPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'GET' }
      )
      return asRecord(result)?.goal ?? null
    }
    case 'setThreadGoal': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const patch = asRecord(payload.patch) ?? {}
      const result = await requestJson(options, context, kunThreadGoalPath(threadId), {
        method: 'POST',
        body: JSON.stringify(patch)
      })
      return asRecord(result)?.goal ?? null
    }
    case 'clearThreadGoal': {
      const result = await requestJson(
        options,
        context,
        kunThreadGoalPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'DELETE' }
      )
      return asRecord(result)?.cleared === true
    }
    case 'getThreadTodos': {
      const result = await requestJson(
        options,
        context,
        kunThreadTodosPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'GET' }
      )
      return asRecord(result)?.todos ?? null
    }
    case 'setThreadTodos': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const result = await requestJson(options, context, kunThreadTodosPath(threadId), {
        method: 'POST',
        body: JSON.stringify({ todos: arrayValue(payload.todos) })
      })
      return asRecord(result)?.todos ?? null
    }
    case 'clearThreadTodos': {
      const result = await requestJson(
        options,
        context,
        kunThreadTodosPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'DELETE' }
      )
      return asRecord(result)?.cleared === true
    }
    case 'cancelUserInput':
      await requestJson(options, context, kunUserInputPath(requiredString(payload, 'requestId', input.operation)), {
        method: 'POST',
        body: JSON.stringify({ cancelled: true })
      })
      return undefined
    case 'listThreadChildren': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const turnId = optionalString(payload.turnId) ?? optionalString(payload.parentTurnId)
      const activeOnly = booleanOrUndefined(payload.activeOnly)
      let result: unknown
      try {
        result = await requestJson(
          options,
          context,
          `${kunThreadChildrenPath(threadId)}${queryString({
            turn_id: turnId,
            active_only: activeOnly,
            cursor: optionalString(payload.cursor),
            limit: optionalPositiveIntegerString(payload.limit)
          })}`,
          { method: 'GET' }
        )
      } catch (error) {
        if (!isKunNotFoundError(error)) throw error
        return {
          runtimeId: 'kun',
          threadId,
          ...(turnId ? { parentTurnId: turnId } : {}),
          children: [],
          degraded: true,
          reason: 'Kun child run endpoint is unavailable.'
        }
      }
      const record = asRecord(result) ?? {}
      const rawChildren = arrayValue(record.children).length
        ? arrayValue(record.children)
        : arrayValue(record.childRuns)
      const children = filterAgentRuntimeThreadChildren(
        rawChildren
          .map((child) => mapKunChildRun(child, threadId))
          .filter((child): child is AgentRuntimeChild => child != null),
        {
          runtimeId: 'kun',
          parentThreadId: threadId,
          ...(turnId ? { parentTurnId: turnId } : {}),
          ...(activeOnly !== undefined ? { activeOnly } : {})
        }
      )
      const metadata = asRecord(record.metadata)
      return {
        runtimeId: 'kun',
        threadId,
        ...(turnId ? { parentTurnId: turnId } : {}),
        children,
        ...(optionalString(record.nextCursor) ? { nextCursor: optionalString(record.nextCursor) } : {}),
        ...(record.degraded === true ? { degraded: true } : {}),
        ...(optionalString(record.reason) ? { reason: optionalString(record.reason) } : {}),
        ...(metadata ? { metadata } : {})
      }
    }
    case 'readChildTranscript': {
      const threadId = optionalString(payload.threadId) ??
        optionalString(payload.parentThreadId) ??
        requiredString(payload, 'threadId', input.operation)
      const parentTurnId = optionalString(payload.parentTurnId) ?? optionalString(payload.turnId)
      const childId = requiredString(payload, 'childId', input.operation)
      const reason = 'Kun child agent transcripts are not persisted by the runtime yet.'
      return {
        transcript: {
          runtimeId: 'kun',
          threadId,
          parentThreadId: threadId,
          ...(parentTurnId ? { parentTurnId } : {}),
          childId,
          format: 'unknown',
          entries: [],
          degraded: true,
          reason
        }
      }
    }
    default:
      throw new Error(`Unsupported Kun auxiliary operation: ${input.operation}.`)
  }
}

async function requestJson(
  options: KunAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  pathAndQuery: string,
  init: KunAgentRuntimeHttpInit
): Promise<unknown> {
  const response = await options.request(context.settings, pathAndQuery, init)
  if (!response.ok) throw kunHttpError(response)
  return readJson(response.body)
}

function readJson(body: string): unknown {
  if (!body.trim()) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return {}
  }
}

function kunHttpError(response: KunAgentRuntimeHttpResult): Error {
  const body = asRecord(readJson(response.body))
  const message = stringValue(body?.message) || stringValue(body?.error) || `Kun runtime HTTP request failed (${response.status}).`
  const error = new Error(message)
  error.name = stringValue(body?.code) || 'KunRuntimeHttpError'
  return error
}

function isKunCapabilityUnavailableError(error: unknown, message: string): boolean {
  return error instanceof Error &&
    error.name === 'capability_unavailable' &&
    error.message.toLowerCase().includes(message.toLowerCase())
}

function missingPayload(operation: string, key: string): Error {
  return new Error(`Kun auxiliary operation ${operation} requires payload.${key}.`)
}

function requiredString(payload: Record<string, unknown>, key: string, operation: string): string {
  const value = optionalString(payload[key])
  if (!value) throw missingPayload(operation, key)
  return value
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalPositiveIntegerString(value: unknown): string | undefined {
  const number = numberValue(value)
  if (number === undefined || !Number.isInteger(number) || number <= 0) return undefined
  return String(number)
}

function queryString(params: Record<string, string | boolean | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

function threadListQuery(input: {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
}): string {
  const query = new URLSearchParams()
  if (typeof input.limit === 'number') query.set('limit', String(input.limit))
  if (input.search?.trim()) query.set('search', input.search.trim())
  if (typeof input.includeArchived === 'boolean') query.set('include_archived', String(input.includeArchived))
  if (typeof input.archivedOnly === 'boolean') query.set('archived_only', String(input.archivedOnly))
  const value = query.toString()
  return value ? `?${value}` : ''
}

function kunUsagePath(input: AgentRuntimeUsageQuery): string {
  const query = new URLSearchParams()
  query.set('group_by', input.groupBy)
  if (input.from?.trim()) query.set('from', input.from.trim())
  if (input.to?.trim()) query.set('to', input.to.trim())
  if (input.timezone?.trim()) query.set('timezone', input.timezone.trim())
  return `/v1/usage?${query.toString()}`
}

function mapKunThread(value: unknown): AgentRuntimeThread {
  const record = firstRecord(value, 'thread')
  const id = stringValue(record.id) || stringValue(record.threadId)
  const status = stringValue(record.status)
  const turns = arrayValue(record.turns)
  const latestTurn = asRecord(turns.at(-1)) ?? {}
  return {
    id,
    runtimeId: 'kun',
    title: stringValue(record.title) || stringValue(record.name) || stringValue(record.preview) || 'Kun thread',
    updatedAt: stringValue(record.updatedAt) || stringValue(record.updated_at) || new Date().toISOString(),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at),
    model: optionalString(record.model),
    mode: optionalString(record.mode),
    workspace: optionalString(record.workspace),
    status: status || undefined,
    archived: record.archived === true || status === 'archived',
    preview: optionalString(record.preview),
    latestTurnId: optionalString(record.latestTurnId) ?? optionalString(latestTurn.id),
    latestTurnStatus: optionalString(record.latestTurnStatus) ?? optionalString(latestTurn.status),
    backendThreadId: id,
    relation: normalizeThreadRelation(record.relation),
    parentThreadId: optionalString(record.parentThreadId) ?? optionalString(record.parent_thread_id),
    forkedFromThreadId: optionalString(record.forkedFromThreadId) ?? optionalString(record.forked_from_thread_id),
    forkedFromTitle: optionalString(record.forkedFromTitle) ?? optionalString(record.forked_from_title),
    forkedAt: optionalString(record.forkedAt) ?? optionalString(record.forked_at),
    forkedFromMessageCount: numberValue(record.forkedFromMessageCount) ?? numberValue(record.forked_from_message_count),
    forkedFromTurnCount: numberValue(record.forkedFromTurnCount) ?? numberValue(record.forked_from_turn_count),
    goal: mapKunGoal(record.goal, id)
  }
}

function mapKunGoal(value: unknown, threadId: string): AgentRuntimeThreadGoal | null {
  const record = asRecord(value)
  if (!record) return null
  const objective = stringValue(record.objective)
  const status = mapKunGoalStatus(stringValue(record.status))
  const createdAt = optionalString(record.createdAt) ?? optionalString(record.created_at) ?? new Date().toISOString()
  const updatedAt = optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? createdAt
  const tokenBudget = numberValue(record.tokenBudget) ?? numberValue(record.token_budget)
  if (!objective || !status) return null
  return {
    runtimeId: 'kun',
    threadId,
    objective,
    status,
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    tokensUsed: numberValue(record.tokensUsed) ?? numberValue(record.tokens_used) ?? 0,
    timeUsedSeconds: numberValue(record.timeUsedSeconds) ?? numberValue(record.time_used_seconds) ?? 0,
    createdAt,
    updatedAt
  }
}

function mapKunThreadDetail(value: unknown): AgentRuntimeThreadDetail {
  const record = firstRecord(value, 'thread')
  const thread = mapKunThread(record)
  const turns = arrayValue(record.turns)
    .map((turn) => mapKunTurn(turn, thread.id))
    .filter((turn) => turn.id)
  const items = turns.flatMap((turn) => turn.items ?? [])
  return {
    ...thread,
    latestSeq: numberValue(record.latestSeq) ?? numberValue(record.latest_seq) ?? items.length,
    turns,
    items,
    usage: mapUsage(record.usage)
  }
}

function mapKunTurn(value: unknown, threadId: string): AgentRuntimeTurn {
  const record = asRecord(value) ?? {}
  const id = stringValue(record.id) || stringValue(record.turnId)
  const startedAt = optionalString(record.startedAt) ?? optionalString(record.createdAt)
  const completedAt = optionalString(record.completedAt) ?? optionalString(record.finishedAt)
  const items = arrayValue(record.items)
    .map((item) => mapKunItem(item))
    .filter(Boolean) as AgentRuntimeItem[]
  return {
    id,
    threadId: stringValue(record.threadId) || threadId,
    status: normalizeTurnStatus(record.status),
    startedAt,
    completedAt,
    durationMs: numberValue(record.durationMs),
    items
  }
}

function mapKunItem(value: unknown): AgentRuntimeItem | null {
  const record = asRecord(value)
  if (!record) return null
  const kind = stringValue(record.kind)
  const base = {
    id: stringValue(record.id) || `${kind || 'item'}-${Date.now()}`,
    status: normalizeItemStatus(record.status),
    createdAt: optionalString(record.createdAt)
  }
  if (kind === 'user_message') {
    return { ...base, kind: 'user_message', text: stringValue(record.displayText) || stringValue(record.text) }
  }
  if (kind === 'assistant_text') {
    return { ...base, kind: 'assistant_message', text: stringValue(record.text) }
  }
  if (kind === 'assistant_reasoning') {
    return { ...base, kind: 'reasoning', text: stringValue(record.text) }
  }
  if (kind === 'tool_call') {
    const toolName = stringValue(record.toolName)
    const itemId = kunToolItemId(record, base.id)
    return {
      ...base,
      id: itemId,
      kind: 'tool',
      toolKind: normalizeToolKind(record.toolKind),
      summary: stringValue(record.summary) || toolName || 'Tool call',
      detail: stringifyDetail(record.arguments),
      meta: kunToolMeta(record, base.id, toolName)
    }
  }
  if (kind === 'tool_result') {
    const toolName = stringValue(record.toolName)
    const itemId = kunToolItemId(record, base.id)
    return {
      ...base,
      id: itemId,
      kind: 'tool',
      status: record.isError === true ? 'error' : normalizeItemStatus(record.status) ?? 'success',
      toolKind: normalizeToolKind(record.toolKind),
      summary: stringValue(record.summary) || toolName || 'Tool result',
      detail: stringifyDetail(record.output),
      meta: kunToolMeta(record, base.id, toolName)
    }
  }
  if (kind === 'approval') {
    return {
      ...base,
      kind: 'approval',
      summary: stringValue(record.summary) || stringValue(record.toolName),
      meta: {
        approvalId: stringValue(record.approvalId),
        toolName: stringValue(record.toolName)
      }
    }
  }
  if (kind === 'user_input') {
    return {
      ...base,
      kind: 'user_input',
      text: stringValue(record.prompt),
      meta: { requestId: stringValue(record.inputId), questions: record.questions }
    }
  }
  if (kind === 'compaction') {
    return {
      ...base,
      kind: 'compaction',
      summary: stringValue(record.summary),
      meta: { replacedTokens: numberValue(record.replacedTokens) }
    }
  }
  if (kind === 'review') {
    return {
      ...base,
      kind: 'review',
      summary: stringValue(record.title),
      text: stringValue(record.reviewText),
      meta: { output: record.output }
    }
  }
  if (kind === 'error') {
    return {
      ...base,
      kind: 'system',
      status: 'error',
      text: stringValue(record.message),
      detail: stringifyDetail(record.details),
      meta: { code: stringValue(record.code), severity: stringValue(record.severity) }
    }
  }
  return {
    ...base,
    kind: 'system',
    text: stringValue(record.text) || stringValue(record.message),
    meta: { sourceKind: kind }
  }
}

function kunToolItemId(record: Record<string, unknown>, fallbackId: string): string {
  const callId = stringValue(record.callId)
  return callId ? `tool_${callId}` : fallbackId
}

function kunToolMeta(
  record: Record<string, unknown>,
  sourceItemId: string,
  toolName: string
): Record<string, unknown> {
  const callId = stringValue(record.callId)
  return {
    sourceItemId,
    ...(callId ? { callId } : {}),
    ...(toolName ? { toolName } : {})
  }
}

function mapTurnHandle(value: unknown, fallbackThreadId: string): AgentRuntimeTurnHandle {
  const record = firstRecord(value, 'turn')
  return {
    threadId: stringValue(record.threadId) || fallbackThreadId,
    turnId: stringValue(record.turnId) || stringValue(record.id),
    userMessageItemId: optionalString(record.userMessageItemId)
  }
}

function mapKunToolReadyEvent(
  record: Record<string, unknown>,
  common: {
    threadId: string
    seq?: number
    createdAt?: string
    turnId?: string
    sourceItemId?: string
  }
): AgentRuntimeEvent | null {
  const callId = stringValue(record.callId)
  const toolName = stringValue(record.toolName)
  if (!callId || !toolName) return null
  return {
    kind: 'tool_event',
    threadId: common.threadId,
    runtimeId: 'kun',
    seq: common.seq,
    createdAt: common.createdAt,
    turnId: common.turnId,
    itemId: `tool_${callId}`,
    status: 'running',
    summary: toolName,
    toolKind: 'tool_call',
    meta: {
      ...(common.sourceItemId ? { sourceItemId: common.sourceItemId } : {}),
      callId,
      toolName,
      ...(typeof record.readyCount === 'number' ? { readyCount: record.readyCount } : {}),
      runtimeStatus: 'tool_call_ready'
    }
  }
}

function mapKunEvent(value: unknown, fallbackThreadId: string): AgentRuntimeEvent | null {
  const record = asRecord(value)
  if (!record) return null
  const threadId = stringValue(record.threadId) || fallbackThreadId
  const seq = numberValue(record.seq)
  const kind = stringValue(record.kind)
  const createdAt = optionalString(record.timestamp) ?? optionalString(record.createdAt)
  const turnId = optionalString(record.turnId)
  const itemId = stringValue(record.itemId)
  const child = mapKunChildEvent(record, threadId, turnId, createdAt)
  if (child) {
    const message = optionalString(record.message) ?? optionalString(record.text)
    return {
      kind: 'child_event',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      itemId: child.id,
      child,
      ...(message ? { message } : {})
    }
  }

  if (kind === 'thread_created' || kind === 'thread_updated') {
    return {
      kind: 'thread_lifecycle',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      state: kind === 'thread_created' ? 'created' : 'updated',
      thread: {
        id: threadId,
        runtimeId: 'kun',
        title: stringValue(record.title) || 'Kun thread',
        updatedAt: createdAt || new Date().toISOString(),
        status: optionalString(record.status),
        backendThreadId: threadId
      }
    }
  }

  if (
    kind === 'turn_started' ||
    kind === 'turn_completed' ||
    kind === 'turn_failed' ||
    kind === 'turn_aborted' ||
    kind === 'turn_steered'
  ) {
    return {
      kind: 'turn_lifecycle',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      state: mapKunTurnLifecycleState(kind),
      message: optionalString(record.message) ?? optionalString(record.text)
    }
  }

  if (kind === 'agent_message_delta' || kind === 'assistant_delta' || kind === 'assistant_text_delta') {
    const item = asRecord(record.item)
    return {
      kind: 'assistant_delta',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      itemId: itemId || stringValue(item?.id) || `kun-delta-${seq ?? Date.now()}`,
      text: stringValue(record.text) || stringValue(record.delta) || stringValue(item?.text)
    }
  }
  if (kind === 'agent_reasoning_delta' || kind === 'reasoning_delta' || kind === 'assistant_reasoning_delta') {
    const item = asRecord(record.item)
    return {
      kind: 'reasoning_delta',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      itemId: itemId || stringValue(item?.id) || `kun-reasoning-${seq ?? Date.now()}`,
      text: stringValue(record.text) || stringValue(record.delta) || stringValue(item?.text),
      visibility: 'summary'
    }
  }

  if (kind === 'tool_call_ready') {
    return mapKunToolReadyEvent(record, {
      threadId,
      seq,
      createdAt,
      turnId,
      sourceItemId: itemId || optionalString(record.itemId)
    })
  }

  if (kind === 'compaction_started' || kind === 'compaction_completed') {
    const sourceItemIds = stringArrayValue(record.sourceItemIds)
    return {
      kind: 'compaction_event',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      status: kind === 'compaction_started' ? 'running' : 'success',
      summary: stringValue(record.summary),
      detail: compactionEventDetail(record),
      auto: record.auto !== false,
      messagesBefore: sourceItemIds?.length,
      replacedTokens: numberValue(record.replacedTokens),
      sourceDigest: optionalString(record.sourceDigest),
      digestMarker: optionalString(record.digestMarker),
      sourceItemIds
    }
  }

  if (kind === 'goal_updated' || kind === 'goal_cleared') {
    const goal = asRecord(record.goal)
    return {
      kind: 'goal_event',
      threadId,
      runtimeId: 'kun',
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      objective: stringValue(goal?.objective),
      status: mapKunGoalStatus(stringValue(goal?.status)),
      cleared: kind === 'goal_cleared' || record.cleared === true
    }
  }

  if (
    kind === 'item_created' ||
    kind === 'item_updated' ||
    kind === 'item_completed' ||
    kind === 'tool_call_started' ||
    kind === 'tool_call_finished'
  ) {
    const item = mapKunItem(record.item)
    if (item) {
      return {
        kind: 'item_snapshot',
        threadId,
        runtimeId: 'kun',
        seq,
        createdAt,
        turnId,
        itemId: item.id,
        item
      }
    }
  }

  if (isNeutralEvent(record)) return { ...record, runtimeId: 'kun' } as AgentRuntimeEvent

  return {
    kind: 'item_snapshot',
    threadId,
    runtimeId: 'kun',
    seq,
    createdAt,
    turnId,
    item: {
      id: itemId || `kun-event-${seq ?? Date.now()}`,
      kind: 'system',
      meta: record
    }
  }
}

function mapKunTurnLifecycleState(kind: string): Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state'] {
  if (kind === 'turn_completed') return 'completed'
  if (kind === 'turn_failed') return 'failed'
  if (kind === 'turn_aborted') return 'aborted'
  if (kind === 'turn_steered') return 'steered'
  return 'started'
}

function compactionEventDetail(record: Record<string, unknown>): string | undefined {
  const replacedTokens = numberValue(record.replacedTokens)
  if (replacedTokens !== undefined) return `replacedTokens=${replacedTokens}`
  return optionalString(record.detail) ?? optionalString(record.reason)
}

function mapKunGoalStatus(value: string): Extract<AgentRuntimeEvent, { kind: 'goal_event' }>['status'] | undefined {
  if (
    value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
  ) {
    return value
  }
  return undefined
}

function isNeutralEvent(record: Record<string, unknown>): boolean {
  return [
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
    'child_event',
    'usage',
    'error',
    'heartbeat'
  ].includes(stringValue(record.kind))
}

function conservativeKunCapabilities(): AgentRuntimeCapabilities {
  const caps = createDefaultAgentRuntimeCapabilities({ runtimeId: 'kun', transport: 'http_sse' })
  return {
    ...caps,
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'sse'
    },
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: 'summary',
      source: 'model'
    },
    model: {
      ...caps.model,
      supportsToolCalling: true
    },
    tools: {
      ...caps.tools,
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      diagnostics: { available: false, reason: 'runtime info unavailable', degraded: true }
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: 'async',
      userInput: 'async',
      compact: 'native',
      fork: true,
      review: true,
      goals: true,
      todos: true,
      resumeSession: true
    },
    guard: {
      toolStorm: 'native'
    },
    storage: {
      ...caps.storage,
      backendThreadIdStable: true,
      usage: true
    }
  }
}

function mapKunCapabilities(value: unknown, diagnosticsAvailable: boolean): AgentRuntimeCapabilities {
  const caps = conservativeKunCapabilities()
  const manifest = asRecord(asRecord(value)?.capabilities) ?? asRecord(value) ?? {}
  const model = asRecord(manifest.model) ?? {}
  const mcp = asRecord(manifest.mcp) ?? {}
  const web = asRecord(manifest.web) ?? {}
  const research = asRecord(manifest.research) ?? {}
  const skills = asRecord(manifest.skills) ?? {}
  const subagents = asRecord(manifest.subagents) ?? {}
  const attachments = asRecord(manifest.attachments) ?? {}
  const memory = asRecord(manifest.memory) ?? {}
  return {
    ...caps,
    model: {
      id: optionalString(model.id),
      inputModalities: modalities(model.inputModalities, caps.model.inputModalities),
      outputModalities: modalities(model.outputModalities, caps.model.outputModalities),
      supportsToolCalling: booleanValue(model.supportsToolCalling, caps.model.supportsToolCalling),
      contextWindowTokens: numberValue(model.contextWindowTokens)
    },
    tools: {
      toolCalling: booleanValue(model.supportsToolCalling, true),
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: {
        ...capabilityState(mcp),
        search: mcpSearchCapabilityState(asRecord(mcp.search) ?? {}),
        toolCount: numberValue(mcp.toolCount)
      },
      web: {
        ...capabilityState(web),
        fetch: capabilityState(asRecord(web.fetch) ?? {}),
        search: capabilityState(asRecord(web.search) ?? {})
      },
      research: researchCapabilityState(research),
      skills: capabilityState(skills),
      subagents: {
        ...capabilityState(subagents),
        maxParallel: numberValue(subagents.maxParallel),
        maxChildren: numberValue(subagents.maxChildRuns) ?? numberValue(subagents.maxChildren)
      },
      diagnostics: diagnosticsAvailable
        ? { available: true }
        : { available: false, reason: 'runtime info unavailable', degraded: true }
    },
    storage: {
      ...caps.storage,
      attachments: capabilityState(attachments),
      memory: capabilityState(memory)
    }
  }
}

function capabilityState(value: Record<string, unknown>): { available: boolean; reason?: string; degraded?: boolean } {
  const available = value.available === true || value.status === 'available'
  const reason = optionalString(value.reason)
  return {
    available,
    ...(reason ? { reason } : {}),
    ...(value.status === 'unavailable' && value.enabled === true ? { degraded: true } : {})
  }
}

function mcpSearchCapabilityState(value: Record<string, unknown>): { available: boolean; reason?: string } {
  const reason = optionalString(value.reason)
  return {
    available: value.available === true || value.active === true,
    ...(reason ? { reason } : {})
  }
}

function researchCapabilityState(value: Record<string, unknown>): AgentRuntimeCapabilities['tools']['research'] {
  const base = capabilityState(value)
  const sources = researchSources(value)
  const available = base.available || value.active === true || (hasResearchProviderState(value) && sources.length > 0)
  const toolName = optionalString(value.toolName) ?? optionalString(value.tool) ?? 'research_search'
  return {
    ...base,
    available,
    ...(available ? { server: 'mcp' as const, toolName } : {}),
    ...(sources.length ? { sources } : {}),
    ...(numberValue(value.maxResults) ? { maxResults: numberValue(value.maxResults) } : {})
  }
}

function hasResearchProviderState(value: Record<string, unknown>): boolean {
  return Boolean(
    asRecord(value.arxiv) ||
    asRecord(value.biorxiv) ||
    asRecord(value.semanticScholar) ||
    asRecord(value.semantic_scholar) ||
    asRecord(value.tavily) ||
    asRecord(value.web) ||
    asRecord(value.cns)
  )
}

function researchSources(value: Record<string, unknown>): NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']> {
  const explicit = arrayValue(value.sources)
    .filter((entry): entry is NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']>[number] =>
      entry === 'arxiv' ||
      entry === 'biorxiv' ||
      entry === 'semantic_scholar' ||
      entry === 'web' ||
      entry === 'cns'
    )
  if (explicit.length) return [...new Set(explicit)]
  const sources: NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']> = []
  if (capabilityState(asRecord(value.arxiv) ?? {}).available) sources.push('arxiv')
  if (capabilityState(asRecord(value.biorxiv) ?? {}).available) sources.push('biorxiv')
  if (capabilityState(asRecord(value.semanticScholar) ?? {}).available) sources.push('semantic_scholar')
  if (capabilityState(asRecord(value.semantic_scholar) ?? {}).available) sources.push('semantic_scholar')
  if (capabilityState(asRecord(value.tavily) ?? {}).available) sources.push('web')
  if (capabilityState(asRecord(value.web) ?? {}).available) sources.push('web')
  if (capabilityState(asRecord(value.cns) ?? {}).available) sources.push('cns')
  return [...new Set(sources)]
}

function modalities(value: unknown, fallback: AgentRuntimeModality[]): AgentRuntimeModality[] {
  const parsed = arrayValue(value).filter((entry): entry is AgentRuntimeModality => entry === 'text' || entry === 'image')
  return parsed.length ? parsed : fallback
}

function mapUsage(value: unknown): AgentRuntimeThreadDetail['usage'] {
  const record = asRecord(value)
  if (!record) return undefined
  const inputTokens = numberValue(record.inputTokens) ?? numberValue(record.promptTokens) ?? numberValue(record.prompt_tokens)
  const outputTokens = numberValue(record.outputTokens) ?? numberValue(record.completionTokens) ?? numberValue(record.completion_tokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberValue(record.totalTokens) ??
      numberValue(record.total_tokens) ??
      (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined),
    cacheReadTokens: numberValue(record.cacheReadTokens) ??
      numberValue(record.cachedTokens) ??
      numberValue(record.cacheHitTokens) ??
      numberValue(record.cache_hit_tokens),
    cacheWriteTokens: numberValue(record.cacheWriteTokens) ??
      numberValue(record.cacheMissTokens) ??
      numberValue(record.cache_miss_tokens),
    costUsd: numberValue(record.costUsd) ?? numberValue(record.cost_usd)
  }
}

function mapKunChildRun(value: unknown, fallbackParentThreadId: string): AgentRuntimeChild | null {
  const record = asRecord(value)
  if (!record) return null
  const id = stringValue(record.id) || stringValue(record.childId)
  const parentThreadId = stringValue(record.parentThreadId) || fallbackParentThreadId
  if (!id || !parentThreadId) return null
  const label = optionalString(record.label) ?? optionalString(record.childLabel)
  const status = mapKunChildStatus(stringValue(record.status) || stringValue(record.childStatus))
  const updatedAt = optionalString(record.updatedAt) ?? optionalString(record.updated_at)
  const completedAt = status === 'completed' || status === 'failed' || status === 'aborted'
    ? updatedAt
    : undefined
  const workspace = optionalString(record.workspace)
  const model = optionalString(record.model)
  const error = optionalString(record.error)
  return {
    id,
    runtimeId: 'kun',
    parentThreadId,
    parentTurnId: optionalString(record.parentTurnId) ?? optionalString(record.parent_turn_id),
    kind: 'agent',
    status,
    ...(label ? { label, name: label } : {}),
    prompt: optionalString(record.prompt),
    summary: optionalString(record.summary) ?? optionalString(record.text) ?? error,
    usage: mapUsage(record.usage),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at),
    startedAt: optionalString(record.startedAt) ?? optionalString(record.started_at) ?? optionalString(record.createdAt) ?? optionalString(record.created_at),
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    metadata: {
      source: 'kun.delegate_task',
      ...(workspace ? { workspace } : {}),
      ...(model ? { model } : {}),
      ...(error ? { error } : {})
    }
  }
}

function mapKunChildStatus(value: string): AgentRuntimeChildStatus {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  ) {
    return value
  }
  return 'unknown'
}

function mapKunChildEvent(
  value: Record<string, unknown>,
  fallbackParentThreadId: string,
  fallbackParentTurnId: string | undefined,
  createdAt: string | undefined
): AgentRuntimeChild | null {
  const event = value
  const record = asRecord(event.child)
  if (!record) return null
  const id = stringValue(record.childId)
  const parentThreadId = stringValue(record.parentThreadId) || fallbackParentThreadId
  if (!id || !parentThreadId) return null
  const label = optionalString(record.childLabel)
  const status = mapKunChildStatus(stringValue(record.childStatus))
  const summary = optionalString(event.text) ?? optionalString(event.message)
  return {
    id,
    runtimeId: 'kun',
    parentThreadId,
    parentTurnId: optionalString(record.parentTurnId) ?? fallbackParentTurnId,
    kind: 'agent',
    status,
    ...(label ? { label, name: label } : {}),
    ...(summary ? { summary } : {}),
    updatedAt: createdAt,
    ...(status === 'completed' || status === 'failed' || status === 'aborted' ? { completedAt: createdAt } : {}),
    metadata: {
      source: 'kun.runtime_event',
      ...(numberValue(record.childSeq) !== undefined ? { childSeq: numberValue(record.childSeq) } : {})
    }
  }
}

function mapUsageResponse(
  value: unknown,
  input: AgentRuntimeUsageQuery
): Extract<AgentRuntimeUsageResponse, { supported: true }> {
  const record = asRecord(value) ?? {}
  const buckets = arrayValue(record.buckets)
    .map((item) => normalizeUsageBucket(asRecord(item) ?? {}, input.groupBy))
  const days = arrayValue(record.days)
    .map((item) => normalizeUsageBucket(asRecord(item) ?? {}, 'day'))
  return {
    supported: true,
    groupBy: input.groupBy,
    from: optionalString(record.from) ?? input.from,
    to: optionalString(record.to) ?? input.to,
    timezone: optionalString(record.timezone) ?? input.timezone,
    buckets,
    ...(days.length ? { days } : {}),
    totals: normalizeUsageTotals(asRecord(record.totals) ?? {})
  }
}

function normalizeUsageBucket(
  record: Record<string, unknown>,
  groupBy: AgentRuntimeUsageQuery['groupBy']
): Record<string, unknown> {
  const inputTokens = usageNumber(record, 'inputTokens', 'input_tokens', 'prompt_tokens')
  const outputTokens = usageNumber(record, 'outputTokens', 'output_tokens', 'completion_tokens')
  const totalTokens = usageNumber(record, 'totalTokens', 'total_tokens') || inputTokens + outputTokens
  const bucket: Record<string, unknown> = {
    inputTokens,
    outputTokens,
    reasoningTokens: usageNumber(record, 'reasoningTokens', 'reasoning_tokens'),
    cachedTokens: usageNumber(record, 'cachedTokens', 'cached_tokens', 'cacheReadTokens', 'cache_read_tokens', 'cache_hit_tokens'),
    cacheMissTokens: usageNumber(record, 'cacheMissTokens', 'cache_miss_tokens', 'cacheWriteTokens', 'cache_write_tokens'),
    totalTokens,
    costUsd: usageNumber(record, 'costUsd', 'cost_usd'),
    costCny: usageNullableNumber(record, 'costCny', 'cost_cny'),
    cacheSavingsUsd: usageNumber(record, 'cacheSavingsUsd', 'cache_savings_usd'),
    cacheSavingsCny: usageNullableNumber(record, 'cacheSavingsCny', 'cache_savings_cny'),
    tokenEconomySavingsTokens: usageNumber(record, 'tokenEconomySavingsTokens', 'token_economy_savings_tokens'),
    tokenEconomySavingsUsd: usageNumber(record, 'tokenEconomySavingsUsd', 'token_economy_savings_usd'),
    tokenEconomySavingsCny: usageNullableNumber(record, 'tokenEconomySavingsCny', 'token_economy_savings_cny'),
    turns: usageNumber(record, 'turns'),
    threadCount: usageNumber(record, 'threadCount', 'thread_count'),
    cacheHitRate: usageNullableRate(record, 'cacheHitRate', 'cache_hit_rate')
  }
  if (groupBy === 'day') bucket.date = optionalString(record.date) ?? ''
  if (groupBy === 'model') bucket.model = optionalString(record.model) ?? 'unknown'
  if (groupBy === 'thread') {
    bucket.threadId = optionalString(record.threadId) ??
      optionalString(record.thread_id) ??
      optionalString(record.id) ??
      optionalString(record.key) ??
      optionalString(record.label) ??
      ''
    if (typeof record.title === 'string') bucket.title = record.title
  }
  return bucket
}

function normalizeUsageTotals(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...normalizeUsageBucket(record, 'thread'),
    days: usageNumber(record, 'days'),
    activeDays: usageNumber(record, 'activeDays', 'active_days')
  }
}

async function hydrateThreadCacheStats(
  options: KunAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  threadId: string,
  response: Extract<AgentRuntimeUsageResponse, { supported: true }>
): Promise<void> {
  let payload: unknown
  try {
    payload = await requestJson(options, context, kunThreadPath(threadId), { method: 'GET' })
  } catch (error) {
    if (isKunNotFoundError(error)) return
    throw error
  }
  const stats = threadCacheStats(payload)
  if (!stats) return
  const bucket = response.buckets.find((item) => {
    const record = asRecord(item) ?? {}
    return [record.threadId, record.thread_id, record.id, record.key, record.label].some((candidate) => candidate === threadId)
  })
  if (!bucket) return
  const cacheTotal = stats.hitTokens + stats.missTokens
  bucket.cachedTokens = stats.hitTokens
  bucket.cacheMissTokens = stats.missTokens
  bucket.cacheHitRate = cacheTotal > 0 ? stats.hitTokens / cacheTotal : null
}

function isKunNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.name === 'not_found'
}

function threadCacheStats(value: unknown): { hitTokens: number; missTokens: number } | null {
  const record = firstRecord(value, 'thread')
  let hitTokens = 0
  let missTokens = 0
  let hasCacheTelemetry = false
  for (const turn of arrayValue(record.turns)) {
    const usage = asRecord(asRecord(turn)?.usage)
    if (!usage) continue
    const hasHit = numberValue(usage.prompt_cache_hit_tokens) !== undefined ||
      numberValue(usage.promptCacheHitTokens) !== undefined
    const hasMiss = numberValue(usage.prompt_cache_miss_tokens) !== undefined ||
      numberValue(usage.promptCacheMissTokens) !== undefined
    if (!hasHit && !hasMiss) continue
    hasCacheTelemetry = true
    hitTokens += usageNumber(usage, 'promptCacheHitTokens', 'prompt_cache_hit_tokens')
    missTokens += usageNumber(usage, 'promptCacheMissTokens', 'prompt_cache_miss_tokens')
  }
  return hasCacheTelemetry ? { hitTokens, missTokens } : null
}

function usageNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value !== undefined) return value
  }
  return 0
}

function usageNullableNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value !== undefined) return value
  }
  return null
}

function usageNullableRate(record: Record<string, unknown>, ...keys: string[]): number | null {
  const value = usageNullableNumber(record, ...keys)
  return value === null ? null : Math.max(0, Math.min(1, value))
}

function normalizeThreadRelation(value: unknown): AgentRuntimeThread['relation'] {
  return value === 'primary' || value === 'fork' || value === 'side' ? value : undefined
}

function normalizeTurnStatus(value: unknown): AgentRuntimeTurn['status'] {
  if (value === 'queued' || value === 'running' || value === 'completed' ||
    value === 'failed' || value === 'aborted' || value === 'steered') {
    return value
  }
  return 'queued'
}

function normalizeItemStatus(value: unknown): AgentRuntimeItem['status'] | undefined {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  ) {
    return value
  }
  return undefined
}

function normalizeToolKind(value: unknown): AgentRuntimeToolKind | undefined {
  if (value === 'tool_call' || value === 'command_execution' || value === 'file_change') return value
  return undefined
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

function firstRecord(value: unknown, nestedKey: string): Record<string, unknown> {
  const record = asRecord(value) ?? {}
  return asRecord(record[nestedKey]) ?? record
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

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text || undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
