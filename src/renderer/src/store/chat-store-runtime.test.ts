import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchAgentRuntimeEvent } from '../agent/agent-runtime-event-dispatcher'
import type { ChatBlock } from '../agent/types'
import { clearBusyWatchdog, resetBusyRecoveryAttempts } from './chat-store-schedulers'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))

import {
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  clearWatchedCompletionNotifications,
  clearPendingClawFeishuMirrors,
  completionNotificationDedupeKeyForWatchedThread,
  MAX_PENDING_CLAW_FEISHU_MIRRORS,
  MAX_WATCHED_COMPLETION_NOTIFICATIONS,
  rememberPendingClawFeishuMirror,
  takePendingClawFeishuMirror,
  watchTurnCompletionNotification
} from './chat-store-runtime'
import type { ChatState, ChatStoreSet } from './chat-store-types'

afterEach(() => {
  clearBusyWatchdog()
  resetBusyRecoveryAttempts()
  vi.useRealTimers()
  registryMock.getProvider.mockReset()
  vi.unstubAllGlobals()
})

function makeSinkHarness(overrides: Partial<ChatState> = {}): {
  getState: () => ChatState
  set: ChatStoreSet
  get: () => ChatState
} {
  let state = {
    activeThreadId: 'thread-current',
    blocks: [],
    liveReasoning: '',
    liveReasoningMeta: null,
    liveAssistant: '',
    lastSeq: 0,
    usageRefreshKey: 0,
    childRefreshKey: 0,
    busy: true,
    error: null,
    currentTurnId: 'turn-current',
    currentTurnUserId: 'user-current',
    turnStartedAtByUserId: { 'user-current': 1000 },
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    watchTurnCompletion: {},
    unreadThreadIds: {},
    queuedMessages: [],
    threads: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(),
    drainQueuedMessages: vi.fn()
  } as unknown as ChatState
  state = { ...state, ...overrides }
  const get = (): ChatState => state
  const set: ChatStoreSet = (partial) => {
    const patch = typeof partial === 'function' ? partial(state) : partial
    state = { ...state, ...patch }
  }
  return {
    getState: () => state,
    set,
    get
  }
}

