import type { CodexThreadEventPayload } from '../codex-runtime-api'

export type CodexEventNormalizeContext = {
  threadId?: string
  turnId?: string
}

export function normalizeCodexEvent(
  payload: unknown,
  context: CodexEventNormalizeContext = {}
): CodexThreadEventPayload | null {
  const event = asRecord(payload)
  if (!event) return null
  if (stringValue(event.type) === 'event_msg') {
    return normalizeSessionEventMessage(asRecord(event.payload), context)
  }
  if (stringValue(event.type) === 'response_item') {
    return normalizeSessionResponseItem(asRecord(event.payload), context)
  }
  const method = stringValue(event.method)
  const params = asRecord(event.params) ?? {}
  const threadId = stringValue(params.threadId) ||
    stringValue(params.thread_id) ||
    stringValue(asRecord(params.thread)?.id) ||
    stringValue(context.threadId)
  if (!threadId) return null
  const turnId = stringValue(params.turnId) ||
    stringValue(params.turn_id) ||
    stringValue(asRecord(params.turn)?.id) ||
    stringValue(context.turnId)
  if (isAgentMessageDelta(method)) {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: deltaText(params), kind: 'agent_message' }]
    }
  }
  if (isReasoningDelta(method)) {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: deltaText(params), kind: 'agent_reasoning' }]
    }
  }
  if (method === 'item/commandExecution/outputDelta') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: stringValue(params.itemId),
        summary: 'Command output',
        status: 'running',
        toolKind: 'command_execution',
        detail: stringValue(params.delta)
      }
    }
  }
  if (method === 'item/fileChange/outputDelta') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: stringValue(params.itemId),
        summary: 'File changes',
        status: 'running',
        toolKind: 'file_change',
        detail: stringValue(params.delta)
      }
    }
  }
  if (method === 'rawResponseItem/completed') {
    return normalizeSessionResponseItem(asRecord(params.item), { threadId, turnId })
  }
  if (method === 'item/started') {
    return normalizeThreadItem(asRecord(params.item), { threadId, turnId }, 'running')
  }
  if (method === 'item/completed') {
    return normalizeThreadItem(asRecord(params.item), { threadId, turnId }, 'completed')
  }
  if (method === 'turn/completed') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      turnComplete: true
    }
  }
  if (method === 'thread/tokenUsage/updated') {
    const usage = tokenUsageFromParams(params)
    if (!usage) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      usage
    }
  }
  if (method === 'error' || method === 'turn/failed') {
    const error = asRecord(params.error)
    const details = error?.details ?? error?.data ?? params.details ?? params.data
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-error',
        message: stringValue(error?.message) || 'Codex runtime error',
        ...(stringValue(error?.code) ? { code: stringValue(error?.code) } : {}),
        ...(details !== undefined ? { details } : {}),
        severity: 'error'
      }
    }
  }
  if (method === 'turn/cancelled' || method === 'turn/canceled') {
    const reason = stringValue(params.reason)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-cancelled',
        message: reason ? `Codex turn cancelled: ${reason}` : 'Codex turn cancelled.',
        code: 'cancelled',
        severity: 'warning'
      }
    }
  }
  if (isApprovalRequest(method)) {
    const itemId = stringValue(params.itemId) || turnId || 'codex-approval'
    const toolName = stringValue(params.toolName) || approvalToolName(method)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId,
        message: `Codex requested approval for ${toolName}, but approval handling is not available.`,
        code: 'approval_required',
        severity: 'warning'
      }
    }
  }
  if (isUserInputRequest(method)) {
    const itemId = stringValue(params.itemId) || stringValue(params.requestId) || turnId || 'codex-user-input'
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId,
        message: 'Codex is blocked on a user input request, but user input handling is not available yet.',
        code: 'user_input_required',
        severity: 'warning'
      }
    }
  }
  return null
}

