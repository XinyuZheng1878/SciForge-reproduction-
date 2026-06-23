import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type {
  ComputerUseLease,
  ComputerUseLeaseRejection,
  ComputerUseSession,
  ComputerUseTarget
} from './contract.js'

export const COMPUTER_USE_STATUS_PATH_ENV = 'SCIFORGE_COMPUTER_USE_STATUS_PATH'
export const COMPUTER_USE_SHARED_LEASE_DIR_ENV = 'SCIFORGE_COMPUTER_USE_SHARED_LEASE_DIR'

type FileLeaseRecord = {
  version: 1
  lease: ComputerUseLease
  targetTitle: string
  pid: number
  serverId: string
  updatedAt: string
}

export type SharedLeaseAcquireResult =
  | { ok: true; lease: ComputerUseLease }
  | { ok: false; rejection: ComputerUseLeaseRejection }

export interface ComputerUseSharedLeaseCoordinator {
  acquire(lease: ComputerUseLease, target: ComputerUseTarget): Promise<SharedLeaseAcquireResult>
  refresh(session: ComputerUseSession): Promise<SharedLeaseAcquireResult>
  release(sessionId: string): Promise<void>
  activeLeases(): Promise<ComputerUseLease[]>
  recentRejections(): ComputerUseLeaseRejection[]
}

export class NoopComputerUseSharedLeaseCoordinator implements ComputerUseSharedLeaseCoordinator {
  async acquire(lease: ComputerUseLease): Promise<SharedLeaseAcquireResult> {
    return { ok: true, lease }
  }

  async refresh(session: ComputerUseSession): Promise<SharedLeaseAcquireResult> {
    return {
      ok: true,
      lease: {
        leaseId: `noop-${session.computerUseSessionId}`,
        computerUseSessionId: session.computerUseSessionId,
        agentId: session.agentId,
        threadId: session.threadId,
        ...(session.turnId ? { turnId: session.turnId } : {}),
        targetId: session.targetId ?? 'unbound',
        backend: session.backend,
        ...(session.inputIsolation ? { inputIsolation: session.inputIsolation } : {}),
        ...(typeof session.affectsUserInput === 'boolean' ? { affectsUserInput: session.affectsUserInput } : {}),
        ...(typeof session.requiresHostFocus === 'boolean' ? { requiresHostFocus: session.requiresHostFocus } : {}),
        ...(typeof session.usesHostClipboard === 'boolean' ? { usesHostClipboard: session.usesHostClipboard } : {}),
        acquiredAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    }
  }

  async release(): Promise<void> {}

  async activeLeases(): Promise<ComputerUseLease[]> {
    return []
  }

  recentRejections(): ComputerUseLeaseRejection[] {
    return []
  }
}

export type FileComputerUseSharedLeaseCoordinatorOptions = {
  leaseDir: string
  nowIso?: () => string
  pid?: number
  serverId?: string
}

export class FileComputerUseSharedLeaseCoordinator implements ComputerUseSharedLeaseCoordinator {
  private readonly nowIso: () => string
  private readonly pid: number
  private readonly serverId: string
  private readonly recent: ComputerUseLeaseRejection[] = []

  constructor(private readonly options: FileComputerUseSharedLeaseCoordinatorOptions) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.pid = options.pid ?? process.pid
    this.serverId = options.serverId ?? process.env.SCIFORGE_COMPUTER_USE_SERVER_ID ?? `pid-${this.pid}`
  }

  async acquire(lease: ComputerUseLease, target: ComputerUseTarget): Promise<SharedLeaseAcquireResult> {
    await mkdir(this.options.leaseDir, { recursive: true })
    const lockDir = this.lockDir(sharedLeaseKey({
      targetId: target.id,
      sessionId: lease.computerUseSessionId,
      agentId: lease.agentId,
      threadId: lease.threadId,
      inputIsolation: target.inputIsolation ?? lease.inputIsolation
    }))
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await mkdir(lockDir)
        await this.writeRecord(lockDir, lease, target.title)
        return { ok: true, lease }
      } catch (error) {
        if (!isErrno(error) || error.code !== 'EEXIST') throw error
      }

