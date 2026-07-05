import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFile } from '../../adapters/file/atomic-write.js'
import {
  Paper,
  PaperIndex,
  PaperCreateRequest,
  PaperUpdateRequest,
  PaperDiagnostics,
  IMRAD_OUTLINE,
  SHORT_REPORT_OUTLINE,
  type Paper as PaperType,
  type PaperSection,
  type SubSection,
  type PaperReference,
  type PaperIndex as PaperIndexType,
  type PaperCreateRequest as CreateRequest,
  type PaperUpdateRequest as UpdateRequest,
  type PaperDiagnostics as Diagnostics
} from './types.js'

const DEFAULT_INDEX_PATH = '.agents/papers.json'

export interface PaperStore {
  create(input: CreateRequest): Promise<PaperType>
  get(id: string): Promise<PaperType | null>
  update(id: string, patch: UpdateRequest): Promise<PaperType>
  list(filter?: PaperListFilter): Promise<PaperType[]>
  delete(id: string): Promise<PaperType>
  /** Generate content from research data */
  generateContent(
    paper: PaperType,
    researchData: ResearchData
  ): Promise<{ sections: PaperSection[]; references: PaperReference[] }>
  /** Write paper to Markdown file */
  exportMarkdown(paper: PaperType, outputPath?: string): Promise<string>
  diagnostics(): Promise<Diagnostics>
  getIndexPath(): string
}

export type PaperListFilter = {
  status?: string
  limit?: number
}

/** Aggregated research data passed to the paper generator */
export type ResearchData = {
  goal?: string
  hypotheses?: Array<{
    id: string
    title: string
    statement: string
    status: string
    confidence: number
    totalTrials: number
    experimentIds: string[]
  }>
  experiments?: Array<{
    id: string
    title: string
    language: string
    status?: string
    exitCode?: number | null
    metrics?: Record<string, number>
  }>
  artifacts?: Array<{
    id: string
    type: string
    title: string
    summary: string
    evidenceLevel: string
    interpretation?: string
  }>
  conclusions?: string[]
}

export class JsonPaperStore implements PaperStore {
  private cache: PaperIndexType | null = null

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

  private async load(): Promise<PaperIndexType> {
    if (this.cache) return this.cache
    try {
      this.cache = PaperIndex.parse(JSON.parse(await readFile(this.getIndexPath(), 'utf-8')))
    } catch {
      this.cache = PaperIndex.parse({ version: 1, papers: [], lastUpdated: this.now() })
    }
    return this.cache
  }

  private async save(index: PaperIndexType): Promise<void> {
    const data = PaperIndex.parse({ ...index, lastUpdated: this.now() })
    await mkdir(dirname(this.getIndexPath()), { recursive: true })
    await atomicWriteFile(this.getIndexPath(), JSON.stringify(data, null, 2) + '\n')
    this.cache = data
  }

  async create(input: CreateRequest): Promise<PaperType> {
    const index = await this.load()
    const id = input.id ?? `PAPER-${this.dateSlug()}-${randomUUID().slice(0, 8)}`
    if (index.papers.some(p => p.id === id)) {
      throw new Error(`Paper already exists: ${id}`)
    }
    const now = this.now()

    // Select template sections
    let sections: PaperSection[]
    if (input.template === 'short_report') {
      sections = JSON.parse(JSON.stringify(SHORT_REPORT_OUTLINE)) as PaperSection[]
    } else if (input.template === 'custom' && input.customSections) {
      sections = input.customSections as PaperSection[]
    } else {
      sections = JSON.parse(JSON.stringify(IMRAD_OUTLINE)) as PaperSection[]
    }

    const paper = Paper.parse({
      id,
      title: input.title,
      authors: input.authors ?? [],
      abstract: input.abstract ?? '',
      keywords: input.keywords ?? [],
      status: 'draft',
      venue: input.venue ?? '',
      sections,
      references: [],
      hypothesisIds: input.hypothesisIds ?? [],
      experimentIds: input.experimentIds ?? [],
      artifactIds: input.artifactIds ?? [],
      outputPath: '',
      createdAt: now,
      updatedAt: now
    })
    index.papers.push(paper)
    await this.save(index)
    return paper
  }

  async get(id: string): Promise<PaperType | null> {
    return (await this.load()).papers.find(p => p.id === id) ?? null
  }