function normalizeSessionEventMessage(
  payload: Record<string, unknown> | null,
  context: CodexEventNormalizeContext
): CodexThreadEventPayload | null {
  if (!payload) return null
  const threadId = sessionThreadId(payload, context)
  if (!threadId) return null
  const turnId = sessionTurnId(payload, context)
  const type = stringValue(payload.type)
  if (type === 'task_started') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeStatus: {
        itemId: runtimeStatusItemId(threadId, turnId, 'task_started'),
        phase: 'tool_running',
        message: 'Codex task started',
        ...(secondsToIso(payload.started_at) ? { createdAt: secondsToIso(payload.started_at) } : {})
      }
    }
  }
  if (type === 'task_complete') {
    const lastAgentMessage = stringValue(payload.last_agent_message)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      ...(lastAgentMessage ? { deltas: [{ text: lastAgentMessage, kind: 'agent_message' as const, snapshot: true }] } : {}),
      turnComplete: true
    }
  }
  if (type === 'turn_aborted') {
    const reason = stringValue(payload.reason)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-turn-aborted',
        message: reason ? `Codex turn aborted: ${reason}` : 'Codex turn aborted.',
        code: 'aborted',
        severity: 'warning'
      }
    }
  }
  if (type === 'token_count') {
    const usage = tokenUsageFromSessionInfo(asRecord(payload.info))
    if (!usage) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      usage
    }
  }
  return null
}

function normalizeSessionResponseItem(
  payload: Record<string, unknown> | null,
  context: CodexEventNormalizeContext
): CodexThreadEventPayload | null {
  if (!payload) return null
  const threadId = sessionThreadId(payload, context)
  if (!threadId) return null
  const turnId = sessionTurnId(payload, context)
  const type = stringValue(payload.type)
  if (type === 'message') {
    if (stringValue(payload.role) !== 'assistant') return null
    const text = responseMessageText(payload)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_message', snapshot: true }]
    }
  }
  if (type === 'reasoning') {
    const text = reasoningText(payload)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_reasoning' }]
    }
  }
  if (type === 'function_call') {
    const toolName = stringValue(payload.name) || 'tool'
    const args = parseJsonObject(stringValue(payload.arguments))
    const callId = stringValue(payload.call_id)
    const itemId = callId || `${toolName}-${Date.now()}`
    const command = stringValue(args?.cmd) || stringValue(args?.command)
    const cwd = stringValue(args?.workdir) || stringValue(args?.cwd)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId,
        summary: toolName,
        status: 'running',
        toolKind: toolKindForFunction(toolName),
        ...(toolCallDetail(args, payload) ? { detail: toolCallDetail(args, payload) } : {}),
        meta: {
          toolName,
          ...(callId ? { callId } : {}),
          ...(command ? { command } : {}),
          ...(cwd ? { cwd } : {}),
          ...(args ? { arguments: args } : {})
        }
      }
    }
  }
  if (type === 'function_call_output') {
    const output = outputText(payload.output)
    const callId = stringValue(payload.call_id)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId || 'codex-tool-output',
        summary: 'Tool output',
        status: toolOutputStatus(output),
        detail: output,
        ...(callId ? { meta: { callId } } : {})
      }
    }
  }
  if (type === 'local_shell_call') {
    const action = asRecord(payload.action)
    const command = stringValue(action?.command)
    const callId = stringValue(payload.call_id)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId || 'codex-local-shell-call',
        summary: command || 'Local shell',
        status: stringValue(payload.status) === 'completed' ? 'success' : 'running',
        toolKind: 'command_execution',
        ...(command ? { detail: command } : {}),
        meta: {
          toolName: 'local_shell',
          ...(callId ? { callId } : {}),
          ...(command ? { command } : {})
        }
      }
    }
  }
  return null
}

