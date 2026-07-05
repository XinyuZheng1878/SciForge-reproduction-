import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import {
  Hypothesis,
  HypothesisIndex,
  HypothesisCreateRequest,
  HypothesisUpdateRequest,
  HypothesisDiagnostics,
  type Hypothesis as HypothesisType,
  type HypothesisIndex as HypothesisIndexType,
  type HypothesisCreateRequest as CreateRequest,
  type HypothesisUpdateRequest as UpdateRequest,
  type HypothesisDiagnostics as Diagnostics
} from './types.js'

const DEFAULT_INDEX_PATH = '.agents/hypotheses.json'

export interface HypothesisStore {
  create(input: CreateRequest): Promise<HypothesisType>
  get(id: string): Promise<HypothesisType | null>
  update(id: string, patch: UpdateRequest): Promise<HypothesisType>
  list(filter?: HypothesisListFilter): Promise<HypothesisType[]>
  delete(id: string): Promise<HypothesisType>
  diagnostics(): Promise<Diagnostics>
  getIndexPath(): string
}

export type HypothesisListFilter = {
  status?: string
  tags?: string[]
  parentHypothesisId?: string
  limit?: number
}

export class JsonHypothesisStore implements HypothesisStore {
  private cache: HypothesisIndexType | null = null

  constructor(
    private readonly options: {
      workspaceDir: string
      indexPath?: string
      nowIso?: () => string
    }
  ) {}

  getIndexPath(): string {
    return resolve(this.options.workspaceDir, this.options.indexPath ?? DEFAULT_INDEX_PATH)
  }

  private now(): string {
    return this.options.nowIso?.() ?? new Date().toISOString()
  }

  private async load(): Promise<HypothesisIndexType> {
    if (this.cache) return this.cache
    try {
      const raw = await readFile(this.getIndexPath(), 'utf-8')
      this.cache = HypothesisIndex.parse(JSON.parse(raw))
    } catch {
      this.cache = HypothesisIndex.parse({ version: 1, hypotheses: [], lastUpdated: this.now() })
    }
    return this.cache
  }

  private async save(index: HypothesisIndexType): Promise<void> {
    const data = HypothesisIndex.parse({ ...index, lastUpdated: this.now() })
    await mkdir(dirname(this.getIndexPath()), { recursive: true })
    await atomicWriteFile(this.getIndexPath(), JSON.stringify(data, null, 2) + '\n')
    this.cache = data
  }

  async create(input: CreateRequest): Promise<HypothesisType> {
    const index = await this.load()
    const id = input.id ?? `HYP-${this.dateSlug()}-${randomUUID().slice(0, 8)}`
    if (index.hypotheses.some(h => h.id === id)) {
      throw new Error(`Hypothesis already exists: ${id}`)
    }
    const now = this.now()
    const { priorConfidence, ...inputRest } = input
    const hyp = Hypothesis.parse({
      ...inputRest,
      id,
      status: 'draft',
      confidence: {
        prior: priorConfidence ?? 0.5,
        posterior: priorConfidence ?? 0.5,
        totalTrials: 0,
        supportingTrials: 0,
        contradictingTrials: 0,
        lastUpdated: now
      },
      createdAt: now,
      updatedAt: now
    })
    // Link parent
    if (hyp.parentHypothesisId) {
      const parent = index.hypotheses.find(h => h.id === hyp.parentHypothesisId)
      if (parent && !parent.childHypothesisIds.includes(hyp.id)) {
        parent.childHypothesisIds.push(hyp.id)
      }
    }
    index.hypotheses.push(hyp)
    await this.save(index)
    return hyp
  }

  async get(id: string): Promise<HypothesisType | null> {
    return (await this.load()).hypotheses.find(h => h.id === id) ?? null
  }

