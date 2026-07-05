import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { YamlResearchArtifactStore } from './store.js'
import type { ResearchArtifact, ResearchArtifactCreateRequest } from './types.js'

describe('YamlResearchArtifactStore', () => {
  let store: YamlResearchArtifactStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sciforge-artifact-store-test-'))
    store = new YamlResearchArtifactStore({
      workspaceDir: tmpDir,
      nowIso: () => '2026-07-02T12:00:00.000Z',
      idGenerator: () => 'EXP-TEST-0001'
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates an artifact with auto-generated ID', async () => {
      const input: ResearchArtifactCreateRequest = {
        type: 'experiment',
        title: 'Test experiment',
        summary: 'A test experiment summary',
        evidenceLevel: 'preliminary'
      }
      const artifact = await store.create(input)
      expect(artifact.id).toBe('EXP-TEST-0001')
      expect(artifact.type).toBe('experiment')
      expect(artifact.title).toBe('Test experiment')
      expect(artifact.status).toBe('draft')
      expect(artifact.evidenceLevel).toBe('preliminary')
      expect(artifact.claimScope).toBe('local-note')
      expect(artifact.riskLevel).toBe('medium')
      expect(artifact.visibility).toBe('local-only')
      expect(artifact.createdAt).toBe('2026-07-02T12:00:00.000Z')
    })

    it('creates an artifact with explicit ID', async () => {
      const input: ResearchArtifactCreateRequest = {
        id: 'EXP-014',
        type: 'experiment',
        title: 'Custom ID experiment',
        summary: 'Experiment with explicit ID',
        evidenceLevel: 'reproduced',
        claimScope: 'internal-summary',
        riskLevel: 'high',
        limitations: ['Small sample size', 'Single GPU'],
        interpretation: 'Results suggest method A outperforms baseline',
        nextActions: ['Run on larger dataset', 'Submit for review'],
        tags: ['nlp', 'reranker'],
        visibility: 'github-summary-only'
      }
      const artifact = await store.create(input)
      expect(artifact.id).toBe('EXP-014')
      expect(artifact.claimScope).toBe('internal-summary')
      expect(artifact.riskLevel).toBe('high')
      expect(artifact.limitations).toHaveLength(2)
      expect(artifact.tags).toContain('nlp')
      expect(artifact.visibility).toBe('github-summary-only')
    })

    it('rejects duplicate artifact IDs', async () => {
      await store.create({
        type: 'observation',
        title: 'First',
        summary: 'First observation',
        evidenceLevel: 'observation'
      })
      await expect(
        store.create({
          id: 'EXP-TEST-0001',
          type: 'run',
          title: 'Second',
          summary: 'Duplicate',
          evidenceLevel: 'observation'
        })
      ).rejects.toThrow('Artifact already exists')
    })
  })

  describe('get', () => {
    it('retrieves an artifact by ID', async () => {
      await store.create({
        id: 'DEC-001',
        type: 'decision',
        title: 'Use transformer architecture',
        summary: 'Decided to use transformer-based approach',
        evidenceLevel: 'observation'
      })
      const found = await store.get('DEC-001')
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Use transformer architecture')
    })

    it('returns null for missing artifact', async () => {
      const found = await store.get('NONEXISTENT')
      expect(found).toBeNull()
    })
  })

  describe('update', () => {
    it('updates artifact status and evidence level', async () => {
      await store.create({
        id: 'RUN-001',
        type: 'run',
        title: 'Training run',
        summary: 'Initial training run',
        evidenceLevel: 'observation'
      })
      const updated = await store.update('RUN-001', {
        status: 'completed',
        evidenceLevel: 'preliminary',
        confirmedAt: '2026-07-02T13:00:00.000Z'
      })
      expect(updated.status).toBe('completed')
      expect(updated.evidenceLevel).toBe('preliminary')
      expect(updated.confirmedAt).toBe('2026-07-02T13:00:00.000Z')
    })

    it('throws on missing artifact', async () => {
      await expect(
        store.update('NONEXISTENT', { status: 'completed' })
      ).rejects.toThrow('Artifact not found')
    })
  })

  describe('list', () => {
    beforeEach(async () => {
      const artifacts: ResearchArtifactCreateRequest[] = [
        { id: 'EXP-001', type: 'experiment', title: 'Exp 1', summary: 'First', evidenceLevel: 'preliminary', tags: ['nlp'] },
        { id: 'EXP-002', type: 'experiment', title: 'Exp 2', summary: 'Second', evidenceLevel: 'reproduced', tags: ['cv'] },
        { id: 'OBS-001', type: 'observation', title: 'Obs 1', summary: 'Third', evidenceLevel: 'observation', visibility: 'github-summary-only' },
        { id: 'DEC-001', type: 'decision', title: 'Dec 1', summary: 'Fourth', evidenceLevel: 'observation', status: 'completed' }
      ]
      for (const input of artifacts) {
        await store.create(input)
      }
    })

    it('lists all artifacts', async () => {
      const all = await store.list()
      expect(all).toHaveLength(4)
    })

    it('filters by type', async () => {
      const experiments = await store.list({ type: 'experiment' })
      expect(experiments).toHaveLength(2)
    })

    it('filters by tag', async () => {
      const nlpItems = await store.list({ tags: ['nlp'] })
      expect(nlpItems).toHaveLength(1)
      expect(nlpItems[0].id).toBe('EXP-001')
    })

    it('filters by visibility', async () => {
      const githubItems = await store.list({ visibility: 'github-summary-only' })
      expect(githubItems).toHaveLength(1)
      expect(githubItems[0].id).toBe('OBS-001')
    })

    it('filters by evidence level', async () => {
      const reproduced = await store.list({ evidenceLevel: 'reproduced' })
      expect(reproduced).toHaveLength(1)
      expect(reproduced[0].id).toBe('EXP-002')
    })

    it('filters by status', async () => {
      const completed = await store.list({ status: 'completed' })
      expect(completed).toHaveLength(1)
    })

    it('respects limit', async () => {
      const limited = await store.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })
  })

  describe('delete', () => {
    it('removes an artifact', async () => {
      await store.create({
        id: 'REMOVE-ME',
        type: 'observation',
        title: 'To be removed',
        summary: 'This will be deleted',
        evidenceLevel: 'observation'
      })
      const removed = await store.delete('REMOVE-ME')
      expect(removed.id).toBe('REMOVE-ME')
      const found = await store.get('REMOVE-ME')
      expect(found).toBeNull()
    })
  })

  describe('diagnostics', () => {
    it('reports empty counts for empty store', async () => {
      const diag = await store.diagnostics()
      expect(diag.totalCount).toBe(0)
      expect(diag.highRiskCount).toBe(0)
      expect(diag.pendingSyncCount).toBe(0)
    })

    it('reports correct counts after inserts', async () => {
      await store.create({
        id: 'EXP-DIAG-1',
        type: 'experiment',
        title: 'Diag 1',
        summary: 'Diagnostic test',
        evidenceLevel: 'preliminary',
        riskLevel: 'high',
        visibility: 'github-full',
        status: 'active'
      })
      await store.create({
        id: 'DEC-DIAG-1',
        type: 'decision',
        title: 'Diag 2',
        summary: 'Another diagnostic',
        evidenceLevel: 'observation'
      })
      const diag = await store.diagnostics()
      expect(diag.totalCount).toBe(2)
      expect(diag.highRiskCount).toBe(1)
      expect(diag.pendingSyncCount).toBe(1)
      expect(diag.byType.experiment).toBe(1)
      expect(diag.byType.decision).toBe(1)
    })
  })

  describe('YAML file persistence', () => {
    it('writes artifacts.yml to .agents/', async () => {
      await store.create({
        id: 'PERSIST-1',
        type: 'experiment',
        title: 'Persistent artifact',
        summary: 'Should survive reload',
        evidenceLevel: 'preliminary'
      })
      // Create a new store pointing at the same directory
      const store2 = new YamlResearchArtifactStore({
        workspaceDir: tmpDir,
        nowIso: () => '2026-07-02T14:00:00.000Z'
      })
      const found = await store2.get('PERSIST-1')
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Persistent artifact')
    })
  })
})
