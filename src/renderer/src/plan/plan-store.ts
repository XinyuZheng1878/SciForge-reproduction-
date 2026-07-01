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

type PersistedPlanRegistry = {
  version: 1
  activeByWorkspace: Record<string, string>
  activeByThread: Record<string, string>
  plans: Record<string, GuiPlanArtifact>
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

function threadKey(workspaceRoot: string, threadId: string | null | undefined): string {
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const thread = threadId?.trim()
  return workspace && thread ? `${workspace}::${thread}` : ''
}

function splitThreadKey(key: string): { workspaceRoot: string; threadId: string } | null {
  const separator = key.lastIndexOf('::')
  if (separator <= 0) return null
  const workspaceRoot = key.slice(0, separator)
  const threadId = key.slice(separator + 2).trim()
  return workspaceRoot && threadId ? { workspaceRoot, threadId } : null
}

function emptyRegistry(): PersistedPlanRegistry {
  return { version: 1, activeByWorkspace: {}, activeByThread: {}, plans: {} }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizePlanArtifact(raw: unknown): GuiPlanArtifact | null {
  if (!isRecord(raw)) return null
  const workspaceRoot = normalizeWorkspaceRoot(normalizeText(raw.workspaceRoot))
  const relativePath = normalizeGuiPlanRelativePath(normalizeText(raw.relativePath))
  if (!workspaceRoot || !isGuiPlanRelativePath(relativePath)) return null
  const id = buildGuiPlanId(workspaceRoot, relativePath)
  const threadId = normalizeText(raw.threadId)
  const absolutePath = normalizeText(raw.absolutePath)
  const sourceRequest = typeof raw.sourceRequest === 'string' ? raw.sourceRequest : ''
  const featureName = normalizeText(raw.featureName) || planDisplayNameFromRelativePath(relativePath)
  const createdAt = normalizeText(raw.createdAt) || new Date(0).toISOString()
  const updatedAt = normalizeText(raw.updatedAt) || createdAt
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

function normalizePlanRegistry(raw: unknown): PersistedPlanRegistry {
  if (!isRecord(raw)) return emptyRegistry()
  const plans: PersistedPlanRegistry['plans'] = {}
  const planIdAliases = new Map<string, string>()
  if (isRecord(raw.plans)) {
    for (const [planId, value] of Object.entries(raw.plans)) {
      const plan = normalizePlanArtifact(value)
      if (!plan) continue
      plans[plan.id] = plan
      planIdAliases.set(planId, plan.id)
      const rawId = isRecord(value) ? normalizeText(value.id) : ''
      if (rawId) planIdAliases.set(rawId, plan.id)
    }
  }

  const activeByWorkspace: PersistedPlanRegistry['activeByWorkspace'] = {}
  if (isRecord(raw.activeByWorkspace)) {
    for (const [workspaceRoot, value] of Object.entries(raw.activeByWorkspace)) {
      const workspace = normalizeWorkspaceRoot(workspaceRoot)
      const planId = planIdAliases.get(normalizeText(value)) ?? normalizeText(value)
      const plan = plans[planId]
      if (workspace && plan && guiPlanWorkspaceMatches(plan.workspaceRoot, workspace)) {
        activeByWorkspace[workspace] = plan.id
      }
    }
  }

  const activeByThread: PersistedPlanRegistry['activeByThread'] = {}
  if (isRecord(raw.activeByThread)) {
    for (const [key, value] of Object.entries(raw.activeByThread)) {
      const activeKey = normalizeText(key)
      const planId = planIdAliases.get(normalizeText(value)) ?? normalizeText(value)
      const plan = plans[planId]
      const parsed = splitThreadKey(activeKey)
      if (!plan || !parsed || !guiPlanMatchesContext(plan, parsed.workspaceRoot, parsed.threadId)) {
        continue
      }
      const canonicalKey = threadKey(plan.workspaceRoot, plan.threadId)
      if (canonicalKey) activeByThread[canonicalKey] = plan.id
    }
  }

  return { version: 1, activeByWorkspace, activeByThread, plans }
}

function readRegistry(storage = browserStorage()): PersistedPlanRegistry {
  if (!storage) return emptyRegistry()
  try {
    const raw = storage.getItem(PLAN_REGISTRY_STORAGE_KEY)
    if (!raw) return emptyRegistry()
    return normalizePlanRegistry(JSON.parse(raw))
  } catch {
    return emptyRegistry()
  }
}

function writeRegistry(registry: PersistedPlanRegistry, storage = browserStorage()): void {
  if (!storage) return
  try {
    storage.setItem(PLAN_REGISTRY_STORAGE_KEY, JSON.stringify(normalizePlanRegistry(registry)))
  } catch {
    /* ignore storage failures */
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

export function rememberGuiPlan(plan: GuiPlanArtifact): void {
  const normalizedPlan = normalizePlanArtifact(plan)
  if (!normalizedPlan) return
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(normalizedPlan.workspaceRoot)
  const key = threadKey(workspace, normalizedPlan.threadId)
  registry.plans[normalizedPlan.id] = normalizedPlan
  if (workspace) registry.activeByWorkspace[workspace] = normalizedPlan.id
  if (key) registry.activeByThread[key] = normalizedPlan.id
  writeRegistry(registry)
}

export function forgetGuiPlan(planOrId: GuiPlanArtifact | string): void {
  const registry = readRegistry()
  const planId = typeof planOrId === 'string' ? planOrId : planOrId.id
  delete registry.plans[planId]
  for (const [workspace, activePlanId] of Object.entries(registry.activeByWorkspace)) {
    if (activePlanId === planId) delete registry.activeByWorkspace[workspace]
  }
  for (const [key, activePlanId] of Object.entries(registry.activeByThread)) {
    if (activePlanId === planId) delete registry.activeByThread[key]
  }
  writeRegistry(registry)
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

function findActivePlanIdByWorkspace(
  registry: PersistedPlanRegistry,
  workspaceRoot: string
): string | undefined {
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  if (!workspace) return undefined
  const exact = registry.activeByWorkspace[workspace]
  if (exact) return exact
  return Object.entries(registry.activeByWorkspace).find(([storedWorkspace]) =>
    guiPlanWorkspaceMatches(storedWorkspace, workspace)
  )?.[1]
}

function findActivePlanIdByThread(
  registry: PersistedPlanRegistry,
  workspaceRoot: string,
  threadId: string | null | undefined
): string | undefined {
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const thread = threadId?.trim()
  if (!workspace || !thread) return undefined
  const exact = registry.activeByThread[threadKey(workspace, thread)]
  if (exact) return exact
  return Object.entries(registry.activeByThread).find(([key]) => {
    const parsed = splitThreadKey(key)
    return parsed?.threadId === thread && guiPlanWorkspaceMatches(parsed.workspaceRoot, workspace)
  })?.[1]
}

export function readRememberedGuiPlan(
  workspaceRoot: string,
  threadId?: string | null
): GuiPlanArtifact | null {
  const registry = readRegistry()
  const workspace = normalizeWorkspaceRoot(workspaceRoot)
  const byThread = findActivePlanIdByThread(registry, workspace, threadId)
  const byWorkspace = threadId?.trim() ? undefined : findActivePlanIdByWorkspace(registry, workspace)
  const plan = registry.plans[byThread ?? byWorkspace ?? ''] ?? null
  return plan && guiPlanMatchesContext(plan, workspace, threadId) ? plan : null
}

export const useGuiPlanStore = create<GuiPlanState>((set) => ({
  activePlan: null,
  content: '',
  lastSavedContent: '',
  saveStatus: 'saved',
  operationStatus: 'idle',
  error: null,

  setActivePlan: (plan, content) => {
    rememberGuiPlan(plan)
    set({
      activePlan: plan,
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
      if (activePlan) rememberGuiPlan(activePlan)
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
      rememberGuiPlan(updated)
      return { activePlan: updated }
    }),

  clearActivePlan: () =>
    set({
      activePlan: null,
      content: '',
      lastSavedContent: '',
      saveStatus: 'saved',
      operationStatus: 'idle',
      error: null
    })
}))
