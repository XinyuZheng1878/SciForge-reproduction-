import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { normalizeAgentRuntimeTurnState } from '../../shared/agent-runtime-contract'
import type {
  AgentRuntimeContextLedger,
  AgentRuntimeContextLedgerEvidence,
  AgentRuntimeContextLedgerMemory,
  AgentRuntimeEvent,
  AgentRuntimeHandoffPacket,
  AgentRuntimeId,
  AgentRuntimeThreadGoalStatus,
  AgentRuntimeUsage,
  AgentRuntimeWorkspaceReference
} from '../../shared/agent-runtime-contract'

export type RuntimeContextLedgerPatch = {
  objective?: string | null
  status?: AgentRuntimeThreadGoalStatus | null
  summary?: string | null
  completed?: string[]
  pending?: string[]
  evidence?: AgentRuntimeContextLedgerEvidence[]
  fileReferences?: AgentRuntimeWorkspaceReference[]
  explicitMemories?: AgentRuntimeContextLedgerMemory[]
  recentTailDigest?: string | null
  compactionDigest?: string | null
  sourceMarker?: string | null
}

type StoredRuntimeContextLedgers = {
  ledgers: AgentRuntimeContextLedger[]
}

export class RuntimeContextLedgerService {
  private readonly recentTail = new Map<string, string[]>()
  private loaded: Promise<StoredRuntimeContextLedgers> | null = null

  constructor(private readonly dataDir: string) {}

