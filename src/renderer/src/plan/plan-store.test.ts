import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuiPlanArtifact,
  forgetGuiPlan,
  guiPlanMatchesContext,
  PLAN_REGISTRY_STORAGE_KEY,
  readRememberedGuiPlan,
  useGuiPlanStore
} from './plan-store'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

function storageKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => typeof key === 'string'
  )
}

describe('plan-store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    useGuiPlanStore.getState().clearActivePlan()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useGuiPlanStore.getState().clearActivePlan()
  })

  it('creates artifacts with shared plan id and relative path normalization', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: 'C:\\Users\\Codex\\APP\\',
      threadId: 'thread-a',
      relativePath: '.sciforge\\plan\\Checkout.md',
      sourceRequest: 'checkout',
      now: 1
    })

    expect(plan).toMatchObject({
      id: 'C:/Users/Codex/APP:.sciforge/plan/checkout.md',
      workspaceRoot: 'C:/Users/Codex/APP',
      relativePath: '.sciforge/plan/Checkout.md',
      featureName: 'checkout'
    })
  })

  it('remembers active plans only for the owning thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')?.id).toBe(plan.id)
    expect(readRememberedGuiPlan('/tmp/app', 'thread-b')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/app')).toBeNull()
  })

  it('persists the plan registry only under the current storage key', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')

    const keys = storageKeys(localStorage)
    expect(keys).toEqual([PLAN_REGISTRY_STORAGE_KEY])
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeTruthy()
    expect(keys.some((key) => /preview|generated-content/.test(key))).toBe(false)
  })

  it('restores remembered plans when workspace casing or separators differ', () => {
    const threadedPlan = createGuiPlanArtifact({
      workspaceRoot: 'C:\\Users\\Codex\\APP\\',
      threadId: 'thread-a',
      relativePath: '.sciforge\\plan\\Checkout.md',
      sourceRequest: 'checkout',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(threadedPlan, '# Checkout')

    expect(readRememberedGuiPlan('c:/users/codex/app/', 'thread-a')?.id).toBe(threadedPlan.id)
    expect(guiPlanMatchesContext(threadedPlan, 'c:/users/codex/app/', 'thread-a')).toBe(true)
    expect(readRememberedGuiPlan('c:/users/codex/app/')).toBeNull()

    localStorage.clear()

    const threadlessPlan = createGuiPlanArtifact({
      workspaceRoot: 'D:\\Work\\APP\\',
      relativePath: '.sciforge\\plan\\Draft.md',
      sourceRequest: 'draft',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(threadlessPlan, '# Draft')

    expect(readRememberedGuiPlan('d:/work/app/')?.id).toBe(threadlessPlan.id)
    expect(readRememberedGuiPlan('d:/work/app/', 'thread-a')).toBeNull()
  })

  it('remembers threadless plans at workspace scope without leaking into threaded context', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      relativePath: '.sciforge/plan/draft.md',
      sourceRequest: 'draft',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Draft')

    expect(readRememberedGuiPlan('/tmp/app')?.id).toBe(plan.id)
    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
  })

  it('normalizes malformed persisted plan registry data before restoring plans', () => {
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByWorkspace: {
        '/TMP/VALID/': 'valid',
        '/tmp/missing': 'missing'
      },
      activeByThread: {
        '/TMP/VALID::thread-a': 'valid',
        '/tmp/valid::thread-b': 'valid',
        '/tmp/other::thread-a': 'valid',
        '/tmp/invalid::thread-b': 'invalid'
      },
      plans: {
        valid: {
          workspaceRoot: '/tmp/valid/',
          threadId: 'thread-a',
          relativePath: '.sciforge/plan/draft.md',
          sourceRequest: 'draft',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        invalid: {
          id: 'invalid',
          workspaceRoot: 42,
          relativePath: ''
        }
      }
    }))

    expect(readRememberedGuiPlan('/tmp/valid', 'thread-a')).toMatchObject({
      id: '/tmp/valid:.sciforge/plan/draft.md',
      workspaceRoot: '/tmp/valid',
      featureName: 'draft',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(readRememberedGuiPlan('/tmp/missing')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/invalid', 'thread-b')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/valid', 'thread-b')).toBeNull()
    expect(readRememberedGuiPlan('/tmp/other', 'thread-a')).toBeNull()
  })

  it('drops mismatched thread registry pointers without shadowing valid fallbacks', () => {
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByThread: {
        '/tmp/app::thread-a': 'wrong-thread',
        '/tmp/app::thread-b': 'threadless',
        '/TMP/APP::thread-a': 'valid'
      },
      plans: {
        valid: {
          workspaceRoot: '/tmp/app',
          threadId: 'thread-a',
          relativePath: '.sciforge/plan/valid.md',
          sourceRequest: 'valid',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        wrongThread: {
          id: 'wrong-thread',
          workspaceRoot: '/tmp/app',
          threadId: 'thread-z',
          relativePath: '.sciforge/plan/wrong-thread.md',
          sourceRequest: 'wrong',
          createdAt: '2026-01-01T00:00:00.000Z'
        },
        threadless: {
          workspaceRoot: '/tmp/app',
          relativePath: '.sciforge/plan/threadless.md',
          sourceRequest: 'threadless',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }))

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toMatchObject({
      id: '/tmp/app:.sciforge/plan/valid.md'
    })
    expect(readRememberedGuiPlan('/tmp/app', 'thread-b')).toBeNull()
  })

  it('forgets completed plans from the persisted registry', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')
    forgetGuiPlan(plan)

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
  })

  it('persists updated plan timestamps when saved content is marked clean', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })
    const savedAt = new Date('2026-01-02T03:04:05.000Z')

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')
    vi.useFakeTimers()
    vi.setSystemTime(savedAt)
    useGuiPlanStore.getState().markSaved('# Auth updated')

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')?.updatedAt).toBe(savedAt.toISOString())
  })

  it('matches active plans to the current workspace and thread', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })
    const threadlessPlan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      relativePath: '.sciforge/plan/draft.md',
      sourceRequest: 'draft',
      now: 1
    })

    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-a')).toBe(true)
    expect(guiPlanMatchesContext(plan, '/tmp/app', 'thread-b')).toBe(false)
    expect(guiPlanMatchesContext(plan, '/tmp/other', 'thread-a')).toBe(false)
    expect(guiPlanMatchesContext(threadlessPlan, '/tmp/app')).toBe(true)
    expect(guiPlanMatchesContext(threadlessPlan, '/tmp/app', 'thread-a')).toBe(false)
  })
})
