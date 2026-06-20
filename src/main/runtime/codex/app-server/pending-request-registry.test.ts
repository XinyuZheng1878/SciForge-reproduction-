import { describe, expect, it, vi } from 'vitest'
import {
  createCodexAppServerPendingRequestRegistry,
  type CodexAppServerPendingRequest
} from './pending-request-registry'

describe('Codex app-server pending request registry', () => {
  it('captures known approval and user-input request ids without resolving them', async () => {
    const observed: CodexAppServerPendingRequest[] = []
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest: (request) => observed.push(request)
    })

    const approval = registry.handle({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        command: 'npm test',
        providerPayload: { apiKey: 'secret' }
      }
    })
    const input = registry.handle({
      id: 'input-1',
      method: 'item/tool/requestUserInput',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-1',
        questions: [{ id: 'q1', question: 'Pick one' }]
      }
    })

    expect(observed).toEqual([
      expect.objectContaining({
        requestId: 'approval-1',
        method: 'item/commandExecution/requestApproval',
        kind: 'approval',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-1',
        summary: 'Command approval requested'
      }),
      expect.objectContaining({
        requestId: 'input-1',
        method: 'item/tool/requestUserInput',
        kind: 'user_input',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-1',
        summary: 'User input requested'
      })
    ])
    expect(registry.pending()).toHaveLength(2)

    registry.resolveApproval({ requestId: 'approval-1', decision: 'denied' })
    registry.resolveUserInput({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })

    await expect(approval).resolves.toEqual({ decision: 'decline' })
    await expect(input).resolves.toEqual({ answers: { q1: { answers: ['A'] } } })
    expect(registry.pending()).toEqual([])
  })

  it('captures legacy request_user_input aliases as user-input requests', async () => {
    const observed: CodexAppServerPendingRequest[] = []
    const registry = createCodexAppServerPendingRequestRegistry({
      onPendingRequest: (request) => observed.push(request)
    })

    const input = registry.handle({
      id: 'input-legacy',
      method: 'request_user_input',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-legacy',
        questions: [{ id: 'q1', question: 'Pick one' }]
      }
    })

    expect(observed).toEqual([
      expect.objectContaining({
        requestId: 'input-legacy',
        method: 'request_user_input',
        kind: 'user_input',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'input-item-legacy',
        summary: 'User input requested'
      })
    ])

    registry.resolveUserInput({
      requestId: 'input-legacy',
      answers: [{ id: 'q1', value: 'A' }]
    })

    await expect(input).resolves.toEqual({ answers: { q1: { answers: ['A'] } } })
  })

  it('routes dynamic tool call requests to the configured handler without queuing them', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'tool-ok' }],
      success: true
    }))
    const registry = createCodexAppServerPendingRequestRegistry({ onToolCallRequest })

    await expect(registry.handle({
      id: 'tool-request-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        callId: 'call-1',
        namespace: 'mcp_server',
        tool: 'lookup',
        arguments: { id: 'ABC-123' }
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'tool-ok' }],
      success: true
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'tool-request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      namespace: 'mcp_server',
      tool: 'lookup',
      arguments: { id: 'ABC-123' }
    })
    expect(registry.pending()).toEqual([])
  })

  it('normalizes dotted dynamic tool names when app-server omits namespace', async () => {
    const onToolCallRequest = vi.fn(async () => ({
      contentItems: [{ type: 'inputText' as const, text: 'tool-ok' }],
      success: true
    }))
    const registry = createCodexAppServerPendingRequestRegistry({ onToolCallRequest })

    await expect(registry.handle({
      id: 'tool-request-dotted',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        toolName: 'mcp_server.lookup',
        arguments: { id: 'ABC-123' }
      }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'tool-ok' }],
      success: true
    })
    expect(onToolCallRequest).toHaveBeenCalledWith({
      requestId: 'tool-request-dotted',
      threadId: 'thread-1',
      callId: undefined,
      namespace: 'mcp_server',
      tool: 'lookup',
      arguments: { id: 'ABC-123' }
    })
    expect(registry.pending()).toEqual([])
  })

  it('fails unknown server-originated requests closed and emits a safe visible error', async () => {
    const onUnknownRequest = vi.fn()
    const registry = createCodexAppServerPendingRequestRegistry({ onUnknownRequest })

    await expect(registry.handle({
      id: 'unknown-1',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-1',
        rawJson: { token: 'secret' }
      }
    })).rejects.toThrow('Unsupported Codex app-server request: item/tool/call')

    expect(onUnknownRequest).toHaveBeenCalledWith({
      requestId: 'unknown-1',
      method: 'item/tool/call',
      threadId: 'thread-1',
      turnId: undefined,
      message: 'Codex requested an unsupported operation and it was declined.'
    })
  })
})