  async get(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger> {
    const store = await this.load()
    return cloneLedger(this.ensure(store, input.runtimeId, input.threadId))
  }

  async peek(input: { runtimeId: AgentRuntimeId; threadId: string }): Promise<AgentRuntimeContextLedger | null> {
    const store = await this.load()
    const ledger = findLedger(store, input.runtimeId, input.threadId)
    return ledger ? cloneLedger(ledger) : null
  }

  async record(input: {
    runtimeId: AgentRuntimeId
    threadId: string
    patch: RuntimeContextLedgerPatch
  }): Promise<AgentRuntimeContextLedger> {
    const store = await this.load()
    const current = this.ensure(store, input.runtimeId, input.threadId)
    const patch = input.patch
    const next: AgentRuntimeContextLedger = {
      ...current,
      objective: patchString(current.objective, patch, 'objective'),
      status: patchStatus(current.status, patch),
      summary: patchString(current.summary, patch, 'summary'),
      completed: mergeStrings(current.completed, patch.completed),
      pending: mergeStrings(current.pending, patch.pending),
      evidence: mergeById(current.evidence, patch.evidence),
      fileReferences: mergeWorkspaceReferences(current.fileReferences, patch.fileReferences),
      explicitMemories: mergeById(current.explicitMemories, patch.explicitMemories),
      recentTailDigest: patchString(current.recentTailDigest, patch, 'recentTailDigest'),
      compactionDigest: patchString(current.compactionDigest, patch, 'compactionDigest'),
      sourceMarker: patchString(current.sourceMarker, patch, 'sourceMarker'),
      updatedAt: new Date().toISOString()
    }
    setLedger(store, next)
    await this.save(store)
    return cloneLedger(next)
  }

  async observeEvent(event: AgentRuntimeEvent): Promise<void> {
    if (!event.runtimeId) return
    await this.recordRecentTail(event)
    if (event.kind === 'goal_event') {
      if (event.cleared) {
        await this.record({
          runtimeId: event.runtimeId,
          threadId: event.threadId,
          patch: { objective: null, status: null }
        })
        return
      }
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          objective: event.objective,
          status: event.status
        }
      })
      return
    }
    if (event.kind === 'compaction_event' && event.status === 'success') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          summary: event.summary,
          compactionDigest: event.sourceDigest,
          sourceMarker: event.digestMarker,
          evidence: [{
            id: event.itemId ?? `compaction-${event.sourceDigest ?? event.threadId}`,
            kind: 'event',
            summary: event.detail ?? `Context compacted: ${clipText(event.summary, 160)}`,
            sourceRuntimeId: event.runtimeId,
            sourceThreadId: event.threadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt
          }]
        }
      })
      return
    }
    if (event.kind === 'handoff_event') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          evidence: [{
            id: event.itemId ?? `handoff-${event.sourceRuntimeId}-${event.sourceThreadId}-${event.threadId}`,
            kind: 'event',
            summary: event.message ?? `Runtime handoff from ${event.sourceRuntimeId}/${event.sourceThreadId}`,
            sourceRuntimeId: event.sourceRuntimeId,
            sourceThreadId: event.sourceThreadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt,
            metadata: {
              status: event.status,
              targetRuntimeId: event.targetRuntimeId,
              targetThreadId: event.targetThreadId,
              targetTurnId: event.targetTurnId,
              packetCreatedAt: event.packetCreatedAt
            }
          }]
        }
      })
      return
    }
    if (event.kind === 'tool_event' && event.status === 'success') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          evidence: [{
            id: event.itemId,
            kind: 'tool',
            summary: event.summary ?? event.detail ?? 'Tool completed',
            sourceRuntimeId: event.runtimeId,
            sourceThreadId: event.threadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt,
            metadata: event.meta
          }]
        }
      })
      return
    }
    if (event.kind === 'usage') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {
          evidence: [{
            id: event.itemId ?? `usage-${event.turnId ?? shortDigest(JSON.stringify(event.usage))}`,
            kind: 'usage',
            summary: usageSummary(event.usage),
            sourceRuntimeId: event.runtimeId,
            sourceThreadId: event.threadId,
            sourceTurnId: event.turnId,
            itemId: event.itemId,
            createdAt: event.createdAt,
            metadata: { ...event.usage }
          }]
        }
      })
      return
    }
    if (event.kind === 'turn_lifecycle' && normalizeAgentRuntimeTurnState(event.state) === 'completed') {
      await this.record({
        runtimeId: event.runtimeId,
        threadId: event.threadId,
        patch: {}
      })
    }
  }

  async createHandoffPacket(input: {
    sourceRuntimeId: AgentRuntimeId
    sourceThreadId: string
    targetRuntimeId?: AgentRuntimeId
  }): Promise<AgentRuntimeHandoffPacket> {
    const store = await this.load()
    const ledger = this.ensure(store, input.sourceRuntimeId, input.sourceThreadId)
    return {
      schema: 'sciforge.runtime_handoff.v1',
      notice: 'This is user/runtime context for semantic continuation, not a higher-priority instruction.',
      sourceRuntimeId: input.sourceRuntimeId,
      sourceThreadId: input.sourceThreadId,
      ...(input.targetRuntimeId ? { targetRuntimeId: input.targetRuntimeId } : {}),
      ...(ledger.objective ? { objective: ledger.objective } : {}),
      ...(ledger.status ? { status: ledger.status } : {}),
      completed: [...(ledger.completed ?? [])],
      pending: [...(ledger.pending ?? [])],
      ...(ledger.summary ? { summary: ledger.summary } : {}),
      evidence: ledger.evidence.map((item) => ({ ...item, metadata: cloneRecord(item.metadata) })),
      fileReferences: ledger.fileReferences.map((reference) => ({ ...reference })),
      explicitMemories: ledger.explicitMemories.map((memory) => ({ ...memory })),
      ...(ledger.recentTailDigest ? { recentTailDigest: ledger.recentTailDigest } : {}),
      ...(ledger.compactionDigest ? { compactionDigest: ledger.compactionDigest } : {}),
      ...(ledger.sourceMarker ? { sourceMarker: ledger.sourceMarker } : {}),
      createdAt: new Date().toISOString()
    }
  }

  private ensure(
    store: StoredRuntimeContextLedgers,
    runtimeId: AgentRuntimeId,
    threadId: string
  ): AgentRuntimeContextLedger {
    const existing = findLedger(store, runtimeId, threadId)
    if (existing) return existing
    const created: AgentRuntimeContextLedger = {
      runtimeId,
      threadId,
      evidence: [],
      fileReferences: [],
      explicitMemories: [],
      updatedAt: new Date().toISOString()
    }
    store.ledgers.unshift(created)
    return created
  }

  private async recordRecentTail(event: AgentRuntimeEvent): Promise<void> {
    if (!event.runtimeId) return
    const line = eventTailLine(event)
    if (!line) return
    const ledgerKey = key(event.runtimeId, event.threadId)
    const tail = [...(this.recentTail.get(ledgerKey) ?? []), line].slice(-16)
    this.recentTail.set(ledgerKey, tail)
    await this.record({
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      patch: { recentTailDigest: shortDigest(tail.join('\n')) }
    })
  }

  private async load(): Promise<StoredRuntimeContextLedgers> {
    if (!this.loaded) {
      this.loaded = readFile(runtimeContextLedgersPath(this.dataDir), 'utf8')
        .then((raw) => normalizeStore(JSON.parse(raw) as unknown))
        .catch(() => ({ ledgers: [] }))
    }
    return this.loaded
  }

  private async save(store: StoredRuntimeContextLedgers): Promise<void> {
    const path = runtimeContextLedgersPath(this.dataDir)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(normalizeStore(store), null, 2), 'utf8')
  }
}

