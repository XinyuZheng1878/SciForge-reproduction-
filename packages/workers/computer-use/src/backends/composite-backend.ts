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
import { createBrowserCdpComputerUseBackend } from './browser-cdp-backend.js'
import {
  createGlobalNativeComputerUseBackend,
  type GlobalNativeComputerUseBackendOptions
} from './global-native-backend.js'
import {
  createMacAppScopedComputerUseBackend,
  isMacAppScopedTargetId
} from './mac-app-scoped-backend.js'

export type CompositeComputerUseBackendOptions = GlobalNativeComputerUseBackendOptions & {
  browserCdp?: ComputerUseBackend
  globalNative?: ComputerUseBackend
  macAppScoped?: ComputerUseBackend
  enableHostInputBackends?: boolean
}

export class CompositeComputerUseBackend implements ComputerUseBackend {
  readonly kind: ComputerUseBackendKind = 'browser-cdp'
  private readonly browserCdp: ComputerUseBackend
  private readonly globalNative?: ComputerUseBackend
  private readonly macAppScoped?: ComputerUseBackend
  private readonly enableHostInputBackends: boolean

  constructor(options: CompositeComputerUseBackendOptions = {}) {
    this.browserCdp = options.browserCdp ?? createBrowserCdpComputerUseBackend()
    this.enableHostInputBackends = options.enableHostInputBackends ?? process.env.SCIFORGE_COMPUTER_USE_ENABLE_HOST_INPUT === '1'
    if (this.enableHostInputBackends) {
      this.globalNative = options.globalNative ?? createGlobalNativeComputerUseBackend(options)
      this.macAppScoped = options.macAppScoped ?? createMacAppScopedComputerUseBackend({
        fallbackBackend: this.globalNative
      })
    }
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    const isolatedTargets = await this.browserCdp.listTargets()
    if (!this.enableHostInputBackends || !this.globalNative || !this.macAppScoped) return isolatedTargets
    const [globalTargets, scopedTargets] = await Promise.all([
      this.globalNative.listTargets(),
      this.macAppScoped.listTargets()
    ])
    return [...isolatedTargets, ...globalTargets, ...scopedTargets]
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    return this.backendFor(session.backend, targetId).bindTarget(session, targetId)
  }

  async releaseTarget(sessionId: string, reason?: string): Promise<ComputerUseSession | null> {
    const released = await Promise.all([
      this.browserCdp.releaseTarget(sessionId, reason),
      ...(this.globalNative && this.macAppScoped
        ? [
            this.globalNative.releaseTarget(sessionId, reason),
            this.macAppScoped.releaseTarget(sessionId, reason)
          ]
        : [])
    ])
    return released.find(Boolean) ?? null
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    return this.backendFor(session.backend, session.targetId ?? input.targetId).executeAction(session, input)
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    const isolatedDiagnostic = await this.browserCdp.diagnostics()
    if (!this.enableHostInputBackends || !this.globalNative || !this.macAppScoped) return isolatedDiagnostic
    const [globalDiagnostic, scopedDiagnostic] = await Promise.all([
      this.globalNative.diagnostics(),
      this.macAppScoped.diagnostics()
    ])
    return {
      ...isolatedDiagnostic,
      available: isolatedDiagnostic.available || globalDiagnostic.available || scopedDiagnostic.available,
      reason: isolatedDiagnostic.reason ?? globalDiagnostic.reason ?? scopedDiagnostic.reason,
      activeLeases: [
        ...isolatedDiagnostic.activeLeases,
        ...globalDiagnostic.activeLeases,
        ...scopedDiagnostic.activeLeases
      ],
      recentRejections: [
        ...isolatedDiagnostic.recentRejections,
        ...globalDiagnostic.recentRejections,
        ...scopedDiagnostic.recentRejections
      ].slice(-20),
      recentError: isolatedDiagnostic.recentError ?? globalDiagnostic.recentError ?? scopedDiagnostic.recentError
    }
  }

  private backendFor(kind: ComputerUseBackendKind, targetId?: string): ComputerUseBackend {
    if (kind === 'browser-cdp' || targetId === 'browser-cdp:isolated-browser') return this.browserCdp
    if (!this.enableHostInputBackends || !this.globalNative || !this.macAppScoped) return this.browserCdp
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
