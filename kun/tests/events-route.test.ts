import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeEvent } from '../src/contracts/events.js'
import type { EventBus } from '../src/ports/event-bus.js'
import type { SessionStore } from '../src/ports/session-store.js'
import { buildEventStreamResponse } from '../src/server/routes/events.js'

describe('events route', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes before replaying events and de-duplicates live echoes by sequence', async () => {
    const event = turnStartedEvent(1)
    let liveHandler: ((event: RuntimeEvent) => void) | undefined
    const eventBus = eventBusStub((handler) => {
      liveHandler = handler
    })
    const sessionStore = {
      loadEventsSince: vi.fn(async () => {
        liveHandler?.(event)
        return [event]
      })
    } as unknown as SessionStore
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thread-1/events?since_seq=0'),
      threadId: 'thread-1',
      eventBus,
      sessionStore,
      allocateSeq: () => 99
    })

    const frames = await readSseFrames(response)

    const subscribeOrder = vi.mocked(eventBus.subscribe).mock.invocationCallOrder[0]
    const replayOrder = vi.mocked(sessionStore.loadEventsSince).mock.invocationCallOrder[0]
    expect(subscribeOrder).toBeLessThan(replayOrder)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toContain('id: 1')
    expect(frames[0]).toContain('event: turn_started')
  })

  it('emits heartbeats without allocating a new replay cursor', async () => {
    vi.useFakeTimers()
    const eventBus = eventBusStub()
    const sessionStore = {
      loadEventsSince: vi.fn(async () => [])
    } as unknown as SessionStore
    const allocateSeq = vi.fn(() => 99)
    const response = buildEventStreamResponse({
      request: new Request('http://localhost/v1/threads/thread-1/events?since_seq=7'),
      threadId: 'thread-1',
      eventBus,
      sessionStore,
      allocateSeq
    })
    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()

    await Promise.resolve()
    const next = reader!.read()
    await vi.advanceTimersByTimeAsync(15_000)
    const chunk = await next
    await reader!.cancel()

    const frame = new TextDecoder().decode(chunk.value)
    expect(allocateSeq).not.toHaveBeenCalled()
    expect(frame).toContain('id: 7')
    expect(frame).toContain('"seq":7')
    expect(frame).toContain('event: heartbeat')
  })
})

function eventBusStub(
  onSubscribe?: (handler: (event: RuntimeEvent) => void) => void
): EventBus {
  return {
    publish: vi.fn(),
    subscribe: vi.fn((_threadId, handler) => {
      onSubscribe?.(handler)
      return vi.fn()
    }),
    snapshotSince: vi.fn(() => []),
    highestSeq: vi.fn(() => 0),
    reset: vi.fn()
  }
}

function turnStartedEvent(seq: number): RuntimeEvent {
  return {
    kind: 'turn_started',
    seq,
    timestamp: '2026-06-23T00:00:00.000Z',
    threadId: 'thread-1',
    turnId: 'turn-1'
  }
}

async function readSseFrames(response: Response): Promise<string[]> {
  const reader = response.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  let buffer = ''
  const frames: string[] = []
  try {
    while (true) {
      const next = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((resolve) => {
          setTimeout(() => resolve({ done: true, value: undefined }), 20)
        })
      ])
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        frames.push(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
      }
    }
    return frames
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
