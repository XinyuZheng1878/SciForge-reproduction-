import { describe, expect, it, vi } from 'vitest'
import { createPaperRadarWorkerService } from './paper-radar-worker-service'

describe('paper-radar worker service adapter', () => {
  it('maps GUI Paper Radar payloads onto the shared worker service contract', async () => {
    const worker = {
      diagnostics: vi.fn(() => ({
        stats: { papers: 2, arxiv: 1, biorxiv: 1 },
        checkedAt: '2026-06-23T00:00:00.000Z'
      })),
      syncArxiv: vi.fn(async () => ({ source: 'arxiv', fetched: 1, upserted: 1, skipped: 0 })),
      syncBiorxiv: vi.fn(async () => ({ source: 'biorxiv', fetched: 1, upserted: 1, skipped: 0 })),
      syncProfile: vi.fn(async () => ({
        dryRun: false,
        preview: false,
        profile: 'lab_default',
        results: [],
        fetched: 0,
        upserted: 0,
        skipped: 0,
        auditId: 'pr_audit_000001'
      })),
      listProfiles: vi.fn(() => ({ profiles: [], count: 0 })),
      saveProfile: vi.fn(() => ({
        dryRun: false,
        preview: false,
        saved: true,
        profile: {
          name: 'lab_default',
          keywords: [],
          excludeKeywords: [],
          arxivCategories: [],
          biorxivSubjects: []
        },
        auditId: 'pr_audit_000002'
      })),
      search: vi.fn(() => ({ papers: [], count: 0 })),
      rank: vi.fn(() => ({ profile: 'lab_default', papers: [], count: 0 })),
      digest: vi.fn(() => ({ profile: 'lab_default', generatedAt: '2026-06-23T00:00:00.000Z', papers: [], count: 0 })),
      close: vi.fn()
    }
    const service = createPaperRadarWorkerService({ service: worker as never })

    await expect(service.status()).resolves.toMatchObject({
      ok: true,
      service: 'sciforge.paper-radar',
      stats: { papers: 2, arxiv: 1, biorxiv: 1 }
    })
    await expect(service.search({ query: 'protein', topK: 5 })).resolves.toEqual({
      ok: true,
      data: { papers: [], count: 0 }
    })
    expect(worker.search).toHaveBeenCalledWith({
      query: 'protein',
      sources: undefined,
      categories: undefined,
      from: undefined,
      to: undefined,
      top_k: 5
    })

    await service.saveProfile({
      name: 'lab default',
      keywords: ['protein'],
      excludeKeywords: ['review'],
      arxivCategories: ['q-bio'],
      biorxivSubjects: ['bioinformatics']
    })
    expect(worker.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'lab default',
      keywords: ['protein'],
      exclude_keywords: ['review'],
      arxiv_categories: ['q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      confirmed: true,
      confirmation_id: 'gui-paper-radar-profile-save'
    }))

    await service.syncProfile({ profile: 'lab_default', maxRecords: 20 })
    expect(worker.syncProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'lab_default',
      max_records: 20,
      confirmed: true,
      confirmation_id: 'gui-paper-radar-profile-sync'
    }))
  })
})
