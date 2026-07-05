import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { DEFAULT_PROFILE, normalizeTopicProfile } from './core/profiles.js'
import {
  createPaperRadarCoreService,
  type PaperRadarCoreService
} from './core/service.js'
import type {
  ArxivSyncRequest,
  BiorxivSyncRequest
} from './core/sources.js'
import type {
  RankedPaper,
  RankRequest,
  SearchRequest,
  SyncResult,
  TopicProfile
} from './core/types.js'

import {
  PAPER_RADAR_MCP_SERVER_VERSION,
  PAPER_RADAR_WORKER_CAPABILITIES,
  PAPER_RADAR_WORKER_TRANSPORT,
  PaperRadarWorkerError,
  paperRadarErrorPayloadFromUnknown,
  type PaperDigestInput,
  type PaperRadarCapability,
  type PaperRadarErrorCode,
  type PaperRadarSideEffect,
  type PaperProfileSaveInput,
  type PaperProfileSyncInput,
  type PaperRankInput,
  type PaperSearchInput,
  type PaperStats,
  type PaperSyncStateRecord
} from './contract.js'
import {
  mcpWriteConfirmationRequired,
  mcpWriteControlFromInput,
  mcpWriteRedactedInput
} from './write-action.js'

export interface PaperRadarResolvedPaths {
  dbPath: string
  profilesPath: string
}

export interface PaperRadarServiceOptions {
  dbPath?: string
  profilesPath?: string
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  now?: () => Date
  auditSink?: PaperRadarAuditSink
  maxAuditRecords?: number
  coreService?: PaperRadarCoreService
}

export interface PaperRadarCallOptions {
  signal?: AbortSignal
}

export interface PaperRadarDiagnostics {
  version: string
  transport: typeof PAPER_RADAR_WORKER_TRANSPORT
  capabilities: typeof PAPER_RADAR_WORKER_CAPABILITIES
  storage: PaperRadarResolvedPaths
  stats: PaperStats
  checkedAt: string
}

export type PaperRadarAuditAction = 'preview' | 'write'

export interface PaperRadarAuditRecord {
  auditId: string
  sequence: number
  timestamp: string
  capability: PaperRadarCapability
  sideEffect: PaperRadarSideEffect
  action: PaperRadarAuditAction
  ok: boolean
  dryRun: boolean
  preview: boolean
  confirmed: boolean
  profile?: string
  from?: string
  to?: string
  maxRecords?: number
  sourceCount?: number
  keywordCount?: number
  excludeKeywordCount?: number
  arxivCategoryCount?: number
  biorxivSubjectCount?: number
  fetched?: number
  upserted?: number
  skipped?: number
  errorCode?: PaperRadarErrorCode
  reason?: string
}

export type PaperRadarAuditRecordInput = Omit<
  PaperRadarAuditRecord,
  'auditId' | 'sequence' | 'timestamp'
>

export type PaperRadarAuditSink = (record: PaperRadarAuditRecord) => void

export interface PaperRadarAuditResult {
  records: PaperRadarAuditRecord[]
  count: number
}

export interface PaperProfileListResult {
  profiles: TopicProfile[]
  count: number
}

export interface PaperProfileSaveResult {
  dryRun: boolean
  preview: boolean
  saved: boolean
  profile: TopicProfile
  auditId: string
}

export interface PaperProfileSyncPlan {
  source: 'arxiv' | 'biorxiv'
  from: string
  to: string
  maxRecords: number
  categories?: string[]
  subjects?: string[]
}

export type PaperProfileSyncResult =
  | {
    dryRun: boolean
    preview: true
    profile: string
    from: string
    to: string
    maxRecords: number
    planned: PaperProfileSyncPlan[]
    auditId: string
  }
  | {
    dryRun: false
    preview: false
    profile: string
    from: string
    to: string
    maxRecords: number
    results: SyncResult[]
    fetched: number
    upserted: number
    skipped: number
    auditId: string
  }

export interface PaperSearchResult {
  papers: RankedPaper[]
  count: number
}

export interface PaperRankResult {
  profile: string
  papers: RankedPaper[]
  count: number
}

export interface PaperDigestResult extends PaperRankResult {
  generatedAt: string
}