function normalizeThreadItem(
  item: Record<string, unknown> | null,
  context: CodexEventNormalizeContext,
  lifecycle: 'running' | 'completed'
): CodexThreadEventPayload | null {
  if (!item) return null
  const threadId = sessionThreadId(item, context)
  if (!threadId) return null
  const turnId = sessionTurnId(item, context)
  const type = stringValue(item.type)
  if (type === 'agentMessage') {
    const text = stringValue(item.text)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_message', snapshot: true }]
    }
  }
  if (type === 'reasoning') {
    const text = [...arrayValue(item.summary), ...arrayValue(item.content)]
      .map((entry) => typeof entry === 'string' ? entry : stringValue(asRecord(entry)?.text))
      .filter(Boolean)
      .join('\n')
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_reasoning' }]
    }
  }
  if (type === 'commandExecution') {
    const status = threadItemStatus(item, lifecycle)
    const output = stringValue(item.aggregatedOutput)
    const command = stringValue(item.command)
    const cwd = stringValue(item.cwd)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: stringValue(item.id) || 'codex-command',
        summary: command || 'Command execution',
        status,
        toolKind: 'command_execution',
        ...(output || command ? { detail: output || command } : {}),
        meta: {
          ...(command ? { command } : {}),
          ...(cwd ? { cwd } : {}),
          ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {})
        }
      }
    }
  }
  if (type === 'fileChange') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: stringValue(item.id) || 'codex-file-change',
        summary: 'File changes',
        status: threadItemStatus(item, lifecycle),
        toolKind: 'file_change',
        detail: threadItemJsonDetail(item.changes)
      }
    }
  }
  if (type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'collabAgentToolCall') {
    const tool = stringValue(item.tool) || stringValue(item.server) || type
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: stringValue(item.id) || `codex-${type}`,
        summary: tool,
        status: threadItemStatus(item, lifecycle),
        toolKind: 'tool_call',
        detail: threadItemJsonDetail(item.result) || threadItemJsonDetail(item.error) || threadItemJsonDetail(item.contentItems),
        meta: {
          toolName: tool,
          ...(stringValue(item.server) ? { server: stringValue(item.server) } : {}),
          ...(stringValue(item.namespace) ? { namespace: stringValue(item.namespace) } : {})
        }
      }
    }
  }
  return null
}

function isApprovalRequest(method: string): boolean {
  return method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval' ||
    method === 'item/permissions/requestApproval' ||
    method === 'applyPatchApproval' ||
    method === 'execCommandApproval'
}

function isAgentMessageDelta(method: string): boolean {
  return method === 'item/agentMessage/delta' ||
    method === 'item/agentMessage/textDelta' ||
    method === 'item/agentMessage/contentDelta' ||
    method === 'item/assistantMessage/delta' ||
    method === 'item/assistantMessage/textDelta' ||
    method === 'item/assistantMessage/contentDelta'
}

function isReasoningDelta(method: string): boolean {
  return method === 'item/reasoning/textDelta' ||
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/delta' ||
    method === 'item/reasoning/summaryDelta' ||
    method === 'item/reasoning/contentDelta' ||
    method === 'item/agentReasoning/delta' ||
    method === 'item/agentReasoning/textDelta'
}

function approvalToolName(method: string): string {
  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') return 'command execution'
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') return 'file change'
  return 'tool'
}

