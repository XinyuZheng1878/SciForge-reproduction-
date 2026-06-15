import { describe, expect, it } from 'vitest'
import {
  runtimeThreadsListHasActiveTurn,
  waitForRuntimeTurnsIdle
} from './managed-runtime-idle'

function thread(input: {
  id?: string
  status?: string
  latestTurnStatus?: string
  turns?: Array<{ status?: string }>
}) {
  return {
    id: input.id ?? 'thr_1',
    runtimeId: 'kun' as const,
    title: input.id ?? 'Thread',
    updatedAt: '2026-06-15T00:00:00.000Z',
    ...(input.status ? { status: input.status } : {}),
    ...(input.latestTurnStatus ? { latestTurnStatus: input.latestTurnStatus } : {}),
    ...(input.turns ? { turns: input.turns } : {})
  }
}

describe('runtimeThreadsListHasActiveTurn', () => {
  it('detects running thread summaries', () => {
    expect(runtimeThreadsListHasActiveTurn([thread({ status: 'running' })])).toBe(true)
    expect(runtimeThreadsListHasActiveTurn([thread({ latestTurnStatus: 'queued' })])).toBe(true)
  })

  it('detects running turns if a hydrated response includes them', () => {
    expect(runtimeThreadsListHasActiveTurn([
      thread({ status: 'idle', turns: [{ status: 'queued' }] })
    ])).toBe(true)
  })

  it('treats idle or malformed lists as idle', () => {
    expect(runtimeThreadsListHasActiveTurn([
      thread({ status: 'idle', turns: [{ status: 'completed' }] })
    ])).toBe(false)
    expect(runtimeThreadsListHasActiveTurn([])).toBe(false)
  })
})

describe('waitForRuntimeTurnsIdle', () => {
  it('waits until the runtime reports no active turns', async () => {
    const responses = [
      [thread({ status: 'running' })],
      [thread({ status: 'idle' })]
    ]
    const sleeps: number[] = []

    const result = await waitForRuntimeTurnsIdle({
      listThreads: async () => responses.shift() ?? [],
      sleepMs: async (ms) => { sleeps.push(ms) },
      intervalMs: 25,
      timeoutMs: 100
    })

    expect(result).toBe('idle')
    expect(sleeps).toEqual([25])
  })

  it('returns unavailable instead of blocking if the runtime cannot be queried', async () => {
    await expect(waitForRuntimeTurnsIdle({
      listThreads: async () => {
        throw new Error('offline')
      },
      sleepMs: async () => undefined,
      timeoutMs: 100
    })).resolves.toBe('unavailable')
  })
})