export interface PaperRadarService {
  readonly paths: PaperRadarResolvedPaths
  syncArxiv(input: ArxivSyncRequest, options?: PaperRadarCallOptions): Promise<SyncResult>
  syncBiorxiv(input: BiorxivSyncRequest, options?: PaperRadarCallOptions): Promise<SyncResult>
  listProfiles(input?: Record<string, never>, options?: PaperRadarCallOptions): PaperProfileListResult
  saveProfile(input: PaperProfileSaveInput, options?: PaperRadarCallOptions): PaperProfileSaveResult
  syncProfile(input: PaperProfileSyncInput, options?: PaperRadarCallOptions): Promise<PaperProfileSyncResult>
  search(input: PaperSearchInput, options?: PaperRadarCallOptions): PaperSearchResult
  rank(input: PaperRankInput, options?: PaperRadarCallOptions): PaperRankResult
  digest(input: PaperDigestInput, options?: PaperRadarCallOptions): PaperDigestResult
  diagnostics(options?: PaperRadarCallOptions): PaperRadarDiagnostics
  syncState(options?: PaperRadarCallOptions): { state: PaperSyncStateRecord[]; count: number }
  auditRecords(options?: PaperRadarCallOptions): PaperRadarAuditResult
  getProfile(name: string, options?: PaperRadarCallOptions): TopicProfile
  getPaper(id: string, options?: PaperRadarCallOptions): RankedPaper
  listPaperResources(limit?: number, options?: PaperRadarCallOptions): RankedPaper[]
  close(): void
}

export function createPaperRadarService(options: PaperRadarServiceOptions = {}): PaperRadarService {
  return new LocalPaperRadarService(options)
}

export function paperRadarPathsFromEnv(options: {
  env?: NodeJS.ProcessEnv
  dbPath?: string
  profilesPath?: string
  userDataDir?: string
} = {}): PaperRadarResolvedPaths {
  const env = options.env ?? process.env
  const userDataDir = cleanPath(options.userDataDir ?? env.PAPER_RADAR_USER_DATA)
  const configuredDbPath = cleanPath(options.dbPath ?? env.PAPER_RADAR_DB)
  const configuredProfilesPath = cleanPath(options.profilesPath ?? env.PAPER_RADAR_PROFILES)
  const dbPath = configuredDbPath
    ?? (userDataDir ? join(userDataDir, 'paper-radar', 'paper-radar.sqlite') : join(homedir(), '.sciforge', 'paper-radar.sqlite'))
  const profilesPath = configuredProfilesPath
    ?? (userDataDir
      ? join(userDataDir, 'paper-radar', 'profiles.json')
      : configuredDbPath
        ? paperRadarProfilesPathForDb(dbPath)
        : join(homedir(), '.sciforge', 'paper-radar-profiles.json'))
  return { dbPath, profilesPath }
}

export function createPaperRadarFixtureFetch(fixtureDir: string): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('export.arxiv.org/oai2')) {
      return new Response(readFileSync(join(fixtureDir, 'arxiv-oai.xml'), 'utf8'), {
        status: 200,
        headers: { 'content-type': 'text/xml; charset=utf-8' }
      })
    }
    if (url.includes('api.biorxiv.org/details')) {
      return new Response(readFileSync(join(fixtureDir, 'biorxiv.json'), 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      })
    }
    return new Response(JSON.stringify({ error: `No fixture for ${url}` }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  }) as typeof fetch
}

class LocalPaperRadarService implements PaperRadarService {
  readonly paths: PaperRadarResolvedPaths
  private readonly core: PaperRadarCoreService
  private readonly now: () => Date
  private readonly auditSink?: PaperRadarAuditSink
  private readonly maxAuditRecords: number
  private readonly auditEntries: PaperRadarAuditRecord[] = []
  private auditSequence = 0

  constructor(options: PaperRadarServiceOptions) {
    this.paths = paperRadarPathsFromEnv(options)
    this.core = options.coreService ?? createPaperRadarCoreService({
      dbPath: this.paths.dbPath,
      profilesPath: this.paths.profilesPath,
      fetchImpl: options.fetchImpl,
      now: options.now,
      profileStoreOptions: { persistDefault: false }
    })
    this.now = options.now ?? (() => new Date())
    this.auditSink = options.auditSink
    this.maxAuditRecords = Math.max(1, Math.floor(options.maxAuditRecords ?? 500))
  }