      const existing = await this.readRecord(lockDir)
      if (!existing || !isLeaseOwnerAlive(existing)) {
        await rm(lockDir, { recursive: true, force: true })
        continue
      }
      if (
        existing.lease.computerUseSessionId === lease.computerUseSessionId &&
        existing.lease.agentId === lease.agentId &&
        existing.lease.threadId === lease.threadId
      ) {
        await this.writeRecord(lockDir, {
          ...existing.lease,
          ...lease,
          updatedAt: this.nowIso()
        }, target.title)
        return { ok: true, lease }
      }

      const rejection: ComputerUseLeaseRejection = {
        code: 'target_in_use',
        targetId: target.id,
        activeLease: existing.lease,
        message:
          `computer-use target "${target.title}" is already leased by ` +
          `agent ${existing.lease.agentId} in session ${existing.lease.computerUseSessionId}`
      }
      this.remember(rejection)
      return { ok: false, rejection }
    }

    return this.acquire(lease, target)
  }

  async refresh(session: ComputerUseSession): Promise<SharedLeaseAcquireResult> {
    if (!session.targetId) {
      return {
        ok: false,
        rejection: {
          code: 'invalid_request',
          message: `computer-use session ${session.computerUseSessionId} does not hold an active target lease`
        }
      }
    }
    const lockDir = this.lockDir(sharedLeaseKey({
      targetId: session.targetId,
      sessionId: session.computerUseSessionId,
      agentId: session.agentId,
      threadId: session.threadId,
      inputIsolation: session.inputIsolation
    }))
    const existing = await this.readRecord(lockDir)
    if (!existing || !isLeaseOwnerAlive(existing)) {
      const lease: ComputerUseLease = {
        leaseId: `shared-${session.computerUseSessionId}`,
        computerUseSessionId: session.computerUseSessionId,
        agentId: session.agentId,
        threadId: session.threadId,
        ...(session.turnId ? { turnId: session.turnId } : {}),
        targetId: session.targetId,
        backend: session.backend,
        ...(session.inputIsolation ? { inputIsolation: session.inputIsolation } : {}),
        ...(typeof session.affectsUserInput === 'boolean' ? { affectsUserInput: session.affectsUserInput } : {}),
        ...(typeof session.requiresHostFocus === 'boolean' ? { requiresHostFocus: session.requiresHostFocus } : {}),
        ...(typeof session.usesHostClipboard === 'boolean' ? { usesHostClipboard: session.usesHostClipboard } : {}),
        acquiredAt: session.createdAt,
        updatedAt: this.nowIso()
      }
      return this.acquire(lease, {
        id: session.targetId,
        kind: targetKindFromId(session.targetId),
        title: session.targetId,
        backend: session.backend,
        ...(session.inputIsolation ? { inputIsolation: session.inputIsolation } : {}),
        ...(typeof session.affectsUserInput === 'boolean' ? { affectsUserInput: session.affectsUserInput } : {}),
        ...(typeof session.requiresHostFocus === 'boolean' ? { requiresHostFocus: session.requiresHostFocus } : {}),
        ...(typeof session.usesHostClipboard === 'boolean' ? { usesHostClipboard: session.usesHostClipboard } : {})
      })
    }
    if (
      existing.lease.computerUseSessionId !== session.computerUseSessionId ||
      existing.lease.agentId !== session.agentId ||
      existing.lease.threadId !== session.threadId
    ) {
      const rejection: ComputerUseLeaseRejection = {
        code: 'target_in_use',
        targetId: session.targetId,
        activeLease: existing.lease,
        message:
          `computer-use target "${session.targetId}" is already leased by ` +
          `agent ${existing.lease.agentId} in session ${existing.lease.computerUseSessionId}`
      }
      this.remember(rejection)
      return { ok: false, rejection }
    }
    const lease = {
      ...existing.lease,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      updatedAt: this.nowIso()
    }
    await this.writeRecord(lockDir, lease, session.targetId)
    return { ok: true, lease }
  }

  async release(sessionId: string): Promise<void> {
    for (const entry of await this.lockEntries()) {
      await this.releaseLockIfOwned(join(this.options.leaseDir, entry), sessionId)
    }
  }

  async activeLeases(): Promise<ComputerUseLease[]> {
    const leases: ComputerUseLease[] = []
    for (const entry of await this.lockEntries()) {
      const lockDir = join(this.options.leaseDir, entry)
      const record = await this.readRecord(lockDir)
      if (!record) continue
      if (!isLeaseOwnerAlive(record)) {
        await rm(lockDir, { recursive: true, force: true })
        continue
      }
      leases.push(record.lease)
    }
    return leases
  }

  recentRejections(): ComputerUseLeaseRejection[] {
    return [...this.recent]
  }

  private async releaseLockIfOwned(lockDir: string, sessionId: string): Promise<void> {
    const record = await this.readRecord(lockDir)
    if (record?.lease.computerUseSessionId === sessionId) {
      await rm(lockDir, { recursive: true, force: true })
    }
  }

  private async lockEntries(): Promise<string[]> {
    try {
      return await readdir(this.options.leaseDir)
    } catch (error) {
      if (isErrno(error) && error.code === 'ENOENT') return []
      throw error
    }
  }

  private lockDir(targetId: string): string {
    return join(this.options.leaseDir, targetIdToLockName(targetId))
  }

  private async readRecord(lockDir: string): Promise<FileLeaseRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(join(lockDir, 'lease.json'), 'utf8')) as FileLeaseRecord
      if (!parsed || parsed.version !== 1 || !parsed.lease?.computerUseSessionId) return null
      return parsed
    } catch (error) {
      if (isErrno(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null
      return null
    }
  }

  private async writeRecord(lockDir: string, lease: ComputerUseLease, targetTitle: string): Promise<void> {
    const record: FileLeaseRecord = {
      version: 1,
      lease: {
        ...lease,
        updatedAt: this.nowIso()
      },
      targetTitle,
      pid: this.pid,
      serverId: this.serverId,
      updatedAt: this.nowIso()
    }
    await writeFile(join(lockDir, 'lease.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  private remember(rejection: ComputerUseLeaseRejection): void {
    this.recent.push(rejection)
    if (this.recent.length > 20) this.recent.shift()
  }
}

function targetKindFromId(targetId: string): ComputerUseTarget['kind'] {
  if (targetId.startsWith('window:') || targetId.startsWith('mac-app-scoped:window:')) return 'window'
  if (targetId.startsWith('app:') || targetId.startsWith('mac-app-scoped:app:')) return 'app'
  return 'desktop'
}

export function defaultSharedLeaseCoordinatorFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ComputerUseSharedLeaseCoordinator {
  const explicit = env[COMPUTER_USE_SHARED_LEASE_DIR_ENV]
  const statusPath = env[COMPUTER_USE_STATUS_PATH_ENV]
  const leaseDir = explicit || (statusPath ? join(dirname(statusPath), 'leases') : '')
  return leaseDir
    ? new FileComputerUseSharedLeaseCoordinator({ leaseDir })
    : new NoopComputerUseSharedLeaseCoordinator()
}

function targetIdToLockName(targetId: string): string {
  return Buffer.from(targetId).toString('base64url')
}

function sharedLeaseKey(input: {
  targetId: string
  sessionId: string
  agentId: string
  threadId: string
  inputIsolation: ComputerUseTarget['inputIsolation']
}): string {
  return input.inputIsolation === 'agent-isolated'
    ? `${input.targetId}#${input.agentId}#${input.threadId}#${input.sessionId}`
    : input.targetId
}

function isLeaseOwnerAlive(record: FileLeaseRecord): boolean {
  if (!Number.isFinite(record.pid) || record.pid <= 0) return false
  if (record.pid === process.pid) return true
  try {
    process.kill(record.pid, 0)
    return true
  } catch (error) {
    if (isErrno(error) && error.code === 'ESRCH') return false
    return true
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}