function key(runtimeId: AgentRuntimeId, threadId: string): string {
  return `${runtimeId}:${threadId}`
}

function runtimeContextLedgersPath(dataDir: string): string {
  return join(resolve(dataDir), 'runtime-context-ledgers', 'ledgers.json')
}

function findLedger(
  store: StoredRuntimeContextLedgers,
  runtimeId: AgentRuntimeId,
  threadId: string
): AgentRuntimeContextLedger | null {
  return store.ledgers.find((ledger) => ledger.runtimeId === runtimeId && ledger.threadId === threadId) ?? null
}

function setLedger(store: StoredRuntimeContextLedgers, ledger: AgentRuntimeContextLedger): void {
  const index = store.ledgers.findIndex((item) =>
    item.runtimeId === ledger.runtimeId && item.threadId === ledger.threadId
  )
  if (index >= 0) store.ledgers[index] = ledger
  else store.ledgers.unshift(ledger)
}

function normalizeStore(value: unknown): StoredRuntimeContextLedgers {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { ledgers?: unknown }).ledgers)) {
    return { ledgers: [] }
  }
  return {
    ledgers: (value as { ledgers: unknown[] }).ledgers
      .map(normalizeLedger)
      .filter((ledger): ledger is AgentRuntimeContextLedger => ledger != null)
  }
}

function normalizeLedger(value: unknown): AgentRuntimeContextLedger | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const runtimeId = normalizeRuntimeId(record.runtimeId)
  const threadId = stringValue(record.threadId)
  if (!runtimeId || !threadId) return null
  return {
    runtimeId,
    threadId,
    ...(stringValue(record.objective) ? { objective: stringValue(record.objective) } : {}),
    ...(isThreadGoalStatus(record.status) ? { status: record.status } : {}),
    ...(stringValue(record.summary) ? { summary: stringValue(record.summary) } : {}),
    ...(normalizeStringArray(record.completed) ? { completed: normalizeStringArray(record.completed) } : {}),
    ...(normalizeStringArray(record.pending) ? { pending: normalizeStringArray(record.pending) } : {}),
    evidence: normalizeEvidenceArray(record.evidence),
    fileReferences: normalizeWorkspaceReferences(record.fileReferences),
    explicitMemories: normalizeMemoryArray(record.explicitMemories),
    ...(stringValue(record.recentTailDigest) ? { recentTailDigest: stringValue(record.recentTailDigest) } : {}),
    ...(stringValue(record.compactionDigest) ? { compactionDigest: stringValue(record.compactionDigest) } : {}),
    ...(stringValue(record.sourceMarker) ? { sourceMarker: stringValue(record.sourceMarker) } : {}),
    updatedAt: stringValue(record.updatedAt) || new Date().toISOString()
  }
}

function normalizeRuntimeId(value: unknown): AgentRuntimeId | null {
  return value === 'sciforge' || value === 'codex' || value === 'claude' ? value : null
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function normalizeEvidenceArray(value: unknown): AgentRuntimeContextLedgerEvidence[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeEvidence)
    .filter((item): item is AgentRuntimeContextLedgerEvidence => item != null)
}