  async syncArxiv(input: ArxivSyncRequest, options: PaperRadarCallOptions = {}): Promise<SyncResult> {
    throwIfAborted(options.signal)
    const result = await this.core.syncArxiv(input)
    throwIfAborted(options.signal)
    return result
  }

  async syncBiorxiv(input: BiorxivSyncRequest, options: PaperRadarCallOptions = {}): Promise<SyncResult> {
    throwIfAborted(options.signal)
    const result = await this.core.syncBiorxiv(input)
    throwIfAborted(options.signal)
    return result
  }

  listProfiles(_input: Record<string, never> = {}, options: PaperRadarCallOptions = {}): PaperProfileListResult {
    throwIfAborted(options.signal)
    const profiles = this.core.listProfiles()
    return { profiles, count: profiles.length }
  }

  saveProfile(input: PaperProfileSaveInput, options: PaperRadarCallOptions = {}): PaperProfileSaveResult {
    throwIfAborted(options.signal)
    const profile = normalizeTopicProfile({
      name: input.name,
      description: input.description,
      keywords: input.keywords,
      excludeKeywords: input.exclude_keywords,
      arxivCategories: input.arxiv_categories,
      biorxivSubjects: input.biorxiv_subjects
    })
    const preview = isWritePreview(input)
    if (preview) {
      const audit = this.recordProfileAudit({
        capability: 'paper_profile_save',
        action: 'preview',
        ok: true,
        input,
        profile
      })
      return { dryRun: input.dry_run, preview: true, saved: false, profile, auditId: audit.auditId }
    }

    if (!isWriteConfirmed(input)) {
      this.throwConfirmationRequired({
        capability: 'paper_profile_save',
        action: 'write',
        input,
        profile: profile.name,
        reason: 'Saving a Paper Radar profile writes profiles.json and requires explicit user confirmation.'
      })
    }

    try {
      const savedProfile = this.core.saveProfile(profile)
      const audit = this.recordProfileAudit({
        capability: 'paper_profile_save',
        action: 'write',
        ok: true,
        input,
        profile: savedProfile
      })
      return {
        dryRun: false,
        preview: false,
        saved: true,
        profile: savedProfile,
        auditId: audit.auditId
      }
    } catch (error) {
      this.throwAuditedFailure(error, {
        capability: 'paper_profile_save',
        action: 'write',
        input,
        profile: profile.name,
        fallbackReason: 'Failed to save Paper Radar profile.',
        fallbackSuggestion: 'Check that profiles.json is writable, then retry with confirmed: true.'
      })
    }
  }

  async syncProfile(input: PaperProfileSyncInput, options: PaperRadarCallOptions = {}): Promise<PaperProfileSyncResult> {
    throwIfAborted(options.signal)
    const requestedProfile = input.profile ? normalizeProfileName(input.profile) : DEFAULT_PROFILE.name
    const preview = isWritePreview(input)

    if (preview) {
      try {
        const profile = this.resolveProfile(input.profile)
        const plan = this.core.planProfileSync({
          profile: profile.name,
          from: input.from,
          to: input.to,
          maxRecords: input.max_records
        })
        const audit = this.recordSyncAudit({
          capability: 'paper_profile_sync',
          action: 'preview',
          ok: true,
          input,
          profile: plan.profile,
          from: plan.from,
          to: plan.to,
          maxRecords: plan.maxRecords,
          sourceCount: plan.planned.length
        })
        return {
          dryRun: input.dry_run,
          preview: true,
          profile: plan.profile,
          from: plan.from,
          to: plan.to,
          maxRecords: plan.maxRecords,
          planned: plan.planned,
          auditId: audit.auditId
        }
      } catch (error) {
        this.throwAuditedFailure(error, {
          capability: 'paper_profile_sync',
          action: 'preview',
          input,
          profile: requestedProfile,
          fallbackReason: 'Failed to preview Paper Radar profile sync.',
          fallbackSuggestion: 'Check the profile name and sync window, then retry.'
        })
      }
    }

    if (!isWriteConfirmed(input)) {
      this.throwConfirmationRequired({
        capability: 'paper_profile_sync',
        action: 'write',
        input,
        profile: requestedProfile,
        reason: 'Syncing a Paper Radar profile fetches metadata and writes SQLite sync state, so it requires explicit user confirmation.'
      })
    }

    let profileName = requestedProfile
    let from: string | undefined
    let to: string | undefined
    let maxRecords: number | undefined
    try {
      const profile = this.resolveProfile(input.profile)
      const plan = this.core.planProfileSync({
        profile: profile.name,
        from: input.from,
        to: input.to,
        maxRecords: input.max_records
      })
      profileName = plan.profile
      from = plan.from
      to = plan.to
      maxRecords = plan.maxRecords
      throwIfAborted(options.signal)
      const result = await this.core.syncProfile({
        profile: profile.name,
        from,
        to,
        maxRecords
      })
      throwIfAborted(options.signal)
      const audit = this.recordSyncAudit({
        capability: 'paper_profile_sync',
        action: 'write',
        ok: true,
        input,
        profile: result.profile,
        from,
        to,
        maxRecords,
        sourceCount: result.results.length,
        fetched: result.fetched,
        upserted: result.upserted,
        skipped: result.skipped
      })
      return {
        dryRun: false,
        preview: false,
        ...result,
        auditId: audit.auditId
      }
    } catch (error) {
      this.throwAuditedFailure(error, {
        capability: 'paper_profile_sync',
        action: 'write',
        input,
        profile: profileName,
        from,
        to,
        maxRecords,
        fallbackReason: 'Failed to sync Paper Radar profile.',
        fallbackSuggestion: 'Retry later, or run the same request with dry_run/preview to inspect the planned sync first.'
      })
    }
  }

