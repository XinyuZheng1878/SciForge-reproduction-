import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackend,
  ComputerUseBackendDiagnostic,
  ComputerUseBackendKind,
  ComputerUseBindResult,
  ComputerUseLease,
  ComputerUseLeaseRejection,
  ComputerUseReleaseReason,
  ComputerUseSession,
  ComputerUseTarget
} from '../contract.js'
import { createGlobalNativeComputerUseBackend } from './global-native-backend.js'

type MacScopedTargetDescriptor = ComputerUseTarget & {
  appName: string
  windowIndex?: number
}

export interface MacAppScopedTargetProvider {
  listTargets(): Promise<MacScopedTargetDescriptor[]>
  activateTarget(target: MacScopedTargetDescriptor): Promise<void>
  diagnostics?(): Promise<{ available: boolean; reason?: string }>
}

export type MacAppScopedComputerUseBackendOptions = {
  platform?: NodeJS.Platform
  targetProvider?: MacAppScopedTargetProvider
  fallbackBackend?: ComputerUseBackend
  nowIso?: () => string
}

const execFileAsync = promisify(execFile)
const KIND: ComputerUseBackendKind = 'mac-app-scoped'
const UNSUPPORTED_PLATFORM_REASON =
  'mac-app-scoped computer use is only available on macOS.'
const NO_TARGETS_REASON =
  'mac-app-scoped computer use could not discover accessible macOS app/window targets.'
const DELEGATE_REASON =
  'mac-app-scoped actions are executed through the protected global-native backend after activating the selected app/window target.'
const TARGET_PREFIX = 'mac-app-scoped:'

export class MacAppScopedComputerUseBackend implements ComputerUseBackend {
  readonly kind = KIND
  private readonly platform: NodeJS.Platform
  private readonly provider: MacAppScopedTargetProvider
  private readonly fallbackBackend: ComputerUseBackend
  private readonly nowIso: () => string
  private readonly recentRejections: ComputerUseLeaseRejection[] = []
  private readonly boundSessions = new Map<string, ComputerUseSession>()
  private readonly targetsById = new Map<string, MacScopedTargetDescriptor>()
  private actionQueue: Promise<void> = Promise.resolve()
  private recentError?: string
  private lastDiscoveryReason?: string

  constructor(options: MacAppScopedComputerUseBackendOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.provider = options.targetProvider ?? new DarwinSystemEventsTargetProvider(this.platform)
    this.fallbackBackend = options.fallbackBackend ?? createGlobalNativeComputerUseBackend()
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    if (this.platform !== 'darwin') {
      this.lastDiscoveryReason = UNSUPPORTED_PLATFORM_REASON
      return []
    }
    try {
      const targets = dedupeTargets(await this.provider.listTargets())
      this.targetsById.clear()
      for (const target of targets) this.targetsById.set(target.id, target)
      this.lastDiscoveryReason = targets.length > 0 ? undefined : NO_TARGETS_REASON
      return targets.map(withHostAppScopedMetadata)
    } catch (error) {
      const message = errorMessage(error)
      this.recentError = message
      this.lastDiscoveryReason = message
      return []
    }
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    const target = await this.findTarget(targetId)
    if (!target) {
      const rejection = this.remember({
        code: this.platform === 'darwin' ? 'target_not_found' : 'backend_unavailable',
        targetId,
        message: this.lastDiscoveryReason ?? `mac-app-scoped target "${targetId}" was not found`
      })
      return {
        ok: false,
        session: {
          ...session,
          targetId,
          backend: this.kind,
          leaseState: 'rejected',
          cursor: session.cursor ?? { x: 0, y: 0 },
          updatedAt: this.nowIso()
        },
        rejection
      }
    }

    const now = this.nowIso()
    const bound: ComputerUseSession = {
      ...session,
      targetId,
      backend: this.kind,
      leaseState: 'active',
      cursor: session.cursor ?? { x: 0, y: 0 },
      updatedAt: now
    }
    this.boundSessions.set(session.computerUseSessionId, bound)
    return {
      ok: true,
      session: bound,
      target,
      lease: this.leaseFor(bound, now)
    }
  }

