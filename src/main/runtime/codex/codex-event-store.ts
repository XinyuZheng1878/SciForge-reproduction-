import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CodexThreadEventPayload } from './codex-runtime-api'

export type CodexStoredEvent = {
  seq: number
  threadId: string
  createdAt: string
  event: CodexThreadEventPayload
}

export type CodexEventStoreOptions = {
  rootDir: string
  now?: () => Date
}

export class CodexEventStore {
  private readonly rootDir: string
  private readonly now: () => Date
  private readonly threadQueues = new Map<string, Promise<void>>()

  constructor(options: CodexEventStoreOptions) {
    this.rootDir = options.rootDir
    this.now = options.now ?? (() => new Date())
  }

  async append(threadId: string, event: CodexThreadEventPayload): Promise<CodexStoredEvent> {
    const normalizedThreadId = nonEmpty(threadId || event.threadId, 'Codex thread id is required.')
    return this.enqueueForThread(normalizedThreadId, async () => this.appendNow(normalizedThreadId, event))
  }

  private async appendNow(threadId: string, event: CodexThreadEventPayload): Promise<CodexStoredEvent> {
    const existing = await this.read(threadId, { includeAll: true })
    const seq = Math.max(0, ...existing.map((item) => item.seq)) + 1
    const stored: CodexStoredEvent = {
      seq,
      threadId,
      createdAt: this.now().toISOString(),
      event: {
        ...event,
        threadId,
        seq
      }
    }
    await mkdir(dirname(this.eventsPath(threadId)), { recursive: true })
    await appendFile(this.eventsPath(threadId), `${JSON.stringify(stored)}\n`, 'utf8')
    return stored
  }

  async read(
    threadId: string,
    options: { sinceSeq?: number; includeAll?: boolean } = {}
  ): Promise<CodexStoredEvent[]> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    let raw = ''
    try {
      raw = await readFile(this.eventsPath(normalizedThreadId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const sinceSeq = options.includeAll ? 0 : Math.max(0, Math.floor(options.sinceSeq ?? 0))
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseStoredEvent)
      .filter((event): event is CodexStoredEvent => Boolean(event))
      .filter((event) => event.threadId === normalizedThreadId)
      .filter((event) => event.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  async latestSeq(threadId: string): Promise<number> {
    const events = await this.read(threadId, { includeAll: true })
    return Math.max(0, ...events.map((event) => event.seq))
  }

  private eventsPath(threadId: string): string {
    return join(this.rootDir, 'events', `${safeSegment(threadId)}.jsonl`)
  }

  private enqueueForThread<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadQueues.get(threadId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const next = run.then(() => undefined, () => undefined)
    this.threadQueues.set(threadId, next)
    void next.then(() => {
      if (this.threadQueues.get(threadId) === next) this.threadQueues.delete(threadId)
    })
    return run
  }
}

function parseStoredEvent(line: string): CodexStoredEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  const event = normalizeEvent(record.event)
  const threadId = stringValue(record.threadId) || event?.threadId || ''
  const seq = numberValue(record.seq)
  if (!event || !threadId || seq <= 0) return null
  return {
    seq,
    threadId,
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    event: {
      ...event,
      threadId,
      seq
    }
  }
}

function normalizeEvent(raw: unknown): CodexThreadEventPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const threadId = stringValue(record.threadId)
  if (!threadId) return null
  return record as CodexThreadEventPayload
}

function safeSegment(value: string): string {
  const trimmed = value.trim()
  const encoded = Buffer.from(trimmed, 'utf8').toString('base64url')
  return encoded || 'thread'
}

function nonEmpty(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
}
