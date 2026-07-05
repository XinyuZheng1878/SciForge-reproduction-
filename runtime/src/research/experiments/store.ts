import { mkdir, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import {
  ExperimentSpec,
  ExperimentRun,
  ExperimentIndex,
  ExperimentSpecCreateRequest,
  ExperimentSpecUpdateRequest,
  ExperimentDiagnostics,
  type ExperimentSpec as ExperimentSpecType,
  type ExperimentRun as ExperimentRunType,
  type ExperimentIndex as ExperimentIndexType,
  type ExperimentSpecCreateRequest as CreateRequest,
  type ExperimentSpecUpdateRequest as UpdateRequest,
  type ExperimentDiagnostics as Diagnostics
} from './types.js'

const DEFAULT_INDEX_PATH = '.agents/experiments.json'

export interface ExperimentStore {
  // Spec CRUD
  createSpec(input: CreateRequest): Promise<ExperimentSpecType>
  getSpec(id: string): Promise<ExperimentSpecType | null>
  updateSpec(id: string, patch: UpdateRequest): Promise<ExperimentSpecType>
  deleteSpec(id: string): Promise<ExperimentSpecType>
  listSpecs(filter?: ExperimentListFilter): Promise<ExperimentSpecType[]>

  // Run CRUD
  createRun(input: {
    specId: string
    attempt?: number
    command?: string
  }): Promise<ExperimentRunType>
  updateRun(id: string, patch: Partial<ExperimentRunType>): Promise<ExperimentRunType>
  getRun(id: string): Promise<ExperimentRunType | null>
  listRuns(specId?: string, filter?: RunListFilter): Promise<ExperimentRunType[]>

  // Diagnostics
  diagnostics(): Promise<Diagnostics>
  getIndexPath(): string
}

export type ExperimentListFilter = {
  language?: string
  tags?: string[]
  hypothesisId?: string
  limit?: number
}

export type RunListFilter = {
  status?: string
  limit?: number
}

export class JsonExperimentStore implements ExperimentStore {
  private cache: ExperimentIndexType | null = null

  constructor(
    private readonly options: {
      workspaceDir: string
      indexPath?: string
      nowIso?: () => string
    }
  ) {}

  getIndexPath(): string {
    return resolve(
      this.options.workspaceDir,
      this.options.indexPath ?? DEFAULT_INDEX_PATH
    )
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }

  private async load(): Promise<ExperimentIndexType> {
    if (this.cache) return this.cache
    const indexPath = this.getIndexPath()
    try {
      const raw = await readFile(indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      this.cache = ExperimentIndex.parse(parsed)
    } catch {
      this.cache = ExperimentIndex.parse({
        version: 1,
        specs: [],
        runs: [],
        lastUpdated: this.now()
      })
    }
    return this.cache
  }

  private async save(index: ExperimentIndexType): Promise<void> {
    const indexPath = this.getIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    const data: ExperimentIndexType = {
      ...index,
      lastUpdated: this.now()
    }
    ExperimentIndex.parse(data) // validate
    await atomicWriteFile(indexPath, JSON.stringify(data, null, 2) + '\n')
    this.cache = data
  }

  // ── Spec CRUD ──────────────────────────────────────────

  async createSpec(input: CreateRequest): Promise<ExperimentSpecType> {
    const index = await this.load()
    const id = input.id ?? this.generateSpecId()
    if (index.specs.some(s => s.id === id)) {
      throw new Error(`Experiment spec already exists: ${id}`)
    }
    const now = this.now()
    const spec = ExperimentSpec.parse({
      ...input,
      id,
      createdAt: now,
      updatedAt: now
    })
    index.specs.push(spec)
    await this.save(index)
    return spec
  }

  async getSpec(id: string): Promise<ExperimentSpecType | null> {
    const index = await this.load()
    return index.specs.find(s => s.id === id) ?? null
  }

  async updateSpec(id: string, patch: UpdateRequest): Promise<ExperimentSpecType> {
    const index = await this.load()
    const idx = index.specs.findIndex(s => s.id === id)
    if (idx === -1) throw new Error(`Experiment spec not found: ${id}`)
    const updated = ExperimentSpec.parse({
      ...index.specs[idx],
      ...patch,
      updatedAt: this.now()
    })
    index.specs[idx] = updated
    await this.save(index)
    return updated
  }

  async deleteSpec(id: string): Promise<ExperimentSpecType> {
    const index = await this.load()
    const idx = index.specs.findIndex(s => s.id === id)
    if (idx === -1) throw new Error(`Experiment spec not found: ${id}`)
    const [removed] = index.specs.splice(idx, 1)
    // Also remove associated runs
    index.runs = index.runs.filter(r => r.specId !== id)
    await this.save(index)
    return removed
  }

  async listSpecs(filter: ExperimentListFilter = {}): Promise<ExperimentSpecType[]> {
    const index = await this.load()
    let specs = [...index.specs]
    if (filter.language) {
      specs = specs.filter(s => s.language === filter.language)
    }
    if (filter.tags && filter.tags.length > 0) {
      specs = specs.filter(s => filter.tags!.some(t => s.tags.includes(t)))
    }
    if (filter.hypothesisId) {
      specs = specs.filter(s => s.hypothesisId === filter.hypothesisId)
    }
    if (filter.limit && filter.limit > 0) {
      specs = specs.slice(0, filter.limit)
    }
    return specs
  }

  // ── Run CRUD ───────────────────────────────────────────

  async createRun(input: {
    specId: string
    attempt?: number
    command?: string
  }): Promise<ExperimentRunType> {
    const index = await this.load()
    const spec = index.specs.find(s => s.id === input.specId)
    if (!spec) throw new Error(`Experiment spec not found: ${input.specId}`)
    const id = `RUN-${this.dateSlug()}-${randomUUID().slice(0, 8)}`
    const run = ExperimentRun.parse({
      id,
      specId: input.specId,
      status: 'queued',
      attempt: input.attempt ?? 0,
      command: input.command ?? '',
      createdAt: this.now()
    })
    index.runs.push(run)
    await this.save(index)
    return run
  }

  async updateRun(id: string, patch: Partial<ExperimentRunType>): Promise<ExperimentRunType> {
    const index = await this.load()
    const idx = index.runs.findIndex(r => r.id === id)
    if (idx === -1) throw new Error(`Experiment run not found: ${id}`)
    const updated = ExperimentRun.parse({
      ...index.runs[idx],
      ...patch
    })
    index.runs[idx] = updated
    await this.save(index)
    return updated
  }

  async getRun(id: string): Promise<ExperimentRunType | null> {
    const index = await this.load()
    return index.runs.find(r => r.id === id) ?? null
  }

  async listRuns(specId?: string, filter: RunListFilter = {}): Promise<ExperimentRunType[]> {
    const index = await this.load()
    let runs = [...index.runs]
    if (specId) {
      runs = runs.filter(r => r.specId === specId)
    }
    if (filter.status) {
      runs = runs.filter(r => r.status === filter.status)
    }
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    if (filter.limit && filter.limit > 0) {
      runs = runs.slice(0, filter.limit)
    }
    return runs
  }

  // ── Diagnostics ────────────────────────────────────────

  async diagnostics(): Promise<Diagnostics> {
    const index = await this.load()
    const byStatus: Record<string, number> = {}
    const byLanguage: Record<string, number> = {}
    let totalOutputBytes = 0

    for (const run of index.runs) {
      byStatus[run.status] = (byStatus[run.status] ?? 0) + 1
      totalOutputBytes += Buffer.byteLength(run.output, 'utf-8')
    }
    for (const spec of index.specs) {
      byLanguage[spec.language] = (byLanguage[spec.language] ?? 0) + 1
    }

    return ExperimentDiagnostics.parse({
      indexPath: this.getIndexPath(),
      specCount: index.specs.length,
      runCount: index.runs.length,
      byStatus,
      byLanguage,
      totalOutputBytes
    })
  }

  // ── Helpers ────────────────────────────────────────────

  private generateSpecId(): string {
    return `EXP-${Date.now().toString(36).toUpperCase()}`
  }

  private dateSlug(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}