  search(input: PaperSearchInput, options: PaperRadarCallOptions = {}): PaperSearchResult {
    throwIfAborted(options.signal)
    return this.core.search(searchRequestFromInput(input))
  }

  rank(input: PaperRankInput, options: PaperRadarCallOptions = {}): PaperRankResult {
    throwIfAborted(options.signal)
    const profile = this.resolveProfile(input.profile)
    return this.core.rank(rankRequestFromInput(input, profile.name))
  }

  digest(input: PaperDigestInput, options: PaperRadarCallOptions = {}): PaperDigestResult {
    throwIfAborted(options.signal)
    const profile = this.resolveProfile(input.profile)
    return this.core.digest({
      ...rankRequestFromInput(input, profile.name),
      topK: input.top_k ?? 10
    })
  }

  diagnostics(options: PaperRadarCallOptions = {}): PaperRadarDiagnostics {
    throwIfAborted(options.signal)
    return {
      version: PAPER_RADAR_MCP_SERVER_VERSION,
      transport: PAPER_RADAR_WORKER_TRANSPORT,
      capabilities: PAPER_RADAR_WORKER_CAPABILITIES,
      storage: this.paths,
      stats: this.core.stats(),
      checkedAt: this.now().toISOString()
    }
  }

  syncState(options: PaperRadarCallOptions = {}): { state: PaperSyncStateRecord[]; count: number } {
    throwIfAborted(options.signal)
    const state = this.core.listSyncState()
    return { state, count: state.length }
  }

  auditRecords(options: PaperRadarCallOptions = {}): PaperRadarAuditResult {
    throwIfAborted(options.signal)
    const records = this.auditEntries.map((record) => ({ ...record }))
    return { records, count: records.length }
  }

  getProfile(name: string, options: PaperRadarCallOptions = {}): TopicProfile {
    throwIfAborted(options.signal)
    const profile = this.findProfile(name)
    if (!profile) {
      throw new PaperRadarWorkerError({
        code: 'not_found',
        reason: `Paper Radar profile not found: ${name}`,
        retryable: false,
        suggestion: 'Call gui_paper_profile_list and use one of the returned profile names.'
      })
    }
    return profile
  }

  getPaper(id: string, options: PaperRadarCallOptions = {}): RankedPaper {
    throwIfAborted(options.signal)
    const paper = this.core.getPaper(id)
    if (!paper) {
      throw new PaperRadarWorkerError({
        code: 'not_found',
        reason: `Paper Radar paper not found: ${id}`,
        retryable: false,
        suggestion: 'Call gui_paper_search or gui_paper_rank and use one of the returned paper ids.'
      })
    }
    return paper
  }

  listPaperResources(limit = 50, options: PaperRadarCallOptions = {}): RankedPaper[] {
    throwIfAborted(options.signal)
    return this.core.listRecentPapers(limit)
  }

  close(): void {
    this.core.close()
  }

