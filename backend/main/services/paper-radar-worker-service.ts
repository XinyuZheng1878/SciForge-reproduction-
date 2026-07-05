import {
  createPaperRadarService,
  paperRadarErrorPayloadFromUnknown,
  paperRadarPathsFromEnv,
  type PaperRadarService
} from '../../../workers/paper-radar/src'
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
} from '../../shared/paper-radar'

const PAPER_RADAR_SERVICE_ID = 'sciforge.paper-radar'

export type PaperRadarWorkerServiceOptions = {
  userDataDir?: string
  env?: NodeJS.ProcessEnv
  service?: PaperRadarService
}

export type PaperRadarWorkerService = {
  status(): Promise<PaperRadarStatus>
  syncArxiv(input: PaperRadarArxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncBiorxiv(input: PaperRadarBiorxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>>
  syncProfile(input: PaperRadarProfileSyncInput): Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>>
  listProfiles(): Promise<PaperRadarApiResult<PaperRadarProfileListResult>>
  saveProfile(input: PaperRadarProfile): Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>>
  search(input: PaperRadarSearchInput): Promise<PaperRadarApiResult<PaperRadarSearchResult>>
  rank(input: PaperRadarRankInput): Promise<PaperRadarApiResult<PaperRadarRankResult>>
  digest(input: PaperRadarDigestInput): Promise<PaperRadarApiResult<PaperRadarDigestResult>>
  close(): void
}

export function createPaperRadarWorkerService(
  options: PaperRadarWorkerServiceOptions = {}
): PaperRadarWorkerService {
  const service = options.service ?? createPaperRadarService({
    ...paperRadarPathsFromEnv({
      env: options.env,
      userDataDir: options.userDataDir
    }),
    env: options.env
  })
  return new LocalPaperRadarWorkerService(service)
}

class LocalPaperRadarWorkerService implements PaperRadarWorkerService {
  constructor(private readonly service: PaperRadarService) {}

  async status(): Promise<PaperRadarStatus> {
    try {
      const diagnostics = this.service.diagnostics()
      return {
        ok: true,
        service: PAPER_RADAR_SERVICE_ID,
        stats: diagnostics.stats,
        checkedAt: diagnostics.checkedAt
      }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async syncArxiv(input: PaperRadarArxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
    return apiResult(async () => this.service.syncArxiv({
      categories: input.categories,
      since: input.since,
      until: input.until,
      maxRecords: input.maxRecords
    }))
  }

  async syncBiorxiv(input: PaperRadarBiorxivSyncInput): Promise<PaperRadarApiResult<PaperRadarSyncResult>> {
    return apiResult(async () => this.service.syncBiorxiv({
      from: input.from,
      to: input.to,
      maxRecords: input.maxRecords
    }))
  }

  async syncProfile(input: PaperRadarProfileSyncInput): Promise<PaperRadarApiResult<PaperRadarProfileSyncResult>> {
    return apiResult(async () => {
      const result = await this.service.syncProfile({
        profile: input.profile,
        from: input.from,
        to: input.to,
        max_records: input.maxRecords,
        dry_run: false,
        preview: false,
        confirmed: true,
        confirmation_id: 'gui-paper-radar-profile-sync'
      })
      if (result.preview) {
        return { profile: result.profile, results: [] }
      }
      return { profile: result.profile, results: result.results }
    })
  }

  async listProfiles(): Promise<PaperRadarApiResult<PaperRadarProfileListResult>> {
    return apiResult(async () => {
      const result = this.service.listProfiles()
      return { profiles: result.profiles }
    })
  }

  async saveProfile(input: PaperRadarProfile): Promise<PaperRadarApiResult<PaperRadarProfileSaveResult>> {
    return apiResult(async () => {
      const result = this.service.saveProfile({
        name: input.name,
        description: input.description,
        keywords: input.keywords,
        exclude_keywords: input.excludeKeywords,
        arxiv_categories: input.arxivCategories,
        biorxiv_subjects: input.biorxivSubjects,
        dry_run: false,
        preview: false,
        confirmed: true,
        confirmation_id: 'gui-paper-radar-profile-save'
      })
      return { profile: result.profile }
    })
  }

  async search(input: PaperRadarSearchInput): Promise<PaperRadarApiResult<PaperRadarSearchResult>> {
    return apiResult(async () => this.service.search({
      query: input.query,
      sources: input.sources,
      categories: input.categories,
      from: input.from,
      to: input.to,
      top_k: input.topK
    }))
  }

  async rank(input: PaperRadarRankInput): Promise<PaperRadarApiResult<PaperRadarRankResult>> {
    return apiResult(async () => this.service.rank({
      ...rankInput(input),
      profile: input.profile
    }))
  }

  async digest(input: PaperRadarDigestInput): Promise<PaperRadarApiResult<PaperRadarDigestResult>> {
    return apiResult(async () => this.service.digest({
      ...rankInput(input),
      profile: input.profile
    }))
  }

  close(): void {
    this.service.close()
  }
}

function rankInput(input: PaperRadarRankInput | PaperRadarDigestInput) {
  return {
    query: input.query,
    sources: input.sources,
    categories: input.categories,
    from: input.from,
    to: input.to,
    top_k: input.topK,
    keywords: input.keywords,
    exclude_keywords: input.excludeKeywords,
    days: input.days
  }
}

async function apiResult<T>(fn: () => T | Promise<T>): Promise<PaperRadarApiResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

function errorMessage(error: unknown): string {
  return paperRadarErrorPayloadFromUnknown(error).reason
}
