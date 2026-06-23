import {
  ComputerUseLeaseRegistry,
  type ComputerUseSessionInput
} from './lease.js'
import {
  defaultSharedLeaseCoordinatorFromEnv,
  NoopComputerUseSharedLeaseCoordinator,
  type ComputerUseSharedLeaseCoordinator
} from './shared-lease.js'
import {
  InMemoryComputerUseAuditRecorder,
  type ComputerUseAuditRecord,
  type ComputerUseAuditRecorder
} from './audit.js'
import {
  ComputerUseActionBudget,
  type ComputerUseActionBudgetOptions,
  type ComputerUseBudgetSnapshot
} from './budget.js'
import { assessComputerUseRisk } from './confirmation.js'
import { createCompositeComputerUseBackend } from './backends/composite-backend.js'
import type {
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackend,
  ComputerUseBackendDiagnostic,
  ComputerUseBindResult,
  ComputerUseLeaseRejection,
  ComputerUseReleaseReason,
  ComputerUseRiskAssessment,
  ComputerUseSession,
  ComputerUseTarget,
  ComputerUseWorkerDiagnostics
} from './contract.js'
import {
  COMPUTER_USE_WORKER_CAPABILITIES,
  COMPUTER_USE_WORKER_TRANSPORT,
  COMPUTER_USE_WORKER_VERSION
} from './contract.js'

export type ComputerUseServiceOptions = {
  backend?: ComputerUseBackend
  registry?: ComputerUseLeaseRegistry
  auditRecorder?: ComputerUseAuditRecorder
  budget?: ComputerUseActionBudget | ComputerUseActionBudgetOptions
  sharedLeases?: ComputerUseSharedLeaseCoordinator | false
  nowIso?: () => string
  nextId?: (prefix: string) => string
}

export type ComputerUseListTargetsResult = {
  targets: ComputerUseTarget[]
  diagnostics: ComputerUseBackendDiagnostic
}

export type ComputerUseServiceDiagnostic = Omit<ComputerUseBackendDiagnostic, 'recentError'> & ComputerUseWorkerDiagnostics & {
  sessions: ComputerUseSession[]
  budget: ComputerUseBudgetSnapshot
  audit: ComputerUseAuditRecord[]
}

export class ComputerUseService {
  private readonly backend: ComputerUseBackend
  private readonly registry: ComputerUseLeaseRegistry
  private readonly audit: ComputerUseAuditRecorder
  private readonly budget: ComputerUseActionBudget
  private readonly sharedLeases: ComputerUseSharedLeaseCoordinator
  private readonly activeActionControllers = new Map<string, Set<AbortController>>()

  constructor(options: ComputerUseServiceOptions = {}) {
    this.backend = options.backend ?? createCompositeComputerUseBackend()
    this.registry = options.registry ?? new ComputerUseLeaseRegistry({
      nowIso: options.nowIso,
      nextId: options.nextId
    })
    this.audit = options.auditRecorder ?? new InMemoryComputerUseAuditRecorder({
      nowIso: options.nowIso,
      nextId: options.nextId
    })
    this.budget = options.budget instanceof ComputerUseActionBudget
      ? options.budget
      : new ComputerUseActionBudget(options.budget)
    this.sharedLeases = options.sharedLeases === false
      ? new NoopComputerUseSharedLeaseCoordinator()
      : options.sharedLeases ?? defaultSharedLeaseCoordinatorFromEnv()
  }

  async listTargets(): Promise<ComputerUseListTargetsResult> {
    const targets = await this.backend.listTargets()
    const diagnostics = await this.backend.diagnostics()
    this.audit.record({
      event: 'list_targets',
      action: 'list_targets',
      ok: diagnostics.available,
      backend: diagnostics.backend,
      ...(diagnostics.reason ? { message: diagnostics.reason } : {})
    })
    return { targets, diagnostics }
  }