function isUserInputRequest(method: string): boolean {
  return method === 'item/userInput/request' ||
    method === 'item/userInput/requested' ||
    method === 'userInput/request' ||
    method === 'user_input/request' ||
    method === 'request_user_input' ||
    method === 'item/requestUserInput'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sessionThreadId(
  payload: Record<string, unknown>,
  context: CodexEventNormalizeContext
): string {
  return stringValue(payload.threadId) ||
    stringValue(payload.thread_id) ||
    stringValue(asRecord(payload.thread)?.id) ||
    stringValue(context.threadId)
}

function sessionTurnId(
  payload: Record<string, unknown>,
  context: CodexEventNormalizeContext
): string {
  return stringValue(payload.turnId) ||
    stringValue(payload.turn_id) ||
    stringValue(asRecord(payload.turn)?.id) ||
    stringValue(context.turnId)
}

function deltaText(params: Record<string, unknown>): string {
  return stringValue(params.delta) ||
    stringValue(params.text) ||
    stringValue(params.content)
}

function responseMessageText(payload: Record<string, unknown>): string {
  if (typeof payload.content === 'string') return payload.content
  return arrayValue(payload.content)
    .map(contentText)
    .filter(Boolean)
    .join('\n')
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  const entry = asRecord(value)
  if (!entry) return ''
  return stringValue(entry.text) ||
    stringValue(entry.output) ||
    stringValue(entry.content) ||
    outputText(entry.output)
}

function reasoningText(payload: Record<string, unknown>): string {
  return arrayValue(payload.summary)
    .map((entry) => {
      if (typeof entry === 'string') return entry
      const record = asRecord(entry)
      return stringValue(record?.text)
    })
    .filter(Boolean)
    .join('\n')
}

function toolKindForFunction(
  toolName: string
): NonNullable<CodexThreadEventPayload['tool']>['toolKind'] {
  if (toolName === 'exec_command') return 'command_execution'
  if (toolName === 'apply_patch') return 'file_change'
  return 'tool_call'
}

function toolCallDetail(
  args: Record<string, unknown> | null,
  payload: Record<string, unknown>
): string {
  if (args) return JSON.stringify(args, null, 2)
  return stringValue(payload.arguments)
}

function toolOutputStatus(output: string): NonNullable<CodexThreadEventPayload['tool']>['status'] {
  const exitCode = output.match(/Process exited with code\s+(-?\d+)/i)
  if (!exitCode) return 'success'
  return exitCode[1] === '0' ? 'success' : 'error'
}

function threadItemStatus(
  item: Record<string, unknown>,
  lifecycle: 'running' | 'completed'
): NonNullable<CodexThreadEventPayload['tool']>['status'] {
  const status = stringValue(item.status)
  if (status === 'failed' || status === 'declined' || status === 'error') return 'error'
  if (typeof item.exitCode === 'number' && item.exitCode !== 0) return 'error'
  if (status === 'completed' || lifecycle === 'completed') return 'success'
  return 'running'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  return arrayValue(value)
    .map(asRecord)
    .filter(Boolean)
    .map((entry) => stringValue(entry?.text))
    .filter(Boolean)
    .join('\n')
}

function threadItemJsonDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    const detail = JSON.stringify(value, null, 2)
    return detail === undefined ? undefined : detail
  } catch {
    return undefined
  }
}

function tokenUsageFromParams(params: Record<string, unknown>): NonNullable<CodexThreadEventPayload['usage']> | null {
  const tokenUsage = asRecord(params.tokenUsage)
  const breakdown = asRecord(tokenUsage?.last) ?? asRecord(tokenUsage?.total)
  if (!breakdown) return null
  const inputTokens = integerValue(breakdown.inputTokens)
  const cachedInputTokens = integerValue(breakdown.cachedInputTokens)
  const outputTokens = integerValue(breakdown.outputTokens)
  const reasoningTokens = integerValue(breakdown.reasoningOutputTokens)
  const totalTokens = integerValue(breakdown.totalTokens) || inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: Math.max(0, inputTokens - cachedInputTokens),
    modelContextWindow: nullableInteger(tokenUsage?.modelContextWindow)
  }
}

function tokenUsageFromSessionInfo(info: Record<string, unknown> | null): NonNullable<CodexThreadEventPayload['usage']> | null {
  if (!info) return null
  const usage = asRecord(info.last_token_usage) ?? asRecord(info.total_token_usage)
  if (!usage) return null
  const inputTokens = integerValue(usage.input_tokens)
  const cachedInputTokens = integerValue(usage.cached_input_tokens)
  const outputTokens = integerValue(usage.output_tokens)
  const reasoningTokens = integerValue(usage.reasoning_output_tokens)
  const totalTokens = integerValue(usage.total_tokens) || inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: Math.max(0, inputTokens - cachedInputTokens),
    modelContextWindow: nullableInteger(info.model_context_window)
  }
}

function integerValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}

function secondsToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function runtimeStatusItemId(threadId: string, turnId: string, phase: string): string {
  return `codex-runtime-status-${turnId || threadId}-${phase}`
}
