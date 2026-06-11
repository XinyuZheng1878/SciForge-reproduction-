import type { CodexThreadEventPayload } from '../codex-runtime-api'

export function normalizeCodexEvent(payload: unknown): CodexThreadEventPayload | null {
  const event = asRecord(payload)
  if (!event) return null
  const method = stringValue(event.method)
  const params = asRecord(event.params) ?? {}
  const threadId = stringValue(params.threadId) || stringValue(asRecord(params.thread)?.id)
  if (!threadId) return null
  const turnId = stringValue(params.turnId) || stringValue(asRecord(params.turn)?.id)
  if (method === 'item/agentMessage/delta') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: stringValue(params.delta), kind: 'agent_message' }]
    }
  }
  if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: stringValue(params.delta), kind: 'agent_reasoning' }]
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
  if (method === 'turn/completed') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      turnComplete: true
    }
  }
  if (method === 'error' || method === 'turn/failed') {
    const error = asRecord(params.error)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-error',
        message: stringValue(error?.message) || 'Codex runtime error',
        ...(stringValue(error?.code) ? { code: stringValue(error?.code) } : {}),
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

function isApprovalRequest(method: string): boolean {
  return method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval' ||
    method === 'item/permissions/requestApproval' ||
    method === 'applyPatchApproval' ||
    method === 'execCommandApproval'
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
