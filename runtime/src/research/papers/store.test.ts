import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonPaperStore } from './store.js'
import type { ResearchData } from './store.js'

describe('JsonPaperStore', () => {
  let store: JsonPaperStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sciforge-paper-test-'))
    store = new JsonPaperStore({
      workspaceDir: tmpDir,
      nowIso: () => '2026-07-03T12:00:00.000Z'
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates with IMRaD template by default', async () => {
      const paper = await store.create({ title: 'Test Paper' })
      expect(paper.status).toBe('draft')
      expect(paper.sections.length).toBeGreaterThanOrEqual(7)
      expect(paper.sections[0].heading).toBe('Abstract')
      expect(paper.sections[1].heading).toBe('Introduction')
    })

    it('creates with short report template', async () => {
      const paper = await store.create({ title: 'Short', template: 'short_report' })
      expect(paper.sections.length).toBe(5)
    })

    it('creates with custom ID and authors', async () => {
      const paper = await store.create({
        id: 'PAPER-CUSTOM',
        title: 'Custom Paper',
        authors: ['Author One', 'Author Two'],
        keywords: ['machine learning', 'nlp']
      })
      expect(paper.id).toBe('PAPER-CUSTOM')
      expect(paper.authors).toHaveLength(2)
      expect(paper.keywords).toContain('nlp')
    })
  })

  describe('generateContent', () => {
    it('generates content from research data', async () => {
      const paper = await store.create({ title: 'Research Paper' })
      const data: ResearchData = {
        goal: 'Determine whether A outperforms B',
        hypotheses: [
          { id: 'H1', title: 'A > B', statement: 'A is better than B', status: 'validated', confidence: 0.85, totalTrials: 4, experimentIds: ['E1'] }
        ],
        experiments: [
          { id: 'E1', title: 'Compare A vs B', language: 'python', exitCode: 0, metrics: { accuracy: 0.92 } }
        ],
        artifacts: [
          { id: 'O1', type: 'observation', title: 'Initial finding', summary: 'A scored higher', evidenceLevel: 'preliminary' }
        ]
      }

      const { sections, references } = await store.generateContent(paper, data)
      expect(references.length).toBe(3)
      expect(sections[0].heading).toBe('Abstract')
      // Introduction should be populated
      const intro = sections.find(s => s.heading === 'Introduction')
      expect(intro?.content).toBeTruthy()
      // Results should contain data
      const results = sections.find(s => s.heading === 'Results')
      expect(results?.content).toContain('A > B')
    })
  })

  describe('exportMarkdown', () => {
    it('writes a Markdown file', async () => {
      await store.create({
        id: 'PAPER-EXP',
        title: 'Export Test',
        authors: ['Author'],
        abstract: 'This is a test abstract.',
        keywords: ['test']
      })
      await store.update('PAPER-EXP', {
        sections: [
          { heading: 'Abstract', content: 'Test abstract content.', subsections: [], citedRefs: [], status: 'complete' },
          { heading: 'Results', content: 'The results are clear.', subsections: [], citedRefs: [], status: 'complete' }
        ]
      })
      const updated = await store.get('PAPER-EXP')
      const path = await store.exportMarkdown(updated!)
      expect(path).toContain('.md')
      const { readFile } = await import('node:fs/promises')
      const content = await readFile(path, 'utf-8')
      expect(content).toContain('# Export Test')
      expect(content).toContain('Test abstract content.')
      expect(content).toContain('The results are clear.')
    })
  })

  describe('list and filter', () => {
    it('filters by status', async () => {
      await store.create({ id: 'P1', title: 'Draft', template: 'short_report' })
      await store.create({ id: 'P2', title: 'Done', template: 'short_report' })
      await store.update('P2', { status: 'completed' })
      expect(await store.list()).toHaveLength(2)
      expect(await store.list({ status: 'completed' })).toHaveLength(1)
    })
  })

  describe('persistence', () => {
    it('survives store reload', async () => {
      await store.create({ id: 'PP1', title: 'Persist', template: 'short_report' })
      await store.update('PP1', { status: 'writing' })
      const store2 = new JsonPaperStore({ workspaceDir: tmpDir })
      const found = await store2.get('PP1')
      expect(found).not.toBeNull()
      expect(found!.status).toBe('writing')
    })
  })
})
