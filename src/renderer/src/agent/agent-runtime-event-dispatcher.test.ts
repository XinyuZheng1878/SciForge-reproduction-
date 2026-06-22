import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_RUNTIME_EVENT_KINDS,
  type AgentRuntimeEvent,
  type AgentRuntimeEventKind
} from '@shared/agent-runtime-contract'
import {
  agentRuntimeEventBelongsToThread,
  dispatchAgentRuntimeEvent
} from './agent-runtime-event-dispatcher'
import type { ThreadEventSink } from './types'

function makeSink(): ThreadEventSink {
  return {
    onSeq: vi.fn(),
    onDeltas: vi.fn(),
    onAssistantMessage: vi.fn(),
    onUserMessage: vi.fn(),
    onTool: vi.fn(),
    onCompaction: vi.fn(),
    onReview: vi.fn(),
    onApproval: vi.fn(),
    onUserInput: vi.fn(),
    onUserInputStatus: vi.fn(),
    onRuntimeStatus: vi.fn(),
    onRuntimeError: vi.fn(),
    onGoal: vi.fn(),
    onTodos: vi.fn(),
    onTurnComplete: vi.fn(),
    onError: vi.fn(),
    onUsage: vi.fn()
  }
}

function sampleEvent(kind: AgentRuntimeEventKind): AgentRuntimeEvent {
  const base = {
    threadId: 'thread-1',
    turnId: 'turn-1',
    seq: 99,
    createdAt: '2026-06-11T00:00:00.000Z'
  }
  switch (kind) {
    case 'thread_lifecycle':
      return { ...base, kind, state: 'updated' }
    case 'turn_lifecycle':
      return { ...base, kind, state: 'completed' }
    case 'runtime_status':
      return { ...base, kind, phase: 'process_start', message: 'Starting runtime' }
    case 'user_message':
      return { ...base, kind, itemId: 'user-1', text: 'hello', displayText: 'Hello' }
    case 'assistant_delta':
      return { ...base, kind, itemId: 'assistant-1', text: 'hi' }
    case 'reasoning_delta':
      return { ...base, kind, itemId: 'reasoning-1', text: 'thinking', visibility: 'summary' }
    case 'item_snapshot':
      return { ...base, kind, item: { id: 'tool-snapshot', kind: 'tool', summary: 'Read', status: 'running' } }
    case 'tool_event':
      return { ...base, kind, itemId: 'tool-1', status: 'running', summary: 'Read', toolKind: 'tool_call' }
    case 'approval_requested':
      return { ...base, kind, approvalId: 'approval-1', summary: 'Allow tool?', toolName: 'read' }
    case 'approval_resolved':
      return { ...base, kind, approvalId: 'approval-1', decision: 'allowed' }
    case 'user_input_requested':
      return {
        ...base,
        kind,
        requestId: 'input-1',
        questions: [{ id: 'q1', header: 'Choice', question: 'Pick one', options: [{ label: 'A' }] }]
      }
    case 'user_input_resolved':
      return { ...base, kind, requestId: 'input-1', status: 'submitted', answers: [{ id: 'q1', value: 'A' }] }
    case 'compaction_event':
      return { ...base, kind, itemId: 'compact-1', status: 'success', summary: 'Compacted' }
    case 'review_event':
      return { ...base, kind, itemId: 'review-1', status: 'running', title: 'Review' }
    case 'goal_event':
      return { ...base, kind, objective: 'Ship the bridge', status: 'active' }
    case 'todo_event':
      return { ...base, kind, items: [{ id: 'todo-1', content: 'Map events', status: 'pending' }] }
    case 'child_event':
      return {
        ...base,
        kind,
        child: {
          runtimeId: 'codex',
          parentThreadId: 'thread-1',
          id: 'child-1',
          kind: 'agent',
          status: 'running'
        }
      }
    case 'usage':
      return { ...base, kind, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costUsd: 0.01 } }
    case 'error':
      return { ...base, kind, recoverable: true, severity: 'warning', message: 'Runtime warning', code: 'warn' }
    case 'heartbeat':
      return { ...base, kind }
    default: {
      const neverKind: never = kind
      return neverKind
    }
  }
}

