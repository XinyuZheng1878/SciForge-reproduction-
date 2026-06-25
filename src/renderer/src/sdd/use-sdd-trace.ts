import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  sddDraftFolderFromRelativePath,
  sddDraftTraceRelativePath
} from '@shared/sdd'
import {
  applySddDerivedStatuses,
  type SddTraceSnapshot
} from '@shared/sdd-trace'
import { buildPlanRelativePath } from '@shared/gui-plan'
import { useChatStore } from '../store/chat-store'
import { useGuiPlanStore } from '../plan/plan-store'
import { useSddDraftStore } from './sdd-draft-store'
import { saveActiveSddDraftToDisk } from './sdd-draft-actions'
import { computeSddTrace, type SddTraceResult } from './sdd-trace-compute'

function normalizeRoot(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '')
}

function parseTraceSnapshot(raw: string): SddTraceSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as SddTraceSnapshot
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.planRelativePath !== 'string') return null
    if (!parsed.requirementHashes || typeof parsed.requirementHashes !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function sddPlanRelativePathForDraft(draftRelativePath: string): string | null {
  const folder = sddDraftFolderFromRelativePath(draftRelativePath)
  if (!folder) return null
  return buildPlanRelativePath(`sdd-${folder}`)
}

export function useSddTrace(input: {
  workspaceRoot: string
  draftRelativePath: string | null
}): SddTraceResult | null {
  const workspaceRoot = normalizeRoot(input.workspaceRoot)
  const draftRelativePath = input.draftRelativePath
  const planRelativePath = useMemo(
    () => (draftRelativePath ? sddPlanRelativePathForDraft(draftRelativePath) : null),
    [draftRelativePath]
  )

  const activeThreadTodos = useChatStore((s) => s.activeThreadTodos)
  const { activeDraft, draftContent, draftSaveStatus } = useSddDraftStore(
    useShallow((s) => ({
      activeDraft: s.activeDraft,
      draftContent: s.content,
      draftSaveStatus: s.saveStatus
    }))
  )
  const { activePlan, planStoreContent } = useGuiPlanStore(
    useShallow((s) => ({ activePlan: s.activePlan, planStoreContent: s.content }))
  )

  const draftIsActive = Boolean(
    activeDraft &&
      draftRelativePath &&
      activeDraft.relativePath === draftRelativePath &&
      normalizeRoot(activeDraft.workspaceRoot) === workspaceRoot
  )
  const planIsActive = Boolean(
    activePlan &&
      planRelativePath &&
      activePlan.relativePath === planRelativePath &&
      normalizeRoot(activePlan.workspaceRoot) === workspaceRoot
  )

  const [diskRequirement, setDiskRequirement] = useState<string | null>(null)
  const [diskPlan, setDiskPlan] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<SddTraceSnapshot | null>(null)

  const todosVersion = activeThreadTodos?.updatedAt ?? ''

  useEffect(() => {
    if (!workspaceRoot || !draftRelativePath || !planRelativePath) {
      setDiskRequirement(null)
      setDiskPlan(null)
      setSnapshot(null)
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      if (typeof window.sciforge?.readWorkspaceFile !== 'function') return
      const requirement = await window.sciforge
        .readWorkspaceFile({ workspaceRoot, path: draftRelativePath })
        .catch(() => null)
      if (!cancelled) setDiskRequirement(requirement?.ok ? requirement.content : null)
      if (!planIsActive) {
        const plan = await window.sciforge
          .readWorkspaceFile({ workspaceRoot, path: planRelativePath })
          .catch(() => null)
        if (!cancelled) setDiskPlan(plan?.ok ? plan.content : null)
      }
      const tracePath = sddDraftTraceRelativePath(draftRelativePath)
      if (tracePath) {
        const trace = await window.sciforge
          .readWorkspaceFile({ workspaceRoot, path: tracePath })
          .catch(() => null)
        if (!cancelled) setSnapshot(trace?.ok ? parseTraceSnapshot(trace.content) : null)
      } else if (!cancelled) {
        setSnapshot(null)
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [workspaceRoot, draftRelativePath, planRelativePath, planIsActive, todosVersion])

  const storeEditing =
    draftIsActive && (draftSaveStatus === 'dirty' || draftSaveStatus === 'saving')
  const requirementMarkdown = storeEditing
    ? draftContent
    : (diskRequirement ?? (draftIsActive ? draftContent : null))
  const planMarkdown = planIsActive ? planStoreContent : diskPlan

  const result = useMemo(() => {
    if (!requirementMarkdown || !planRelativePath) return null
    return computeSddTrace({
      requirementMarkdown,
      planMarkdown: planMarkdown ?? null,
      planRelativePath,
      threadTodos: activeThreadTodos,
      traceSnapshot: snapshot
    })
  }, [requirementMarkdown, planMarkdown, planRelativePath, activeThreadTodos, snapshot])

  const writebackBusyRef = useRef(false)
  useEffect(() => {
    if (!result || !requirementMarkdown || !draftRelativePath) return
    if (Object.keys(result.derivedStatuses).length === 0) return
    if (writebackBusyRef.current) return
    const next = applySddDerivedStatuses(requirementMarkdown, result.derivedStatuses)
    if (next === requirementMarkdown) return

    writebackBusyRef.current = true
    const run = async (): Promise<void> => {
      try {
        if (storeEditing) {
          const store = useSddDraftStore.getState()
          if (store.saveStatus === 'saving') return
          store.setContent(next)
          await saveActiveSddDraftToDisk()
          return
        }
        if (typeof window.sciforge?.writeWorkspaceFile !== 'function') return
        const written = await window.sciforge.writeWorkspaceFile({
          workspaceRoot,
          path: draftRelativePath,
          content: next
        })
        if (written.ok) {
          setDiskRequirement(next)
          if (draftIsActive) useSddDraftStore.getState().markSaved(next)
        }
      } finally {
        writebackBusyRef.current = false
      }
    }
    void run()
  }, [result, requirementMarkdown, draftRelativePath, draftIsActive, storeEditing, workspaceRoot])

  return result
}
