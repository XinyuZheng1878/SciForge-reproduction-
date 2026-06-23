import assert from 'node:assert/strict'
import test from 'node:test'

import { CompositeComputerUseBackend } from './composite-backend.js'
import type {
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackend,
  ComputerUseBackendDiagnostic,
  ComputerUseBackendKind,
  ComputerUseBindResult,
  ComputerUseSession,
  ComputerUseTarget
} from '../contract.js'

test('composite backend defaults to agent-isolated browser targets only', async () => {
  const browser = new FakeBackend('browser-cdp', [{
    id: 'browser-cdp:isolated-browser',
    kind: 'window',
    title: 'Isolated browser',
    backend: 'browser-cdp',
    inputIsolation: 'agent-isolated',
    affectsUserInput: false
  }])
  const globalNative = new ThrowingBackend('global-native')
  const macAppScoped = new ThrowingBackend('mac-app-scoped')
  const backend = new CompositeComputerUseBackend({
    browserCdp: browser,
    globalNative,
    macAppScoped,
    enableHostInputBackends: false
  })

  const targets = await backend.listTargets()
  const diagnostics = await backend.diagnostics()

  assert.deepEqual(targets.map((target) => target.id), ['browser-cdp:isolated-browser'])
  assert.equal(targets[0]?.inputIsolation, 'agent-isolated')
  assert.equal(targets[0]?.affectsUserInput, false)
  assert.equal(diagnostics.backend, 'browser-cdp')
  assert.equal(diagnostics.inputIsolation, 'agent-isolated')
  assert.equal(diagnostics.affectsUserInput, false)
})

test('composite backend only exposes host-input targets when explicitly enabled', async () => {
  const browser = new FakeBackend('browser-cdp', [{
    id: 'browser-cdp:isolated-browser',
    kind: 'window',
    title: 'Isolated browser',
    backend: 'browser-cdp'
  }])
  const globalNative = new FakeBackend('global-native', [{
    id: 'desktop:global',
    kind: 'desktop',
    title: 'Host desktop',
    backend: 'global-native'
  }])
  const macAppScoped = new FakeBackend('mac-app-scoped', [{
    id: 'mac-app-scoped:app:notes',
    kind: 'app',
    title: 'Notes',
    backend: 'mac-app-scoped'
  }])
  const backend = new CompositeComputerUseBackend({
    browserCdp: browser,
    globalNative,
    macAppScoped,
    enableHostInputBackends: true
  })

  const targets = await backend.listTargets()

  assert.deepEqual(targets.map((target) => target.id), [
    'browser-cdp:isolated-browser',
    'desktop:global',
    'mac-app-scoped:app:notes'
  ])
})

class FakeBackend implements ComputerUseBackend {
  constructor(
    readonly kind: ComputerUseBackendKind,
    private readonly targets: ComputerUseTarget[]
  ) {}

  async listTargets(): Promise<ComputerUseTarget[]> {
    return this.targets
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    const target = this.targets.find((candidate) => candidate.id === targetId)
    if (!target) {
      return {
        ok: false,
        session: { ...session, backend: this.kind, targetId, leaseState: 'rejected' },
        rejection: { code: 'target_not_found', targetId, message: `missing ${targetId}` }
      }
    }
    return {
      ok: true,
      session: { ...session, backend: this.kind, targetId, leaseState: 'active' },
      target,
      lease: {
        leaseId: `lease_${session.computerUseSessionId}`,
        computerUseSessionId: session.computerUseSessionId,
        agentId: session.agentId,
        threadId: session.threadId,
        targetId,
        backend: this.kind,
        acquiredAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    }
  }

  async releaseTarget(): Promise<ComputerUseSession | null> {
    return null
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    return {
      ok: true,
      output: {
        kind: 'computer_action',
        action: input.action,
        ok: true,
        computerUseSessionId: session.computerUseSessionId,
        targetId: session.targetId
      }
    }
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    return {
      backend: this.kind,
      available: true,
      platform: process.platform,
      inputIsolation: this.kind === 'browser-cdp' ? 'agent-isolated' : 'host-global',
      affectsUserInput: this.kind !== 'browser-cdp',
      activeLeases: [],
      recentRejections: []
    }
  }
}

class ThrowingBackend extends FakeBackend {
  constructor(kind: ComputerUseBackendKind) {
    super(kind, [])
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    throw new Error(`${this.kind} should not be used`)
  }
}
