import type {
  CodexAppServerJsonRpcRequest,
  CodexAppServerRequestId
} from './protocol'

export type CodexAppServerPendingRequestKind = 'approval' | 'user_input'

export type CodexAppServerPendingRequest = {
  requestId: CodexAppServerRequestId
  method: string
  kind: CodexAppServerPendingRequestKind
  threadId?: string
  turnId?: string
  itemId?: string
  summary: string
  params: Record<string, unknown>
}

export type CodexAppServerUnknownRequestNotice = {
  requestId: CodexAppServerRequestId
  method: string
  threadId?: string
  turnId?: string
  message: string
}

export type CodexAppServerApprovalDecision =
  | 'allowed'
  | 'allowed_for_session'
  | 'denied'
  | 'cancelled'

export type CodexAppServerResolveApprovalInput = {
  requestId: CodexAppServerRequestId
  decision: CodexAppServerApprovalDecision
  message?: string
  result?: unknown
}

export type CodexAppServerResolveUserInputInput = {
  requestId: CodexAppServerRequestId
  answers?: Array<{ id: string; label?: string; value: string }>
  status?: 'submitted' | 'cancelled'
  result?: unknown
}

export type CodexAppServerPendingRequestRegistryOptions = {
  onPendingRequest?: (request: CodexAppServerPendingRequest) => void
  onUnknownRequest?: (request: CodexAppServerUnknownRequestNotice) => void
}

type PendingEntry = {
  request: CodexAppServerPendingRequest
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval'
])

const USER_INPUT_METHODS = new Set([
  'item/tool/requestUserInput',
  'item/userInput/request',
  'item/userInput/requested',
  'userInput/request',
  'user_input/request',
  'request_user_input',
  'item/requestUserInput',
  'mcpServer/elicitation/request'
])

export function isCodexAppServerUserInputRequestMethod(method: string): boolean {
  return USER_INPUT_METHODS.has(method)
}

export function createCodexAppServerPendingRequestRegistry(
  options: CodexAppServerPendingRequestRegistryOptions = {}
): CodexAppServerPendingRequestRegistry {
  return new CodexAppServerPendingRequestRegistry(options)
}

export class CodexAppServerPendingRequestRegistry {
  private readonly pendingRequests = new Map<CodexAppServerRequestId, PendingEntry>()

  constructor(private readonly options: CodexAppServerPendingRequestRegistryOptions = {}) {}

  handle(request: CodexAppServerJsonRpcRequest): Promise<unknown> {
    const pending = toPendingRequest(request)
    if (!pending) {
      const notice = unknownRequestNotice(request)
      this.options.onUnknownRequest?.(notice)
      return Promise.reject(new Error(`Unsupported Codex app-server request: ${request.method}`))
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(request.id, { request: pending, resolve, reject })
      this.options.onPendingRequest?.(pending)
    })
  }

  pending(): CodexAppServerPendingRequest[] {
    return [...this.pendingRequests.values()].map((entry) => entry.request)
  }

  resolveServerRequest(requestId: CodexAppServerRequestId, result: unknown): void {
    const entry = this.take(requestId)
    entry.resolve(result)
  }

  resolveApproval(input: CodexAppServerResolveApprovalInput): void {
    const entry = this.take(input.requestId)
    if (entry.request.kind !== 'approval') {
      entry.reject(new Error(`Codex app-server request ${String(input.requestId)} is not an approval request.`))
      return
    }
    entry.resolve(input.result ?? approvalResult(entry.request, input.decision))
  }

  resolveUserInput(input: CodexAppServerResolveUserInputInput): void {
    const entry = this.take(input.requestId)
    if (entry.request.kind !== 'user_input') {
      entry.reject(new Error(`Codex app-server request ${String(input.requestId)} is not a user input request.`))
      return
    }
    entry.resolve(input.result ?? userInputResult(entry.request, input))
  }

  rejectAll(error: Error): void {
    for (const entry of this.pendingRequests.values()) entry.reject(error)
    this.pendingRequests.clear()
  }

  private take(requestId: CodexAppServerRequestId): PendingEntry {
    const entry = this.pendingRequests.get(requestId)
    if (!entry) throw new Error(`Codex app-server request is not pending: ${String(requestId)}`)
    this.pendingRequests.delete(requestId)
    return entry
  }
}

function toPendingRequest(request: CodexAppServerJsonRpcRequest): CodexAppServerPendingRequest | null {
  const params = asRecord(request.params) ?? {}
  if (APPROVAL_METHODS.has(request.method)) {
    return {
      requestId: request.id,
      method: request.method,
      kind: 'approval',
      ...commonRequestFields(params),
      summary: approvalSummary(request.method),
      params
    }
  }
  if (isCodexAppServerUserInputRequestMethod(request.method)) {
    return {
      requestId: request.id,
      method: request.method,
      kind: 'user_input',
      ...commonRequestFields(params),
      summary: userInputSummary(request.method),
      params
    }
  }
  return null
}

function commonRequestFields(params: Record<string, unknown>): {
  threadId?: string
  turnId?: string
  itemId?: string
} {
  return {
    ...(stringValue(params.threadId) ? { threadId: stringValue(params.threadId) } : {}),
    ...(stringValue(params.turnId) ? { turnId: stringValue(params.turnId) } : {}),
    ...(stringValue(params.itemId) ? { itemId: stringValue(params.itemId) } : {})
  }
}

function approvalSummary(method: string): string {
  if (method === 'item/commandExecution/requestApproval') return 'Command approval requested'
  if (method === 'item/fileChange/requestApproval') return 'File change approval requested'
  if (method === 'item/permissions/requestApproval') return 'Permission approval requested'
  return 'Approval requested'
}

function userInputSummary(method: string): string {
  if (method === 'mcpServer/elicitation/request') return 'MCP input requested'
  return 'User input requested'
}

function approvalResult(
  request: CodexAppServerPendingRequest,
  decision: CodexAppServerApprovalDecision
): unknown {
  if (request.method === 'item/permissions/requestApproval') {
    if (decision === 'allowed' || decision === 'allowed_for_session') {
      return {
        permissions: asRecord(request.params.permissions) ?? {},
        scope: decision === 'allowed_for_session' ? 'session' : 'turn'
      }
    }
    return { permissions: {}, scope: 'turn' }
  }
  return { decision: approvalDecisionValue(decision) }
}

function approvalDecisionValue(decision: CodexAppServerApprovalDecision): string {
  if (decision === 'allowed') return 'accept'
  if (decision === 'allowed_for_session') return 'acceptForSession'
  if (decision === 'cancelled') return 'cancel'
  return 'decline'
}

function userInputResult(
  request: CodexAppServerPendingRequest,
  input: CodexAppServerResolveUserInputInput
): unknown {
  if (request.method === 'mcpServer/elicitation/request') {
    if (input.status === 'cancelled') return { action: 'cancel', content: null }
    return {
      action: 'accept',
      content: Object.fromEntries((input.answers ?? []).map((answer) => [answer.id, answer.value]))
    }
  }
  if (input.status === 'cancelled') return { answers: {} }
  return {
    answers: Object.fromEntries((input.answers ?? []).map((answer) => [
      answer.id,
      { answers: [answer.value] }
    ]))
  }
}

function unknownRequestNotice(request: CodexAppServerJsonRpcRequest): CodexAppServerUnknownRequestNotice {
  const params = asRecord(request.params) ?? {}
  return {
    requestId: request.id,
    method: request.method,
    threadId: stringValue(params.threadId) || undefined,
    turnId: stringValue(params.turnId) || undefined,
    message: 'Codex requested an unsupported operation and it was declined.'
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
