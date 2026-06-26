import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type {
  PaperRadarApiResult,
  PaperRadarArxivSyncInput,
  PaperRadarBiorxivSyncInput,
  PaperRadarDigestInput,
  PaperRadarDigestResult,
  PaperRadarProfile,
  PaperRadarProfileListResult,
  PaperRadarProfileSaveResult,
  PaperRadarProfileSyncInput,
  PaperRadarProfileSyncResult,
  PaperRadarRankInput,
  PaperRadarRankResult,
  PaperRadarSearchInput,
  PaperRadarSearchResult,
  PaperRadarStatus,
  PaperRadarSyncResult
} from '../shared/paper-radar'

const DEFAULT_BASE_URL = 'http://127.0.0.1:3901'
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const SYNC_REQUEST_TIMEOUT_MS = 120_000
const SIDECAR_READY_TIMEOUT_MS = 12_000
const PAPER_RADAR_SERVICE_ID = 'sciforge.paper-radar'
const PAPER_RADAR_RUNTIME_TOKEN_BYTES = 32

let paperRadarChild: ChildProcess | null = null
let paperRadarLaunchSignature: string | null = null
let paperRadarReadyPromise: Promise<void> | null = null
let generatedPaperRadarRuntimeToken: string | null = null

export type PaperRadarLaunch = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  baseUrl: string
  dbPath: string
  profilesPath: string
  runtimeToken: string
}

export function paperRadarBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PAPER_RADAR_SERVICE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function paperRadarDbPath(userDataDir: string): string {
  return join(userDataDir, 'paper-radar', 'paper-radar.sqlite')
}

export function paperRadarProfilesPath(userDataDir: string): string {
  return join(userDataDir, 'paper-radar', 'profiles.json')
}

export function paperRadarRuntimeToken(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.PAPER_RADAR_RUNTIME_TOKEN?.trim()
  if (configured) return configured
  generatedPaperRadarRuntimeToken ??= randomBytes(PAPER_RADAR_RUNTIME_TOKEN_BYTES).toString('base64url')
  return generatedPaperRadarRuntimeToken
}

export function isPaperRadarServiceHealth(
  health: PaperRadarStatus | null | undefined
): health is PaperRadarStatus & { ok: true; service: typeof PAPER_RADAR_SERVICE_ID } {
  return Boolean(health?.ok && health.service === PAPER_RADAR_SERVICE_ID)
}

export function buildPaperRadarLaunch(options: {
  userDataDir: string
  appRoot?: string
  env?: NodeJS.ProcessEnv
  npmCommand?: string
}): PaperRadarLaunch {
  const baseEnv = options.env ?? process.env
  const baseUrl = paperRadarBaseUrl(baseEnv)
  const port = localPortFromBaseUrl(baseUrl) ?? 3901
  const npmCommand = options.npmCommand ?? (process.platform === 'win32' ? 'cmd.exe' : 'npm')
  const npmArgsPrefix = options.npmCommand ? [] : process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd'] : []
  const dbPath = baseEnv.PAPER_RADAR_DB || paperRadarDbPath(options.userDataDir)
  const profilesPath = baseEnv.PAPER_RADAR_PROFILES || paperRadarProfilesPath(options.userDataDir)
  const runtimeToken = paperRadarRuntimeToken(baseEnv)
  return {
    command: npmCommand,
    cwd: options.appRoot ?? process.cwd(),
    args: [
      ...npmArgsPrefix,
      '--workspace',
      'sciforge-paper-radar-service',
      'run',
      'start'
    ],
    env: {
      ...baseEnv,
      PAPER_RADAR_HOST: '127.0.0.1',
      PAPER_RADAR_PORT: String(port),
      PAPER_RADAR_DB: dbPath,
      PAPER_RADAR_PROFILES: profilesPath,
      PAPER_RADAR_RUNTIME_TOKEN: runtimeToken,
      PAPER_RADAR_AUTO_SYNC: baseEnv.PAPER_RADAR_AUTO_SYNC ?? '0'
    },
    baseUrl,
    dbPath,
    profilesPath,
    runtimeToken
  }
}

