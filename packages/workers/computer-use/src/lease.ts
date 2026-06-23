import type {
  ComputerUseBackendKind,
  ComputerUseBindResult,
  ComputerUseLease,
  ComputerUseLeaseRejection,
  ComputerUseReleaseReason,
  ComputerUseSession,
  ComputerUseTarget
} from './contract.js'

export type ComputerUseLeaseRegistryOptions = {
  nowIso?: () => string
  nextId?: (prefix: string) => string
}

export type ComputerUseSessionInput = {
  computerUseSessionId?: string
  agentId: string
  threadId: string
  turnId?: string
  backend: ComputerUseBackendKind
}

export class ComputerUseLeaseRegistry {
  private readonly sessions = new Map<string, ComputerUseSession>()
  private readonly leasesByTarget = new Map<string, ComputerUseLease>()
  private readonly recentRejections: ComputerUseLeaseRejection[] = []
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string

  constructor(options: ComputerUseLeaseRegistryOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`)
  }

  getOrCreateSession(input: ComputerUseSessionInput): ComputerUseSession {
    const sessionId = input.computerUseSessionId ?? this.nextId('cu_session')
    const existing = this.sessions.get(sessionId)
    const now = this.nowIso()
    if (existing) {
      const next = {
        ...existing,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        backend: input.backend,
        updatedAt: now
      }
      this.sessions.set(sessionId, next)
      return next
    }
    const session: ComputerUseSession = {
      computerUseSessionId: sessionId,
      agentId: input.agentId,
      threadId: input.threadId,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      backend: input.backend,
      leaseState: 'unbound',
      createdAt: now,
      updatedAt: now
    }
    this.sessions.set(sessionId, session)
    return session
  }

  validateSessionOwner(input: ComputerUseSessionInput): {
    ok: true
  } | {
    ok: false
    session: ComputerUseSession
    rejection: ComputerUseLeaseRejection
  } {
    if (!input.computerUseSessionId) return { ok: true }
    const existing = this.sessions.get(input.computerUseSessionId)
    if (!existing) return { ok: true }
    if (existing.agentId === input.agentId && existing.threadId === input.threadId) return { ok: true }
    const rejection: ComputerUseLeaseRejection = {
      code: 'invalid_request',
      targetId: existing.targetId,
      message:
        `computer-use session ${existing.computerUseSessionId} belongs to ` +
        `agent ${existing.agentId} in thread ${existing.threadId}; ` +
        `agent ${input.agentId} in thread ${input.threadId} must create its own session`
    }
    this.rememberRejection(rejection)
    return { ok: false, session: { ...existing, leaseState: 'rejected' }, rejection }
  }

  getSession(sessionId: string): ComputerUseSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  updateSessionContext(
    sessionId: string,
    patch: {
      turnId?: string
      backend?: ComputerUseBackendKind
      cursor?: { x: number; y: number }
    }
  ): ComputerUseSession {
    const session = this.updateSession(sessionId, {
      ...(patch.turnId ? { turnId: patch.turnId } : {}),
      ...(patch.backend ? { backend: patch.backend } : {}),
      ...(patch.cursor ? { cursor: patch.cursor } : {}),
      updatedAt: this.nowIso()
    })
    if (session.targetId) {
      for (const [leaseKey, lease] of this.leasesByTarget.entries()) {
        if (lease.computerUseSessionId !== sessionId) continue
        const nextLease: ComputerUseLease = {
          ...lease,
          ...(session.turnId ? { turnId: session.turnId } : {}),
          updatedAt: session.updatedAt
        }
        this.leasesByTarget.set(leaseKey, nextLease)
      }
    }
    return session
  }

  bindTarget(session: ComputerUseSession, target: ComputerUseTarget): ComputerUseBindResult {
    const leaseKey = leaseMapKey(session.computerUseSessionId, target)
    const active = this.leasesByTarget.get(leaseKey)
    const now = this.nowIso()
    if (active && active.computerUseSessionId !== session.computerUseSessionId) {
      const rejection: ComputerUseLeaseRejection = {
        code: 'target_in_use',
        targetId: target.id,
        activeLease: active,
        message:
          `computer-use target "${target.title}" is already leased by ` +
          `agent ${active.agentId} in session ${active.computerUseSessionId}`
      }
      this.rememberRejection(rejection)
      const rejected = this.updateSession(session.computerUseSessionId, {
        targetId: target.id,
        leaseState: 'rejected',
        updatedAt: now
      })
      return { ok: false, session: rejected, target, rejection }
    }

    const lease: ComputerUseLease = active ?? {
      leaseId: this.nextId('cu_lease'),
      computerUseSessionId: session.computerUseSessionId,
      agentId: session.agentId,
      threadId: session.threadId,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      targetId: target.id,
      backend: target.backend,
      ...(target.inputIsolation ? { inputIsolation: target.inputIsolation } : {}),
      ...(typeof target.affectsUserInput === 'boolean' ? { affectsUserInput: target.affectsUserInput } : {}),
      ...(typeof target.requiresHostFocus === 'boolean' ? { requiresHostFocus: target.requiresHostFocus } : {}),
      ...(typeof target.usesHostClipboard === 'boolean' ? { usesHostClipboard: target.usesHostClipboard } : {}),
      acquiredAt: now,
      updatedAt: now
    }
    const refreshed = { ...lease, updatedAt: now }
    this.deleteLeasesForSession(session.computerUseSessionId)
    this.leasesByTarget.set(leaseKey, refreshed)
    const bound = this.updateSession(session.computerUseSessionId, {
      targetId: target.id,
      backend: target.backend,
      inputIsolation: target.inputIsolation,
      affectsUserInput: target.affectsUserInput,
      requiresHostFocus: target.requiresHostFocus,
      usesHostClipboard: target.usesHostClipboard,
      leaseState: 'active',
      updatedAt: now
    })
    return { ok: true, session: bound, target, lease: refreshed }
  }

  releaseSession(
    sessionId: string,
    reason: ComputerUseReleaseReason = 'agent_release'
  ): ComputerUseSession | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    const now = this.nowIso()
    this.deleteLeasesForSession(sessionId)
    return this.updateSession(sessionId, {
      leaseState: 'released',
      targetId: undefined,
      inputIsolation: undefined,
      affectsUserInput: undefined,
      requiresHostFocus: undefined,
      usesHostClipboard: undefined,
      releaseReason: reason,
      releasedAt: now,
      updatedAt: now
    })
  }

  sessionsSnapshot(): ComputerUseSession[] {
    return [...this.sessions.values()]
  }

  activeLeases(): ComputerUseLease[] {
    return [...this.leasesByTarget.values()]
  }

  recentLeaseRejections(): ComputerUseLeaseRejection[] {
    return [...this.recentRejections]
  }

  private updateSession(
    sessionId: string,
    patch: Partial<ComputerUseSession>
  ): ComputerUseSession {
    const current = this.sessions.get(sessionId)
    if (!current) throw new Error(`unknown computer-use session: ${sessionId}`)
    const next = { ...current, ...patch }
    if (Object.prototype.hasOwnProperty.call(patch, 'targetId') && patch.targetId === undefined) {
      delete next.targetId
    }
    for (const key of ['inputIsolation', 'affectsUserInput', 'requiresHostFocus', 'usesHostClipboard'] as const) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] === undefined) {
        delete next[key]
      }
    }
    this.sessions.set(sessionId, next)
    return next
  }

  private rememberRejection(rejection: ComputerUseLeaseRejection): void {
    this.recentRejections.push(rejection)
    if (this.recentRejections.length > 20) this.recentRejections.shift()
  }

  private deleteLeasesForSession(sessionId: string): void {
    for (const [leaseKey, lease] of this.leasesByTarget.entries()) {
      if (lease.computerUseSessionId === sessionId) this.leasesByTarget.delete(leaseKey)
    }
  }
}

function leaseMapKey(sessionId: string, target: ComputerUseTarget): string {
  return target.inputIsolation === 'agent-isolated'
    ? `${target.id}#${sessionId}`
    : target.id
}
