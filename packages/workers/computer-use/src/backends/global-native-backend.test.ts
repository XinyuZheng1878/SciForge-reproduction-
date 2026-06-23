import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GlobalNativeComputerUseBackend
} from './global-native-backend.js'
import type { HostController } from './host-control.js'
import type { ComputerUseSession } from '../contract.js'

test('global-native backend serializes host actions with a global action lock', async () => {
  const events: string[] = []
  const fakeController = {
    async ensureReady() {
      return { available: true }
    },
    async click(x: number | undefined) {
      events.push(`start:${x}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      events.push(`end:${x}`)
    }
  } as unknown as HostController
  const backend = new GlobalNativeComputerUseBackend({ controller: fakeController })
  const session = testSession()

  await Promise.all([
    backend.executeAction(session, {
      action: 'click',
      computerUseSessionId: session.computerUseSessionId,
      x: 1,
      y: 1
    }),
    backend.executeAction(session, {
      action: 'click',
      computerUseSessionId: session.computerUseSessionId,
      x: 2,
      y: 2
    })
  ])

  assert.deepEqual(events, ['start:1', 'end:1', 'start:2', 'end:2'])
})

function testSession(): ComputerUseSession {
  return {
    computerUseSessionId: 'session-1',
    agentId: 'agent-1',
    threadId: 'thread-1',
    targetId: 'desktop:global',
    backend: 'global-native',
    leaseState: 'active',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z'
  }
}
