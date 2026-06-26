import { basename, dirname, resolve } from 'node:path'
import type {
  ComputerUseBackendDiagnostic,
  ComputerUseLease,
  ComputerUseLeaseRejection
} from '../../../packages/workers/computer-use/src/contract'
import {
  atomicWriteAppDataJson,
  atomicWriteAppDataJsonAtPath,
  readAppDataStoreText,
  readAppDataStoreTextAtPath
} from './app-data-store'

export type ComputerUseStatusServer = ComputerUseBackendDiagnostic & {
  serverId: string
  pid: number
  updatedAt: string
}

export type ComputerUseRuntimeStatus = {
  updatedAt: string
  servers: ComputerUseStatusServer[]
  activeLeases: ComputerUseLease[]
  recentRejections: ComputerUseLeaseRejection[]
  backend: ComputerUseBackendDiagnostic | null
}

type ComputerUseStatusFile = {
  version: 1
  servers: Record<string, ComputerUseStatusServer>
}

const COMPUTER_USE_STATUS_STORE = ['computer-use', 'status.json'] as const

export function emptyComputerUseRuntimeStatus(): ComputerUseRuntimeStatus {
  return {
    updatedAt: new Date(0).toISOString(),
    servers: [],
    activeLeases: [],
    recentRejections: [],
    backend: null
  }
}

export async function readComputerUseRuntimeStatus(path: string): Promise<ComputerUseRuntimeStatus> {
  const file = await readStatusFile(path)
  if (!file) return emptyComputerUseRuntimeStatus()
  const servers = Object.values(file.servers)
    .filter(isFreshServer)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const backend = servers[0] ? backendSummary(servers[0], servers) : null
  return {
    updatedAt: servers[0]?.updatedAt ?? new Date(0).toISOString(),
    servers,
    activeLeases: servers.flatMap((server) => server.activeLeases),
    recentRejections: servers.flatMap((server) => server.recentRejections).slice(-20),
    backend
  }
}

export async function recordComputerUseDiagnostic(
  path: string | undefined,
  diagnostic: ComputerUseBackendDiagnostic
): Promise<void> {
  if (!path) return
  const now = new Date().toISOString()
  const serverId = process.env.SCIFORGE_COMPUTER_USE_SERVER_ID || `pid-${process.pid}`
  const current = await readStatusFile(path) ?? { version: 1 as const, servers: {} }
  current.servers[serverId] = {
    ...diagnostic,
    serverId,
    pid: process.pid,
    updatedAt: now
  }
  const store = computerUseStatusStore(path)
  if (store) {
    await atomicWriteAppDataJson(store.rootDir, COMPUTER_USE_STATUS_STORE, current, { trailingNewline: true })
    return
  }
  await atomicWriteAppDataJsonAtPath(path, current, { trailingNewline: true })
}

async function readStatusFile(path: string): Promise<ComputerUseStatusFile | null> {
  let raw = ''
  try {
    const store = computerUseStatusStore(path)
    raw = store
      ? await readAppDataStoreText(store.rootDir, COMPUTER_USE_STATUS_STORE)
      : await readAppDataStoreTextAtPath(path)
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') return null
    throw error
  }
  try {
    const parsed = JSON.parse(raw) as ComputerUseStatusFile
    if (!parsed || parsed.version !== 1 || !parsed.servers || typeof parsed.servers !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function computerUseStatusStore(path: string): { rootDir: string } | null {
  const resolved = resolve(path)
  if (basename(resolved) !== 'status.json' || basename(dirname(resolved)) !== 'computer-use') return null
  return { rootDir: dirname(dirname(resolved)) }
}

function isFreshServer(server: ComputerUseStatusServer): boolean {
  const updatedAt = Date.parse(server.updatedAt)
  if (!Number.isFinite(updatedAt)) return false
  return Date.now() - updatedAt < 10 * 60 * 1000
}

function backendSummary(
  primary: ComputerUseStatusServer,
  servers: ComputerUseStatusServer[]
): ComputerUseBackendDiagnostic {
  return {
    backend: primary.backend,
    available: servers.some((server) => server.available),
    platform: primary.platform,
    reason: primary.reason,
    activeLeases: servers.flatMap((server) => server.activeLeases),
    recentRejections: servers.flatMap((server) => server.recentRejections).slice(-20),
    recentError: primary.recentError
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}