  async update(id: string, patch: UpdateRequest): Promise<HypothesisType> {
    const index = await this.load()
    const idx = index.hypotheses.findIndex(h => h.id === id)
    if (idx === -1) throw new Error(`Hypothesis not found: ${id}`)

    const current = index.hypotheses[idx]
    const now = this.now()

    // Handle trial recording (Bayesian update)
    let confidence = current.confidence
    if (patch.recordTrial) {
      const { supported, experimentId } = patch.recordTrial
      const total = confidence.totalTrials + 1
      const supporting = confidence.supportingTrials + (supported ? 1 : 0)
      const contradicting = confidence.contradictingTrials + (supported ? 0 : 1)
      // Bayesian update: posterior = (supporting + pseudocount * prior) / (total + 2*pseudocount)
      // Using pseudocount=0.5 to allow faster hypothesis confirmation/falsification
      const pseudocount = 0.5
      const posterior = (supporting + pseudocount * confidence.prior) / (total + 2 * pseudocount)
      confidence = {
        ...confidence,
        posterior: Math.max(0, Math.min(1, posterior)),
        totalTrials: total,
        supportingTrials: supporting,
        contradictingTrials: contradicting,
        lastUpdated: now
      }
      // Auto-update status based on confidence
      if (patch.status === undefined) {
        if (confidence.posterior >= 0.8 && total >= 3) {
          patch.status = 'validated'
        } else if (confidence.posterior <= 0.1 && total >= 3) {
          patch.status = 'falsified'
        } else if (total >= 3) {
          patch.status = confidence.posterior > confidence.prior ? 'supported' : 'contradicted'
        } else {
          patch.status = 'active'
        }
      }
    }

    // Apply update (exclude `recordTrial` which is not a Hypothesis field)
    const { recordTrial: _, ...patchRest } = patch
    const updated = Hypothesis.parse({
      ...current,
      ...patchRest,
      id: current.id,
      confidence,
      createdAt: current.createdAt,
      updatedAt: now
    })

    // Ensure experimentId is recorded
    if (patch.recordTrial?.experimentId && !updated.experimentIds.includes(patch.recordTrial.experimentId)) {
      updated.experimentIds.push(patch.recordTrial.experimentId)
    }

    index.hypotheses[idx] = updated
    await this.save(index)
    return updated
  }

  async list(filter: HypothesisListFilter = {}): Promise<HypothesisType[]> {
    let hyps = [...(await this.load()).hypotheses]
    if (filter.status) hyps = hyps.filter(h => h.status === filter.status)
    if (filter.tags?.length) hyps = hyps.filter(h => filter.tags!.some(t => h.tags.includes(t)))
    if (filter.parentHypothesisId) hyps = hyps.filter(h => h.parentHypothesisId === filter.parentHypothesisId)
    hyps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (filter.limit && filter.limit > 0) hyps = hyps.slice(0, filter.limit)
    return hyps
  }

  async delete(id: string): Promise<HypothesisType> {
    const index = await this.load()
    const idx = index.hypotheses.findIndex(h => h.id === id)
    if (idx === -1) throw new Error(`Hypothesis not found: ${id}`)
    const [removed] = index.hypotheses.splice(idx, 1)
    // Unlink from parent
    if (removed.parentHypothesisId) {
      const parent = index.hypotheses.find(h => h.id === removed.parentHypothesisId)
      if (parent) {
        parent.childHypothesisIds = parent.childHypothesisIds.filter(cid => cid !== id)
      }
    }
    await this.save(index)
    return removed
  }

  async diagnostics(): Promise<Diagnostics> {
    const hyps = (await this.load()).hypotheses
    const byStatus: Record<string, number> = {}
    let totalPosterior = 0, totalTrials = 0
    for (const h of hyps) {
      byStatus[h.status] = (byStatus[h.status] ?? 0) + 1
      totalPosterior += h.confidence.posterior
      totalTrials += h.confidence.totalTrials
    }
    return HypothesisDiagnostics.parse({
      totalCount: hyps.length,
      byStatus,
      activeCount: (byStatus['active'] ?? 0) + (byStatus['draft'] ?? 0),
      validatedCount: byStatus['validated'] ?? 0,
      falsifiedCount: byStatus['falsified'] ?? 0,
      averageConfidence: hyps.length > 0 ? totalPosterior / hyps.length : 0,
      totalTrials
    })
  }

  private dateSlug(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}
