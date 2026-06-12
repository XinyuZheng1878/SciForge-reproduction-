import { describe, expect, it } from 'vitest'
import { normalizeCodexEvent } from './codex-event-normalizer'

describe('normalizeCodexEvent', () => {
  it('maps agent message deltas without exposing raw JSON-RPC payloads', () => {
    expect(normalizeCodexEvent({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        delta: 'hello',
        providerPayload: { token: 'secret' }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ text: 'hello', kind: 'agent_message' }]
    })
  })

  it('maps reasoning text and summary deltas to reasoning deltas', () => {
    expect(normalizeCodexEvent({
      method: 'item/reasoning/textDelta',
      params: { threadId: 'thread-1', delta: 'thinking' }
    })).toEqual({
      threadId: 'thread-1',
      deltas: [{ text: 'thinking', kind: 'agent_reasoning' }]
    })

    expect(normalizeCodexEvent({
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId: 'thread-1', delta: 'summary' }
    })).toEqual({
      threadId: 'thread-1',
      deltas: [{ text: 'summary', kind: 'agent_reasoning' }]
    })
  })

  it('maps command output deltas to command tool updates', () => {
    expect(normalizeCodexEvent({
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId: 'thread-1',
        itemId: 'cmd-1',
        delta: 'stdout line',
        command: 'npm test'
      }
    })).toEqual({
      threadId: 'thread-1',
      tool: {
        itemId: 'cmd-1',
        summary: 'Command output',
        status: 'running',
        toolKind: 'command_execution',
        detail: 'stdout line'
      }
    })
  })

  it('maps turn completion to a done event', () => {
    expect(normalizeCodexEvent({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turnId: 'turn-1' }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      turnComplete: true
    })
  })

  it('maps token usage updates to neutral usage counters with cache telemetry', () => {
    expect(normalizeCodexEvent({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            inputTokens: 300,
            cachedInputTokens: 200,
            outputTokens: 40,
            reasoningOutputTokens: 10,
            totalTokens: 350
          },
          last: {
            inputTokens: 120,
            cachedInputTokens: 90,
            outputTokens: 20,
            reasoningOutputTokens: 5,
            totalTokens: 145
          },
          modelContextWindow: 128000
        }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 145,
        cacheReadTokens: 90,
        cacheWriteTokens: 30,
        modelContextWindow: 128000
      }
    })
  })

  it('maps error, failed, and cancelled events to safe runtime errors', () => {
    expect(normalizeCodexEvent({
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        error: {
          message: 'provider failed',
          code: 'provider_error',
          providerPayload: { secret: 'do-not-leak' }
        }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeError: {
        itemId: 'turn-1',
        message: 'provider failed',
        code: 'provider_error',
        severity: 'error'
      }
    })

    expect(normalizeCodexEvent({
      method: 'turn/failed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-2',
        error: { message: 'turn failed', code: 'bad_turn', raw: { jsonrpc: '2.0' } }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-2',
      runtimeError: {
        itemId: 'turn-2',
        message: 'turn failed',
        code: 'bad_turn',
        severity: 'error'
      }
    })

    expect(normalizeCodexEvent({
      method: 'turn/cancelled',
      params: { threadId: 'thread-1', turnId: 'turn-3', reason: 'user interrupted' }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-3',
      runtimeError: {
        itemId: 'turn-3',
        message: 'Codex turn cancelled: user interrupted',
        code: 'cancelled',
        severity: 'warning'
      }
    })
  })

  it('maps approval requests to a fail-closed approval notice', () => {
    expect(normalizeCodexEvent({
      id: 'server-approval-1',
      method: 'item/permissions/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'approval-1',
        toolName: 'shell',
        request: { command: 'rm -rf /tmp/example' }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeError: {
        itemId: 'approval-1',
        message: 'Codex requested approval for shell, but approval handling is not available.',
        code: 'approval_required',
        severity: 'warning'
      }
    })

    expect(normalizeCodexEvent({
      id: 'server-approval-2',
      method: 'item/commandExecution/requestApproval',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'cmd-approval-1',
        command: 'npm test',
        cwd: '/private/work'
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeError: {
        itemId: 'cmd-approval-1',
        message: 'Codex requested approval for command execution, but approval handling is not available.',
        code: 'approval_required',
        severity: 'warning'
      }
    })
  })

  it('maps user input requests to a fail-closed blocked notice', () => {
    expect(normalizeCodexEvent({
      id: 'server-input-1',
      method: 'request_user_input',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        requestId: 'input-1',
        questions: [{
          id: 'q1',
          question: 'Pick one',
          options: [{ label: 'A' }]
        }]
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeError: {
        itemId: 'input-1',
        message: 'Codex is blocked on a user input request, but user input handling is not available yet.',
        code: 'user_input_required',
        severity: 'warning'
      }
    })
  })
})
