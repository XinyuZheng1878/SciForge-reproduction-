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

  it('maps assistant message delta aliases to assistant deltas', () => {
    expect(normalizeCodexEvent({
      method: 'item/assistantMessage/textDelta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        text: 'hello from alias'
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ text: 'hello from alias', kind: 'agent_message' }]
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

  it('maps reasoning delta aliases to reasoning deltas', () => {
    expect(normalizeCodexEvent({
      method: 'item/agentReasoning/textDelta',
      params: { threadId: 'thread-1', text: 'thinking alias' }
    })).toEqual({
      threadId: 'thread-1',
      deltas: [{ text: 'thinking alias', kind: 'agent_reasoning' }]
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

  it('maps new app-server task lifecycle messages using supplied turn context', () => {
    expect(normalizeCodexEvent({
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: 'turn-1',
        started_at: 1781413091,
        model_context_window: 258400
      }
    }, { threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeStatus: {
        itemId: 'codex-runtime-status-turn-1-task_started',
        phase: 'tool_running',
        message: 'Codex task started',
        createdAt: '2026-06-14T04:58:11.000Z'
      }
    })

    expect(normalizeCodexEvent({
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: 'turn-1',
        last_agent_message: 'done'
      }
    }, { threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ kind: 'agent_message', text: 'done', snapshot: true }],
      turnComplete: true
    })

    expect(normalizeCodexEvent({
      type: 'event_msg',
      payload: {
        type: 'turn_aborted',
        turn_id: 'turn-1',
        reason: 'interrupted'
      }
    }, { threadId: 'thread-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      runtimeError: {
        itemId: 'turn-1',
        message: 'Codex turn aborted: interrupted',
        code: 'aborted',
        severity: 'warning'
      }
    })
  })

  it('maps new app-server response items to assistant and tool events', () => {
    expect(normalizeCodexEvent({
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        arguments: '{"cmd":"npm test","workdir":"/tmp/workspace"}',
        call_id: 'call-1'
      }
    }, { threadId: 'thread-1', turnId: 'turn-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'call-1',
        summary: 'exec_command',
        status: 'running',
        toolKind: 'command_execution',
        detail: '{\n  "cmd": "npm test",\n  "workdir": "/tmp/workspace"\n}',
        meta: {
          toolName: 'exec_command',
          callId: 'call-1',
          command: 'npm test',
          cwd: '/tmp/workspace',
          arguments: {
            cmd: 'npm test',
            workdir: '/tmp/workspace'
          }
        }
      }
    })

    expect(normalizeCodexEvent({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Process exited with code 0\nOutput:\nok'
      }
    }, { threadId: 'thread-1', turnId: 'turn-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'call-1',
        summary: 'Tool output',
        status: 'success',
        detail: 'Process exited with code 0\nOutput:\nok',
        meta: {
          callId: 'call-1'
        }
      }
    })

    expect(normalizeCodexEvent({
      type: 'response_item',
      payload: {
        type: 'local_shell_call',
        call_id: 'shell-1',
        status: 'in_progress',
        action: { command: 'date' }
      }
    }, { threadId: 'thread-1', turnId: 'turn-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'shell-1',
        summary: 'date',
        status: 'running',
        toolKind: 'command_execution',
        detail: 'date',
        meta: {
          toolName: 'local_shell',
          callId: 'shell-1',
          command: 'date'
        }
      }
    })

    expect(normalizeCodexEvent({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'visible answer' }],
        phase: 'final_answer'
      }
    }, { threadId: 'thread-1', turnId: 'turn-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ text: 'visible answer', kind: 'agent_message', snapshot: true }]
    })

    expect(normalizeCodexEvent({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: 'visible string answer'
      }
    }, { threadId: 'thread-1', turnId: 'turn-1' })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ text: 'visible string answer', kind: 'agent_message', snapshot: true }]
    })
  })

  it('maps app-server raw response item notifications to visible events', () => {
    expect(normalizeCodexEvent({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'function_call',
          name: 'exec_command',
          arguments: '{"cmd":"pwd"}',
          call_id: 'call-1'
        }
      }
    })).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'call-1',
        status: 'running',
        toolKind: 'command_execution'
      }
    })

    expect(normalizeCodexEvent({
      method: 'rawResponseItem/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'visible answer' }]
        }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      deltas: [{ text: 'visible answer', kind: 'agent_message', snapshot: true }]
    })
  })

  it('maps app-server thread item lifecycle notifications to tool events', () => {
    expect(normalizeCodexEvent({
      method: 'item/started',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'npm test',
          cwd: '/tmp/workspace',
          status: 'inProgress',
          aggregatedOutput: null,
          exitCode: null
        }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'cmd-1',
        summary: 'npm test',
        status: 'running',
        toolKind: 'command_execution',
        detail: 'npm test',
        meta: {
          command: 'npm test',
          cwd: '/tmp/workspace'
        }
      }
    })

    expect(normalizeCodexEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'npm test',
          cwd: '/tmp/workspace',
          status: 'completed',
          aggregatedOutput: 'ok',
          exitCode: 0
        }
      }
    })).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'cmd-1',
        summary: 'npm test',
        status: 'success',
        toolKind: 'command_execution',
        detail: 'ok',
        meta: {
          command: 'npm test',
          cwd: '/tmp/workspace',
          exitCode: 0
        }
      }
    })

    expect(normalizeCodexEvent({
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          type: 'commandExecution',
          id: 'cmd-2',
          command: 'npm test',
          status: 'completed',
          aggregatedOutput: 'failed',
          exitCode: 1
        }
      }
    })).toMatchObject({
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: {
        itemId: 'cmd-2',
        status: 'error',
        meta: {
          exitCode: 1
        }
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
