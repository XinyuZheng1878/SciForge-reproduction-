import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import type { CodexRuntimeService } from './runtime/codex'
import { registerRuntimeSseIpc } from './runtime-sse-ipc'

type StartHandler = (event: { sender: { send: ReturnType<typeof vi.fn> } }, args: unknown) => Promise<{ streamId: string }>
type StopHandler = (event: unknown, streamId: unknown) => Promise<boolean>

function settings(activeAgentRuntime: AppSettingsV1['activeAgentRuntime'] = 'codex'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
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
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function createHarness(
  activeAgentRuntime: AppSettingsV1['activeAgentRuntime'],
  codexRuntimeService: CodexRuntimeService
): {
  start: StartHandler
  stop: StopHandler
  ensureRuntime: ReturnType<typeof vi.fn>
  logError: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: unknown) => {
      handlers.set(channel, handler)
    })
  } as unknown as IpcMain
  const ensureRuntime = vi.fn(async () => undefined)
  const logError = vi.fn()

  registerRuntimeSseIpc({
    ipcMain,
    store: { load: vi.fn(async () => settings(activeAgentRuntime)) } as unknown as Parameters<typeof registerRuntimeSseIpc>[0]['store'],
    ensureRuntime,
    codexRuntime: () => codexRuntimeService,
    logError
  })

  return {
    start: handlers.get('runtime:sse:start') as StartHandler,
    stop: handlers.get('runtime:sse:stop') as StopHandler,
    ensureRuntime,
    logError
  }
}

async function waitFor(assertion: () => void): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  throw lastError
}

describe('registerRuntimeSseIpc', () => {
  it('uses explicit runtimeId for legacy SSE subscriptions instead of active runtime', async () => {
    const codexRuntime = {
      subscribeEvents: vi.fn(async function* (threadId: string, sinceSeq: number) {
        yield { threadId, seq: sinceSeq + 1, runtimeId: 'codex' }
      }),
      readStoredEvents: vi.fn()
    } as unknown as CodexRuntimeService
    const { start, ensureRuntime } = createHarness('kun', codexRuntime)
    const send = vi.fn()

    await start({ sender: { send } }, {
      runtimeId: 'codex',
      threadId: 'codex-thread',
      sinceSeq: 4,
      streamId: 'stream-codex'
    })

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith('runtime:sse-event', {
        streamId: 'stream-codex',
        data: { threadId: 'codex-thread', seq: 5, runtimeId: 'codex' }
      })
    })
    expect(codexRuntime.subscribeEvents).toHaveBeenCalledWith(
      'codex-thread',
      4,
      expect.any(AbortSignal)
    )
    expect(ensureRuntime).not.toHaveBeenCalled()
  })

  it('keeps legacy callers on Kun instead of defaulting to active runtime', async () => {
    const fetchMock = vi.fn(async (_url: URL, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"seq":1,"kind":"heartbeat"}\n\n'))
        init?.signal?.addEventListener('abort', () => controller.close(), { once: true })
      }
    })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const codexRuntime = {
        subscribeEvents: vi.fn(),
        readStoredEvents: vi.fn()
      } as unknown as CodexRuntimeService
      const { start, stop, ensureRuntime } = createHarness('codex', codexRuntime)
      const send = vi.fn()

      await start({ sender: { send } }, {
        threadId: 'kun-thread',
        sinceSeq: 0,
        streamId: 'stream-kun'
      })

      await waitFor(() => {
        expect(send).toHaveBeenCalledWith('runtime:sse-event', {
          streamId: 'stream-kun',
          data: { seq: 1, kind: 'heartbeat' }
        })
      })
      await stop({}, 'stream-kun')

      expect(ensureRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ activeAgentRuntime: 'codex' })
      )
      expect(fetchMock).toHaveBeenCalled()
      expect(codexRuntime.subscribeEvents).not.toHaveBeenCalled()
      expect(codexRuntime.readStoredEvents).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