  async releaseTarget(sessionId: string, reason: ComputerUseReleaseReason = 'agent_release'): Promise<ComputerUseSession | null> {
    const session = this.boundSessions.get(sessionId)
    if (!session) return null
    this.boundSessions.delete(sessionId)
    const now = this.nowIso()
    return {
      ...session,
      leaseState: 'released',
      releaseReason: reason,
      releasedAt: now,
      updatedAt: now
    }
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    const targetId = session.targetId ?? input.targetId
    if (!targetId) {
      return this.actionFailure(session, input, 'invalid_request', 'mac-app-scoped action requires an active target lease')
    }
    const target = await this.findTarget(targetId)
    if (!target) {
      return this.actionFailure(session, input, 'target_not_found', this.lastDiscoveryReason ?? `mac-app-scoped target "${targetId}" was not found`)
    }

    return await this.withActionQueue(async () => {
      try {
        await this.provider.activateTarget(target)
        const delegated = await this.fallbackBackend.executeAction(
          {
            ...session,
            backend: 'global-native',
            targetId
          },
          {
            ...input,
            targetId,
            computerUseSessionId: session.computerUseSessionId
          }
        )
        if (delegated.ok) {
          this.updateCursor(
            session.computerUseSessionId,
            input,
            delegated.output.kind === 'computer_action' ? delegated.output.cursor : undefined
          )
        } else {
          this.remember(delegated.rejection)
        }
        return delegated
      } catch (error) {
        const message = errorMessage(error)
        this.recentError = message
        return this.actionFailure(session, input, 'backend_unavailable', message)
      }
    })
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    const providerStatus = this.platform === 'darwin'
      ? await this.provider.diagnostics?.().catch((error) => ({ available: false, reason: errorMessage(error) }))
      : { available: false, reason: UNSUPPORTED_PLATFORM_REASON }
    let fallback: ComputerUseBackendDiagnostic
    try {
      fallback = await this.fallbackBackend.diagnostics()
    } catch (error) {
      fallback = {
        backend: 'global-native',
        available: false,
        platform: this.platform,
        reason: errorMessage(error),
        activeLeases: [],
        recentRejections: []
      }
    }
    const providerAvailable = providerStatus?.available ?? this.platform === 'darwin'
    const available = providerAvailable && fallback.available
    const reason = available
      ? DELEGATE_REASON
      : providerStatus?.available === false
        ? providerStatus.reason ?? this.lastDiscoveryReason
        : fallback.reason ?? this.lastDiscoveryReason
    return {
      backend: this.kind,
      available,
      platform: this.platform,
      inputIsolation: 'host-app-scoped',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true,
      ...(reason ? { reason } : {}),
      activeLeases: [
        ...[...this.boundSessions.values()].map((session) => this.leaseFor(session, session.updatedAt)),
        ...fallback.activeLeases.filter((lease) => lease.backend !== this.kind)
      ],
      recentRejections: [
        ...this.recentRejections,
        ...fallback.recentRejections
      ].slice(-20),
      ...(this.recentError ?? fallback.recentError ? { recentError: this.recentError ?? fallback.recentError } : {})
    }
  }

  private async findTarget(targetId: string): Promise<MacScopedTargetDescriptor | undefined> {
    const cached = this.targetsById.get(targetId)
    if (cached) return cached
    await this.listTargets()
    return this.targetsById.get(targetId)
  }

  private leaseFor(session: ComputerUseSession, updatedAt: string): ComputerUseLease {
    return {
      leaseId: `backend_${session.computerUseSessionId}`,
      computerUseSessionId: session.computerUseSessionId,
      agentId: session.agentId,
      threadId: session.threadId,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      targetId: session.targetId ?? `${TARGET_PREFIX}unbound`,
      backend: this.kind,
      inputIsolation: 'host-app-scoped',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true,
      acquiredAt: session.createdAt,
      updatedAt
    }
  }

  private updateCursor(sessionId: string, input: ComputerUseActionRequest, cursor?: [number, number]): void {
    const session = this.boundSessions.get(sessionId)
    if (!session) return
    const nextCursor = cursor
      ? { x: cursor[0], y: cursor[1] }
      : typeof input.x === 'number' && typeof input.y === 'number'
        ? { x: input.x, y: input.y }
        : undefined
    if (!nextCursor) return
    this.boundSessions.set(sessionId, {
      ...session,
      cursor: nextCursor,
      updatedAt: this.nowIso()
    })
  }

  private actionFailure(
    session: ComputerUseSession,
    input: ComputerUseActionRequest,
    code: ComputerUseLeaseRejection['code'],
    message: string
  ): ComputerUseActionResult {
    const rejection = this.remember({
      code,
      targetId: session.targetId ?? input.targetId,
      message
    })
    return {
      ok: false,
      rejection,
      output: {
        kind: 'computer_action',
        action: input.action,
        ok: false,
        message,
        computerUseSessionId: session.computerUseSessionId,
        targetId: session.targetId ?? input.targetId
      }
    }
  }

  private remember(rejection: ComputerUseLeaseRejection): ComputerUseLeaseRejection {
    this.recentRejections.push(rejection)
    if (this.recentRejections.length > 20) this.recentRejections.shift()
    return rejection
  }

  private async withActionQueue<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.actionQueue
    let release!: () => void
    this.actionQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

export class DarwinSystemEventsTargetProvider implements MacAppScopedTargetProvider {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async listTargets(): Promise<MacScopedTargetDescriptor[]> {
    if (this.platform !== 'darwin') return []
    const { stdout } = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', LIST_TARGETS_SCRIPT], {
      timeout: 5_000,
      maxBuffer: 1_000_000
    })
    const parsed = JSON.parse(stdout || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => normalizeRawTarget(entry))
  }

  async activateTarget(target: MacScopedTargetDescriptor): Promise<void> {
    if (this.platform !== 'darwin') throw new Error(UNSUPPORTED_PLATFORM_REASON)
    await execFileAsync('osascript', ['-l', 'JavaScript', '-e', activateScriptForTarget(target)], {
      timeout: 3_000,
      maxBuffer: 200_000
    })
  }

  async diagnostics(): Promise<{ available: boolean; reason?: string }> {
    if (this.platform !== 'darwin') return { available: false, reason: UNSUPPORTED_PLATFORM_REASON }
    try {
      await execFileAsync('osascript', ['-e', 'return "ok"'], { timeout: 2_000, maxBuffer: 20_000 })
      return { available: true, reason: DELEGATE_REASON }
    } catch (error) {
      return { available: false, reason: errorMessage(error) }
    }
  }
}

