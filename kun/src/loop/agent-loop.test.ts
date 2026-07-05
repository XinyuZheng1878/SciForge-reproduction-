import { describe, expect, it, vi } from 'vitest'
import { AgentLoop } from './agent-loop.js'

type DispatchOutcome =
  | { kind: 'aborted' }
  | {
      kind: 'continue'
      executedCount: number
      successCount: number
      errorCount: number
      suppressedCount: number
    }
  | { kind: 'all_suppressed'; suppressedCount: number }

describe('AgentLoop tool-loop recovery state', () => {
  it('clears recovery after successful tool progress', async () => {
    const { handle, turns } = createToolLoopHarness()

    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 1)).resolves.toBe('continue')
    await expect(handle(successfulToolOutcome(), 2)).resolves.toBe('continue')
    await expect(handle(successfulToolOutcome(), 4)).resolves.toBe('continue')

    expect(turns.applyItem).not.toHaveBeenCalled()
  })

  it('still fails repeated suppressed calls after recovery guidance', async () => {
    const { handle, turns } = createToolLoopHarness()

    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 1)).resolves.toBe('continue')
    await expect(handle({ kind: 'all_suppressed', suppressedCount: 1 }, 2)).resolves.toBe('failed')

    expect(turns.applyItem).toHaveBeenCalledTimes(1)
  })
})

function successfulToolOutcome(): DispatchOutcome {
  return {
    kind: 'continue',
    executedCount: 1,
    successCount: 1,
    errorCount: 0,
    suppressedCount: 0
  }
}

function createToolLoopHarness() {
  const events = { record: vi.fn(async () => undefined) }
  const turns = { applyItem: vi.fn(async () => undefined) }
  const loop = new AgentLoop({
    threadStore: {},
    sessionStore: {},
    approvalGate: {},
    userInputGate: {},
    model: {},
    toolHost: {},
    usage: {},
    events,
    turns,
    inflight: {},
    steering: {},
    compactor: {},
    prefix: { systemPrompt: '', fewShots: [] },
    ids: { next: vi.fn(() => 'item_error_1') },
    nowIso: () => '2026-07-03T00:00:00.000Z',
    toolStorm: {
      enabled: true,
      maxRecoverySteps: 1,
      nonProgressThreshold: 3,
      maxStepsAfterRecovery: 2
    }
  } as never)

  const signal = new AbortController().signal
  const handle = (outcome: DispatchOutcome, stepIndex: number) =>
    (loop as unknown as {
      handleToolDispatchOutcome(input: {
        outcome: DispatchOutcome
        threadId: string
        turnId: string
        stepIndex: number
        signal: AbortSignal
      }): Promise<'continue' | 'failed' | 'aborted'>
    }).handleToolDispatchOutcome({
      outcome,
      threadId: 'thread_1',
      turnId: 'turn_1',
      stepIndex,
      signal
    })

  return { handle, events, turns }
}
