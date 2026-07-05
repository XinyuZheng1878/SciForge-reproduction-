import { randomUUID } from 'node:crypto'
import type {
  AgentRuntimeMemoryRecord,
  AgentRuntimeMemoryScope
} from '../../shared/agent-runtime-contract'
import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from './app-data-store'
import { canonicalPath } from './workspace-paths'

type StoredMemory = {
  records: AgentRuntimeMemoryRecord[]
}

const SHARED_MEMORY_STORE = ['shared-memory', 'memories.json'] as const

export type MemoryListInput = {
  scope?: AgentRuntimeMemoryScope
  workspace?: string
  includeDeleted?: boolean
  includeDisabled?: boolean
  query?: string
  limit?: number
}

export class SharedMemoryService {
  private loaded: Promise<StoredMemory> | null = null

  constructor(private readonly dataDir: string) {}

  async list(input: MemoryListInput = {}): Promise<AgentRuntimeMemoryRecord[]> {
    const store = await this.load()
    const workspace = input.workspace?.trim() ? await safeCanonical(input.workspace) : ''
    const queryTokens = tokenize(input.query ?? '')
    const records = store.records
      .filter((record) => !input.scope || record.scope === input.scope)
      .filter((record) => input.includeDeleted === true || record.deleted !== true)
      .filter((record) => input.includeDisabled === true || record.disabled !== true)
      .filter((record) => !workspace || record.scope === 'user' || sameWorkspace(record.workspace, workspace))
      .filter((record) => queryTokens.length === 0 || matchesTokens(record, queryTokens))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return records.slice(0, Math.max(1, Math.min(input.limit ?? 200, 500)))
  }

  async create(input: {
    text: string
    scope?: AgentRuntimeMemoryScope
    workspace?: string
    project?: string
    tags?: string[]
    confidence?: number
    disabled?: boolean
  }): Promise<AgentRuntimeMemoryRecord> {
    const text = input.text.trim()
    if (!text) throw new Error('Memory text is required.')
    const now = new Date().toISOString()
    const record: AgentRuntimeMemoryRecord = {
      id: `mem_${Date.now()}_${randomUUID()}`,
      text,
      scope: input.scope ?? 'user',
      ...(input.workspace?.trim() ? { workspace: await safeCanonical(input.workspace) } : {}),
      ...(input.project?.trim() ? { project: input.project.trim() } : {}),
      tags: normalizeTags(input.tags),
      confidence: normalizeConfidence(input.confidence),
      disabled: input.disabled === true,
      deleted: false,
      createdAt: now,
      updatedAt: now
    }
    const store = await this.load()
    store.records.unshift(record)
    await this.save(store)
    return record
  }

  async update(input: {
    memoryId: string
    patch: Partial<Omit<AgentRuntimeMemoryRecord, 'id' | 'createdAt' | 'updatedAt'>>
  }): Promise<AgentRuntimeMemoryRecord> {
    const store = await this.load()
    const index = store.records.findIndex((record) => record.id === input.memoryId)
    if (index < 0) throw new Error(`Memory not found: ${input.memoryId}`)
    const previous = store.records[index]
    const patch = input.patch
    const next: AgentRuntimeMemoryRecord = {
      ...previous,
      ...(typeof patch.text === 'string' ? { text: patch.text.trim() } : {}),
      ...(patch.scope ? { scope: patch.scope } : {}),
      ...(typeof patch.workspace === 'string' ? { workspace: await safeCanonical(patch.workspace) } : {}),
      ...(typeof patch.project === 'string' ? { project: patch.project.trim() } : {}),
      ...(Array.isArray(patch.tags) ? { tags: normalizeTags(patch.tags) } : {}),
      ...(typeof patch.confidence === 'number' ? { confidence: normalizeConfidence(patch.confidence) } : {}),
      ...(typeof patch.disabled === 'boolean' ? { disabled: patch.disabled } : {}),
      ...(typeof patch.deleted === 'boolean' ? { deleted: patch.deleted } : {}),
      updatedAt: new Date().toISOString()
    }
    if (!next.text.trim()) throw new Error('Memory text is required.')
    store.records[index] = next
    await this.save(store)
    return next
  }

