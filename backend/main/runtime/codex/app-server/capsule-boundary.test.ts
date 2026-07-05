import { describe, expect, it } from 'vitest'
import {
  CODEX_MAIN_IPC_CHANNELS,
  createCodexAppServerClient
} from './json-rpc-client'
import type {
  CodexAppServerJsonRpcRequest,
  CodexAppServerThreadStartParams
} from './protocol'
import {
  createCodexAppServerPendingRequestRegistry
} from './request-registry'
import {
  normalizeCodexEvent
} from './event-normalizer'
import {
  defaultCodexAppServerServerRequestResponse,
  visibleServerRequestFailureMessage
} from './server-requests'

describe('Codex app-server capsule boundaries', () => {
  it('exposes protocol, JSON-RPC, request, event, and reasoning seams from app-server', async () => {
    expect(CODEX_MAIN_IPC_CHANNELS.connect).toBe('codex:connect')
    expect(typeof createCodexAppServerClient).toBe('function')

    const threadStart: CodexAppServerThreadStartParams = {
      cwd: '/workspace',
      sandbox: 'workspace-write'
    }
    expect(threadStart).toEqual({
      cwd: '/workspace',
      sandbox: 'workspace-write'
    })

    const request: CodexAppServerJsonRpcRequest = {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-1', itemId: 'cmd-1' }
    }
    const registry = createCodexAppServerPendingRequestRegistry()
    const pending = registry.handle(request)
    registry.resolveApproval({ requestId: 'approval-1', decision: 'denied' })
    await expect(pending).resolves.toEqual({ decision: 'decline' })

    expect(normalizeCodexEvent({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', delta: 'hi' }
    })).toEqual({
      threadId: 'thread-1',
      deltas: [{ text: 'hi', kind: 'agent_message' }]
    })

    expect(defaultCodexAppServerServerRequestResponse({
      id: 'input-1',
      method: 'mcpServer/elicitation/request',
      params: {}
    })).toEqual({ action: 'cancel', content: null })
    expect(visibleServerRequestFailureMessage('item/tool/call')).toBe(
      'Codex requested an unsupported operation and it was declined.'
    )
  })
})
