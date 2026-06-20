import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { createKunAgentRuntimeAdapter } from './kun-agent-runtime-adapter'

type CapturedRequest = {
  pathAndQuery: string
  body: Record<string, unknown>
}

const MODEL_ROUTER_MODEL_CASES: Array<[string, string | undefined]> = [
  ['auto', 'auto'],
  ['empty', ''],
  ['undefined', undefined]
]

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    claw: defaultClawSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function adapterWithCapturedRequests(captured: CapturedRequest[]) {
  return createKunAgentRuntimeAdapter({
    request: vi.fn(async (_settings, pathAndQuery, init) => {
      if (init.body) {
        captured.push({
          pathAndQuery,
          body: JSON.parse(init.body) as Record<string, unknown>
        })
      }
      if (pathAndQuery === '/v1/threads') {
        return jsonResponse({
          thread: {
            id: 'thread-1',
            title: 'Thread 1',
            updatedAt: '2026-06-02T00:00:00.000Z'
          }
        })
      }
      if (pathAndQuery.endsWith('/turns')) {
        return jsonResponse({
          turn: {
            id: 'turn-1',
            threadId: 'thread-1'
          }
        })
      }
      if (pathAndQuery.endsWith('/resume-thread')) {
        return jsonResponse({
          threadId: 'thread-1',
          sessionId: 'session-1'
        })
      }
      return jsonResponse({})
    })
  })
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    body: JSON.stringify(body)
  }
}