describe('thread event sink binding', () => {
  it('ignores reasoning deltas from a stream bound to a different active thread', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-new' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-old',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'old reasoning', seq: 7 }])

    expect(getState().liveReasoning).toBe('')
    expect(getState().lastSeq).toBe(0)
  })

  it('ignores queued callbacks after a stream has been aborted', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      liveReasoning: 'current reasoning'
    })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    controller.abort()
    sink.onDeltas([{ kind: 'agent_reasoning', text: 'late old reasoning', seq: 8 }])
    sink.onTurnComplete()

    expect(getState().liveReasoning).toBe('current reasoning')
    expect(getState().blocks).toEqual([])
    expect(getState().busy).toBe(true)
  })

  it('accepts reasoning deltas from the current active stream', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const controller = new AbortController()
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      signal: controller.signal
    })

    sink.onDeltas([{ kind: 'agent_reasoning', text: 'fresh reasoning', seq: 9 }])

    expect(getState().liveReasoning).toBe('fresh reasoning')
    expect(getState().lastSeq).toBe(9)
    expect(getState().turnReasoningFirstAtByUserId['user-current']).toEqual(expect.any(Number))
  })

  it('preserves reasoning disclosure metadata when live reasoning flushes into process blocks', () => {
    const { getState, set, get } = makeSinkHarness({ activeThreadId: 'thread-current' })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onDeltas([{
      kind: 'agent_reasoning',
      text: 'visible reasoning',
      seq: 9,
      meta: { reasoning: { visibility: 'trace', source: 'model' } }
    }])
    sink.onTool({
      itemId: 'tool-1',
      summary: 'Read',
      status: 'running'
    })

    expect(getState().liveReasoning).toBe('')
    expect(getState().liveReasoningMeta).toBeNull()
    expect(getState().blocks[0]).toEqual(expect.objectContaining({
      kind: 'reasoning',
      text: 'visible reasoning',
      meta: { reasoning: { visibility: 'trace', source: 'model' } }
    }))
  })

  it('increments the child refresh key for current child events without storing child records', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      childRefreshKey: 2
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 10
    })

    dispatchAgentRuntimeEvent(
      {
        kind: 'child_event',
        threadId: 'thread-current',
        turnId: 'turn-current',
        seq: 11,
        child: {
          runtimeId: 'codex',
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          id: 'child-1',
          kind: 'agent',
          status: 'running'
        }
      },
      sink
    )

    expect(getState().childRefreshKey).toBe(3)
    expect(getState()).not.toHaveProperty('children')

    dispatchAgentRuntimeEvent(
      {
        kind: 'child_event',
        threadId: 'thread-current',
        turnId: 'turn-current',
        seq: 11,
        child: {
          runtimeId: 'codex',
          parentThreadId: 'thread-current',
          id: 'child-1',
          kind: 'agent',
          status: 'completed'
        }
      },
      sink
    )

    expect(getState().childRefreshKey).toBe(3)
  })

  it('applies distinct runtime events that share a Codex sequence number', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      childRefreshKey: 2,
      lastSeq: 10,
      busy: true,
      currentTurnId: 'turn-current',
      currentTurnUserId: 'user-current',
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 10
    })

    dispatchAgentRuntimeEvent(
      {
        kind: 'reasoning_delta',
        threadId: 'thread-current',
        turnId: 'turn-current',
        itemId: 'reasoning-11',
        text: 'reasoning summary',
        visibility: 'summary',
        source: 'runtime_summary',
        seq: 11
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'assistant_delta',
        threadId: 'thread-current',
        turnId: 'turn-current',
        itemId: 'assistant-11',
        text: 'assistant output',
        seq: 11
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'child_event',
        threadId: 'thread-current',
        turnId: 'turn-current',
        seq: 11,
        child: {
          runtimeId: 'codex',
          parentThreadId: 'thread-current',
          parentTurnId: 'turn-current',
          id: 'child-11',
          kind: 'agent',
          status: 'completed'
        }
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'turn_lifecycle',
        threadId: 'thread-current',
        turnId: 'turn-current',
        state: 'completed',
        seq: 11
      },
      sink
    )

    expect(getState().lastSeq).toBe(11)
    expect(getState().childRefreshKey).toBe(3)
    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().blocks).toEqual([
      expect.objectContaining({
        kind: 'reasoning',
        text: 'reasoning summary',
        meta: { reasoning: { visibility: 'summary', source: 'runtime_summary' } }
      }),
      expect.objectContaining({ kind: 'assistant', text: 'assistant output' })
    ])
  })

  it('keeps the event cursor monotonic when stale seq ticks arrive', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      lastSeq: 10
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 10
    })

    sink.onSeq(7)
    expect(getState().lastSeq).toBe(10)

    sink.onSeq(11)
    expect(getState().lastSeq).toBe(11)
  })

  it('drops stale sequenced tool, status, and item events before mutating state', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      lastSeq: 10,
      busy: true,
      currentTurnId: 'turn-current',
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 10
    })

    dispatchAgentRuntimeEvent(
      {
        kind: 'runtime_status',
        threadId: 'thread-current',
        turnId: 'turn-current',
        itemId: 'status-old',
        phase: 'turn_done',
        message: 'Old completion',
        seq: 9
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'tool_event',
        threadId: 'thread-current',
        itemId: 'tool-old',
        status: 'running',
        summary: 'Old tool',
        seq: 10
      },
      sink
    )
    dispatchAgentRuntimeEvent(
      {
        kind: 'item_snapshot',
        threadId: 'thread-current',
        seq: 8,
        item: {
          id: 'tool-snapshot-old',
          kind: 'tool',
          summary: 'Old snapshot',
          status: 'running'
        }
      },
      sink
    )

    expect(getState().lastSeq).toBe(10)
    expect(getState().busy).toBe(true)
    expect(getState().currentTurnId).toBe('turn-current')
    expect(getState().blocks).toEqual([])

    dispatchAgentRuntimeEvent(
      {
        kind: 'tool_event',
        threadId: 'thread-current',
        itemId: 'tool-new',
        status: 'running',
        summary: 'New tool',
        seq: 11
      },
      sink
    )

    expect(getState().lastSeq).toBe(11)
    expect(getState().blocks).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'tool-new', summary: 'New tool' })
    ])
  })

  it('drops replayed deltas at or below the subscription floor', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      lastSeq: 5
    })
    const sink = buildThreadEventSink(set, get, {
      threadId: 'thread-current',
      sinceSeq: 5
    })

    sink.onDeltas([
      { kind: 'agent_message', text: 'old 4', seq: 4 },
      { kind: 'agent_message', text: 'old 5', seq: 5 },
      { kind: 'agent_message', text: 'new 6', seq: 6 }
    ])

    expect(getState().liveAssistant).toBe('new 6')
    expect(getState().lastSeq).toBe(6)
  })

  it('refreshes shared context state after compaction events', () => {
    const refreshActiveThreadContextState = vi.fn(async () => undefined)
    const { set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      refreshActiveThreadContextState
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onCompaction({
      itemId: 'compact-1',
      status: 'success',
      summary: 'Compacted context',
      messagesBefore: 10,
      messagesAfter: 4
    })

    expect(refreshActiveThreadContextState).toHaveBeenCalledWith('thread-current')
  })

  it('keeps reconnecting, tool waiting, and stream recovery runtime statuses non-terminal', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      currentTurnId: 'turn-current',
      blocks: [
        {
          kind: 'tool',
          id: 'tool-running',
          summary: 'Running tests',
          status: 'running',
          toolKind: 'command_execution'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    for (const phase of ['reconnecting', 'tool_waiting', 'stream_recovering'] as const) {
      sink.onRuntimeStatus?.({
        kind: 'tool_catalog_changed',
        itemId: `runtime-status-${phase}`,
        turnId: 'turn-current',
        phase,
        message: phase
      })
    }

    expect(getState().busy).toBe(true)
    expect(getState().currentTurnId).toBe('turn-current')
    expect(getState().blocks).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'running' }),
      expect.objectContaining({ kind: 'system', id: 'runtime-status-reconnecting' }),
      expect.objectContaining({ kind: 'system', id: 'runtime-status-tool_waiting' }),
      expect.objectContaining({ kind: 'system', id: 'runtime-status-stream_recovering' })
    ])
  })

  it('refreshes the busy watchdog when tool and reconnect activity continues', () => {
    vi.useFakeTimers()
    const recoverActiveTurn = vi.fn(async () => true)
    const { set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      currentTurnId: 'turn-current',
      recoverActiveTurn
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTool({
      itemId: 'tool-running',
      status: 'running',
      summary: 'Running tests',
      toolKind: 'command_execution'
    })
    vi.advanceTimersByTime(179_999)
    expect(recoverActiveTurn).not.toHaveBeenCalled()

    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-reconnecting',
      turnId: 'turn-current',
      phase: 'reconnecting',
      message: 'Reconnecting'
    })
    vi.advanceTimersByTime(179_999)
    expect(recoverActiveTurn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(recoverActiveTurn).toHaveBeenCalledTimes(1)
  })

  it('projects runtime handoff events as visible timeline markers', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'target-thread',
      busy: true
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'target-thread' })

    dispatchAgentRuntimeEvent({
      kind: 'handoff_event',
      threadId: 'target-thread',
      turnId: 'target-turn',
      itemId: 'handoff-1',
      createdAt: '2026-06-11T00:00:01.000Z',
      status: 'started',
      sourceRuntimeId: 'codex',
      sourceThreadId: 'source-thread',
      targetRuntimeId: 'claude',
      targetThreadId: 'target-thread',
      targetTurnId: 'target-turn'
    }, sink)

    expect(getState().blocks).toEqual([
      expect.objectContaining({
        kind: 'system',
        id: 'handoff-1',
        text: 'Semantic continuation from Codex to Claude.'
      })
    ])
  })

  it('does not infer running state from projection-only runtime activity', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onDeltas([{ kind: 'agent_message', text: 'late output', seq: 1 }])
    sink.onTool({
      itemId: 'tool-late',
      status: 'running',
      summary: 'Late tool',
      toolKind: 'command_execution'
    })
    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-reconnecting',
      phase: 'reconnecting',
      message: 'Reconnecting'
    })

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().liveAssistant).toBe('')
    expect(getState().blocks).toEqual([
      expect.objectContaining({ kind: 'assistant', text: 'late output' }),
      expect.objectContaining({ kind: 'tool', id: 'tool-late', status: 'running' }),
      expect.objectContaining({ kind: 'system', id: 'runtime-status-reconnecting' })
    ])
  })

  it('ignores Codex thread lifecycle status without marking a new empty thread busy', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      currentTurnId: null,
      currentTurnUserId: null,
      blocks: []
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-thread-ready',
      phase: 'thread_start_done',
      message: 'Codex thread ready'
    })

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().blocks).toEqual([])
  })

  it('persists assistant snapshots as visible assistant blocks after completion', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      liveAssistant: '',
      blocks: [
        { kind: 'user', id: 'user-current', text: 'hello' },
        {
          kind: 'system',
          id: 'runtime-status-turn-done',
          createdAt: '2026-06-11T00:00:01.000Z',
          text: 'Codex turn completed'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onAssistantMessage?.({
      itemId: 'assistant-1',
      createdAt: '2026-06-11T00:00:02.000Z',
      text: 'Hey there! How can I help?'
    })

    expect(getState().busy).toBe(false)
    expect(getState().liveAssistant).toBe('')
    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      {
        kind: 'system',
        id: 'runtime-status-turn-done',
        createdAt: '2026-06-11T00:00:01.000Z',
        text: 'Codex turn completed'
      },
      {
        kind: 'assistant',
        id: 'assistant-1',
        createdAt: '2026-06-11T00:00:02.000Z',
        text: 'Hey there! How can I help?'
      }
    ])
  })

  it('deduplicates repeated canonical assistant snapshots by item id', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: false,
      liveAssistant: '',
      blocks: [
        { kind: 'user', id: 'user-current', text: 'hello' },
        {
          kind: 'assistant',
          id: 'assistant-1',
          createdAt: '2026-06-11T00:00:02.000Z',
          text: 'Earlier duplicate text'
        },
        {
          kind: 'assistant',
          id: 'assistant-1',
          createdAt: '2026-06-11T00:00:03.000Z',
          text: 'Latest snapshot text'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onAssistantMessage?.({
      itemId: 'assistant-1',
      createdAt: '2026-06-11T00:00:03.000Z',
      text: 'Latest snapshot text'
    })

    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      {
        kind: 'assistant',
        id: 'assistant-1',
        createdAt: '2026-06-11T00:00:03.000Z',
        text: 'Latest snapshot text'
      }
    ])
  })

  it('does not restart busy when terminal runtime status follows turn completion', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      liveAssistant: 'done',
      blocks: [
        { kind: 'user', id: 'user-current', text: 'hello' },
        {
          kind: 'tool',
          id: 'tool-running',
          summary: 'Running tests',
          status: 'running',
          toolKind: 'command_execution'
        },
        {
          kind: 'user_input',
          id: 'input-pending',
          requestId: 'request-1',
          questions: [],
          status: 'pending'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    vi.stubGlobal('window', { sciforge: {} })

    sink.onTurnComplete()
    expect(getState().busy).toBe(false)

    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-turn-done',
      turnId: 'turn-current',
      createdAt: '2026-06-11T00:00:01.000Z',
      phase: 'turn_done',
      message: 'Codex turn completed'
    })

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'success' }),
      expect.objectContaining({ kind: 'user_input', id: 'input-pending', status: 'cancelled' }),
      expect.objectContaining({ kind: 'assistant', text: 'done' }),
      {
        kind: 'system',
        id: 'runtime-status-turn-done',
        createdAt: '2026-06-11T00:00:01.000Z',
        text: 'Codex turn completed'
      }
    ])
  })

  it('settles busy state when terminal runtime status is the only completion signal', async () => {
    const provider = {
      rememberThreadRuntime: vi.fn(),
      getThreadDetail: vi.fn(async () => ({
        latestSeq: 12,
        threadStatus: 'completed',
        blocks: [
          { kind: 'user' as const, id: 'user-current', text: 'hello' },
          {
            kind: 'assistant' as const,
            id: 'assistant-canonical',
            createdAt: '2026-06-11T00:00:02.000Z',
            text: 'Recovered answer from snapshot'
          }
        ]
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', { sciforge: {} })
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      liveAssistant: '',
      blocks: [
        { kind: 'user', id: 'user-current', text: 'hello' },
        {
          kind: 'tool',
          id: 'tool-running',
          summary: 'Running search',
          status: 'running',
          toolKind: 'command_execution'
        }
      ],
      lastSeq: 8,
      threads: [{
        id: 'thread-current',
        runtimeId: 'codex',
        title: 'Current',
        updatedAt: '2026-06-11T00:00:00.000Z',
        model: 'gpt-5',
        mode: 'agent',
        workspace: '/workspace/sciforge'
      }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-turn-done',
      turnId: 'turn-current',
      createdAt: '2026-06-11T00:00:01.000Z',
      phase: 'turn_done',
      message: 'Codex turn completed'
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thread-current', 'codex')
    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().currentTurnUserId).toBeNull()
    expect(getState().lastSeq).toBe(12)
    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'success' }),
      {
        kind: 'system',
        id: 'runtime-status-turn-done',
        createdAt: '2026-06-11T00:00:01.000Z',
        text: 'Codex turn completed'
      },
      {
        kind: 'assistant',
        id: 'assistant-canonical',
        createdAt: '2026-06-11T00:00:02.000Z',
        text: 'Recovered answer from snapshot'
      }
    ])
  })

  it('does not settle the same turn twice when lifecycle follows terminal runtime status', () => {
    const showTurnCompleteNotification = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { sciforge: { showTurnCompleteNotification } })
    registryMock.getProvider.mockReturnValue({
      rememberThreadRuntime: vi.fn(),
      getThreadDetail: vi.fn(async () => ({ blocks: [] }))
    })
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      liveAssistant: 'done',
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }],
      threads: [{
        id: 'thread-current',
        runtimeId: 'codex',
        title: 'Current',
        updatedAt: '2026-06-11T00:00:00.000Z',
        model: 'gpt-5',
        mode: 'agent',
        workspace: '/workspace/sciforge'
      }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeStatus?.({
      kind: 'tool_catalog_changed',
      itemId: 'runtime-status-turn-done',
      turnId: 'turn-current',
      createdAt: '2026-06-11T00:00:01.000Z',
      phase: 'turn_done',
      message: 'Codex turn completed'
    })
    dispatchAgentRuntimeEvent({
      kind: 'turn_lifecycle',
      threadId: 'thread-current',
      turnId: 'turn-current',
      createdAt: '2026-06-11T00:00:02.000Z',
      state: 'completed'
    }, sink)

    expect(getState().busy).toBe(false)
    expect(getState().blocks.filter((block) => block.kind === 'assistant')).toHaveLength(1)
    expect(showTurnCompleteNotification).toHaveBeenCalledTimes(1)
  })

  it('settles busy state when terminal turn lifecycle is the completion signal', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      liveAssistant: 'done',
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    dispatchAgentRuntimeEvent({
      kind: 'turn_lifecycle',
      threadId: 'thread-current',
      turnId: 'turn-current',
      createdAt: '2026-06-11T00:00:01.000Z',
      state: 'completed'
    }, sink)

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().currentTurnUserId).toBeNull()
    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      expect.objectContaining({ kind: 'assistant', text: 'done' })
    ])
  })

  it('merges canonical assistant output after completion when live events omitted the answer', async () => {
    const provider = {
      rememberThreadRuntime: vi.fn(),
      getThreadDetail: vi.fn(async () => ({
        latestSeq: 12,
        threadStatus: 'completed',
        blocks: [
          { kind: 'user' as const, id: 'user-current', text: 'hello' },
          {
            kind: 'assistant' as const,
            id: 'assistant-canonical',
            createdAt: '2026-06-11T00:00:02.000Z',
            text: 'Hey there! How can I help?'
          }
        ]
      }))
    }
    registryMock.getProvider.mockReturnValue(provider)
    vi.stubGlobal('window', { sciforge: {} })
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [
        { kind: 'user', id: 'user-current', text: 'hello' },
        {
          kind: 'system',
          id: 'runtime-status-turn-done',
          createdAt: '2026-06-11T00:00:01.000Z',
          text: 'Codex turn completed'
        }
      ],
      lastSeq: 8,
      threads: [{
        id: 'thread-current',
        runtimeId: 'codex',
        title: 'Current',
        updatedAt: '2026-06-11T00:00:00.000Z',
        model: 'gpt-5',
        mode: 'agent',
        workspace: '/workspace/sciforge'
      }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onTurnComplete()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thread-current', 'codex')
    expect(getState().busy).toBe(false)
    expect(getState().lastSeq).toBe(12)
    expect(getState().blocks).toEqual([
      { kind: 'user', id: 'user-current', text: 'hello' },
      {
        kind: 'system',
        id: 'runtime-status-turn-done',
        createdAt: '2026-06-11T00:00:01.000Z',
        text: 'Codex turn completed'
      },
      {
        kind: 'assistant',
        id: 'assistant-canonical',
        createdAt: '2026-06-11T00:00:02.000Z',
        text: 'Hey there! How can I help?'
      }
    ])
  })

  it('settles stale pending work when the turn completion signal arrives', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [
        { kind: 'user', id: 'user-current', text: 'run tests' },
        {
          kind: 'tool',
          id: 'tool-running',
          summary: 'Running tests',
          status: 'running',
          toolKind: 'command_execution'
        },
        {
          kind: 'approval',
          id: 'approval-pending',
          approvalId: 'approval-1',
          summary: 'Needs approval',
          status: 'pending'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })
    vi.stubGlobal('window', { sciforge: {} })

    sink.onTurnComplete()

    expect(getState().busy).toBe(false)
    expect(getState().currentTurnId).toBeNull()
    expect(getState().currentTurnUserId).toBeNull()
    expect(getState().blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'success',
      'error'
    ])
  })

  it('updates an existing approval when a non-pending approval snapshot is replayed', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      blocks: [
        {
          kind: 'approval',
          id: 'approval-4',
          approvalId: '4',
          summary: 'Command approval requested',
          status: 'pending'
        }
      ]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onApproval({
      approvalId: '4',
      summary: 'Command approval requested',
      toolName: 'command execution',
      status: 'error',
      errorMessage: 'No Codex app-server request is pending.'
    })

    expect(getState().blocks).toEqual([
      expect.objectContaining({
        id: 'approval-4',
        approvalId: '4',
        status: 'error',
        errorMessage: 'No Codex app-server request is pending.'
      })
    ])
  })
})

