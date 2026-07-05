import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGuiPlanArtifact,
  PLAN_REGISTRY_STORAGE_KEY,
  useGuiPlanStore
} from '../../plan/plan-store'
import { runPlanPanelRememberedPlanRestore } from './PlanPanel'

vi.mock('../write/WriteMarkdownEditor', () => ({
  WriteMarkdownEditor: () => null
}))

vi.mock('../../write/write-workspace-store', () => ({
  useWriteWorkspaceStore: () => ({})
}))

vi.mock('../../store/chat-store', () => ({
  useChatStore: {
    getState: () => ({
      syncPlanTodosFromMarkdown: vi.fn()
    })
  }
}))

vi.mock('../../lib/open-workspace-path', () => ({
  openWorkspacePathInEditor: vi.fn()
}))

vi.mock('../../sdd/use-sdd-trace', () => ({
  useSddTrace: () => null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

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

describe('PlanPanel remembered plan restore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
    useGuiPlanStore.getState().clearActivePlan()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useGuiPlanStore.getState().clearActivePlan()
  })

  it('clears stale owner content and deletes the old localStorage plan registry without restoring it', () => {
    const stalePlan = createGuiPlanArtifact({
      workspaceRoot: '/tmp/app',
      threadId: 'thread-a',
      relativePath: '.sciforge/plan/owner-a.md',
      sourceRequest: 'owner a',
      now: 1
    })
    const readWorkspaceFile = vi.fn(async () => ({
      ok: false as const,
      message: 'plan B is missing'
    }))

    useGuiPlanStore.getState().setActivePlan(stalePlan, '# Owner A')
    localStorage.setItem(PLAN_REGISTRY_STORAGE_KEY, '{}')
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeTruthy()

    runPlanPanelRememberedPlanRestore({
      workspaceRoot: '/tmp/app',
      activeThreadId: 'thread-b',
      activePlan: useGuiPlanStore.getState().activePlan,
      readWorkspaceFile,
      setActivePlan: useGuiPlanStore.getState().setActivePlan,
      setOperationStatus: useGuiPlanStore.getState().setOperationStatus,
      clearActivePlan: useGuiPlanStore.getState().clearActivePlan
    })

    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(localStorage.getItem(PLAN_REGISTRY_STORAGE_KEY)).toBeNull()
    expect(useGuiPlanStore.getState()).toMatchObject({
      activePlan: null,
      content: ''
    })

    runPlanPanelRememberedPlanRestore({
      workspaceRoot: '/tmp/app',
      activeThreadId: 'thread-b',
      activePlan: useGuiPlanStore.getState().activePlan,
      readWorkspaceFile,
      setActivePlan: useGuiPlanStore.getState().setActivePlan,
      setOperationStatus: useGuiPlanStore.getState().setOperationStatus,
      clearActivePlan: useGuiPlanStore.getState().clearActivePlan
    })

    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(useGuiPlanStore.getState()).toMatchObject({
      activePlan: null,
      content: '',
      operationStatus: 'idle',
      error: null
    })
  })
})
