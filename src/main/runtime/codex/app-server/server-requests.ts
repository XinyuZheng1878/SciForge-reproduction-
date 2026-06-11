import type { CodexAppServerJsonRpcRequest } from './protocol'

export function defaultCodexAppServerServerRequestHandler(
  request: CodexAppServerJsonRpcRequest
): unknown {
  return defaultCodexAppServerServerRequestResponse(request)
}

export function defaultCodexAppServerServerRequestResponse(
  request: CodexAppServerJsonRpcRequest
): unknown {
  if (request.method === 'item/commandExecution/requestApproval') return { decision: 'decline' }
  if (request.method === 'item/fileChange/requestApproval') return { decision: 'decline' }
  if (request.method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' }
  if (request.method === 'item/tool/requestUserInput') return { answers: {} }
  if (request.method === 'mcpServer/elicitation/request') return { action: 'cancel', content: null }
  if (request.method === 'applyPatchApproval') return { decision: 'denied' }
  if (request.method === 'execCommandApproval') return { decision: 'denied' }
  if (request.method === 'attestation/generate') return { token: '' }
  throw new Error(`Unsupported Codex app-server request: ${request.method}`)
}

export function visibleServerRequestFailureMessage(_method: string): string {
  return 'Codex requested an unsupported operation and it was declined.'
}
