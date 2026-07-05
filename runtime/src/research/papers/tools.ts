import type { CapabilityToolProvider } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import type { PaperStore } from './store.js'
import type { HypothesisStore } from '../hypotheses/store.js'
import type { ExperimentStore } from '../experiments/store.js'
import type { ResearchArtifactStore } from '../artifacts/store.js'
import {
  PaperCreateRequest,
  PaperUpdateRequest
} from './types.js'

/**
 * Builds paper generation tools that synthesize research findings
 * into structured academic papers (Markdown format, IMRaD structure).
 *
 * Integrates with all three research subsystems to gather data:
 *  - Hypothesis Store (hypotheses and confidence scores)
 *  - Experiment Store (experiments and metrics)
 *  - Research Artifact Store (observations and interpretations)
 */
export function buildPaperToolProviders(
  paperStore: PaperStore | undefined,
  hypothesisStore: HypothesisStore | undefined,
  experimentStore: ExperimentStore | undefined,
  artifactStore: ResearchArtifactStore | undefined
): CapabilityToolProvider[] {
  if (!paperStore) return []

  return [
    {
      id: 'paper-generation',
      kind: 'memory',
      enabled: true,
      available: true,
      tools: [
        // ── paper_create ────────────────────────────────
        LocalToolHost.defineTool({
          name: 'paper_create',
          description:
            'Create a new paper from research findings. The paper starts with a standard ' +
            'IMRaD outline (Introduction, Method, Results, Discussion, Conclusion). ' +
            'Use paper_generate to populate sections with data-driven content.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional paper ID. Auto-generated if not provided.' },
              title: { type: 'string', description: 'Paper title' },
              authors: { type: 'array', items: { type: 'string' }, description: 'Author names' },
              abstract: { type: 'string', description: 'Paper abstract (can be filled later)' },
              keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords' },
              venue: { type: 'string', description: 'Target journal or venue' },
              template: {
                type: 'string',
                enum: ['imrad', 'short_report', 'custom'],
                description: 'Paper template: imrad (full paper), short_report (compact), custom'
              },
              hypothesisIds: { type: 'array', items: { type: 'string' }, description: 'Hypothesis IDs to include' },
              experimentIds: { type: 'array', items: { type: 'string' }, description: 'Experiment IDs to include' },
              artifactIds: { type: 'array', items: { type: 'string' }, description: 'Artifact IDs to include' }
            },
            required: ['title']
          },
          execute: async (args) => {
            try {
              const input = PaperCreateRequest.parse(args)
              const paper = await paperStore.create(input)
              return { output: { ok: true, paper } }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── paper_generate ──────────────────────────────
        LocalToolHost.defineTool({
          name: 'paper_generate',
          description:
            'Generate paper content by synthesizing research data (hypotheses, experiments, artifacts). ' +
            'Automatically populates sections with data-driven content: Introduction summarizes the research goal, ' +
            'Method describes experiments, Results presents metrics and findings, Discussion interprets validated ' +
            'and falsified hypotheses. The agent should then refine and expand each section.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              paperId: { type: 'string', description: 'Paper ID to generate content for' }
            },
            required: ['paperId']
          },
          execute: async (args) => {
            try {
              const paperId = typeof args.paperId === 'string' ? args.paperId.trim() : ''
              if (!paperId) return { output: { ok: false, error: 'paperId is required' }, isError: true }

              const paper = await paperStore.get(paperId)
              if (!paper) return { output: { ok: false, error: `Paper not found: ${paperId}` }, isError: true }

              // Gather research data
              const hypotheses = await (hypothesisStore?.list({ limit: 50 }) ?? [])
              const experiments = await (experimentStore?.listSpecs({ limit: 50 }) ?? [])
              const artifacts = await (artifactStore?.list({ limit: 50 }) ?? [])

              // Filter to relevant items if paper has specific IDs
              const relevantHypotheses = paper.hypothesisIds.length > 0
                ? hypotheses.filter(h => paper.hypothesisIds.includes(h.id))
                : hypotheses

              // Get recent runs for each experiment
              const experimentData = await Promise.all(
                (paper.experimentIds.length > 0
                  ? experiments.filter(e => paper.experimentIds.includes(e.id))
                  : experiments
                ).map(async (spec) => {
                  const runs = await (experimentStore?.listRuns(spec.id, { status: 'completed', limit: 1 }) ?? [])
                  const lastRun = runs[0]
                  return {
                    id: spec.id,
                    title: spec.title,
                    language: spec.language,
                    exitCode: lastRun?.exitCode,
                    metrics: lastRun?.metricValues
                  }
                })
              )

              // Generate content
              const { sections, references } = await paperStore.generateContent(paper, {
                goal: hypotheses.find(h => h.status === 'active')?.statement,
                hypotheses: relevantHypotheses.map(h => ({
                  id: h.id,
                  title: h.title,
                  statement: h.statement,
                  status: h.status,
                  confidence: h.confidence.posterior,
                  totalTrials: h.confidence.totalTrials,
                  experimentIds: h.experimentIds
                })),
                experiments: experimentData,
                artifacts: artifacts.map(a => ({
                  id: a.id,
                  type: a.type,
                  title: a.title,
                  summary: a.summary,
                  evidenceLevel: a.evidenceLevel,
                  interpretation: a.interpretation
                }))
              })

              // Update paper with generated content
              await paperStore.update(paperId, {
                sections,
                references,
                status: 'outlined'
              })

              return {
                output: {
                  ok: true,
                  paperId,
                  sectionsGenerated: sections.filter(s => s.content).length,
                  totalSections: sections.length,
                  references: references.length,
                  instruction: 'Content generated. Use paper_section to refine individual sections, then paper_export to write the final Markdown file.'
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── paper_section ────────────────────────────────
        LocalToolHost.defineTool({
          name: 'paper_section',
          description:
            'Get or update a specific paper section. Use this to read the current draft content ' +
            'of a section, then rewrite it with refined text. The section is identified by its heading name.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              paperId: { type: 'string', description: 'Paper ID' },
              heading: { type: 'string', description: 'Section heading (e.g., "Introduction", "Results")' },
              content: { type: 'string', description: 'New content for the section (Markdown). If omitted, returns current content.' }
            },
            required: ['paperId', 'heading']
          },
          execute: async (args) => {
            try {
              const paperId = typeof args.paperId === 'string' ? args.paperId.trim() : ''
              const heading = typeof args.heading === 'string' ? args.heading.trim() : ''
              if (!paperId || !heading) {
                return { output: { ok: false, error: 'paperId and heading are required' }, isError: true }
              }

              const paper = await paperStore.get(paperId)
              if (!paper) return { output: { ok: false, error: `Paper not found: ${paperId}` }, isError: true }

              // Find section by heading (case-insensitive match)
              const sectionIdx = paper.sections.findIndex(
                s => s.heading.toLowerCase() === heading.toLowerCase()
              )
              if (sectionIdx === -1) {
                return {
                  output: {
                    ok: false,
                    error: `Section "${heading}" not found. Available: ${paper.sections.map(s => s.heading).join(', ')}`
                  },
                  isError: true
                }
              }

              // If content is provided, update the section
              if (typeof args.content === 'string' && args.content.trim()) {
                const updated = [...paper.sections]
                updated[sectionIdx] = {
                  ...updated[sectionIdx],
                  content: args.content,
                  status: 'complete'
                }
                await paperStore.update(paperId, { sections: updated })

                // Auto-update paper status
                const allComplete = updated.every(s =>
                  s.status === 'complete' || s.heading === 'References'
                )
                if (allComplete) {
                  await paperStore.update(paperId, { status: 'completed' })
                } else {
                  await paperStore.update(paperId, { status: 'writing' })
                }

                return { output: { ok: true, paperId, heading, updated: true } }
              }

              // Return current section content
              return {
                output: {
                  ok: true,
                  paperId,
                  heading: paper.sections[sectionIdx].heading,
                  content: paper.sections[sectionIdx].content,
                  status: paper.sections[sectionIdx].status,
                  subsections: paper.sections[sectionIdx].subsections.map(s => ({
                    heading: s.heading,
                    status: s.status
                  }))
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── paper_export ─────────────────────────────────
        LocalToolHost.defineTool({
          name: 'paper_export',
          description:
            'Export the paper as a Markdown file. By default writes to the workspace root ' +
            'as `paper_{id}.md`. The exported file can be converted to PDF via the write-export service.',
          policy: 'auto',
          toolKind: 'file_change',
          inputSchema: {
            type: 'object',
            properties: {
              paperId: { type: 'string', description: 'Paper ID to export' },
              outputPath: { type: 'string', description: 'Custom output path (default: paper_{id}.md in workspace)' }
            },
            required: ['paperId']
          },
          execute: async (args) => {
            try {
              const paperId = typeof args.paperId === 'string' ? args.paperId.trim() : ''
              if (!paperId) return { output: { ok: false, error: 'paperId is required' }, isError: true }

              const paper = await paperStore.get(paperId)
              if (!paper) return { output: { ok: false, error: `Paper not found: ${paperId}` }, isError: true }

              const outputPath = typeof args.outputPath === 'string' ? args.outputPath : undefined
              const path = await paperStore.exportMarkdown(paper, outputPath)

              await paperStore.update(paperId, { outputPath: path, status: 'published' })

              // Create a research artifact
              if (artifactStore) {
                try {
                  await artifactStore.create({
                    type: 'document',
                    title: `Paper: ${paper.title}`,
                    summary: `Autonomous research paper exported to ${path}. ${paper.sections.length} sections, ${paper.references.length} references.`,
                    evidenceLevel: 'preliminary',
                    sourceFilePath: path,
                    interpretation: paper.abstract,
                    tags: ['paper', 'auto-generated', 'autonomous']
                  })
                } catch {
                  // Best effort
                }
              }

              return { output: { ok: true, paperId, outputPath: path } }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── paper_list ───────────────────────────────────
        LocalToolHost.defineTool({
          name: 'paper_list',
          description: 'List all papers with status and section counts.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              status: { type: 'string', description: 'Filter by status (draft, outlined, writing, completed, published)' },
              limit: { type: 'number', description: 'Max results (default 20)' }
            }
          },
          execute: async (args) => {
            try {
              const papers = await paperStore.list({
                status: typeof args.status === 'string' ? args.status : undefined,
                limit: typeof args.limit === 'number' ? args.limit : 20
              })
              return {
                output: {
                  ok: true,
                  count: papers.length,
                  papers: papers.map(p => ({
                    id: p.id,
                    title: p.title,
                    status: p.status,
                    sections: p.sections.length,
                    completedSections: p.sections.filter(s => s.status === 'complete').length,
                    references: p.references.length,
                    updatedAt: p.updatedAt
                  }))
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        })
      ]
    }
  ]
}