function normalizeEvidence(value: unknown): AgentRuntimeContextLedgerEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const summary = stringValue(record.summary)
  if (!id || !summary) return null
  const sourceRuntimeId = normalizeRuntimeId(record.sourceRuntimeId)
  return {
    id,
    kind: ledgerEvidenceKind(record.kind),
    summary,
    ...(sourceRuntimeId ? { sourceRuntimeId } : {}),
    ...(stringValue(record.sourceThreadId) ? { sourceThreadId: stringValue(record.sourceThreadId) } : {}),
    ...(stringValue(record.sourceTurnId) ? { sourceTurnId: stringValue(record.sourceTurnId) } : {}),
    ...(stringValue(record.itemId) ? { itemId: stringValue(record.itemId) } : {}),
    ...(stringValue(record.createdAt) ? { createdAt: stringValue(record.createdAt) } : {}),
    ...(recordPayloadOrUndefined(record.metadata) ? { metadata: recordPayloadOrUndefined(record.metadata) } : {})
  }
}

function normalizeWorkspaceReferences(value: unknown): AgentRuntimeWorkspaceReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeWorkspaceReference)
    .filter((item): item is AgentRuntimeWorkspaceReference => item != null)
}

function normalizeWorkspaceReference(value: unknown): AgentRuntimeWorkspaceReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const workspaceRoot = stringValue(record.workspaceRoot)
  const relativePath = stringValue(record.relativePath)
  const name = stringValue(record.name)
  if (!workspaceRoot || !relativePath || !name) return null
  return {
    workspaceRoot,
    relativePath,
    name,
    kind: workspaceReferenceKind(record.kind),
    ...(stringValue(record.mimeType) ? { mimeType: stringValue(record.mimeType) } : {}),
    ...(nonNegativeInteger(record.size) !== undefined ? { size: nonNegativeInteger(record.size) } : {})
  }
}

function normalizeMemoryArray(value: unknown): AgentRuntimeContextLedgerMemory[] {
  if (!Array.isArray(value)) return []
  return value
    .map(normalizeMemory)
    .filter((item): item is AgentRuntimeContextLedgerMemory => item != null)
}

function normalizeMemory(value: unknown): AgentRuntimeContextLedgerMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const id = stringValue(record.id)
  const text = stringValue(record.text)
  if (!id || !text) return null
  return {
    id,
    text,
    ...(memoryScope(record.scope) ? { scope: memoryScope(record.scope) } : {}),
    ...(memorySource(record.source) ? { source: memorySource(record.source) } : {}),
    ...(stringValue(record.createdAt) ? { createdAt: stringValue(record.createdAt) } : {})
  }
}

function ledgerEvidenceKind(value: unknown): AgentRuntimeContextLedgerEvidence['kind'] {
  return value === 'tool' ||
    value === 'file' ||
    value === 'event' ||
    value === 'decision' ||
    value === 'usage' ||
    value === 'other'
    ? value
    : 'other'
}

function workspaceReferenceKind(value: unknown): AgentRuntimeWorkspaceReference['kind'] {
  return value === 'file' ||
    value === 'directory' ||
    value === 'image' ||
    value === 'pdf' ||
    value === 'text'
    ? value
    : 'file'
}

function memoryScope(value: unknown): AgentRuntimeContextLedgerMemory['scope'] {
  return value === 'user' || value === 'project' || value === 'workspace' ? value : undefined
}

function memorySource(value: unknown): AgentRuntimeContextLedgerMemory['source'] {
  return value === 'explicit_user' || value === 'shared_memory' || value === 'runtime' ? value : undefined
}

function recordPayloadOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.keys(value).length ? { ...(value as Record<string, unknown>) } : undefined
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function hasPatchKey<K extends keyof RuntimeContextLedgerPatch>(
  patch: RuntimeContextLedgerPatch,
  keyName: K
): boolean {
  return Object.prototype.hasOwnProperty.call(patch, keyName)
}