  private recordAudit(input: PaperRadarAuditRecordInput): PaperRadarAuditRecord {
    const sequence = ++this.auditSequence
    const record: PaperRadarAuditRecord = {
      auditId: `pr_audit_${String(sequence).padStart(6, '0')}`,
      sequence,
      timestamp: this.now().toISOString(),
      ...input
    }
    this.auditEntries.push(record)
    while (this.auditEntries.length > this.maxAuditRecords) this.auditEntries.shift()
    try {
      this.auditSink?.(record)
    } catch {
      // Audit sinks are observers; the in-memory record above remains authoritative for this service.
    }
    return record
  }

  private recordProfileAudit(input: {
    capability: Extract<PaperRadarCapability, 'paper_profile_save'>
    action: PaperRadarAuditAction
    ok: boolean
    input: PaperProfileSaveInput
    profile: TopicProfile
    errorCode?: PaperRadarErrorCode
    reason?: string
  }): PaperRadarAuditRecord {
    return this.recordAudit({
      capability: input.capability,
      sideEffect: 'write',
      action: input.action,
      ok: input.ok,
      dryRun: input.input.dry_run,
      preview: isWritePreview(input.input),
      confirmed: isWriteConfirmed(input.input),
      profile: input.profile.name,
      keywordCount: input.profile.keywords.length,
      excludeKeywordCount: input.profile.excludeKeywords.length,
      arxivCategoryCount: input.profile.arxivCategories.length,
      biorxivSubjectCount: input.profile.biorxivSubjects.length,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.reason ? { reason: sanitizeAuditReason(input.reason) } : {})
    })
  }

  private recordSyncAudit(input: {
    capability: Extract<PaperRadarCapability, 'paper_profile_sync'>
    action: PaperRadarAuditAction
    ok: boolean
    input: PaperProfileSyncInput
    profile: string
    from?: string
    to?: string
    maxRecords?: number
    sourceCount?: number
    fetched?: number
    upserted?: number
    skipped?: number
    errorCode?: PaperRadarErrorCode
    reason?: string
  }): PaperRadarAuditRecord {
    return this.recordAudit({
      capability: input.capability,
      sideEffect: 'write',
      action: input.action,
      ok: input.ok,
      dryRun: input.input.dry_run,
      preview: isWritePreview(input.input),
      confirmed: isWriteConfirmed(input.input),
      profile: input.profile,
      ...(input.from ? { from: input.from } : {}),
      ...(input.to ? { to: input.to } : {}),
      ...(input.maxRecords !== undefined ? { maxRecords: input.maxRecords } : {}),
      ...(input.sourceCount !== undefined ? { sourceCount: input.sourceCount } : {}),
      ...(input.fetched !== undefined ? { fetched: input.fetched } : {}),
      ...(input.upserted !== undefined ? { upserted: input.upserted } : {}),
      ...(input.skipped !== undefined ? { skipped: input.skipped } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.reason ? { reason: sanitizeAuditReason(input.reason) } : {})
    })
  }

  private throwConfirmationRequired(input: {
    capability: Extract<PaperRadarCapability, 'paper_profile_save' | 'paper_profile_sync'>
    action: PaperRadarAuditAction
    input: PaperProfileSaveInput | PaperProfileSyncInput
    profile: string
    reason: string
  }): never {
    const audit = input.capability === 'paper_profile_save'
      ? this.recordProfileAudit({
        capability: input.capability,
        action: input.action,
        ok: false,
        input: input.input as PaperProfileSaveInput,
        profile: normalizeTopicProfile({
          name: input.profile,
          keywords: [],
          excludeKeywords: [],
          arxivCategories: [],
          biorxivSubjects: []
        }),
        errorCode: 'confirmation_required',
        reason: input.reason
      })
      : this.recordSyncAudit({
        capability: input.capability,
        action: input.action,
        ok: false,
        input: input.input as PaperProfileSyncInput,
        profile: input.profile,
        errorCode: 'confirmation_required',
        reason: input.reason
      })
    const confirmationRequired = mcpWriteConfirmationRequired({
      worker: 'paper-radar',
      tool: input.capability === 'paper_profile_save' ? 'gui_paper_profile_save' : 'gui_paper_profile_sync',
      action: input.capability === 'paper_profile_save' ? 'profile_save' : 'profile_sync',
      destructive: false,
      confirmationId: mcpWriteControlFromInput(input.input).confirmationId ?? `${input.capability}:${input.profile}`
    })
    throw new PaperRadarWorkerError({
      code: 'confirmation_required',
      reason: input.reason,
      retryable: false,
      suggestion: 'Run the same request with dry_run or preview first, then retry with confirmed: true.',
      auditId: audit.auditId,
      confirmationRequired,
      sideEffect: 'write'
    })
  }

  private throwAuditedFailure(error: unknown, input: {
    capability: Extract<PaperRadarCapability, 'paper_profile_save' | 'paper_profile_sync'>
    action: PaperRadarAuditAction
    input: PaperProfileSaveInput | PaperProfileSyncInput
    profile: string
    from?: string
    to?: string
    maxRecords?: number
    fallbackReason: string
    fallbackSuggestion: string
  }): never {
    const payload = paperRadarErrorPayloadFromUnknown(error, {
      reason: input.fallbackReason,
      retryable: false,
      suggestion: input.fallbackSuggestion
    })
    const audit = input.capability === 'paper_profile_save'
      ? this.recordProfileAudit({
        capability: input.capability,
        action: input.action,
        ok: false,
        input: input.input as PaperProfileSaveInput,
        profile: normalizeTopicProfile({
          name: input.profile,
          keywords: [],
          excludeKeywords: [],
          arxivCategories: [],
          biorxivSubjects: []
        }),
        errorCode: payload.code,
        reason: payload.reason
      })
      : this.recordSyncAudit({
        capability: input.capability,
        action: input.action,
        ok: false,
        input: input.input as PaperProfileSyncInput,
        profile: input.profile,
        from: input.from,
        to: input.to,
        maxRecords: input.maxRecords,
        errorCode: payload.code,
        reason: payload.reason
      })
    throw new PaperRadarWorkerError({
      ...payload,
      auditId: audit.auditId,
      sideEffect: 'write'
    })
  }

  private resolveProfile(name?: string): TopicProfile {
    if (!name) return this.core.getProfile(DEFAULT_PROFILE.name)
    const profile = this.findProfile(name)
    if (!profile) {
      throw new PaperRadarWorkerError({
        code: 'not_found',
        reason: `Paper Radar profile not found: ${name}`,
        retryable: false,
        suggestion: 'Call gui_paper_profile_list before syncing, ranking, or digesting with a profile.'
      })
    }
    return profile
  }

  private findProfile(name: string): TopicProfile | undefined {
    const normalizedName = normalizeProfileName(name)
    return this.core.findProfile(normalizedName)
  }
}

