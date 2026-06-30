import { expect, it } from 'vitest'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import { SequentialIdGenerator } from '../ports/id-generator.js'
import { RuntimeEventRecorder } from './runtime-event-recorder.js'
import { TurnInProgressError, TurnService } from './turn-service.js'

it('interruptTurn rejects missing thread or turn instead of reporting a fake abort', async () => {
  const { turns, threadStore } = createTurnService()

  await expect(turns.interruptTurn({ threadId: 'missing-thread', turnId: 'turn_1' }))
    .rejects.toThrow(/thread not found: missing-thread/)

  await threadStore.upsert(makeThread('thread_1'))
  await expect(turns.interruptTurn({ threadId: 'thread_1', turnId: 'missing-turn' }))
    .rejects.toThrow(/turn not found: missing-turn/)
})

it('interruptTurn still aborts an existing in-flight turn', async () => {
  const { turns, threadStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const started = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Work' }
  })

  const result = await turns.interruptTurn({
    threadId: 'thread_1',
    turnId: started.turnId
  })

  expect(result.status).toBe('aborted')
  const turn = await turns.getTurn('thread_1', started.turnId)
  expect(turn?.status).toBe('aborted')
})

it('startTurn rejects a second running turn on the same thread', async () => {
  const { turns, threadStore } = createTurnService()
  await threadStore.upsert(makeThread('thread_1'))
  const first = await turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Work' }
  })

  await expect(turns.startTurn({
    threadId: 'thread_1',
    request: { prompt: 'Overlapping work' }
  })).rejects.toThrow(TurnInProgressError)

  const thread = await threadStore.get('thread_1')
  expect(thread?.turns.map((turn) => turn.id)).toEqual([first.turnId])
})

function createTurnService() {
  const eventBus = new InMemoryEventBus()
  const sessionStore = new InMemorySessionStore()
  const threadStore = new InMemoryThreadStore()
  const events = new RuntimeEventRecorder({
    eventBus,
    sessionStore,
    allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
    nowIso: () => '2026-06-28T00:00:00.000Z'
  })
  const turns = new TurnService({
    threadStore,
    sessionStore,
    events,
    inflight: new InflightTracker(),
    steering: new SteeringQueue(),
    compactor: new ContextCompactor({}),
    ids: new SequentialIdGenerator(),
    nowIso: () => '2026-06-28T00:00:00.000Z'
  })
  return { turns, threadStore }
}

function makeThread(id: string): ThreadRecord {
  return {
    id,
    title: 'Test thread',
    workspace: '/tmp/workspace',
    model: 'test-model',
    mode: 'agent',
    status: 'idle',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    relation: 'primary',
    createdAt: '2026-06-28T00:00:00.000Z',
    updatedAt: '2026-06-28T00:00:00.000Z',
    turns: []
  }
}
