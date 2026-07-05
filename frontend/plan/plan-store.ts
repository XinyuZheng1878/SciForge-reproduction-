import { create } from 'zustand'
import {
  buildGuiPlanId,
  guiPlanWorkspaceMatches,
  isGuiPlanRelativePath,
  normalizeGuiPlanRelativePath,
  planDisplayNameFromRelativePath
} from '@shared/gui-plan'
import { browserStorage } from '../lib/browser-storage'

export type GuiPlanOperationStatus =
  | 'idle'
  | 'drafting'
  | 'ready'
  | 'refining'
  | 'building'
  | 'error'

export type GuiPlanSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export type GuiPlanArtifact = {
  id: string
  workspaceRoot: string
  threadId?: string | null
  featureName: string
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  createdAt: string
  updatedAt: string
}

export type GuiPlanState = {
  activePlan: GuiPlanArtifact | null
  content: string
  lastSavedContent: string
  saveStatus: GuiPlanSaveStatus
  operationStatus: GuiPlanOperationStatus
  error: string | null
  setActivePlan: (plan: GuiPlanArtifact, content: string) => void
  setContent: (content: string) => void
  setSaveStatus: (status: GuiPlanSaveStatus, error?: string | null) => void
  markSaved: (content: string) => void
  setOperationStatus: (status: GuiPlanOperationStatus, error?: string | null) => void
  updateActivePlan: (planId: string, patch: Partial<Pick<GuiPlanArtifact, 'threadId' | 'absolutePath'>>) => void
  clearActivePlan: () => void
}

export const PLAN_REGISTRY_STORAGE_KEY = 'sciforge.plan.registry.v1'

function normalizeWorkspaceRoot(value: string | undefined | null): string {
  return (value ?? '').trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function discardLegacyGuiPlanRegistry(storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.removeItem?.(PLAN_REGISTRY_STORAGE_KEY)
  } catch {
    /* ignore storage failures */
  }
}

function normalizePlanArtifact(raw: unknown): GuiPlanArtifact | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(record.workspaceRoot))
  const relativePath = normalizeGuiPlanRelativePath(normalizeText(record.relativePath))
  if (!workspaceRoot || !isGuiPlanRelativePath(relativePath)) return null
  const id = buildGuiPlanId(workspaceRoot, relativePath)
  const threadId = normalizeText(record.threadId)
  const absolutePath = normalizeText(record.absolutePath)
  const sourceRequest = typeof record.sourceRequest === 'string' ? record.sourceRequest : ''
  const featureName = normalizeText(record.featureName) || planDisplayNameFromRelativePath(relativePath)
  const createdAt = normalizeText(record.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(record.updatedAt) || createdAt
  return {
    id,
    workspaceRoot,
    ...(threadId ? { threadId } : { threadId: null }),
    featureName,
    relativePath,
    ...(absolutePath ? { absolutePath } : {}),
    sourceRequest,
    createdAt,
    updatedAt
  }
}

export function createGuiPlanArtifact(options: {
  workspaceRoot: string
  threadId?: string | null
  relativePath: string
  absolutePath?: string
  sourceRequest: string
  now?: number
}): GuiPlanArtifact {
  const now = new Date(options.now ?? Date.now()).toISOString()
  const workspaceRoot = normalizeWorkspaceRoot(options.workspaceRoot)
  const relativePath = normalizeGuiPlanRelativePath(options.relativePath)
  const featureName = planDisplayNameFromRelativePath(relativePath)
  return {
    id: buildGuiPlanId(workspaceRoot, relativePath),
    workspaceRoot,
    threadId: options.threadId ?? null,
    featureName,
    relativePath,
    ...(options.absolutePath ? { absolutePath: options.absolutePath } : {}),
    sourceRequest: options.sourceRequest,
    createdAt: now,
    updatedAt: now
  }
}

export function rememberGuiPlan(_plan: GuiPlanArtifact): void {
  discardLegacyGuiPlanRegistry()
}

export function forgetGuiPlan(_planOrId: GuiPlanArtifact | string): void {
  discardLegacyGuiPlanRegistry()
}

export function guiPlanMatchesContext(
  plan: GuiPlanArtifact,
  workspaceRoot: string,
  threadId?: string | null
): boolean {
  if (!guiPlanWorkspaceMatches(plan.workspaceRoot, normalizeWorkspaceRoot(workspaceRoot))) return false
  const activeThread = threadId?.trim() ?? ''
  const planThread = plan.threadId?.trim() ?? ''
  return activeThread ? planThread === activeThread : !planThread
}

export function readRememberedGuiPlan(
  _workspaceRoot: string,
  _threadId?: string | null
): GuiPlanArtifact | null {
  discardLegacyGuiPlanRegistry()
  return null
}

export const useGuiPlanStore = create<GuiPlanState>((set) => ({
  activePlan: null,
  content: '',
  lastSavedContent: '',
  saveStatus: 'saved',
  operationStatus: 'idle',
  error: null,

  setActivePlan: (plan, content) => {
    const normalizedPlan = normalizePlanArtifact(plan) ?? plan
    discardLegacyGuiPlanRegistry()
    set({
      activePlan: normalizedPlan,
      content,
      lastSavedContent: content,
      saveStatus: 'saved',
      operationStatus: 'ready',
      error: null
    })
  },

  setContent: (content) =>
    set((state) => ({
      content,
      saveStatus: content === state.lastSavedContent ? 'saved' : 'dirty',
      error: state.saveStatus === 'error' ? null : state.error
    })),

  setSaveStatus: (status, error = null) => set({ saveStatus: status, error }),

  markSaved: (content) =>
    set((state) => {
      const activePlan = state.activePlan
        ? { ...state.activePlan, updatedAt: new Date().toISOString() }
        : state.activePlan
      discardLegacyGuiPlanRegistry()
      return {
        content,
        lastSavedContent: content,
        saveStatus: 'saved',
        error: state.operationStatus === 'error' ? state.error : null,
        activePlan
      }
    }),

  setOperationStatus: (status, error = null) => set({ operationStatus: status, error }),

  updateActivePlan: (planId, patch) =>
    set((state) => {
      if (state.activePlan?.id !== planId) return {}
      const updated = {
        ...state.activePlan,
        ...patch,
        updatedAt: new Date().toISOString()
      }
      discardLegacyGuiPlanRegistry()
      return { activePlan: updated }
    }),

  clearActivePlan: () => {
    discardLegacyGuiPlanRegistry()
    set({
      activePlan: null,
      content: '',
      lastSavedContent: '',
      saveStatus: 'saved',
      operationStatus: 'idle',
      error: null
    })
  }
}))
