import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuiPlanArtifact,
  discardLegacyGuiPlanRegistry,
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

  it('keeps active plans in memory without persisting the legacy GUI registry', () => {
    const plan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/auth.md',
      sourceRequest: 'auth',
      now: 1
    })

    useGuiPlanStore.getState().setActivePlan(plan, '# Auth')

    expect(useGuiPlanStore.getState().activePlan?.id).toBe(plan.id)
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()
    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
  })

  it('deletes stale persisted GUI plan registries instead of migrating them', () => {
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify({
      activeByWorkspace: { '/tmp/app': 'plan-a' },
      activeByThread: { '/tmp/app::thread-a': 'plan-a' },
      plans: {
        'plan-a': {
          workspaceRoot: '/tmp/app',
          threadId: 'thread-a',
          relativePath: '.sciforge/plan/auth.md',
          sourceRequest: 'auth',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      }
    }))

    expect(readRememberedGuiPlan('/tmp/app', 'thread-a')).toBeNull()
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()
  })

  it('clears stale registries from legacy helper calls', () => {
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, '{}')
    discardLegacyGuiPlanRegistry()
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()

    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, '{}')
    forgetGuiPlan('old-plan')
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()
  })

  it('persists updated plan timestamps only in memory when saved content is marked clean', () => {
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

    expect(useGuiPlanStore.getState().activePlan?.updatedAt).toBe(savedAt.toISOString())
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()
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