export async function ensurePaperRadarSidecar(options: {
  userDataDir: string
  appRoot?: string
  env?: NodeJS.ProcessEnv
  spawnImpl?: typeof spawn
  log?: (message: string) => void
}): Promise<void> {
  const env = options.env ?? process.env
  if (env.PAPER_RADAR_AUTO_START === '0') {
    options.log?.('Paper Radar auto-start is disabled.')
    if (isPaperRadarChildRunning()) await stopPaperRadarSidecar()
    return
  }

  const launch = buildPaperRadarLaunch({
    userDataDir: options.userDataDir,
    appRoot: options.appRoot,
    env
  })
  const signature = paperRadarLaunchSignatureValue(launch)
  if (isPaperRadarChildRunning()) {
    if (paperRadarLaunchSignature === signature) {
      await (paperRadarReadyPromise ?? waitForPaperRadarHealth(launch.baseUrl, SIDECAR_READY_TIMEOUT_MS, launch.runtimeToken))
      return
    }
    options.log?.('Paper Radar sidecar launch settings changed; restarting sidecar.')
    await stopPaperRadarSidecar()
  } else {
    const health = await checkPaperRadarHealth(launch.baseUrl, launch.runtimeToken).catch(() => null)
    if (isPaperRadarServiceHealth(health)) return
  }

  const spawnImpl = options.spawnImpl ?? spawn
  options.log?.(`Starting Paper Radar sidecar from ${launch.cwd}.`)
  paperRadarChild = spawnImpl(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  paperRadarLaunchSignature = signature
  paperRadarReadyPromise = waitForPaperRadarHealth(launch.baseUrl, SIDECAR_READY_TIMEOUT_MS, launch.runtimeToken)
  const child = paperRadarChild
  attachPaperRadarChildLogging(child, options.log)
  child.once('error', (error) => {
    options.log?.(`Paper Radar sidecar failed to start: ${error.message}`)
  })
  child.once('exit', (code, signal) => {
    if (paperRadarChild !== child) return
    paperRadarChild = null
    paperRadarLaunchSignature = null
    paperRadarReadyPromise = null
    if (code !== 0 || signal) {
      options.log?.(`Paper Radar sidecar exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
    }
  })

  try {
    await paperRadarReadyPromise
  } finally {
    if (paperRadarChild === child) paperRadarReadyPromise = null
  }
}

export async function stopPaperRadarSidecar(): Promise<void> {
  const child = paperRadarChild
  if (!child) return
  paperRadarChild = null
  paperRadarLaunchSignature = null
  paperRadarReadyPromise = null
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    await killWindowsProcessTree(child.pid)
    return
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function killWindowsProcessTree(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    killer.once('error', () => resolve())
    killer.once('exit', () => resolve())
  })
}

export async function getPaperRadarStatus(baseUrl = paperRadarBaseUrl()): Promise<PaperRadarStatus> {
  try {
    return await checkPaperRadarHealth(baseUrl)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function syncPaperRadarArxiv(
  input: PaperRadarArxivSyncInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
  return paperRadarPost<PaperRadarSyncResult>(`${baseUrl}/sync/arxiv`, input, SYNC_REQUEST_TIMEOUT_MS)
}

export async function syncPaperRadarBiorxiv(
  input: PaperRadarBiorxivSyncInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
  return paperRadarPost<PaperRadarSyncResult>(`${baseUrl}/sync/biorxiv`, input, SYNC_REQUEST_TIMEOUT_MS)
}

export async function syncPaperRadarProfile(
  input: PaperRadarProfileSyncInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>> {
  return paperRadarPost<PaperRadarProfileSyncResult>(`${baseUrl}/sync/profile`, input, SYNC_REQUEST_TIMEOUT_MS)
}

export async function listPaperRadarProfiles(
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarProfileListResult>> {
  return paperRadarGet<PaperRadarProfileListResult>(`${baseUrl}/profiles`)
}

export async function savePaperRadarProfile(
  input: PaperRadarProfile,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>> {
  return paperRadarPost<PaperRadarProfileSaveResult>(`${baseUrl}/profiles`, input)
}

export async function searchPaperRadar(
  input: PaperRadarSearchInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarSearchResult>> {
  const url = new URL(`${baseUrl}/papers/search`)
  if (input.query) url.searchParams.set('q', input.query)
  for (const source of input.sources ?? []) url.searchParams.append('source', source)
  for (const category of input.categories ?? []) url.searchParams.append('category', category)
  if (input.from) url.searchParams.set('from', input.from)
  if (input.to) url.searchParams.set('to', input.to)
  if (input.topK) url.searchParams.set('topK', String(input.topK))
  return paperRadarGet<PaperRadarSearchResult>(url.toString())
}

export async function rankPaperRadar(
  input: PaperRadarRankInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarRankResult>> {
  return paperRadarPost<PaperRadarRankResult>(`${baseUrl}/papers/rank`, input)
}

export async function digestPaperRadar(
  input: PaperRadarDigestInput,
  baseUrl = paperRadarBaseUrl()
): Promise<PaperRadarApiResult<PaperRadarDigestResult>> {
  return paperRadarPost<PaperRadarDigestResult>(`${baseUrl}/digest`, input)
}

async function checkPaperRadarHealth(baseUrl: string, runtimeToken = paperRadarRuntimeToken()): Promise<PaperRadarStatus> {
  const result = await paperRadarGet<PaperRadarStatus>(`${baseUrl}/health`, runtimeToken)
  if (!result.ok) return { ok: false, message: result.message }
  return result.data
}

async function waitForPaperRadarHealth(baseUrl: string, timeoutMs: number, runtimeToken = paperRadarRuntimeToken()): Promise<void> {
  const startedAt = Date.now()
  let lastMessage = ''
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await checkPaperRadarHealth(baseUrl, runtimeToken)
      if (isPaperRadarServiceHealth(health)) return
      lastMessage = health.ok
        ? `Unexpected Paper Radar service id: ${health.service ?? 'unknown'}`
        : health.message ?? ''
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
    }
    await delay(250)
  }
  throw new Error(lastMessage || `Paper Radar did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`)
}

async function paperRadarGet<T>(url: string, runtimeToken = paperRadarRuntimeToken()): Promise<PaperRadarApiResult<T>> {
  return requestPaperRadar<T>(url, undefined, DEFAULT_REQUEST_TIMEOUT_MS, runtimeToken)
}

async function paperRadarPost<T>(url: string, body: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, runtimeToken = paperRadarRuntimeToken()): Promise<PaperRadarApiResult<T>> {
  return requestPaperRadar<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  }, timeoutMs, runtimeToken)
}

async function requestPaperRadar<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, runtimeToken = paperRadarRuntimeToken()): Promise<PaperRadarApiResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${runtimeToken}`)
    const response = await fetch(url, { ...init, headers, signal: controller.signal })
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      return { ok: false, message: messageFromBody(body) || `Paper Radar returned HTTP ${response.status}` }
    }
    if (isServiceResult<T>(body)) {
      if (body.ok) return { ok: true, data: body.data, summary: body.summary }
      return { ok: false, message: body.error?.message || 'Paper Radar request failed.' }
    }
    return { ok: true, data: body as T }
  } catch (error) {
    if (isAbortError(error)) {
      return { ok: false, message: `Paper Radar request timed out after ${Math.round(timeoutMs / 1000)} seconds.` }
    }
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /aborted/i.test(error.message))
}

function isServiceResult<T>(value: unknown): value is
  | { ok: true; data: T; summary?: string }
  | { ok: false; error?: { message?: string } } {
  return typeof value === 'object' && value !== null && 'ok' in value && ('data' in value || 'error' in value)
}

function messageFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const maybe = body as { message?: unknown; error?: { message?: unknown } }
  return typeof maybe.message === 'string'
    ? maybe.message
    : typeof maybe.error?.message === 'string'
      ? maybe.error.message
      : null
}

function localPortFromBaseUrl(baseUrl: string): number | null {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'http:' || (host !== '127.0.0.1' && host !== 'localhost')) return null
    const port = Number(url.port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isPaperRadarChildRunning(): boolean {
  return Boolean(paperRadarChild && paperRadarChild.exitCode === null && paperRadarChild.signalCode === null)
}

function paperRadarLaunchSignatureValue(launch: PaperRadarLaunch): string {
  return JSON.stringify({
    command: launch.command,
    args: launch.args,
    cwd: launch.cwd,
    baseUrl: launch.baseUrl,
    dbPath: launch.dbPath,
    profilesPath: launch.profilesPath,
    runtimeToken: runtimeTokenFingerprint(launch.runtimeToken)
  })
}

function runtimeTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16)
}

function attachPaperRadarChildLogging(
  child: ChildProcess,
  log: ((message: string) => void) | undefined
): void {
  if (!log) return
  child.stdout?.on('data', (chunk) => logPaperRadarChildChunk('stdout', chunk, log))
  child.stderr?.on('data', (chunk) => logPaperRadarChildChunk('stderr', chunk, log))
}

function logPaperRadarChildChunk(
  stream: 'stdout' | 'stderr',
  chunk: unknown,
  log: (message: string) => void
): void {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return
  log(`Paper Radar sidecar ${stream}: ${normalized.slice(0, 1_000)}`)
}
