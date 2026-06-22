import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { kunRuntimeEvents } from './runtime-sse-ipc'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'kun',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        port: 49876,
        runtimeToken: 'local-runtime-token'
      },
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('kunRuntimeEvents', () => {
  it('parses Kun SSE events for the AgentRuntimeHost event path', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          'id: 5',
          'event: assistant_delta',
          'data: {"threadId":"thread-1","text":"hi"}',
          '',
          'data: {"seq":6,"kind":"turn_completed"}',
          '',
          ''
        ].join('\n')))
        controller.close()
        init?.signal?.addEventListener('abort', () => undefined, { once: true })
      }
    })))
    vi.stubGlobal('fetch', fetchMock)
    const abort = new AbortController()

    try {
      const events = kunRuntimeEvents(settings(), 'thread-1', 4, abort.signal)[Symbol.asyncIterator]()
      const first = await events.next()
      const second = await events.next()
      abort.abort()

      expect(first.value).toEqual({
        threadId: 'thread-1',
        text: 'hi',
        seq: 5,
        kind: 'assistant_delta'
      })
      expect(second.value).toEqual({ seq: 6, kind: 'turn_completed' })
      const [url, init] = fetchMock.mock.calls[0] ?? []
      expect(String(url)).toBe('http://127.0.0.1:49876/v1/threads/thread-1/events?since_seq=4')
      expect(init?.headers).toMatchObject({
        Accept: 'text/event-stream',
        authorization: 'Bearer local-runtime-token',
        'Last-Event-ID': '4'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
