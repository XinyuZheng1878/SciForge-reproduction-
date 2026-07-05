import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  MultiAgentChildRunRecord,
  type MultiAgentChildStatus,
  type MultiAgentStoreDiagnostics,
  type MultiAgentTranscriptPage
} from './contract.js'

export type ListChildRunsOptions = {
  parentThreadId?: string
  parentTurnId?: string
  status?: MultiAgentChildStatus
  limit?: number
  offset?: number
}

export type ReadChildTranscriptOptions = {
  offset?: number
  limit?: number
}

export interface MultiAgentStore {
  upsert(record: MultiAgentChildRunRecord): Promise<void>
  list(options?: ListChildRunsOptions): Promise<MultiAgentChildRunRecord[]>
  get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null>
  readTranscript(
    parentThreadId: string,
    childId: string,
    options?: ReadChildTranscriptOptions
  ): Promise<MultiAgentTranscriptPage | null>
  diagnostics(): Promise<MultiAgentStoreDiagnostics>
}

type StoreScan = {
  records: MultiAgentChildRunRecord[]
  diagnostics: MultiAgentStoreDiagnostics
}

export class FileMultiAgentStore implements MultiAgentStore {
  constructor(private readonly rootDir: string) {}

  async upsert(record: MultiAgentChildRunRecord): Promise<void> {
    const parsed = MultiAgentChildRunRecord.parse(record)
    await mkdir(this.rootDir, { recursive: true })
    const target = this.recordPath(parsed.id)
    const tmp = join(this.rootDir, `.${recordFileName(parsed.id)}.${randomUUID()}.tmp`)
    try {
      await writeFile(tmp, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
      await rename(tmp, target)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async list(options: ListChildRunsOptions = {}): Promise<MultiAgentChildRunRecord[]> {
    const scan = await this.scan()
    return filterRecords(scan.records, options)
  }

  async get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const text = await readFile(this.recordPath(childId), 'utf8').catch(() => null)
    if (text) {
      try {
        const record = MultiAgentChildRunRecord.parse(JSON.parse(text))
        return record.parentThreadId === parentThreadId ? record : null
      } catch {
        return null
      }
    }
    const records = await this.list({ parentThreadId })
    return records.find((record) => record.id === childId) ?? null
  }

  async readTranscript(
    parentThreadId: string,
    childId: string,
    options: ReadChildTranscriptOptions = {}
  ): Promise<MultiAgentTranscriptPage | null> {
    const record = await this.get(parentThreadId, childId)
    if (!record) return null
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.max(1, options.limit ?? 100)
    return {
      childId,
      parentThreadId,
      offset,
      limit,
      total: record.transcript.length,
      entries: record.transcript.slice(offset, offset + limit)
    }
  }

  async diagnostics(): Promise<MultiAgentStoreDiagnostics> {
    return (await this.scan()).diagnostics
  }

  private recordPath(childId: string): string {
    return join(this.rootDir, recordFileName(childId))
  }

  private async scan(): Promise<StoreScan> {
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir).catch(() => [])
    const records: MultiAgentChildRunRecord[] = []
    const issues: MultiAgentStoreDiagnostics['issues'] = []
    for (const entry of entries.filter((name) => name.endsWith('.json')).sort()) {
      const file = join(this.rootDir, entry)
      try {
        const text = await readFile(file, 'utf8')
        records.push(MultiAgentChildRunRecord.parse(JSON.parse(text)))
      } catch (error) {
        issues.push({
          code: 'store_read_failed',
          file,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    records.sort(compareRecords)
    return {
      records,
      diagnostics: {
        rootDir: this.rootDir,
        records: records.length,
        invalidRecords: issues.length,
        issues
      }
    }
  }
}

export class InMemoryMultiAgentStore implements MultiAgentStore {
  private readonly records = new Map<string, MultiAgentChildRunRecord>()

  async upsert(record: MultiAgentChildRunRecord): Promise<void> {
    const parsed = MultiAgentChildRunRecord.parse(record)
    this.records.set(parsed.id, parsed)
  }

  async list(options: ListChildRunsOptions = {}): Promise<MultiAgentChildRunRecord[]> {
    return filterRecords([...this.records.values()].sort(compareRecords), options)
  }

  async get(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    const record = this.records.get(childId)
    return record?.parentThreadId === parentThreadId ? record : null
  }

  async readTranscript(
    parentThreadId: string,
    childId: string,
    options: ReadChildTranscriptOptions = {}
  ): Promise<MultiAgentTranscriptPage | null> {
    const record = await this.get(parentThreadId, childId)
    if (!record) return null
    const offset = Math.max(0, options.offset ?? 0)
    const limit = Math.max(1, options.limit ?? 100)
    return {
      childId,
      parentThreadId,
      offset,
      limit,
      total: record.transcript.length,
      entries: record.transcript.slice(offset, offset + limit)
    }
  }

  async diagnostics(): Promise<MultiAgentStoreDiagnostics> {
    return {
      records: this.records.size,
      invalidRecords: 0,
      issues: []
    }
  }
}

function filterRecords(
  records: readonly MultiAgentChildRunRecord[],
  options: ListChildRunsOptions
): MultiAgentChildRunRecord[] {
  const offset = Math.max(0, options.offset ?? 0)
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit)
  const filtered = records
    .filter((record) => !options.parentThreadId || record.parentThreadId === options.parentThreadId)
    .filter((record) => !options.parentTurnId || record.parentTurnId === options.parentTurnId)
    .filter((record) => !options.status || record.status === options.status)
  return limit === undefined ? filtered.slice(offset) : filtered.slice(offset, offset + limit)
}

function compareRecords(a: MultiAgentChildRunRecord, b: MultiAgentChildRunRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

function recordFileName(childId: string): string {
  return `${Buffer.from(childId, 'utf8').toString('base64url')}.json`
}