describe('agent runtime event dispatcher', () => {
  it('routes only matching thread events', () => {
    expect(agentRuntimeEventBelongsToThread(undefined, 'thread-1')).toBe(true)
    expect(agentRuntimeEventBelongsToThread('thread-1', 'thread-1')).toBe(true)
    expect(agentRuntimeEventBelongsToThread('thread-2', 'thread-1')).toBe(false)
  })

  it('dispatches assistant and reasoning deltas with seq', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      { kind: 'assistant_delta', threadId: 'thread-1', itemId: 'assistant-1', text: 'hello', seq: 7 },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'reasoning_delta',
        threadId: 'thread-1',
        itemId: 'reasoning-1',
        text: 'thinking',
        visibility: 'summary',
        seq: 8
      },
      sink
    )

    expect(sink.onSeq).toHaveBeenNthCalledWith(1, 7)
    expect(sink.onSeq).toHaveBeenNthCalledWith(2, 8)
    expect(sink.onDeltas).toHaveBeenNthCalledWith(1, [{ kind: 'agent_message', text: 'hello', seq: 7 }])
    expect(sink.onDeltas).toHaveBeenNthCalledWith(2, [{ kind: 'agent_reasoning', text: 'thinking', seq: 8 }])
  })

  it('keeps hidden reasoning deltas out of visible chat blocks', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'reasoning_delta',
        threadId: 'thread-1',
        itemId: 'reasoning-hidden',
        text: 'internal scratchpad',
        visibility: 'none',
        seq: 9
      },
      sink
    )

    expect(sink.onSeq).toHaveBeenCalledWith(9)
    expect(sink.onDeltas).not.toHaveBeenCalled()
  })

  it('dispatches persisted assistant snapshots as stable assistant messages', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'item_snapshot',
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'assistant-1',
          kind: 'assistant_message',
          text: 'hello from snapshot',
          createdAt: '2026-06-11T00:00:03.000Z'
        },
        seq: 10
      },
      sink
    )

    expect(sink.onAssistantMessage).toHaveBeenCalledWith({
      itemId: 'assistant-1',
      turnId: 'turn-1',
      createdAt: '2026-06-11T00:00:03.000Z',
      text: 'hello from snapshot'
    })
    expect(sink.onDeltas).not.toHaveBeenCalled()
  })

  it('dispatches approval and user input lifecycle events', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'approval_requested',
        threadId: 'thread-1',
        itemId: 'approval-item',
        approvalId: 'approval-1',
        summary: 'Allow read?',
        toolName: 'read',
        meta: { source: 'runtime' },
        createdAt: '2026-06-11T00:00:00.000Z'
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'approval_resolved',
        threadId: 'thread-1',
        itemId: 'approval-item',
        approvalId: 'approval-1',
        decision: 'denied',
        message: 'User denied'
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'user_input_requested',
        threadId: 'thread-1',
        itemId: 'input-item',
        requestId: 'input-1',
        questions: [{ id: 'q1', header: 'Choice', question: 'Pick one', options: [{ label: 'A' }] }]
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'user_input_resolved',
        threadId: 'thread-1',
        itemId: 'input-item',
        requestId: 'input-1',
        status: 'submitted',
        answers: [{ id: 'q1', label: 'A', value: 'a' }]
      },
      sink
    )

    expect(sink.onApproval).toHaveBeenNthCalledWith(1, {
      approvalId: 'approval-1',
      summary: 'Allow read?',
      toolName: 'read',
      status: 'pending',
      meta: {
        source: 'runtime'
      }
    })
    expect(sink.onApproval).toHaveBeenNthCalledWith(2, {
      approvalId: 'approval-1',
      summary: 'User denied',
      status: 'denied'
    })
    expect(sink.onUserInput).toHaveBeenCalledWith({
      itemId: 'input-item',
      requestId: 'input-1',
      questions: [{ id: 'q1', header: 'Choice', question: 'Pick one', options: [{ label: 'A', description: '' }] }]
    })
    expect(sink.onUserInputStatus).toHaveBeenCalledWith({
      itemId: 'input-item',
      status: 'submitted',
      answers: [{ id: 'q1', label: 'A', value: 'a' }]
    })
  })

  it('preserves structured user input questions from item snapshots', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'item_snapshot',
        threadId: 'thread-1',
        item: {
          id: 'input-item',
          kind: 'user_input',
          summary: 'Pick one',
          status: 'pending',
          meta: {
            requestId: 'request-1',
            questions: [
              {
                id: 'choice',
                header: 'Choice',
                question: 'Pick one',
                options: [
                  { label: 'A', description: 'Alpha' },
                  { label: 'B' }
                ]
              }
            ]
          }
        }
      },
      sink
    )

    expect(sink.onUserInput).toHaveBeenCalledWith({
      itemId: 'input-item',
      requestId: 'request-1',
      questions: [
        {
          id: 'choice',
          header: 'Choice',
          question: 'Pick one',
          options: [
            { label: 'A', description: 'Alpha' },
            { label: 'B', description: '' }
          ]
        }
      ]
    })
  })

  it('dispatches runtime error and runtime status events', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'error',
        threadId: 'thread-1',
        itemId: 'error-1',
        createdAt: '2026-06-11T00:00:00.000Z',
        recoverable: false,
        severity: 'error',
        message: 'Runtime failed',
        code: 'runtime_failed',
        detail: 'Stack trace'
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'runtime_status',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 12,
        createdAt: '2026-06-11T00:00:01.000Z',
        phase: 'process_start',
        message: 'Starting runtime'
      },
      sink
    )

    expect(sink.onRuntimeError).toHaveBeenCalledWith({
      itemId: 'error-1',
      createdAt: '2026-06-11T00:00:00.000Z',
      message: 'Runtime failed',
      code: 'runtime_failed',
      details: 'Stack trace',
      severity: 'error'
    })
    expect(sink.onRuntimeStatus).toHaveBeenCalledWith({
      kind: 'tool_catalog_changed',
      itemId: 'runtime_status_turn-1_process_start',
      turnId: 'turn-1',
      createdAt: '2026-06-11T00:00:01.000Z',
      phase: 'process_start',
      message: 'Starting runtime'
    })
  })

  it('dispatches goal, todo, and usage events', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'goal_event',
        threadId: 'thread-1',
        objective: 'Ship the bridge',
        status: 'active',
        createdAt: '2026-06-11T00:00:00.000Z'
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'todo_event',
        threadId: 'thread-1',
        items: [{ id: 'todo-1', content: 'Map events', status: 'pending' }],
        createdAt: '2026-06-11T00:00:01.000Z'
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'usage',
        threadId: 'thread-1',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          cacheReadTokens: 2,
          cacheWriteTokens: 3,
          costUsd: 0.05
        }
      },
      sink
    )

    expect(sink.onGoal).toHaveBeenCalledWith({
      threadId: 'thread-1',
      createdAt: '2026-06-11T00:00:00.000Z',
      goal: expect.objectContaining({
        threadId: 'thread-1',
        objective: 'Ship the bridge',
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0
      })
    })
    expect(sink.onTodos).toHaveBeenCalledWith({
      threadId: 'thread-1',
      createdAt: '2026-06-11T00:00:01.000Z',
      todos: {
        threadId: 'thread-1',
        updatedAt: '2026-06-11T00:00:01.000Z',
        items: [
          expect.objectContaining({
            id: 'todo-1',
            content: 'Map events',
            status: 'pending'
          })
        ]
      }
    })
    expect(sink.onUsage).toHaveBeenCalledWith({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: 0,
      cachedTokens: 2,
      cacheMissTokens: 3,
      cacheHitRate: 0.4,
      totalTokens: 15,
      costUsd: 0.05,
      costCny: null,
      cacheSavingsUsd: 0,
      cacheSavingsCny: null,
      tokenEconomySavingsTokens: 0,
      tokenEconomySavingsUsd: 0,
      tokenEconomySavingsCny: null,
      turns: 0
    })
  })

  it('dispatches user messages with display text metadata and turn completion', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent(
      {
        kind: 'user_message',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'user-1',
        text: 'expanded prompt',
        displayText: 'short prompt',
        createdAt: '2026-06-11T00:00:00.000Z'
      },
      sink
    )
    dispatchAgentRuntimeEvent({ kind: 'turn_lifecycle', threadId: 'thread-1', turnId: 'turn-1', state: 'completed' }, sink)

    expect(sink.onUserMessage).toHaveBeenCalledWith({
      itemId: 'user-1',
      turnId: 'turn-1',
      createdAt: '2026-06-11T00:00:00.000Z',
      text: 'expanded prompt',
      meta: { displayText: 'short prompt' }
    })
    expect(sink.onTurnComplete).toHaveBeenCalled()
  })

  it('settles aborted turn lifecycle events through the error path and completes the turn', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent({ kind: 'turn_lifecycle', threadId: 'thread-1', turnId: 'turn-1', state: 'aborted' }, sink)

    expect(sink.onError).toHaveBeenCalledWith(new Error('turn aborted'))
    expect(sink.onTurnComplete).toHaveBeenCalled()
  })

  it('settles failed turn lifecycle events through the error path and completes the turn', () => {
    const sink = makeSink()

    dispatchAgentRuntimeEvent({ kind: 'turn_lifecycle', threadId: 'thread-1', turnId: 'turn-1', state: 'failed' }, sink)

    expect(sink.onError).toHaveBeenCalledWith(new Error('turn failed'))
    expect(sink.onTurnComplete).toHaveBeenCalled()
  })

  it('does not crash over every contract event kind', () => {
    const sink = makeSink()

    for (const kind of AGENT_RUNTIME_EVENT_KINDS) {
      expect(() => dispatchAgentRuntimeEvent(sampleEvent(kind), sink)).not.toThrow()
    }
  })
})
