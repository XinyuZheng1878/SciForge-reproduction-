import assert from 'node:assert/strict'
import test from 'node:test'

import { ComputerUseActionBudget } from './budget.js'
import type { ComputerUseSession } from './contract.js'

test('enforces action budget across turn and session dimensions', () => {
  const budget = new ComputerUseActionBudget({
    maxActionsPerTurn: 2,
    maxActionsPerSession: 3
  })
  const session = testSession('turn-1')

  assert.equal(budget.consume(session).ok, true)
  assert.equal(budget.consume(session).ok, true)
  const turnExhausted = budget.consume(session)
  assert.equal(turnExhausted.ok, false)
  if (!turnExhausted.ok) {
    assert.equal(turnExhausted.dimension, 'turn')
    assert.equal(turnExhausted.used, 2)
  }

  assert.equal(budget.consume(testSession('turn-2')).ok, true)
  const sessionExhausted = budget.consume(testSession('turn-2'))
  assert.equal(sessionExhausted.ok, false)
  if (!sessionExhausted.ok) {
    assert.equal(sessionExhausted.dimension, 'session')
    assert.equal(sessionExhausted.used, 3)
  }
})

function testSession(turnId: string): ComputerUseSession {
  return {
    computerUseSessionId: 'session-1',
    agentId: 'agent-1',
    threadId: 'thread-1',
    turnId,
    targetId: 'desktop:global',
    backend: 'global-native',
    leaseState: 'active',
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z'
  }
}
