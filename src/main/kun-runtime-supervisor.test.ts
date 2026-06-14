import { describe, expect, it } from 'vitest'
import { RestartBudget } from './kun-runtime-supervisor'

function budgetAt(clock: { value: number }): RestartBudget {
  return new RestartBudget({
    windowMs: 60_000,
    maxRestarts: 3,
    baseDelayMs: 1_000,
    delayFactor: 3,
    now: () => clock.value
  })
}

describe('RestartBudget', () => {
  it('allows bounded restart attempts with exponential backoff', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)

    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 2, delayMs: 3_000 })
    clock.value += 1_000
    expect(budget.note()).toEqual({ allowed: true, attempt: 3, delayMs: 9_000 })
  })

  it('circuit-breaks once the sliding window is saturated', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()

    expect(budget.note()).toEqual({ allowed: false, attempt: 3, delayMs: 0 })
  })

  it('frees attempts after the window and reset clears immediately', () => {
    const clock = { value: 0 }
    const budget = budgetAt(clock)
    budget.note()
    budget.note()
    budget.note()
    expect(budget.note().allowed).toBe(false)

    clock.value = 60_001
    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
    budget.note()
    budget.reset()
    expect(budget.note()).toEqual({ allowed: true, attempt: 1, delayMs: 1_000 })
  })
})
