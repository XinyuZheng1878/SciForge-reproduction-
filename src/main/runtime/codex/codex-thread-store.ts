import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export type CodexStoredThread = {
  guiThreadId: string
  codexThreadId: string
  runtimeId: 'codex'
  workspace: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  latestSeq: number
  latestTurnId?: string
  latestUserMessageId?: string
}

export type CodexThreadStoreSnapshot = {
  version: 1
  threads: CodexStoredThread[]
}

export type CodexThreadStoreOptions = {
  rootDir: string
  now?: () => Date
}

type CodexThreadStoreUpsertInput = {
  guiThreadId?: string
  codexThreadId: string
  workspace?: string
  title?: string
  archived?: boolean
  latestSeq?: number
  latestTurnId?: string
  latestUserMessageId?: string
  updatedAt?: string
}

export class CodexThreadStore {
  private readonly filePath: string
  private readonly now: () => Date
  private transactionQueue: Promise<void> = Promise.resolve()

  constructor(options: CodexThreadStoreOptions) {
    this.filePath = join(options.rootDir, 'threads.json')
    this.now = options.now ?? (() => new Date())
  }

  async list(options: { includeArchived?: boolean } = {}): Promise<CodexStoredThread[]> {
    const snapshot = await this.load()
    const threads = options.includeArchived
      ? snapshot.threads
      : snapshot.threads.filter((thread) => !thread.archived)
    return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async get(guiThreadId: string): Promise<CodexStoredThread | null> {
    const id = guiThreadId.trim()
    if (!id) return null
    const snapshot = await this.load()
    return snapshot.threads.find((thread) => thread.guiThreadId === id) ?? null
  }

  async getByCodexThreadId(codexThreadId: string): Promise<CodexStoredThread | null> {
    const id = codexThreadId.trim()
    if (!id) return null
    const snapshot = await this.load()
    return snapshot.threads.find((thread) => thread.codexThreadId === id) ?? null
  }

  async upsert(input: CodexThreadStoreUpsertInput): Promise<CodexStoredThread> {
    return this.enqueue(async () => this.upsertNow(input))
  }

  private async upsertNow(input: CodexThreadStoreUpsertInput): Promise<CodexStoredThread> {
    const codexThreadId = input.codexThreadId.trim()
    if (!codexThreadId) throw new Error('Codex thread id is required.')
    const guiThreadId = stringValue(input.guiThreadId)
    const snapshot = await this.load()
    const matchesInput = (thread: CodexStoredThread): boolean => (
      thread.codexThreadId === codexThreadId ||
      (guiThreadId !== '' && thread.guiThreadId === guiThreadId)
    )
    const now = this.now().toISOString()
    const updatedAt = validIso(input.updatedAt) ?? now
    const matchingThreads = snapshot.threads.filter(matchesInput)
    const next = mergeThreadRecords(matchingThreads, {
      guiThreadId,
      codexThreadId,
      updatedAt,
      now,
      workspace: input.workspace,
      title: input.title,
      archived: input.archived,
      latestSeq: input.latestSeq,
      latestTurnId: input.latestTurnId,
      latestUserMessageId: input.latestUserMessageId
    })
    const threads = snapshot.threads.filter((thread) => !matchesInput(thread))
    threads.push(next)
    await this.save({ version: 1, threads })
    return next
  }

  async archive(guiThreadId: string): Promise<CodexStoredThread | null> {
    const existing = await this.get(guiThreadId)
    if (!existing) return null
    return this.upsert({
      guiThreadId: existing.guiThreadId,
      codexThreadId: existing.codexThreadId,
      archived: true
    })
  }

  async updateLatestSeq(guiThreadId: string, latestSeq: number): Promise<CodexStoredThread | null> {
    const existing = await this.get(guiThreadId)
    if (!existing) return null
    return this.upsert({
      guiThreadId: existing.guiThreadId,
      codexThreadId: existing.codexThreadId,
      latestSeq
    })
  }

  private async load(): Promise<CodexThreadStoreSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizeSnapshot(parseSnapshotJson(raw))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySnapshot()
      throw error
    }
  }

  private async save(snapshot: CodexThreadStoreSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    await writeFile(tmpPath, `${JSON.stringify(normalizeSnapshot(snapshot), null, 2)}\n`, 'utf8')
    await rename(tmpPath, this.filePath)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(task, task)
    this.transactionQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

function emptySnapshot(): CodexThreadStoreSnapshot {
  return { version: 1, threads: [] }
}

function normalizeSnapshot(raw: unknown): CodexThreadStoreSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySnapshot()
  const record = raw as Record<string, unknown>
  const threads = Array.isArray(record.threads)
    ? record.threads.map(normalizeThread).filter((thread): thread is CodexStoredThread => Boolean(thread))
    : []
  return { version: 1, threads: dedupeThreads(threads) }
}

function parseSnapshotJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const end = firstJsonObjectEnd(raw)
    if (end >= 0) {
      return JSON.parse(raw.slice(0, end + 1)) as unknown
    }
    throw error
  }
}

function firstJsonObjectEnd(raw: string): number {
  let depth = 0
  let started = false
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      depth += 1
      started = true
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (started && depth === 0) return i
      if (depth < 0) return -1
    }
  }
  return -1
}

