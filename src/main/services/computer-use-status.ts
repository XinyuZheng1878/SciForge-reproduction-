import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  ComputerUseBackendDiagnostic,
  ComputerUseLease,
  ComputerUseLeaseRejection
} from '../../../packages/workers/computer-use/src/contract'

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
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
}

async function readStatusFile(path: string): Promise<ComputerUseStatusFile | null> {
  let raw = ''
  try {
    raw = await readFile(path, 'utf8')
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