describe('createKunAgentRuntimeAdapter', () => {
  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes startThread %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)

      await adapter.startThread({ settings: buildSettings() }, {
        workspace: '/tmp/workspace',
        title: 'New thread',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/threads',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes startTurn %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)

      await adapter.startTurn({ settings: buildSettings() }, {
        threadId: 'thread-1',
        text: 'Hello',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/threads/thread-1/turns',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it.each(MODEL_ROUTER_MODEL_CASES)(
    'routes resumeSession %s model through the resolved Model Router alias',
    async (_name, model) => {
      const captured: CapturedRequest[] = []
      const adapter = adapterWithCapturedRequests(captured)
      const resumeSession = adapter.resumeSession
      if (!resumeSession) throw new Error('Expected Kun adapter to support session resume.')

      await resumeSession({ settings: buildSettings() }, {
        sessionId: 'session-1',
        model
      })

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        pathAndQuery: '/v1/sessions/session-1/resume-thread',
        body: { model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS }
      })
    }
  )

  it('maps Kun tool call and result items to the same callId-backed item id', async () => {
    const adapter = createKunAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({
        id: 'thread-1',
        title: 'Thread 1',
        updatedAt: '2026-06-02T00:00:00.000Z',
        turns: [{
          id: 'turn-1',
          threadId: 'thread-1',
          status: 'completed',
          items: [
            {
              id: 'tool-call-source',
              kind: 'tool_call',
              status: 'running',
              callId: 'call-1',
              toolName: 'read_file',
              arguments: { path: 'draft.md' }
            },
            {
              id: 'tool-result-source',
              kind: 'tool_result',
              status: 'success',
              callId: 'call-1',
              toolName: 'read_file',
              output: 'ok'
            }
          ]
        }]
      }))
    })

    const detail = await adapter.readThread({ settings: buildSettings() }, { threadId: 'thread-1' })
    const tools = detail.items?.filter((item) => item.kind === 'tool') ?? []

    expect(tools).toEqual([
      expect.objectContaining({
        id: 'tool_call-1',
        status: 'running',
        meta: expect.objectContaining({ sourceItemId: 'tool-call-source', callId: 'call-1', toolName: 'read_file' })
      }),
      expect.objectContaining({
        id: 'tool_call-1',
        status: 'success',
        meta: expect.objectContaining({ sourceItemId: 'tool-result-source', callId: 'call-1', toolName: 'read_file' })
      })
    ])
  })

  it('maps Kun tool_call_ready events onto the same tool event chain', async () => {
    const adapter = createKunAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'tool_call_ready',
          threadId: 'thread-1',
          turnId: 'turn-1',
          seq: 7,
          timestamp: '2026-06-02T00:00:01.000Z',
          itemId: 'tool-ready-source',
          callId: 'call-1',
          toolName: 'read_file',
          readyCount: 1
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'tool_event',
        threadId: 'thread-1',
        turnId: 'turn-1',
        seq: 7,
        itemId: 'tool_call-1',
        status: 'running',
        summary: 'read_file',
        toolKind: 'tool_call',
        meta: expect.objectContaining({
          sourceItemId: 'tool-ready-source',
          callId: 'call-1',
          toolName: 'read_file',
          readyCount: 1,
          runtimeStatus: 'tool_call_ready'
        })
      })
    ])
  })

  it('treats an unavailable memory store as an empty memory list', async () => {
    const seen: string[] = []
    const adapter = createKunAgentRuntimeAdapter({
      request: vi.fn(async (_settings, pathAndQuery) => {
        seen.push(pathAndQuery)
        return {
          ok: false,
          status: 503,
          body: JSON.stringify({
            code: 'capability_unavailable',
            message: 'memory store is unavailable'
          })
        }
      })
    })

    await expect(adapter.auxiliary?.({ settings: buildSettings() }, {
      operation: 'listMemories',
      payload: { options: { workspace: '/tmp/workspace', includeDeleted: false } }
    })).resolves.toEqual([])
    expect(seen).toEqual(['/v1/memory?workspace=%2Ftmp%2Fworkspace&include_deleted=false'])
  })

  it('maps Kun compaction and goal events into shared context events', async () => {
    const adapter = createKunAgentRuntimeAdapter({
      request: vi.fn(async () => jsonResponse({})),
      events: async function* () {
        yield {
          kind: 'compaction_completed',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'compact-1',
          seq: 8,
          timestamp: '2026-06-02T00:00:02.000Z',
          summary: 'Kun compacted summary',
          replacedTokens: 1234,
          sourceDigest: 'digest-123',
          digestMarker: '<compact:digest-123>',
          sourceItemIds: ['item-1', 'item-2'],
          auto: false
        }
        yield {
          kind: 'goal_updated',
          threadId: 'thread-1',
          seq: 9,
          timestamp: '2026-06-02T00:00:03.000Z',
          goal: {
            threadId: 'thread-1',
            objective: 'Finish the migration',
            status: 'active',
            tokensUsed: 10,
            timeUsedSeconds: 5,
            createdAt: '2026-06-02T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:03.000Z'
          }
        }
        yield {
          kind: 'goal_cleared',
          threadId: 'thread-1',
          seq: 10,
          timestamp: '2026-06-02T00:00:04.000Z',
          cleared: true
        }
      }
    })

    const events = []
    for await (const event of adapter.subscribeEvents?.(
      { settings: buildSettings() },
      { threadId: 'thread-1', sinceSeq: 0 }
    ) ?? []) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'compaction_event',
        threadId: 'thread-1',
        runtimeId: 'kun',
        turnId: 'turn-1',
        itemId: 'compact-1',
        seq: 8,
        status: 'success',
        summary: 'Kun compacted summary',
        detail: 'replacedTokens=1234',
        auto: false,
        replacedTokens: 1234,
        sourceDigest: 'digest-123',
        digestMarker: '<compact:digest-123>',
        sourceItemIds: ['item-1', 'item-2'],
        messagesBefore: 2
      }),
      expect.objectContaining({
        kind: 'goal_event',
        threadId: 'thread-1',
        runtimeId: 'kun',
        seq: 9,
        objective: 'Finish the migration',
        status: 'active',
        cleared: false
      }),
      expect.objectContaining({
        kind: 'goal_event',
        threadId: 'thread-1',
        runtimeId: 'kun',
        seq: 10,
        cleared: true
      })
    ])
  })
})