describe('thread event sink runtime errors', () => {
  it('adds runtime error events to the timeline with details', () => {
    const { getState, set, get } = makeSinkHarness({
      activeThreadId: 'thread-current',
      busy: true,
      blocks: [{ kind: 'user', id: 'user-current', text: 'hello' }]
    })
    const sink = buildThreadEventSink(set, get, { threadId: 'thread-current' })

    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed',
      code: 'provider_unavailable',
      details: { token: 'secret-token' },
      severity: 'error'
    })
    sink.onRuntimeError?.({
      itemId: 'error-1',
      createdAt: '2026-06-08T00:00:00.000Z',
      message: 'Authorization: Bearer secret-token failed again',
      code: 'provider_unavailable',
      severity: 'error'
    })

    const systemBlocks = getState().blocks.filter((block) => block.kind === 'system')
    expect(systemBlocks).toHaveLength(1)
    expect(systemBlocks[0]).toMatchObject({
      kind: 'system',
      id: 'error-1',
      code: 'provider_unavailable',
      severity: 'error'
    })
    expect(systemBlocks[0].text).toContain('<redacted>')
    expect(systemBlocks[0].detail).not.toContain('secret-token')
  })

  it('settles an aborted turn only from terminal lifecycle', () => {
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user-1', text: 'run command' },
      {
        kind: 'tool',
        id: 'tool-1',
        summary: 'Running command',
        status: 'running',
        toolKind: 'command_execution'
      }
    ]
    const state = {
      activeThreadId: 'thr-1',
      blocks,
      busy: true,
      currentTurnId: 'turn-1',
      currentTurnUserId: 'user-1',
      error: null,
      liveAssistant: '',
      liveReasoning: '',
      turnStartedAtByUserId: { 'user-1': Date.now() - 1000 },
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      refreshThreads: vi.fn(),
      drainQueuedMessages: vi.fn()
    } as unknown as ChatState
    const set = (partial: Partial<ChatState> | ((value: ChatState) => Partial<ChatState>)): void => {
      Object.assign(state, typeof partial === 'function' ? partial(state) : partial)
    }

    dispatchAgentRuntimeEvent({
      kind: 'turn_lifecycle',
      threadId: 'thr-1',
      turnId: 'turn-1',
      state: 'aborted'
    }, buildThreadEventSink(set, () => state))

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(state.blocks.map((block) => ('status' in block ? block.status : block.kind))).toEqual([
      'user',
      'error'
    ])
  })
})