function searchRequestFromInput(input: PaperSearchInput): SearchRequest {
  return {
    query: input.query,
    sources: input.sources,
    categories: input.categories,
    from: input.from,
    to: input.to,
    topK: input.top_k
  }
}

function rankRequestFromInput(input: PaperRankInput, profile: string): RankRequest {
  return {
    ...searchRequestFromInput(input),
    profile,
    keywords: input.keywords,
    excludeKeywords: input.exclude_keywords,
    days: input.days
  }
}

function normalizeProfileName(name: string): string {
  return normalizeTopicProfile({
    name,
    keywords: [],
    excludeKeywords: [],
    arxivCategories: [],
    biorxivSubjects: []
  }).name
}

function cleanPath(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned ? cleaned : undefined
}

function isWritePreview(input: { dry_run?: boolean; preview?: boolean }): boolean {
  return input.dry_run === true || input.preview === true
}

function isWriteConfirmed(input: {
  confirmed?: boolean
  confirmation_id?: string
  confirmation?: { confirmed: true } | 'confirmed'
}): boolean {
  return (
    input.confirmed === true ||
    input.confirmation === 'confirmed' ||
    input.confirmation?.confirmed === true ||
    mcpWriteControlFromInput(input).confirmed
  )
}

function sanitizeAuditReason(reason: string): string {
  const genericRedacted = mcpWriteRedactedInput(reason)
  const redacted = (typeof genericRedacted === 'string' ? genericRedacted : reason)
    .replace(/((?:token|secret|api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)[^\s&]+/gi, '$1[redacted]')
    .replace(/([?&](?:token|secret|api[_-]?key|access[_-]?token|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw new PaperRadarWorkerError({
    code: 'aborted',
    reason: 'Paper Radar request was aborted.',
    retryable: false,
    suggestion: 'Retry the request if it was cancelled accidentally.'
  })
}

export function paperRadarProfilesPathForDb(dbPath: string): string {
  return join(dirname(dbPath), 'profiles.json')
}