  async bindTarget(
    input: ComputerUseSessionInput & { targetId: string }
  ): Promise<ComputerUseBindResult> {
    const ownership = this.registry.validateSessionOwner(input)
    if (!ownership.ok) {
      const result: ComputerUseBindResult = {
        ok: false,
        session: ownership.session,
        rejection: ownership.rejection
      }
      this.auditBindResult(result, input)
      return result
    }

    const session = this.registry.getOrCreateSession(input)
    const targets = await this.backend.listTargets()
    const target = targets.find((candidate) => candidate.id === input.targetId)
    if (!target) {
      const rejection: ComputerUseLeaseRejection = {
        code: 'target_not_found',
        targetId: input.targetId,
        message: `computer-use target "${input.targetId}" was not found`
      }
      const result: ComputerUseBindResult = {
        ok: false,
        session: { ...session, leaseState: 'rejected', targetId: input.targetId },
        rejection
      }
      this.auditBindResult(result, input)
      return result
    }

    const local = this.registry.bindTarget(session, target)
    if (!local.ok) {
      this.auditBindResult(local, input)
      return local
    }

    const shared = await this.sharedLeases.acquire(local.lease, target)
    if (!shared.ok) {
      this.registry.releaseSession(session.computerUseSessionId, 'session_replaced')
      const failed: ComputerUseBindResult = {
        ok: false,
        session: { ...local.session, leaseState: 'rejected' },
        target,
        rejection: shared.rejection
      }
      this.auditBindResult(failed, input)
      return failed
    }

    const remote = await this.backend.bindTarget(local.session, input.targetId)
    if (!remote.ok) {
      const released = this.registry.releaseSession(session.computerUseSessionId, 'backend_unavailable')
      await this.sharedLeases.release(session.computerUseSessionId, target.id)
      const failed: ComputerUseBindResult = {
        ...remote,
        session: released ?? remote.session
      }
      this.auditBindResult(failed, input)
      return failed
    }

    this.auditBindResult(local, input)
    return local
  }

  async releaseTarget(
    sessionId: string,
    reason: ComputerUseReleaseReason = 'agent_release'
  ): Promise<ComputerUseSession | null> {
    const session = this.registry.getSession(sessionId)
    this.abortSessionActions(sessionId)
    const cleanupErrors: string[] = []
    try {
      await this.backend.releaseTarget(sessionId, reason)
    } catch (error) {
      cleanupErrors.push(`backend release failed: ${errorMessage(error)}`)
    }
    try {
      await this.sharedLeases.release(sessionId, session?.targetId)
    } catch (error) {
      cleanupErrors.push(`shared lease release failed: ${errorMessage(error)}`)
    }
    const released = this.registry.releaseSession(sessionId, reason)
    this.audit.record({
      event: 'release_target',
      action: 'release_target',
      ok: released !== null,
      computerUseSessionId: sessionId,
      agentId: released?.agentId,
      threadId: released?.threadId,
      turnId: released?.turnId,
      targetId: session?.targetId ?? released?.targetId,
      backend: released?.backend,
      leaseState: released?.leaseState,
      releaseReason: reason,
      ...(cleanupErrors.length > 0
        ? { message: cleanupErrors.join('; ') }
        : released ? {} : { message: `computer-use session ${sessionId} was not found` })
    })
    return released
  }

  async releaseAllTargets(
    reason: ComputerUseReleaseReason = 'service_shutdown'
  ): Promise<ComputerUseSession[]> {
    const activeSessions = this.registry.sessionsSnapshot().filter(
      (session) => session.leaseState === 'active' && session.targetId
    )
    const released: ComputerUseSession[] = []
    const failures: Array<{ sessionId: string; message: string }> = []

    for (const session of activeSessions) {
      try {
        const result = await this.releaseTarget(session.computerUseSessionId, reason)
        if (result) released.push(result)
      } catch (error) {
        failures.push({
          sessionId: session.computerUseSessionId,
          message: errorMessage(error)
        })
      }
    }

    this.audit.record({
      event: 'release_all_targets',
      action: 'release_target',
      ok: failures.length === 0,
      releaseReason: reason,
      ...(failures.length > 0
        ? { message: `released ${released.length}/${activeSessions.length} computer-use session(s); ${formatReleaseFailures(failures)}` }
        : { message: `released ${released.length}/${activeSessions.length} computer-use session(s)` })
    })
    return released
  }