describe('pending Claw Feishu mirrors', () => {
  afterEach(() => {
    clearPendingClawFeishuMirrors()
  })

  it('normalizes pending mirror fields before storing', () => {
    rememberPendingClawFeishuMirror(' turn-1 ', {
      threadId: ' thread-1 ',
      userBlockId: ' user-1 ',
      userText: ' hello '
    })

    expect(takePendingClawFeishuMirror('turn-1')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
  })

  it('ignores invalid pending mirrors', () => {
    rememberPendingClawFeishuMirror('', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-2', {
      threadId: ' ',
      userBlockId: 'user-2',
      userText: 'hello'
    })
    rememberPendingClawFeishuMirror('turn-3', {
      threadId: 'thread-3',
      userBlockId: 'user-3',
      userText: ' '
    })

    expect(takePendingClawFeishuMirror('')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-2')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-3')).toBeUndefined()
  })

  it('caps pending mirrors and keeps the latest turns', () => {
    for (let index = 0; index < MAX_PENDING_CLAW_FEISHU_MIRRORS + 5; index += 1) {
      rememberPendingClawFeishuMirror(`turn-${index}`, {
        threadId: `thread-${index}`,
        userBlockId: `user-${index}`,
        userText: `hello-${index}`
      })
    }

    expect(takePendingClawFeishuMirror('turn-0')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-4')).toBeUndefined()
    expect(takePendingClawFeishuMirror('turn-5')).toEqual({
      threadId: 'thread-5',
      userBlockId: 'user-5',
      userText: 'hello-5'
    })
    expect(takePendingClawFeishuMirror(`turn-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`)).toEqual({
      threadId: `thread-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userBlockId: `user-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`,
      userText: `hello-${MAX_PENDING_CLAW_FEISHU_MIRRORS + 4}`
    })
  })

  it('removes a pending mirror when taking it', () => {
    rememberPendingClawFeishuMirror('turn-1', {
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })

    expect(takePendingClawFeishuMirror(' turn-1 ')).toEqual({
      threadId: 'thread-1',
      userBlockId: 'user-1',
      userText: 'hello'
    })
    expect(takePendingClawFeishuMirror('turn-1')).toBeUndefined()
  })
})

describe('watched completion notifications', () => {
  afterEach(() => {
    clearWatchedCompletionNotifications()
  })

  it('normalizes watched thread ids before storing and clearing', () => {
    watchTurnCompletionNotification(' thread-1 ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:1000')

    clearWatchedCompletionNotification(' thread-1 ')

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 2000)).toBe('watch:thread-1:2000')
  })

  it('ignores empty watched thread ids', () => {
    watchTurnCompletionNotification(' ', 1000)

    expect(completionNotificationDedupeKeyForWatchedThread('', 2000)).toBe('watch:unknown:2000')
  })

  it('caps watched completion notifications and keeps the latest thread watches', () => {
    for (let index = 0; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS + 5; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }

    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-4', 999)).toBe('watch:thread-4:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-5', 999)).toBe('watch:thread-5:5')
    expect(
      completionNotificationDedupeKeyForWatchedThread(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`, 999)
    ).toBe(`watch:thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}:${MAX_WATCHED_COMPLETION_NOTIFICATIONS + 4}`)
  })

  it('refreshes existing watched threads as the most recent entry', () => {
    watchTurnCompletionNotification('thread-0', 0)
    for (let index = 1; index < MAX_WATCHED_COMPLETION_NOTIFICATIONS; index += 1) {
      watchTurnCompletionNotification(`thread-${index}`, index)
    }
    watchTurnCompletionNotification('thread-0', 1000)
    watchTurnCompletionNotification(`thread-${MAX_WATCHED_COMPLETION_NOTIFICATIONS}`, 2000)

    expect(completionNotificationDedupeKeyForWatchedThread('thread-1', 999)).toBe('watch:thread-1:999')
    expect(completionNotificationDedupeKeyForWatchedThread('thread-0', 999)).toBe('watch:thread-0:1000')
  })
})
