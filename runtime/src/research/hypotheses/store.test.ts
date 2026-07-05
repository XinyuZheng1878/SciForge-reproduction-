import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonHypothesisStore } from './store.js'
import type { HypothesisCreateRequest } from './types.js'

describe('JsonHypothesisStore', () => {
  let store: JsonHypothesisStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sciforge-hypothesis-test-'))
    store = new JsonHypothesisStore({
      workspaceDir: tmpDir,
      nowIso: () => '2026-07-03T12:00:00.000Z'
    })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('create', () => {
    it('creates hypothesis with auto ID', async () => {
      const hyp = await store.create({
        title: 'Test hypothesis',
        statement: 'If X then Y'
      })
      expect(hyp.id).toMatch(/^HYP-/)
      expect(hyp.status).toBe('draft')
      expect(hyp.confidence.prior).toBe(0.5)
      expect(hyp.confidence.posterior).toBe(0.5)
      expect(hyp.confidence.totalTrials).toBe(0)
    })

    it('creates with explicit prior confidence', async () => {
      const hyp = await store.create({
        title: 'Strong prior',
        statement: 'Likely true',
        priorConfidence: 0.8
      })
      expect(hyp.confidence.prior).toBe(0.8)
      expect(hyp.confidence.posterior).toBe(0.8)
    })

    it('links to parent hypothesis', async () => {
      const parent = await store.create({ title: 'Parent', statement: 'P' })
      const child = await store.create({
        title: 'Child', statement: 'C', parentHypothesisId: parent.id
      })
      const updatedParent = await store.get(parent.id)
      expect(updatedParent!.childHypothesisIds).toContain(child.id)
    })
  })

  describe('update with Bayesian trials', () => {
    it('updates posterior after supporting trial', async () => {
      const hyp = await store.create({ title: 'Test', statement: 'X→Y', priorConfidence: 0.5 })
      const updated = await store.update(hyp.id, {
        recordTrial: { supported: true }
      })
      expect(updated.confidence.totalTrials).toBe(1)
      expect(updated.confidence.supportingTrials).toBe(1)
      expect(updated.confidence.posterior).toBeGreaterThan(0.5) // should increase
    })

    it('updates posterior after contradicting trial', async () => {
      const hyp = await store.create({ title: 'Test', statement: 'X→Y', priorConfidence: 0.5 })
      const updated = await store.update(hyp.id, {
        recordTrial: { supported: false }
      })
      expect(updated.confidence.totalTrials).toBe(1)
      expect(updated.confidence.contradictingTrials).toBe(1)
      expect(updated.confidence.posterior).toBeLessThan(0.5) // should decrease
    })

    it('auto-validates after 3+ supporting trials', async () => {
      let hyp = await store.create({ title: 'T', statement: 'S', priorConfidence: 0.5 })
      for (let i = 0; i < 4; i++) {
        hyp = await store.update(hyp.id, { recordTrial: { supported: true } })
      }
      expect(hyp.status).toBe('validated')
      expect(hyp.confidence.totalTrials).toBe(4)
      expect(hyp.confidence.posterior).toBeGreaterThan(0.8)
    })

    it('auto-falsifies after 3+ contradicting trials', async () => {
      let hyp = await store.create({ title: 'T', statement: 'S', priorConfidence: 0.5 })
      for (let i = 0; i < 4; i++) {
        hyp = await store.update(hyp.id, { recordTrial: { supported: false } })
      }
      expect(hyp.status).toBe('falsified')
      expect(hyp.confidence.posterior).toBeLessThan(0.2)
    })

    it('records experiment IDs from trials', async () => {
      const hyp = await store.create({ title: 'T', statement: 'S' })
      await store.update(hyp.id, { recordTrial: { supported: true, experimentId: 'EXP-001' } })
      await store.update(hyp.id, { recordTrial: { supported: false, experimentId: 'EXP-002' } })
      const updated = await store.get(hyp.id)
      expect(updated!.experimentIds).toContain('EXP-001')
      expect(updated!.experimentIds).toContain('EXP-002')
    })
  })

  describe('list and filter', () => {
    beforeEach(async () => {
      const hyps: HypothesisCreateRequest[] = [
        { id: 'HYP-1', title: 'Active', statement: 'A', tags: ['nlp'] },
        { id: 'HYP-2', title: 'Validated', statement: 'B', tags: ['cv'] },
        { id: 'HYP-3', title: 'Falsified', statement: 'C' }
      ]
      for (const h of hyps) await store.create(h)
      await store.update('HYP-2', { recordTrial: { supported: true } })
      await store.update('HYP-2', { recordTrial: { supported: true } })
      await store.update('HYP-2', { recordTrial: { supported: true } })
      await store.update('HYP-3', { recordTrial: { supported: false } })
      await store.update('HYP-3', { recordTrial: { supported: false } })
      await store.update('HYP-3', { recordTrial: { supported: false } })
    })

    it('lists all', async () => { expect(await store.list()).toHaveLength(3) })
    it('filters by status', async () => {
      expect(await store.list({ status: 'validated' })).toHaveLength(1)
      expect(await store.list({ status: 'falsified' })).toHaveLength(1)
    })
    it('filters by tag', async () => {
      expect(await store.list({ tags: ['nlp'] })).toHaveLength(1)
    })
  })

  describe('diagnostics', () => {
    it('reports counts', async () => {
      await store.create({ id: 'D1', title: 'A', statement: 'A', priorConfidence: 0.6 })
      await store.create({ id: 'D2', title: 'B', statement: 'B', priorConfidence: 0.8 })
      const diag = await store.diagnostics()
      expect(diag.totalCount).toBe(2)
      expect(diag.activeCount).toBe(2)
      expect(diag.averageConfidence).toBe(0.7)
    })
  })

  describe('persistence', () => {
    it('survives store reload', async () => {
      await store.create({ id: 'P1', title: 'Persist', statement: 'P' })
      await store.update('P1', { recordTrial: { supported: true } })
      const store2 = new JsonHypothesisStore({ workspaceDir: tmpDir })
      const found = await store2.get('P1')
      expect(found).not.toBeNull()
      expect(found!.confidence.totalTrials).toBe(1)
    })
  })
})