  async executeAction(input: ComputerUseActionRequest): Promise<ComputerUseActionResult> {
    let session = this.registry.getSession(input.computerUseSessionId)
    if (!session || session.leaseState !== 'active' || !session.targetId) {
      const result = actionFailure(input, {
        code: 'invalid_request',
        targetId: input.targetId,
        message: `computer-use session ${input.computerUseSessionId} does not hold an active target lease`
      }, session)
      this.auditActionResult(result, session, input)
      return result
    }

    if (input.agentId || input.threadId) {
      const ownership = this.registry.validateSessionOwner({
        computerUseSessionId: input.computerUseSessionId,
        agentId: input.agentId ?? session.agentId,
        threadId: input.threadId ?? session.threadId,
        turnId: input.turnId,
        backend: session.backend
      })
      if (!ownership.ok) {
        const result = actionFailure(input, ownership.rejection, ownership.session)
        this.auditActionResult(result, ownership.session, input)
        return result
      }
    }

    if (input.turnId) {
      session = this.registry.updateSessionContext(session.computerUseSessionId, { turnId: input.turnId })
    }

    const shared = await this.sharedLeases.refresh(session)
    if (!shared.ok) {
      const result = actionFailure(input, shared.rejection, session)
      this.auditActionResult(result, session, input)
      return result
    }

    if (input.targetId && input.targetId !== session.targetId) {
      const result = actionFailure(input, {
        code: 'invalid_request',
        targetId: input.targetId,
        message: `computer-use session ${session.computerUseSessionId} is leased to ${session.targetId}, not ${input.targetId}`
      }, session)
      this.auditActionResult(result, session, input)
      return result
    }

    const risk = assessComputerUseRisk(input)
    if (risk.blocked) {
      const result = actionFailure(input, {
        code: 'policy_blocked',
        targetId: session.targetId,
        message: risk.blockedReason ?? risk.message ?? 'computer_use action blocked by policy',
        risk
      }, session, risk)
      this.auditActionResult(result, session, input, risk)
      return result
    }
    if (risk.requiresConfirmation) {
      const result = actionFailure(input, {
        code: 'confirmation_required',
        targetId: session.targetId,
        message: risk.message ?? 'computer_use action requires user confirmation before execution',
        risk
      }, session, risk)
      this.auditActionResult(result, session, input, risk)
      return result
    }

    const budget = this.budget.consume(session)
    if (!budget.ok) {
      const result = actionFailure(input, {
        code: 'action_budget_exhausted',
        targetId: session.targetId,
        message: budget.message
      }, session, risk)
      this.auditActionResult(result, session, input, risk, {
        dimension: budget.dimension,
        used: budget.used,
        limit: budget.limit
      })
      return result
    }

    const controller = new AbortController()
    const unlinkAbortSignal = linkAbortSignal(input.signal, controller)
    if (controller.signal.aborted) {
      unlinkAbortSignal()
      const result = actionFailure(input, {
        code: 'aborted',
        targetId: session.targetId,
        message: `computer_use ${input.action} was aborted before execution`
      }, session, risk)
      this.auditActionResult(result, session, input, risk)
      await this.releaseTargetAfterAbort(session.computerUseSessionId)
      return result
    }

    this.trackActionController(session.computerUseSessionId, controller)
    try {
      const result = await this.backend.executeAction(session, {
        ...input,
        targetId: session.targetId,
        signal: controller.signal
      })
      if (controller.signal.aborted) {
        const aborted = actionFailure(input, {
          code: 'aborted',
          targetId: session.targetId,
          message: `computer_use ${input.action} was aborted before completion`
        }, session, risk)
        this.auditActionResult(aborted, this.registry.getSession(session.computerUseSessionId) ?? session, input, risk)
        await this.releaseTargetAfterAbort(session.computerUseSessionId)
        return aborted
      }
      if (result.ok) this.updateSessionFromActionOutput(session, result.output)
      this.auditActionResult(result, this.registry.getSession(session.computerUseSessionId) ?? session, input, risk)
      return result
    } finally {
      unlinkAbortSignal()
      this.untrackActionController(session.computerUseSessionId, controller)
    }
  }

  async diagnostics(): Promise<ComputerUseServiceDiagnostic> {
    const backend = await this.backend.diagnostics()
    const sharedLeases = await this.sharedLeases.activeLeases()
    const recentError = backend.recentError
    const diagnostic: ComputerUseServiceDiagnostic = {
      ...backend,
      version: COMPUTER_USE_WORKER_VERSION,
      transport: COMPUTER_USE_WORKER_TRANSPORT,
      health: computerUseWorkerHealth(backend.available, backend.reason, recentError),
      capabilities: [...COMPUTER_USE_WORKER_CAPABILITIES],
      ...(recentError ? { recentError } : {}),
      activeLeases: [
        ...backend.activeLeases,
        ...sharedLeases.filter(
          (lease) => !backend.activeLeases.some((backendLease) => backendLease.leaseId === lease.leaseId)
        ),
        ...this.registry.activeLeases().filter(
          (lease) => ![...backend.activeLeases, ...sharedLeases].some(
            (knownLease) => knownLease.leaseId === lease.leaseId
          )
        )
      ],
      recentRejections: [
        ...backend.recentRejections,
        ...this.sharedLeases.recentRejections(),
        ...this.registry.recentLeaseRejections()
      ].slice(-20),
      sessions: this.registry.sessionsSnapshot(),
      budget: this.budget.snapshot(),
      audit: this.audit.records()
    }
    this.audit.record({
      event: 'diagnostics',
      action: 'diagnostics',
      ok: diagnostic.available,
      backend: diagnostic.backend,
      ...(diagnostic.reason ? { message: diagnostic.reason } : {})
    })
    return {
      ...diagnostic,
      audit: this.audit.records()
    }
  }

