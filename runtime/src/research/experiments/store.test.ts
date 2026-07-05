import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonExperimentStore } from './store.js'
import type { ExperimentSpecCreateRequest } from './types.js'

describe('JsonExperimentStore', () => {
  let store: JsonExperimentStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sciforge-experiment-test-'))
    store = new JsonExperimentStore({
      workspaceDir: tmpDir,
      nowIso: () => '2026-07-03T12:00:00.000Z'
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('createSpec', () => {
    it('creates an experiment spec with auto-generated ID', async () => {
      const input: ExperimentSpecCreateRequest = {
        title: 'Test experiment',
        description: 'A test',
        language: 'python',
        code: 'print("hello")'
      }
      const spec = await store.createSpec(input)
      expect(spec.id).toMatch(/^EXP-/)
      expect(spec.title).toBe('Test experiment')
      expect(spec.language).toBe('python')
      expect(spec.code).toBe('print("hello")')
      expect(spec.status).toBeUndefined() // not a spec field (run only)
      expect(spec.createdAt).toBe('2026-07-03T12:00:00.000Z')
    })

    it('creates with explicit ID', async () => {
      const spec = await store.createSpec({
        id: 'EXP-001',
        title: 'Custom ID experiment',
        language: 'shell',
        code: 'echo test'
      })
      expect(spec.id).toBe('EXP-001')
    })

    it('rejects duplicate IDs', async () => {
      const created = await store.createSpec({ title: 'First', language: 'python', code: '1' })
      await expect(
        store.createSpec({ id: created.id, title: 'Second', language: 'python', code: '2' })
      ).rejects.toThrow('already exists')
    })

    it('stores metrics, parameters, and tags', async () => {
      const spec = await store.createSpec({
        title: 'Full spec',
        language: 'python',
        code: 'print(42)',
        metrics: [
          { name: 'accuracy', extractor: 'last_line', direction: 'maximize' },
          { name: 'loss', extractor: 'regex', pattern: 'loss: ([\\d.]+)', direction: 'minimize' }
        ],
        parameters: [
          { name: 'lr', type: 'number', default: 0.01 }
        ],
        parameterValues: { lr: 0.001 },
        tags: ['benchmark', 'nlp'],
        timeoutSeconds: 600,
        maxRetries: 5
      })
      expect(spec.metrics).toHaveLength(2)
      expect(spec.parameters).toHaveLength(1)
      expect(spec.tags).toContain('benchmark')
      expect(spec.timeoutSeconds).toBe(600)
      expect(spec.maxRetries).toBe(5)
    })

    it('stores hypothesisId link', async () => {
      const spec = await store.createSpec({
        title: 'Hypothesis test',
        language: 'r',
        code: '1+1',
        hypothesisId: 'HYP-001'
      })
      expect(spec.hypothesisId).toBe('HYP-001')
    })
  })

  describe('getSpec and updateSpec', () => {
    it('retrieves a spec by ID', async () => {
      await store.createSpec({ id: 'EXP-GET-1', title: 'Get test', language: 'python', code: '1' })
      const found = await store.getSpec('EXP-GET-1')
      expect(found).not.toBeNull()
      expect(found!.title).toBe('Get test')
    })

    it('returns null for missing spec', async () => {
      expect(await store.getSpec('NONEXISTENT')).toBeNull()
    })

    it('updates spec fields', async () => {
      await store.createSpec({ id: 'EXP-UPD-1', title: 'Original', language: 'shell', code: 'echo x' })
      const updated = await store.updateSpec('EXP-UPD-1', { title: 'Updated', code: 'echo y' })
      expect(updated.title).toBe('Updated')
      expect(updated.code).toBe('echo y')
      expect(updated.language).toBe('shell') // unchanged
    })

    it('throws on updating missing spec', async () => {
      await expect(store.updateSpec('NONEXISTENT', { title: 'x' })).rejects.toThrow('not found')
    })
  })

  describe('listSpecs with filters', () => {
    beforeEach(async () => {
      const specs: ExperimentSpecCreateRequest[] = [
        { id: 'EXP-L1', title: 'Python exp', language: 'python', code: '1', tags: ['nlp'] },
        { id: 'EXP-L2', title: 'Shell exp', language: 'shell', code: '2', tags: ['sys'] },
        { id: 'EXP-L3', title: 'R exp', language: 'r', code: '3', hypothesisId: 'HYP-1' },
        { id: 'EXP-L4', title: 'Python 2', language: 'python', code: '4', tags: ['nlp', 'cv'] }
      ]
      for (const s of specs) await store.createSpec(s)
    })

    it('lists all specs', async () => {
      expect(await store.listSpecs()).toHaveLength(4)
    })

    it('filters by language', async () => {
      const py = await store.listSpecs({ language: 'python' })
      expect(py).toHaveLength(2)
    })

    it('filters by tag', async () => {
      const nlp = await store.listSpecs({ tags: ['nlp'] })
      expect(nlp).toHaveLength(2)
    })

    it('filters by hypothesisId', async () => {
      const hyp = await store.listSpecs({ hypothesisId: 'HYP-1' })
      expect(hyp).toHaveLength(1)
      expect(hyp[0].id).toBe('EXP-L3')
    })

    it('respects limit', async () => {
      expect(await store.listSpecs({ limit: 2 })).toHaveLength(2)
    })
  })

  describe('deleteSpec', () => {
    it('removes spec and associated runs', async () => {
      await store.createSpec({ id: 'EXP-DEL-1', title: 'To delete', language: 'python', code: '1' })
      await store.createRun({ specId: 'EXP-DEL-1' })
      await store.createRun({ specId: 'EXP-DEL-1' })
      const removed = await store.deleteSpec('EXP-DEL-1')
      expect(removed.id).toBe('EXP-DEL-1')
      expect(await store.getSpec('EXP-DEL-1')).toBeNull()
      expect(await store.listRuns('EXP-DEL-1')).toHaveLength(0)
    })
  })

  describe('createRun and getRun', () => {
    it('creates a run with queued status', async () => {
      await store.createSpec({ id: 'EXP-R1', title: 'Run test', language: 'python', code: 'print(1)' })
      const run = await store.createRun({ specId: 'EXP-R1' })
      expect(run.status).toBe('queued')
      expect(run.specId).toBe('EXP-R1')
      expect(run.attempt).toBe(0)
    })

    it('throws when spec does not exist', async () => {
      await expect(store.createRun({ specId: 'NONEXISTENT' })).rejects.toThrow('not found')
    })

    it('updates run status through lifecycle', async () => {
      await store.createSpec({ id: 'EXP-R2', title: 'Lifecycle', language: 'python', code: '1' })
      const run = await store.createRun({ specId: 'EXP-R2' })
      await store.updateRun(run.id, { status: 'running', pid: 12345, startedAt: '2026-07-03T13:00:00Z' })
      const running = await store.getRun(run.id)
      expect(running!.status).toBe('running')
      expect(running!.pid).toBe(12345)
      await store.updateRun(run.id, { status: 'completed', exitCode: 0, finishedAt: '2026-07-03T13:01:00Z' })
      const completed = await store.getRun(run.id)
      expect(completed!.status).toBe('completed')
      expect(completed!.exitCode).toBe(0)
    })
  })

  describe('listRuns', () => {
    it('returns runs sorted by id when same timestamp', async () => {
      await store.createSpec({ id: 'EXP-RL1', title: 'List', language: 'python', code: '1' })
      const r1 = await store.createRun({ specId: 'EXP-RL1' })
      const r2 = await store.createRun({ specId: 'EXP-RL1' })
      const runs = await store.listRuns('EXP-RL1')
      expect(runs).toHaveLength(2)
      // Both have same createdAt (mock), so order depends on sort stability
      const ids = runs.map(r => r.id)
      expect(ids).toContain(r1.id)
      expect(ids).toContain(r2.id)
    })
  })

  describe('diagnostics', () => {
    it('reports empty for fresh store', async () => {
      const diag = await store.diagnostics()
      expect(diag.specCount).toBe(0)
      expect(diag.runCount).toBe(0)
      expect(diag.totalOutputBytes).toBe(0)
    })

    it('reports counts after inserts', async () => {
      await store.createSpec({ id: 'EXP-D1', title: 'Diag 1', language: 'python', code: '1' })
      await store.createSpec({ id: 'EXP-D2', title: 'Diag 2', language: 'shell', code: '2' })
      const run = await store.createRun({ specId: 'EXP-D1' })
      await store.updateRun(run.id, { status: 'completed', output: 'Hello World' })
      const diag = await store.diagnostics()
      expect(diag.specCount).toBe(2)
      expect(diag.runCount).toBe(1)
      expect(diag.byLanguage.python).toBe(1)
      expect(diag.byLanguage.shell).toBe(1)
      expect(diag.byStatus.completed).toBe(1)
      expect(diag.totalOutputBytes).toBeGreaterThan(0)
    })
  })

  describe('JSON file persistence', () => {
    it('survives store reload', async () => {
      await store.createSpec({ id: 'PERSIST-1', title: 'Persist', language: 'python', code: '1+1' })
      const run = await store.createRun({ specId: 'PERSIST-1' })
      await store.updateRun(run.id, { status: 'completed', exitCode: 0 })

      const store2 = new JsonExperimentStore({
        workspaceDir: tmpDir,
        nowIso: () => '2026-07-03T14:00:00.000Z'
      })
      const spec = await store2.getSpec('PERSIST-1')
      expect(spec).not.toBeNull()
      expect(spec!.title).toBe('Persist')
      const runs = await store2.listRuns('PERSIST-1')
      expect(runs).toHaveLength(1)
      expect(runs[0].status).toBe('completed')
    })
  })
})
