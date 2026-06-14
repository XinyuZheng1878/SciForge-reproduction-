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
})