  private auditBindResult(
    result: ComputerUseBindResult,
    input: ComputerUseSessionInput & { targetId: string }
  ): void {
    const session = result.session
    this.audit.record({
      event: 'bind_target',
      action: 'bind_target',
      ok: result.ok,
      computerUseSessionId: session.computerUseSessionId,
      agentId: result.ok ? session.agentId : input.agentId,
      threadId: result.ok ? session.threadId : input.threadId,
      turnId: session.turnId ?? input.turnId,
      targetId: session.targetId ?? input.targetId,
      backend: session.backend,
      leaseState: session.leaseState,
      ...(result.ok ? {} : {
        rejectionCode: result.rejection.code,
        message: result.rejection.message
      })
    })
  }

  private auditActionResult(
    result: ComputerUseActionResult,
    session: ComputerUseSession | null,
    input: ComputerUseActionRequest,
    risk?: ComputerUseRiskAssessment,
    budget?: { dimension: 'turn' | 'session'; used: number; limit: number }
  ): void {
    this.audit.record({
      event: 'action',
      action: input.action,
      ok: result.ok,
      computerUseSessionId: session?.computerUseSessionId ?? input.computerUseSessionId,
      agentId: session?.agentId ?? input.agentId,
      threadId: session?.threadId ?? input.threadId,
      turnId: session?.turnId ?? input.turnId,
      targetId: session?.targetId ?? input.targetId,
      backend: session?.backend,
      leaseState: session?.leaseState,
      ...(result.ok ? {} : {
        rejectionCode: result.rejection.code,
        message: result.rejection.message
      }),
      ...(risk && risk.categories.length > 0 ? { risk } : {}),
      ...(budget ? { budget } : {}),
      ...(result.ok && result.output.kind === 'computer_action' && result.output.message
        ? { message: result.output.message }
        : {})
    })
  }

  private updateSessionFromActionOutput(
    session: ComputerUseSession,
    output: ComputerUseActionResult['output']
  ): void {
    if (output.kind !== 'computer_action' || !Array.isArray(output.cursor)) return
    const [x, y] = output.cursor
    if (typeof x !== 'number' || typeof y !== 'number') return
    this.registry.updateSessionContext(session.computerUseSessionId, {
      cursor: { x, y }
    })
  }

  private trackActionController(sessionId: string, controller: AbortController): void {
    const controllers = this.activeActionControllers.get(sessionId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.activeActionControllers.set(sessionId, controllers)
  }

  private untrackActionController(sessionId: string, controller: AbortController): void {
    const controllers = this.activeActionControllers.get(sessionId)
    if (!controllers) return
    controllers.delete(controller)
    if (controllers.size === 0) this.activeActionControllers.delete(sessionId)
  }

  private abortSessionActions(sessionId: string): void {
    const controllers = this.activeActionControllers.get(sessionId)
    if (!controllers) return
    for (const controller of controllers) controller.abort()
  }

  private async releaseTargetAfterAbort(sessionId: string): Promise<void> {
    const session = this.registry.getSession(sessionId)
    if (session?.leaseState !== 'active') return
    await this.releaseTarget(sessionId, 'user_stop')
  }
}

export function createComputerUseService(options: ComputerUseServiceOptions = {}): ComputerUseService {
  return new ComputerUseService(options)
}

function actionFailure(
  input: ComputerUseActionRequest,
  rejection: ComputerUseLeaseRejection,
  session?: ComputerUseSession | null,
  risk?: ComputerUseRiskAssessment
): ComputerUseActionResult {
  const assessedRisk = risk ?? rejection.risk
  return {
    ok: false,
    output: {
      kind: 'computer_action',
      action: input.action,
      ok: false,
      message: rejection.message,
      computerUseSessionId: session?.computerUseSessionId ?? input.computerUseSessionId,
      targetId: rejection.targetId ?? session?.targetId ?? input.targetId,
      ...(assessedRisk ? { risk: assessedRisk } : {})
    },
    rejection
  }
}

function computerUseWorkerHealth(
  available: boolean,
  reason: string | undefined,
  recentError: string | undefined
): ComputerUseWorkerDiagnostics['health'] {
  if (!available) {
    return {
      status: 'unhealthy',
      available,
      ...(reason ? { reason } : {})
    }
  }
  if (recentError) {
    return {
      status: 'degraded',
      available,
      reason: reason ?? recentError
    }
  }
  return {
    status: 'healthy',
    available,
    ...(reason ? { reason } : {})
  }
}

function linkAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (!signal) return () => undefined
  if (signal.aborted) {
    controller.abort()
    return () => undefined
  }
  const abort = (): void => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatReleaseFailures(failures: Array<{ sessionId: string; message: string }>): string {
  return failures
    .map((failure) => `${failure.sessionId}: ${failure.message}`)
    .join('; ')
}
