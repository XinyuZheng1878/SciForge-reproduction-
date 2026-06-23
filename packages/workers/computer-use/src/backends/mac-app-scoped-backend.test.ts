import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isMacAppScopedTargetId,
  MacAppScopedComputerUseBackend,
  type MacAppScopedTargetProvider
} from './mac-app-scoped-backend.js'
import type {
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackend,
  ComputerUseBackendDiagnostic,
  ComputerUseBindResult,
  ComputerUseSession,
  ComputerUseTarget
} from '../contract.js'

const baseSession: ComputerUseSession = {
  computerUseSessionId: 'session-1',
  agentId: 'agent-1',
  threadId: 'thread-1',
  backend: 'mac-app-scoped',
  leaseState: 'unbound',
  createdAt: '2026-06-23T00:00:00.000Z',
  updatedAt: '2026-06-23T00:00:00.000Z'
}

test('mac-app-scoped backend discovers real app and window targets through its provider', async () => {
  const provider = new FakeTargetProvider()
  const backend = new MacAppScopedComputerUseBackend({
    platform: 'darwin',
    targetProvider: provider,
    fallbackBackend: new FakeFallbackBackend()
  })

  const targets = await backend.listTargets()

  assert.equal(targets.length, 2)
  assert.equal(targets[0]?.id, 'mac-app-scoped:app:notes')
  assert.equal(targets[0]?.kind, 'app')
  assert.equal(targets[0]?.backend, 'mac-app-scoped')
  assert.equal(targets[1]?.id, 'mac-app-scoped:window:notes:1')
  assert.equal(targets[1]?.kind, 'window')
  assert.equal(isMacAppScopedTargetId(targets[1]?.id), true)
})

test('mac-app-scoped backend binds, activates, delegates, and releases a window target', async () => {
  const provider = new FakeTargetProvider()
  const fallback = new FakeFallbackBackend()
  const backend = new MacAppScopedComputerUseBackend({
    platform: 'darwin',
    targetProvider: provider,
    fallbackBackend: fallback,
    nowIso: () => '2026-06-23T00:01:00.000Z'
  })
  await backend.listTargets()

  const bind = await backend.bindTarget(baseSession, 'mac-app-scoped:window:notes:1')

  assert.equal(bind.ok, true)
  if (!bind.ok) throw new Error('bind should succeed')
  assert.equal(bind.session.leaseState, 'active')
  assert.equal(bind.session.backend, 'mac-app-scoped')
  assert.deepEqual(bind.session.cursor, { x: 0, y: 0 })
  assert.equal(bind.target.kind, 'window')
  assert.equal(bind.lease.targetId, 'mac-app-scoped:window:notes:1')

  const action = await backend.executeAction(bind.session, {
    action: 'click',
    computerUseSessionId: bind.session.computerUseSessionId,
    x: 10,
    y: 20
  })

  assert.equal(action.ok, true)
  assert.deepEqual(provider.activatedTargets, ['mac-app-scoped:window:notes:1'])
  assert.equal(fallback.executed.length, 1)
  assert.equal(fallback.executed[0]?.session.targetId, 'mac-app-scoped:window:notes:1')
  assert.equal(fallback.executed[0]?.input.action, 'click')

  const diagnostics = await backend.diagnostics()
  assert.equal(diagnostics.available, true)
  assert.equal(diagnostics.activeLeases.some((lease) => lease.targetId === 'mac-app-scoped:window:notes:1'), true)

  const released = await backend.releaseTarget(bind.session.computerUseSessionId, 'agent_release')
  assert.equal(released?.leaseState, 'released')
  assert.equal((await backend.diagnostics()).activeLeases.some((lease) => lease.targetId === 'mac-app-scoped:window:notes:1'), false)
})

test('mac-app-scoped backend fails closed on unsupported platforms', async () => {
  const backend = new MacAppScopedComputerUseBackend({
    platform: 'linux',
    targetProvider: new FakeTargetProvider(),
    fallbackBackend: new FakeFallbackBackend()
  })

  assert.deepEqual(await backend.listTargets(), [])
  const bind = await backend.bindTarget(baseSession, 'mac-app-scoped:window:notes:1')

  assert.equal(bind.ok, false)
  if (bind.ok) throw new Error('bind should fail')
  assert.equal(bind.rejection.code, 'backend_unavailable')
  assert.equal(bind.session.leaseState, 'rejected')
  assert.match(bind.rejection.message, /macOS/)
})

class FakeTargetProvider implements MacAppScopedTargetProvider {
  readonly activatedTargets: string[] = []
  readonly targets: ComputerUseTarget[] = [
    {
      id: 'mac-app-scoped:app:notes',
      kind: 'app',
      title: 'Notes',
      appName: 'Notes',
      pid: 42,
      backend: 'mac-app-scoped'
    },
    {
      id: 'mac-app-scoped:window:notes:1',
      kind: 'window',
      title: 'Notes: Shopping',
      appName: 'Notes',
      pid: 42,
      windowId: 'notes:1',
      backend: 'mac-app-scoped'
    }
  ]

  async listTargets() {
    return this.targets.map((target) => ({
      ...target,
      appName: target.appName ?? target.title,
      windowIndex: target.kind === 'window' ? 1 : undefined
    }))
  }

  async activateTarget(target: ComputerUseTarget): Promise<void> {
    this.activatedTargets.push(target.id)
  }

  async diagnostics() {
    return { available: true, reason: 'fake provider ready' }
  }
}

class FakeFallbackBackend implements ComputerUseBackend {
  readonly kind = 'global-native' as const
  readonly executed: Array<{ session: ComputerUseSession; input: ComputerUseActionRequest }> = []

  async listTargets(): Promise<ComputerUseTarget[]> {
    return []
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    return {
      ok: true,
      session,
      target: { id: targetId, kind: 'desktop', title: 'Desktop', backend: 'global-native' },
      lease: {
        leaseId: `fallback-${session.computerUseSessionId}`,
        computerUseSessionId: session.computerUseSessionId,
        agentId: session.agentId,
        threadId: session.threadId,
        targetId,
        backend: 'global-native',
        acquiredAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    }
  }

  async releaseTarget(): Promise<ComputerUseSession | null> {
    return null
  }

  async executeAction(session: ComputerUseSession, input: ComputerUseActionRequest): Promise<ComputerUseActionResult> {
    this.executed.push({ session, input })
    return {
      ok: true,
      output: {
        kind: 'computer_action',
        action: input.action,
        ok: true,
        cursor: [input.x ?? 0, input.y ?? 0],
        computerUseSessionId: session.computerUseSessionId,
        targetId: session.targetId
      }
    }
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    return {
      backend: 'global-native',
      available: true,
      platform: 'darwin',
      activeLeases: [],
      recentRejections: []
    }
  }
}