  async update(id: string, patch: UpdateRequest): Promise<PaperType> {
    const index = await this.load()
    const idx = index.papers.findIndex(p => p.id === id)
    if (idx === -1) throw new Error(`Paper not found: ${id}`)
    const updated = Paper.parse({
      ...index.papers[idx],
      ...patch,
      updatedAt: this.now()
    })
    index.papers[idx] = updated
    await this.save(index)
    return updated
  }

  async list(filter: PaperListFilter = {}): Promise<PaperType[]> {
    let papers = [...(await this.load()).papers]
    if (filter.status) papers = papers.filter(p => p.status === filter.status)
    papers.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (filter.limit && filter.limit > 0) papers = papers.slice(0, filter.limit)
    return papers
  }

  async delete(id: string): Promise<PaperType> {
    const index = await this.load()
    const idx = index.papers.findIndex(p => p.id === id)
    if (idx === -1) throw new Error(`Paper not found: ${id}`)
    const [removed] = index.papers.splice(idx, 1)
    await this.save(index)
    return removed
  }

  // ── Content Generation ─────────────────────────────────

  async generateContent(
    paper: PaperType,
    researchData: ResearchData
  ): Promise<{ sections: PaperSection[]; references: PaperReference[] }> {
    const references: PaperReference[] = []
    const sections = JSON.parse(JSON.stringify(paper.sections)) as PaperSection[]

    // Generate references from research data
    if (researchData.hypotheses) {
      for (const h of researchData.hypotheses) {
        references.push({
          key: `hyp-${h.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          type: 'hypothesis',
          id: h.id,
          citation: `${h.title}. Status: ${h.status}, Confidence: ${h.confidence.toFixed(2)} (${h.totalTrials} trials).`
        })
      }
    }
    if (researchData.experiments) {
      for (const e of researchData.experiments) {
        references.push({
          key: `exp-${e.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          type: 'experiment',
          id: e.id,
          citation: `${e.title} [${e.language}]` + (e.metrics ? ` Metrics: ${JSON.stringify(e.metrics)}` : '')
        })
      }
    }
    if (researchData.artifacts) {
      for (const a of researchData.artifacts) {
        references.push({
          key: `art-${a.id.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          type: 'artifact',
          id: a.id,
          citation: `${a.title} [${a.type}, ${a.evidenceLevel}]. ${a.summary}`
        })
      }
    }

    // Generate data-driven content for each section
    const dataSummary = this.buildDataSummary(researchData)

    for (const section of sections) {
      switch (section.heading) {
        case 'Introduction':
          section.content = this.generateIntroduction(paper, researchData)
          break
        case 'Method':
          section.content = this.generateMethod(researchData)
          break
        case 'Method & Results':
          section.content = this.generateMethod(researchData) + '\n' + dataSummary
          break
        case 'Results':
          section.content = dataSummary
          break
        case 'Discussion':
        case 'Discussion & Conclusion':
          section.content = this.generateDiscussion(researchData) + (section.heading.includes('Conclusion') ? '\n\n' + dataSummary : '')
          break
        case 'References':
          section.content = references
            .map(r => `- **${r.key}**: ${r.citation}`)
            .join('\n')
          break
      }
      if (section.content) section.status = 'draft'
    }

    return { sections, references }
  }

  private buildDataSummary(data: ResearchData): string {
    const lines: string[] = []

    if (data.hypotheses && data.hypotheses.length > 0) {
      lines.push('## Hypotheses Tested\n')
      for (const h of data.hypotheses) {
        lines.push(`- **${h.title}** (${h.status}): ${h.statement}`)
        lines.push(`  - Confidence: ${(h.confidence * 100).toFixed(0)}% after ${h.totalTrials} trials`)
      }
    }

    if (data.experiments && data.experiments.length > 0) {
      lines.push('\n## Experiments Conducted\n')
      for (const e of data.experiments) {
        lines.push(`- **${e.title}** [${e.language}]`)
        if (e.metrics && Object.keys(e.metrics).length > 0) {
          lines.push(`  - Metrics: ${Object.entries(e.metrics).map(([k, v]) => `${k}=${v}`).join(', ')}`)
        }
        if (e.exitCode !== undefined && e.exitCode !== null) {
          lines.push(`  - Exit code: ${e.exitCode}`)
        }
      }
    }

    if (data.artifacts && data.artifacts.length > 0) {
      lines.push('\n## Key Observations\n')
      for (const a of data.artifacts) {
        lines.push(`- [${a.type}/${a.evidenceLevel}] **${a.title}**: ${a.summary}`)
      }
    }

    return lines.join('\n') || 'No research data available.'
  }

  private generateIntroduction(paper: PaperType, data: ResearchData): string {
    const validatedCount = (data.hypotheses ?? []).filter(h => h.status === 'validated').length
    const totalTrials = (data.hypotheses ?? []).reduce((sum, h) => sum + h.totalTrials, 0)
    return [
      `This paper investigates: **${data.goal ?? paper.title}**.\n`,
      (data.hypotheses ?? []).length > 0
        ? `We formulated ${(data.hypotheses ?? []).length} hypotheses, of which ${validatedCount} were validated through ${totalTrials} experimental trials.`
        : '',
    ].filter(Boolean).join('\n')
  }

  private generateMethod(data: ResearchData): string {
    const lines: string[] = ['## Experimental Setup\n']
    if (data.experiments && data.experiments.length > 0) {
      lines.push(`We conducted ${data.experiments.length} experiments:\n`)
      for (const e of data.experiments) {
        lines.push(`- **${e.title}**: Implemented in ${e.language}`)
      }
    } else {
      lines.push('Experimental details are recorded in the experiment registry.')
    }
    return lines.join('\n')
  }

  private generateDiscussion(data: ResearchData): string {
    const lines: string[] = []
    const validated = (data.hypotheses ?? []).filter(h => h.status === 'validated')
    const falsified = (data.hypotheses ?? []).filter(h => h.status === 'falsified')

    if (falsified.length > 0) {
      lines.push('## Falsified Hypotheses\n')
      for (const h of falsified) {
        lines.push(`- **${h.title}** was falsified (posterior: ${h.confidence.toFixed(2)}). ${h.statement}`)
      }
    }

    if (validated.length > 0) {
      lines.push('\n## Validated Findings\n')
      for (const h of validated) {
        lines.push(`- **${h.title}** is supported by evidence (posterior: ${h.confidence.toFixed(2)}, ${h.totalTrials} trials).`)
      }
    }

    return lines.join('\n') || 'See Results section for detailed findings.'
  }

  async exportMarkdown(paper: PaperType, outputPath?: string): Promise<string> {
    const path = outputPath ?? resolve(this.options.workspaceDir, `paper_${paper.id}.md`)
    const lines: string[] = []

    // Title and authors
    lines.push(`# ${paper.title}\n`)
    if (paper.authors.length > 0) {
      lines.push(`${paper.authors.join(', ')}\n`)
    }
    if (paper.abstract) {
      lines.push('## Abstract\n')
      lines.push(paper.abstract + '\n')
    }
    if (paper.keywords.length > 0) {
      lines.push(`**Keywords:** ${paper.keywords.join(', ')}\n`)
    }

    // Sections
    for (const section of paper.sections) {
      this.writeSection(lines, section, 2)
    }

    // References
    if (paper.references.length > 0) {
      lines.push('\n## References\n')
      for (const ref of paper.references) {
        lines.push(`[${ref.key}]: ${ref.citation}`)
      }
      lines.push('')
    }

    const content = lines.join('\n')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')

    return path
  }

  private writeSection(lines: string[], section: PaperSection | SubSection, depth: number): void {
    const prefix = '#'.repeat(Math.min(depth, 6))
    lines.push(`${prefix} ${section.heading}\n`)
    if (section.content) {
      lines.push(section.content + '\n')
    }
    if ('subsections' in section) {
      for (const sub of section.subsections) {
        this.writeSection(lines, sub, depth + 1)
      }
    }
  }

  async diagnostics(): Promise<Diagnostics> {
    const papers = (await this.load()).papers
    const byStatus: Record<string, number> = {}
    let totalRefs = 0, totalSections = 0
    for (const p of papers) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1
      totalRefs += p.references.length
      totalSections += p.sections.length
    }
    return PaperDiagnostics.parse({
      indexPath: this.getIndexPath(),
      totalCount: papers.length,
      byStatus,
      totalReferences: totalRefs,
      totalSections,
      completedCount: byStatus['completed'] ?? 0
    })
  }

  private dateSlug(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}
