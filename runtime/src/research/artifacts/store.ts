import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { load as parseYaml, dump as stringifyYaml } from 'js-yaml'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import {
  ResearchArtifact,
  ResearchArtifactIndex,
  ResearchArtifactCreateRequest,
  ResearchArtifactUpdateRequest,
  ResearchArtifactDiagnostics,
  type ResearchArtifact as ResearchArtifactType,
  type ResearchArtifactIndex as ResearchArtifactIndexType,
  type ResearchArtifactCreateRequest as CreateRequest,
  type ResearchArtifactUpdateRequest as UpdateRequest,
  type ResearchArtifactDiagnostics as Diagnostics
} from './types.js'

const DEFAULT_INDEX_PATH = '.agents/artifacts.yml'

export interface ResearchArtifactStore {
  create(input: CreateRequest): Promise<ResearchArtifactType>
  update(id: string, patch: UpdateRequest): Promise<ResearchArtifactType>
  get(id: string): Promise<ResearchArtifactType | null>
  list(filter?: ArtifactListFilter): Promise<ResearchArtifactType[]>
  delete(id: string): Promise<ResearchArtifactType>
  diagnostics(): Promise<Diagnostics>
  getIndexPath(): string
}

export type ArtifactListFilter = {
  type?: string
  status?: string
  evidenceLevel?: string
  visibility?: string
  tags?: string[]
  hypothesisId?: string
  limit?: number
}

export class YamlResearchArtifactStore implements ResearchArtifactStore {
  private cache: ResearchArtifactIndexType | null = null

  constructor(
    private readonly options: {
      workspaceDir: string
      indexPath?: string
      projectName?: string
      nowIso?: () => string
      idGenerator?: () => string
    }
  ) {}

  getIndexPath(): string {
    return resolve(
      this.options.workspaceDir,
      this.options.indexPath ?? DEFAULT_INDEX_PATH
    )
  }

  async create(input: CreateRequest): Promise<ResearchArtifactType> {
    const index = await this.readIndex()
    const now = this.now()
    const id = input.id ?? this.options.idGenerator?.() ?? this.generateId(input.type, now)

    if (index.artifacts.some((a) => a.id === id)) {
      throw new Error(`Artifact already exists: ${id}`)
    }

    const artifact = ResearchArtifact.parse({
      ...input,
      id,
      createdAt: now,
      updatedAt: now
    })

    index.artifacts.push(artifact)
    index.lastUpdated = now
    await this.writeIndex(index)
    this.cache = index
    return artifact
  }

  async update(id: string, patch: UpdateRequest): Promise<ResearchArtifactType> {
    const index = await this.readIndex()
    const idx = index.artifacts.findIndex((a) => a.id === id)
    if (idx === -1) throw new Error(`Artifact not found: ${id}`)

    const now = this.now()
    const updated = ResearchArtifact.parse({
      ...index.artifacts[idx],
      ...patch,
      updatedAt: now
    })

    index.artifacts[idx] = updated
    index.lastUpdated = now
    await this.writeIndex(index)
    this.cache = index
    return updated
  }

  async get(id: string): Promise<ResearchArtifactType | null> {
    const index = await this.readIndex()
    return index.artifacts.find((a) => a.id === id) ?? null
  }

  async list(filter: ArtifactListFilter = {}): Promise<ResearchArtifactType[]> {
    const index = await this.readIndex()
    let results = [...index.artifacts]

    if (filter.type) {
      results = results.filter((a) => a.type === filter.type)
    }
    if (filter.status) {
      results = results.filter((a) => a.status === filter.status)
    }
    if (filter.evidenceLevel) {
      results = results.filter((a) => a.evidenceLevel === filter.evidenceLevel)
    }
    if (filter.visibility) {
      results = results.filter((a) => a.visibility === filter.visibility)
    }
    if (filter.hypothesisId) {
      results = results.filter((a) => a.hypothesisId === filter.hypothesisId)
    }
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter((a) =>
        filter.tags!.some((tag) => a.tags.includes(tag))
      )
    }

    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit)
    }

    return results
  }

  async delete(id: string): Promise<ResearchArtifactType> {
    const index = await this.readIndex()
    const idx = index.artifacts.findIndex((a) => a.id === id)
    if (idx === -1) throw new Error(`Artifact not found: ${id}`)

    const [removed] = index.artifacts.splice(idx, 1)
    index.lastUpdated = this.now()
    await this.writeIndex(index)
    this.cache = index
    return removed
  }

  async diagnostics(): Promise<Diagnostics> {
    const index = await this.readIndex()
    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    const byEvidenceLevel: Record<string, number> = {}
    const byVisibility: Record<string, number> = {}
    let highRiskCount = 0
    let pendingSyncCount = 0

    for (const a of index.artifacts) {
      byType[a.type] = (byType[a.type] ?? 0) + 1
      byStatus[a.status] = (byStatus[a.status] ?? 0) + 1
      byEvidenceLevel[a.evidenceLevel] = (byEvidenceLevel[a.evidenceLevel] ?? 0) + 1
      byVisibility[a.visibility] = (byVisibility[a.visibility] ?? 0) + 1
      if (a.riskLevel === 'high') highRiskCount++
      if (a.visibility !== 'local-only' && a.status !== 'completed') pendingSyncCount++
    }

    return ResearchArtifactDiagnostics.parse({
      indexPath: this.getIndexPath(),
      totalCount: index.artifacts.length,
      byType,
      byStatus,
      byEvidenceLevel,
      byVisibility,
      highRiskCount,
      pendingSyncCount
    })
  }

  // ── private ──────────────────────────────────────────────

  private async readIndex(): Promise<ResearchArtifactIndexType> {
    if (this.cache) return this.cache

    const indexPath = this.getIndexPath()
    try {
      await stat(indexPath)
      const raw = await readFile(indexPath, 'utf8')
      const parsed = ResearchArtifactIndex.parse(parseYaml(raw) ?? { artifacts: [], version: 1, lastUpdated: this.now() })
      this.cache = parsed
      return parsed
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        const empty = ResearchArtifactIndex.parse({
          version: 1,
          projectName: this.options.projectName,
          artifacts: [],
          lastUpdated: this.now()
        })
        this.cache = empty
        return empty
      }
      throw error
    }
  }

  private async writeIndex(index: ResearchArtifactIndexType): Promise<void> {
    const indexPath = this.getIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    const yaml = stringifyYaml(index, { lineWidth: 120, noRefs: true })
    await atomicWriteFile(indexPath, yaml)
  }

  private generateId(type: string, now: string): string {
    const date = now.slice(0, 10)
    const typePrefix = type.slice(0, 3).toUpperCase()
    const seq = Math.random().toString(36).slice(2, 6)
    return `${typePrefix}-${date}-${seq}`
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }
}