  async delete(memoryId: string): Promise<AgentRuntimeMemoryRecord> {
    return this.update({ memoryId, patch: { deleted: true, disabled: true } })
  }

  async retrieveForTurn(input: {
    workspace?: string
    prompt: string
    limit?: number
  }): Promise<AgentRuntimeMemoryRecord[]> {
    const limit = input.limit ?? 8
    const store = await this.load()
    const userMemories = store.records
      .filter((record) => record.scope === 'user' && record.disabled !== true && record.deleted !== true)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const matched = await this.list({
      workspace: input.workspace,
      includeDeleted: false,
      includeDisabled: false,
      query: input.prompt,
      limit
    })
    return uniqueById([...userMemories, ...matched]).slice(0, Math.max(1, Math.min(limit, 50)))
  }

  private async load(): Promise<StoredMemory> {
    if (!this.loaded) {
      this.loaded = readAppDataStoreText(this.dataDir, SHARED_MEMORY_STORE)
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown))
        .catch(() => ({ records: [] }))
    }
    return this.loaded
  }

  private async save(store: StoredMemory): Promise<void> {
    await atomicWriteAppDataJson(this.dataDir, SHARED_MEMORY_STORE, normalizeStore(store))
  }
}

function normalizeStore(value: unknown): StoredMemory {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { records?: unknown }).records)) {
    return { records: [] }
  }
  const records = (value as { records: unknown[] }).records
    .map(normalizeRecord)
    .filter((record): record is AgentRuntimeMemoryRecord => record != null)
  return { records }
}

function normalizeRecord(value: unknown): AgentRuntimeMemoryRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const text = stringValue(record.text)
  const scope = normalizeScope(record.scope)
  const createdAt = stringValue(record.createdAt) || new Date().toISOString()
  const updatedAt = stringValue(record.updatedAt) || createdAt
  if (!id || !text || !scope) return null
  return {
    id,
    text,
    scope,
    ...(stringValue(record.workspace) ? { workspace: stringValue(record.workspace) } : {}),
    ...(stringValue(record.project) ? { project: stringValue(record.project) } : {}),
    tags: Array.isArray(record.tags) ? normalizeTags(record.tags) : [],
    ...(typeof record.confidence === 'number' ? { confidence: normalizeConfidence(record.confidence) } : {}),
    disabled: record.disabled === true,
    deleted: record.deleted === true,
    createdAt,
    updatedAt
  }
}

async function safeCanonical(path: string | undefined): Promise<string> {
  const value = path?.trim()
  return value ? canonicalPath(value) : ''
}

function sameWorkspace(recordWorkspace: string | undefined, workspace: string): boolean {
  if (!recordWorkspace) return false
  return recordWorkspace === workspace
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeScope(value: unknown): AgentRuntimeMemoryScope | null {
  return value === 'user' || value === 'project' || value === 'workspace' ? value : null
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return [...new Set(tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 50)
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

function tokenize(value: string): string[] {
  const normalized = value.toLowerCase()
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []
  const cjk = [...normalized.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)]
    .map((match) => match[0])
  return [...new Set([...words, ...cjk])].filter((token) => token.length > 0).slice(0, 80)
}

function matchesTokens(record: AgentRuntimeMemoryRecord, tokens: string[]): boolean {
  const haystack = `${record.text} ${record.tags.join(' ')} ${record.workspace ?? ''} ${record.project ?? ''}`.toLowerCase()
  return tokens.some((token) => haystack.includes(token))
}

function uniqueById(records: AgentRuntimeMemoryRecord[]): AgentRuntimeMemoryRecord[] {
  const seen = new Set<string>()
  const output: AgentRuntimeMemoryRecord[] = []
  for (const record of records) {
    if (seen.has(record.id)) continue
    seen.add(record.id)
    output.push(record)
  }
  return output
}