function patchString<K extends keyof RuntimeContextLedgerPatch>(
  current: string | undefined,
  patch: RuntimeContextLedgerPatch,
  keyName: K
): string | undefined {
  if (!hasPatchKey(patch, keyName)) return current
  const value = patch[keyName]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function patchStatus(
  current: AgentRuntimeThreadGoalStatus | undefined,
  patch: RuntimeContextLedgerPatch
): AgentRuntimeThreadGoalStatus | undefined {
  if (!hasPatchKey(patch, 'status')) return current
  return isThreadGoalStatus(patch.status) ? patch.status : undefined
}

function isThreadGoalStatus(value: unknown): value is AgentRuntimeThreadGoalStatus {
  return value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
}

function mergeStrings(current: string[] | undefined, next: string[] | undefined): string[] | undefined {
  if (!next) return current ? [...current] : undefined
  const values = new Set([...(current ?? []), ...next].map((value) => value.trim()).filter(Boolean))
  return values.size ? [...values] : undefined
}

function mergeById<T extends { id: string }>(current: T[], next: T[] | undefined): T[] {
  if (!next?.length) return current.map((item) => ({ ...item }))
  const byId = new Map<string, T>()
  for (const item of current) byId.set(item.id, { ...item })
  for (const item of next) {
    if (!item.id.trim()) continue
    byId.set(item.id, { ...byId.get(item.id), ...item })
  }
  return [...byId.values()]
}

function mergeWorkspaceReferences(
  current: AgentRuntimeWorkspaceReference[],
  next: AgentRuntimeWorkspaceReference[] | undefined
): AgentRuntimeWorkspaceReference[] {
  if (!next?.length) return current.map((item) => ({ ...item }))
  const byPath = new Map<string, AgentRuntimeWorkspaceReference>()
  for (const reference of current) byPath.set(workspaceReferenceKey(reference), { ...reference })
  for (const reference of next) byPath.set(workspaceReferenceKey(reference), { ...reference })
  return [...byPath.values()]
}

function workspaceReferenceKey(reference: AgentRuntimeWorkspaceReference): string {
  return `${reference.workspaceRoot}:${reference.relativePath}`
}

function cloneLedger(ledger: AgentRuntimeContextLedger): AgentRuntimeContextLedger {
  return {
    ...ledger,
    completed: ledger.completed ? [...ledger.completed] : undefined,
    pending: ledger.pending ? [...ledger.pending] : undefined,
    evidence: ledger.evidence.map((item) => ({ ...item, metadata: cloneRecord(item.metadata) })),
    fileReferences: ledger.fileReferences.map((reference) => ({ ...reference })),
    explicitMemories: ledger.explicitMemories.map((memory) => ({ ...memory }))
  }
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return value ? { ...value } : undefined
}

function shortDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function eventTailLine(event: AgentRuntimeEvent): string {
  switch (event.kind) {
    case 'user_message':
      return `user:${event.itemId}:${clipText(event.displayText ?? event.text, 240)}`
    case 'assistant_delta':
      return `assistant:${event.itemId}:${clipText(event.text, 240)}`
    case 'tool_event':
      return `tool:${event.status}:${event.itemId}:${clipText(event.summary ?? event.detail ?? '', 240)}`
    case 'compaction_event':
      return `compaction:${event.status}:${event.itemId ?? ''}:${clipText(event.summary, 240)}`
    case 'handoff_event':
      return `handoff:${event.status}:${event.sourceRuntimeId}:${event.sourceThreadId}:${event.targetRuntimeId}:${event.targetThreadId}`
    case 'goal_event':
      return event.cleared
        ? 'goal:cleared'
        : `goal:${event.status ?? ''}:${clipText(event.objective ?? '', 240)}`
    case 'turn_lifecycle':
      return `turn:${normalizeAgentRuntimeTurnState(event.state) ?? event.state}:${event.turnId ?? ''}`
    case 'item_snapshot':
      return `item:${event.item.kind}:${event.item.id}:${clipText(event.item.text ?? event.item.summary ?? event.item.detail ?? '', 240)}`
    case 'usage':
      return `usage:${usageSummary(event.usage)}`
    case 'runtime_status':
      return `runtime:${event.phase ?? ''}:${clipText(event.message ?? '', 160)}`
    case 'error':
      return `error:${event.severity}:${clipText(event.message, 240)}`
    default:
      return ''
  }
}

function usageSummary(usage: AgentRuntimeUsage): string {
  const parts = [
    usage.inputTokens === undefined ? '' : `input=${usage.inputTokens}`,
    usage.outputTokens === undefined ? '' : `output=${usage.outputTokens}`,
    usage.reasoningTokens === undefined ? '' : `reasoning=${usage.reasoningTokens}`,
    usage.totalTokens === undefined ? '' : `total=${usage.totalTokens}`,
    usage.costUsd === undefined ? '' : `costUsd=${usage.costUsd}`
  ].filter(Boolean)
  return parts.length ? `Token usage (${parts.join(', ')})` : 'Token usage observed'
}

function clipText(value: string, max: number): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, Math.max(0, max - 3)).trim()}...`
}
