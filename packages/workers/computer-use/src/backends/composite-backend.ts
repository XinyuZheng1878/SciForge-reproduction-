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
import {
  createGlobalNativeComputerUseBackend,
  type GlobalNativeComputerUseBackendOptions
} from './global-native-backend.js'
import {
  createMacAppScopedComputerUseBackend,
  isMacAppScopedTargetId
} from './mac-app-scoped-backend.js'

export type CompositeComputerUseBackendOptions = GlobalNativeComputerUseBackendOptions & {
  globalNative?: ComputerUseBackend
  macAppScoped?: ComputerUseBackend
}

export class CompositeComputerUseBackend implements ComputerUseBackend {
  readonly kind: ComputerUseBackendKind = 'global-native'
  private readonly globalNative: ComputerUseBackend
  private readonly macAppScoped: ComputerUseBackend

  constructor(options: CompositeComputerUseBackendOptions = {}) {
    this.globalNative = options.globalNative ?? createGlobalNativeComputerUseBackend(options)
    this.macAppScoped = options.macAppScoped ?? createMacAppScopedComputerUseBackend({
      fallbackBackend: this.globalNative
    })
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    const [globalTargets, scopedTargets] = await Promise.all([
      this.globalNative.listTargets(),
      this.macAppScoped.listTargets()
    ])
    return [...globalTargets, ...scopedTargets]
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    return this.backendFor(session.backend, targetId).bindTarget(session, targetId)
  }

  async releaseTarget(sessionId: string, reason?: string): Promise<ComputerUseSession | null> {
    await Promise.all([
      this.globalNative.releaseTarget(sessionId, reason),
      this.macAppScoped.releaseTarget(sessionId, reason)
    ])
    return null
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    return this.backendFor(session.backend, session.targetId ?? input.targetId).executeAction(session, input)
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    const [globalDiagnostic, scopedDiagnostic] = await Promise.all([
      this.globalNative.diagnostics(),
      this.macAppScoped.diagnostics()
    ])
    return {
      ...globalDiagnostic,
      reason: globalDiagnostic.reason ?? scopedDiagnostic.reason,
      activeLeases: [
        ...globalDiagnostic.activeLeases,
        ...scopedDiagnostic.activeLeases
      ],
      recentRejections: [
        ...globalDiagnostic.recentRejections,
        ...scopedDiagnostic.recentRejections
      ].slice(-20),
      recentError: globalDiagnostic.recentError ?? scopedDiagnostic.recentError
    }
  }

  private backendFor(kind: ComputerUseBackendKind, targetId?: string): ComputerUseBackend {
    if (kind === 'mac-app-scoped' || isMacAppScopedTargetId(targetId)) {
      return this.macAppScoped
    }
    return this.globalNative
  }
}

export function createCompositeComputerUseBackend(
  options: CompositeComputerUseBackendOptions = {}
): CompositeComputerUseBackend {
  return new CompositeComputerUseBackend(options)
}