export function createMacAppScopedComputerUseBackend(
  options: MacAppScopedComputerUseBackendOptions = {}
): MacAppScopedComputerUseBackend {
  return new MacAppScopedComputerUseBackend(options)
}

export function isMacAppScopedTargetId(targetId: string | undefined): boolean {
  return typeof targetId === 'string' && targetId.startsWith(TARGET_PREFIX)
}

function normalizeRawTarget(value: unknown): MacScopedTargetDescriptor[] {
  if (!isRecord(value)) return []
  const appName = stringField(value.appName)
  if (!appName) return []
  const pid = numberField(value.pid)
  const processKey = pid !== undefined ? `pid-${pid}` : slug(appName)
  const appTarget: MacScopedTargetDescriptor = {
    id: `${TARGET_PREFIX}app:${processKey}`,
    kind: 'app',
    title: appName,
    appName,
    ...(pid !== undefined ? { pid } : {}),
    backend: KIND,
    inputIsolation: 'host-app-scoped',
    affectsUserInput: true,
    requiresHostFocus: true,
    usesHostClipboard: true
  }
  const windows = Array.isArray(value.windows) ? value.windows : []
  const windowTargets = windows.flatMap((entry, index): MacScopedTargetDescriptor[] => {
    if (!isRecord(entry)) return []
    const windowIndex = numberField(entry.index) ?? index + 1
    const windowTitle = stringField(entry.title) ?? `Window ${windowIndex}`
    return [{
      id: `${TARGET_PREFIX}window:${processKey}:${windowIndex}`,
      kind: 'window',
      title: `${appName}: ${windowTitle}`,
      appName,
      ...(pid !== undefined ? { pid } : {}),
      windowId: `${processKey}:${windowIndex}`,
      windowIndex,
      backend: KIND,
      inputIsolation: 'host-app-scoped',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true
    }]
  })
  return [appTarget, ...windowTargets]
}

function withHostAppScopedMetadata<T extends ComputerUseTarget>(target: T): T {
  return {
    ...target,
    inputIsolation: 'host-app-scoped',
    affectsUserInput: true,
    requiresHostFocus: true,
    usesHostClipboard: true
  }
}

function dedupeTargets(targets: MacScopedTargetDescriptor[]): MacScopedTargetDescriptor[] {
  const seen = new Set<string>()
  const out: MacScopedTargetDescriptor[] = []
  for (const target of targets) {
    if (seen.has(target.id)) continue
    seen.add(target.id)
    out.push(target)
  }
  return out
}

function activateScriptForTarget(target: MacScopedTargetDescriptor): string {
  return `
const target = ${JSON.stringify({ appName: target.appName, windowIndex: target.windowIndex })};
const current = Application.currentApplication();
current.includeStandardAdditions = true;
const sys = Application('System Events');
const matches = sys.processes.whose({ name: target.appName })();
if (!matches.length) throw new Error('target app is not running: ' + target.appName);
try { Application(target.appName).activate(); } catch (_) {}
const proc = matches[0];
try { proc.frontmost = true; } catch (_) {}
if (target.windowIndex) {
  const windows = proc.windows();
  const win = windows[target.windowIndex - 1];
  if (!win) throw new Error('target window is no longer available: ' + target.appName + ' #' + target.windowIndex);
  try {
    win.actions.byName('AXRaise').perform();
  } catch (_) {
    try { win.attributes.byName('AXMain').value = true; } catch (_) {}
  }
}
try { current.delay(0.08); } catch (_) {}
`
}

const LIST_TARGETS_SCRIPT = `
const sys = Application('System Events');
function value(fn, fallback) {
  try {
    const result = fn();
    return result === undefined || result === null ? fallback : result;
  } catch (_) {
    return fallback;
  }
}
function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
const out = [];
const processes = value(() => sys.processes.whose({ backgroundOnly: false })(), []);
for (const proc of processes) {
  const appName = String(value(() => proc.name(), '') || '').trim();
  if (!appName) continue;
  const pid = asNumber(value(() => proc.unixId(), undefined));
  const windows = value(() => proc.windows(), []);
  const record = { appName, pid, windows: [] };
  for (let index = 0; index < windows.length; index += 1) {
    const win = windows[index];
    const title = String(value(() => win.name(), '') || '').trim() || ('Window ' + (index + 1));
    record.windows.push({ index: index + 1, title });
  }
  out.push(record);
}
JSON.stringify(out);
`

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function slug(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'unknown'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
