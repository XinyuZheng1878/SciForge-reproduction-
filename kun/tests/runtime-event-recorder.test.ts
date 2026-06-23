import { describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../src/contracts/events.js'
import type { EventBus } from '../src/ports/event-bus.js'
import type { SessionStore } from '../src/ports/session-store.js'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'

describe('RuntimeEventRecorder', () => {
  it('persists events before publishing them to live subscribers', async () => {
    const calls: string[] = []
    const eventBus: EventBus = {
      publish: vi.fn(() => {
        calls.push('publish')
      }),
      subscribe: vi.fn(() => () => undefined),
      snapshotSince: vi.fn(() => []),
      highestSeq: vi.fn(() => 0),
      reset: vi.fn()
    }
    const sessionStore = {
      appendEvent: vi.fn(async () => {
        calls.push('persist')
      }),
      highestSeq: vi.fn(async () => 0)
    } as unknown as SessionStore
    const recorder = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: () => 1,
      nowIso: () => '2026-06-23T00:00:00.000Z'
    })

    const event = await recorder.record({
      kind: 'turn_started',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(event).toMatchObject({
      kind: 'turn_started',
      seq: 1,
      timestamp: '2026-06-23T00:00:00.000Z'
    })
    expect(calls).toEqual(['persist', 'publish'])
    expect(sessionStore.appendEvent).toHaveBeenCalledWith('thread-1', event)
    expect(eventBus.publish).toHaveBeenCalledWith(event)
  })

  it('allocates after the highest persisted sequence when the store is ahead', async () => {
    const published: RuntimeEvent[] = []
    const recorder = new RuntimeEventRecorder({
      eventBus: {
        publish: (event) => published.push(event),
        subscribe: () => () => undefined,
        snapshotSince: () => [],
        highestSeq: () => 0,
        reset: () => undefined
      },
      sessionStore: {
        appendEvent: vi.fn(async () => undefined),
        highestSeq: vi.fn(async () => 8)
      } as unknown as SessionStore,
      allocateSeq: () => 2,
      nowIso: () => '2026-06-23T00:00:00.000Z'
    })

    const event = await recorder.record({
      kind: 'turn_completed',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(event.seq).toBe(9)
    expect(published.map((item) => item.seq)).toEqual([9])
  })
})