function normalizeThread(raw: unknown): CodexStoredThread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const codexThreadId = stringValue(record.codexThreadId)
  const guiThreadId = stringValue(record.guiThreadId) || codexThreadId
  if (!codexThreadId || !guiThreadId) return null
  return {
    guiThreadId,
    codexThreadId,
    runtimeId: 'codex',
    workspace: stringValue(record.workspace),
    title: stringValue(record.title) || 'Codex thread',
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    updatedAt: stringValue(record.updatedAt) || stringValue(record.createdAt) || new Date(0).toISOString(),
    archived: record.archived === true,
    latestSeq: numberValue(record.latestSeq),
    ...(stringValue(record.latestTurnId) ? { latestTurnId: stringValue(record.latestTurnId) } : {}),
    ...(stringValue(record.latestUserMessageId) ? { latestUserMessageId: stringValue(record.latestUserMessageId) } : {})
  }
}

function dedupeThreads(threads: CodexStoredThread[]): CodexStoredThread[] {
  const groups: CodexStoredThread[][] = []
  for (const thread of threads) {
    const matchingIndexes = groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.some((candidate) => sameThreadIdentity(candidate, thread)))
      .map(({ index }) => index)
    if (matchingIndexes.length === 0) {
      groups.push([thread])
      continue
    }
    const [firstIndex, ...otherIndexes] = matchingIndexes
    groups[firstIndex].push(thread)
    for (const index of [...otherIndexes].sort((a, b) => b - a)) {
      groups[firstIndex].push(...groups[index])
      groups.splice(index, 1)
    }
  }
  return groups.map((group) => mergeThreadRecords(group))
}

function sameThreadIdentity(a: CodexStoredThread, b: CodexStoredThread): boolean {
  return a.guiThreadId === b.guiThreadId || a.codexThreadId === b.codexThreadId
}

function mergeThreadRecords(
  records: CodexStoredThread[],
  overrides: {
    guiThreadId?: string
    codexThreadId?: string
    workspace?: string
    title?: string
    archived?: boolean
    latestSeq?: number
    latestTurnId?: string
    latestUserMessageId?: string
    updatedAt?: string
    now?: string
  } = {}
): CodexStoredThread {
  const preferredRecords = [...records].sort(compareThreadActivity)
  const preferred = preferredRecords[0]
  const now = validIso(overrides.now) ?? new Date(0).toISOString()
  const guiThreadId = nonEmpty(overrides.guiThreadId, preferred?.guiThreadId ?? overrides.codexThreadId ?? '')
  const codexThreadId = nonEmpty(overrides.codexThreadId, preferred?.codexThreadId ?? guiThreadId)
  return {
    guiThreadId,
    codexThreadId,
    runtimeId: 'codex',
    workspace: chooseString([overrides.workspace, ...preferredRecords.map((thread) => thread.workspace)]),
    title: chooseDisplayTitle([overrides.title, ...preferredRecords.map((thread) => thread.title)]) ?? 'Codex thread',
    createdAt: earliestIso(preferredRecords.map((thread) => thread.createdAt)) ?? now,
    updatedAt: validIso(overrides.updatedAt) ?? latestIso(preferredRecords.map((thread) => thread.updatedAt)) ?? now,
    archived: overrides.archived ?? preferred?.archived ?? false,
    latestSeq: Math.max(
      numberValue(overrides.latestSeq),
      ...preferredRecords.map((thread) => thread.latestSeq)
    ),
    ...optionalString('latestTurnId', overrides.latestTurnId, preferredRecords),
    ...optionalString('latestUserMessageId', overrides.latestUserMessageId, preferredRecords)
  }
}

function compareThreadActivity(a: CodexStoredThread, b: CodexStoredThread): number {
  return b.latestSeq - a.latestSeq ||
    timestampValue(b.updatedAt) - timestampValue(a.updatedAt) ||
    timestampValue(b.createdAt) - timestampValue(a.createdAt)
}

function chooseString(values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ''
}

function chooseDisplayTitle(values: unknown[]): string | null {
  for (const value of values) {
    const title = stringValue(value)
    if (title && !isGeneratedRuntimeTitle(title)) return title
  }
  return null
}

function isGeneratedRuntimeTitle(title: string): boolean {
  return title.includes('<sciforge_runtime_instruction>') ||
    title.includes('Runtime context ledger for this thread:')
}

function optionalString(
  key: 'latestTurnId' | 'latestUserMessageId',
  override: string | undefined,
  records: CodexStoredThread[]
): Partial<Pick<CodexStoredThread, 'latestTurnId' | 'latestUserMessageId'>> {
  if (override !== undefined) return override ? { [key]: override } : {}
  const value = records.map((thread) => thread[key]).find((candidate) => stringValue(candidate))
  return value ? { [key]: value } : {}
}

function earliestIso(values: string[]): string | null {
  return validIsoBy(values, (a, b) => a - b)
}

function latestIso(values: string[]): string | null {
  return validIsoBy(values, (a, b) => b - a)
}

function validIsoBy(values: string[], compare: (a: number, b: number) => number): string | null {
  const valid = values
    .map((value) => ({ value: validIso(value), timestamp: timestampValue(value) }))
    .filter((item): item is { value: string; timestamp: number } => item.value !== null)
    .sort((a, b) => compare(a.timestamp, b.timestamp))
  return valid[0]?.value ?? null
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function nonEmpty(value: unknown, fallback: string): string {
  return stringValue(value) || fallback
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function validIso(value: unknown): string | null {
  const text = stringValue(value)
  if (!text) return null
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? text : null
}
