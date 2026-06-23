import assert from 'node:assert/strict'
import test from 'node:test'
import { ComputerUseLeaseRegistry } from './lease.js'
import type { ComputerUseTarget } from './contract.js'

const target: ComputerUseTarget = {
  id: 'window:notes:1',
  kind: 'window',
  title: 'Notes',
  appName: 'Notes',
  backend: 'global-native'
}

test('rejects a second agent binding an already leased target', () => {
  let counter = 0
  const registry = new ComputerUseLeaseRegistry({
    nowIso: () => '2026-06-23T00:00:00.000Z',
    nextId: (prefix) => `${prefix}_${++counter}`
  })
  const first = registry.getOrCreateSession({
    agentId: 'agent_a',
    threadId: 'thread',
    backend: 'global-native'
  })
  const second = registry.getOrCreateSession({
    agentId: 'agent_b',
    threadId: 'thread',
    backend: 'global-native'
  })

  const bound = registry.bindTarget(first, target)
  assert.equal(bound.ok, true)

  const rejected = registry.bindTarget(second, target)
  assert.equal(rejected.ok, false)
  if (!rejected.ok) {
    assert.equal(rejected.rejection.code, 'target_in_use')
    assert.match(rejected.rejection.message, /already leased/)
    assert.equal(rejected.rejection.activeLease?.agentId, 'agent_a')
  }
})

test('allows another agent after the active lease is released', () => {
  let counter = 0
  const registry = new ComputerUseLeaseRegistry({
    nowIso: () => '2026-06-23T00:00:00.000Z',
    nextId: (prefix) => `${prefix}_${++counter}`
  })
  const first = registry.getOrCreateSession({
    agentId: 'agent_a',
    threadId: 'thread',
    backend: 'global-native'
  })
  const second = registry.getOrCreateSession({
    agentId: 'agent_b',
    threadId: 'thread',
    backend: 'global-native'
  })

  assert.equal(registry.bindTarget(first, target).ok, true)
  registry.releaseSession(first.computerUseSessionId)
  assert.equal(registry.bindTarget(second, target).ok, true)
})

test('rejects another agent reusing an existing session id', () => {
  let counter = 0
  const registry = new ComputerUseLeaseRegistry({
    nowIso: () => '2026-06-23T00:00:00.000Z',
    nextId: (prefix) => `${prefix}_${++counter}`
  })
  const first = registry.getOrCreateSession({
    computerUseSessionId: 'shared-session',
    agentId: 'agent_a',
    threadId: 'thread',
    backend: 'global-native'
  })
  assert.equal(registry.bindTarget(first, target).ok, true)

  const ownership = registry.validateSessionOwner({
    computerUseSessionId: 'shared-session',
    agentId: 'agent_b',
    threadId: 'thread',
    backend: 'global-native'
  })

  assert.equal(ownership.ok, false)
  if (!ownership.ok) {
    assert.equal(ownership.rejection.code, 'invalid_request')
    assert.match(ownership.rejection.message, /must create its own session/)
  }
  assert.equal(registry.getSession('shared-session')?.agentId, 'agent_a')
})

test('updates session turn and cursor without dropping the active lease', () => {
  const registry = new ComputerUseLeaseRegistry({
    nowIso: () => '2026-06-23T00:00:00.000Z',
    nextId: (prefix) => `${prefix}_1`
  })
  const session = registry.getOrCreateSession({
    computerUseSessionId: 'session-1',
    agentId: 'agent_a',
    threadId: 'thread',
    backend: 'global-native'
  })
  assert.equal(registry.bindTarget(session, target).ok, true)

  const updated = registry.updateSessionContext('session-1', {
    turnId: 'turn-2',
    cursor: { x: 10, y: 20 }
  })

  assert.equal(updated.targetId, target.id)
  assert.equal(updated.leaseState, 'active')
  assert.deepEqual(updated.cursor, { x: 10, y: 20 })
  assert.equal(registry.activeLeases()[0]?.turnId, 'turn-2')
})
