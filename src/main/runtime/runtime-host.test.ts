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
} from '../../shared/app-settings'
import type { CodexRuntimeService } from './codex'
import { runtimeEventsViaRuntimeHost, runtimeRequestViaRuntimeHost } from './runtime-host'

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

describe('runtimeRequestViaRuntimeHost', () => {
  it('delegates explicit Kun requests to the existing Kun request function', async () => {
    const ensureKunRuntime = vi.fn(async () => undefined)
    const kunRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{"ok":true}' }))
    const response = await runtimeRequestViaRuntimeHost(
      settings('codex'),
      '/v1/threads',
      { method: 'GET' },
      {
        ensureKunRuntime,
        kunRequest
      },
      'kun'
    )

    expect(response.ok).toBe(true)
    expect(kunRequest).toHaveBeenCalledWith(
      expect.objectContaining({ activeAgentRuntime: 'codex' }),
      '/v1/threads',
      { method: 'GET' },
      ensureKunRuntime
    )
  })

  it('does not project Codex into the legacy Kun-shaped request contract', async () => {
    const kunRequest = vi.fn()
    const response = await runtimeRequestViaRuntimeHost(
      settings('codex'),
      '/v1/threads',
      { method: 'GET' },
      {
        ensureKunRuntime: vi.fn(async () => undefined),
        kunRequest
      }
    )

    expect(response.ok).toBe(false)
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({
      code: 'unsupported_runtime_request'
    })
    expect(kunRequest).not.toHaveBeenCalled()
  })
})

describe('runtimeEventsViaRuntimeHost', () => {
  it('delegates explicit Kun event streams to the existing Kun SSE implementation', async () => {
    const ensureKunRuntime = vi.fn(async () => undefined)
    const kunEvents = vi.fn(async function* () {
      yield { seq: 3, kind: 'agent_message_delta' }
    })
    const ac = new AbortController()
    const events = []

    for await (const event of runtimeEventsViaRuntimeHost(
      settings('codex'),
      'kun-thread',
      2,
      ac.signal,
      {
        ensureKunRuntime,
        kunRequest: vi.fn(),
        kunEvents,
        codexRuntime: () => ({}) as CodexRuntimeService
      },
      'kun'
    )) {
      events.push(event)
    }

    expect(events).toEqual([{ seq: 3, kind: 'agent_message_delta' }])
    expect(ensureKunRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ activeAgentRuntime: 'codex' })
    )
    expect(kunEvents).toHaveBeenCalledWith(
      expect.objectContaining({ activeAgentRuntime: 'codex' }),
      'kun-thread',
      2,
      ac.signal
    )
  })

  it('replays stored Codex events without exposing JSON-RPC frames', async () => {
    const codex = {
      connect: vi.fn(async () => ({ ok: true as const, info: {} })),
      readStoredEvents: vi.fn(async () => [
        { threadId: 'codex-thread', seq: 7, turnComplete: true }
      ])
    } as unknown as CodexRuntimeService

    const events = []
    for await (const event of runtimeEventsViaRuntimeHost(
      settings('codex'),
      'codex-thread',
      6,
      new AbortController().signal,
      {
        ensureKunRuntime: vi.fn(async () => undefined),
        kunRequest: vi.fn(),
        kunEvents: vi.fn(),
        codexRuntime: () => codex
      }
    )) {
      events.push(event)
    }

    expect(events).toEqual([{ threadId: 'codex-thread', seq: 7, turnComplete: true }])
    expect(codex.readStoredEvents).toHaveBeenCalledWith('codex-thread', 6)
    expect(codex.connect).not.toHaveBeenCalled()
  })
})
