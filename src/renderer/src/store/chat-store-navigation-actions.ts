import type { NormalizedThread } from '../agent/types'
import { isRemoteChannelManagedBy } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import {
  deriveThreadTitleFromPrompt,
  hasInternalPromptThreadTitle,
  hasPlaceholderThreadTitle,
  shouldAutoTitleThread
} from '../lib/thread-title'
import { filterThreadsForSidebar } from '../lib/thread-sidebar-visibility'
import {
  enrichThreadsWithForkInfo,
  forgetThreadFork,
  hydrateThreadForkRegistry,
  markThreadFork,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { workspaceLabelFromPath } from '../lib/workspace-label'
import { isInternalTemporaryWorkspace, normalizeWorkspaceRoot } from '../lib/workspace-path'
import { onRemoteChannelActivityApi } from '../lib/remote-channel-api'
import { buildRemoteChannelRuntimePrompt, getActiveAgentApiKey, getActiveAgentRuntime, type AgentRuntimeId } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import {
  activeRemoteChannel,
  compactCodeWorkspaceRoots,
  filterHiddenCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hideCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isRemoteChannelThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  readHiddenCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel,
  restoreHiddenCodeWorkspaceRoots
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  reconcileOptimisticUserBlock,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  isEmptySddAssistantThreadCandidate,
  isSddAssistantThread,
  readSddThreadRegistry
} from '../sdd/sdd-thread-registry'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopRuntimeThreadRefreshPoll,
  stopTurnCompletionPoll,
  syncRuntimeThreadRefreshPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  rememberPendingRemoteChannelMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'

type SseAbortRef = { current: AbortController | null }

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let bootPromise: Promise<void> | null = null
let remoteChannelActivityUnsubscribe: (() => void) | null = null
let refreshThreadsRequestSeq = 0

function stateHasRecoverableActiveTurn(state: ChatState): boolean {
  return state.busy || Boolean(state.currentTurnId) || state.blocks.some(hasPendingRuntimeWork)
}

function titleFromLocalUserBlocks(blocks: ChatState['blocks']): string | null {
  for (const block of blocks) {
    if (block.kind !== 'user' || isRemoteChannelManagedBy(block.managedBy)) continue
    const text = block.meta?.displayText?.trim() || block.text.trim()
    if (!text || hasInternalPromptThreadTitle(text)) continue
    const title = deriveThreadTitleFromPrompt(text)
    if (!title || hasPlaceholderThreadTitle(title) || hasInternalPromptThreadTitle(title)) continue
    return title
  }
  return null
}

function threadNeedsSidebarTitle(thread: Pick<NormalizedThread, 'id' | 'title'>): boolean {
  return shouldAutoTitleThread(thread) || hasInternalPromptThreadTitle(thread.title)
}

function activeThreadFilteredFromSidebar(options: {
  activeId: string | null
  rawThreads: NormalizedThread[]
  sidebarThreads: NormalizedThread[]
}): boolean {
  return options.activeId != null &&
    options.rawThreads.some((thread) => thread.id === options.activeId) &&
    !options.sidebarThreads.some((thread) => thread.id === options.activeId)
}

function preserveLocalActiveThreadForSidebar(
  thread: NormalizedThread | null,
  blocks: ChatState['blocks']
): NormalizedThread | null {
  if (!thread) return null
  if (!threadNeedsSidebarTitle(thread)) return thread
  const title = titleFromLocalUserBlocks(blocks)
  return title ? { ...thread, title } : null
}

export async function syncRemoteChannelActivityToStore(
  set: ChatStoreSet,
  get: ChatStoreGet,
  payload: { channelId: string; threadId: string; runtimeId?: AgentRuntimeId; previousThreadId?: string }
): Promise<void> {
  const threadId = payload.threadId.trim()
  if (!threadId) return
  const state = get()
  const previousThreadId = payload.previousThreadId?.trim() ?? ''
  const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
  const channels = settings.remoteChannel.channels
  const activityChannel = channels.find((channel) => channel.id === payload.channelId && channel.enabled)
  const activeChannelId = channels.some(
    (channel) => channel.id === state.activeRemoteChannelId && channel.enabled
  )
    ? state.activeRemoteChannelId
    : channels.find((channel) => channel.enabled)?.id ?? ''
  const nextActiveChannelId = state.connectPhonePanelOpen && activityChannel ? payload.channelId : activeChannelId
  set({ remoteChannels: channels, activeRemoteChannelId: nextActiveChannelId })

  const provider = getProvider()
  provider.rememberThreadRuntime?.(threadId, payload.runtimeId)

  if (state.connectPhonePanelOpen && activityChannel) {
    if (state.activeThreadId === threadId) {
      await get().recoverActiveTurn()
    } else {
      await get().selectRemoteChannelConversation(payload.channelId, threadId)
    }
    return
  }

  if (state.activeThreadId === threadId) {
    await get().recoverActiveTurn()
    await get().refreshThreads()
    return
  }

  if (previousThreadId && previousThreadId === state.activeThreadId && previousThreadId !== threadId) {
    await get().selectThread(threadId)
    return
  }

  set((snapshot) => ({
    watchTurnCompletion: { ...snapshot.watchTurnCompletion, [threadId]: true },
    unreadThreadIds: { ...snapshot.unreadThreadIds, [threadId]: true }
  }))
  watchTurnCompletionNotification(threadId)
  syncTurnCompletionPoll(set, get)
  await get().refreshThreads()
}

export function createNavigationActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'openCode' | 'probeRuntime' | 'boot' | 'chooseWorkspace' | 'clearWorkspace' | 'deleteWorkspace' | 'refreshThreads' | 'setThreadSearch' | 'setShowArchivedThreads'> {
  return {
  openCode: async () => {
    const state = get()
    const activeThread = state.activeThreadId
      ? state.threads.find((thread) => thread.id === state.activeThreadId) ?? null
      : null
    if (activeThread && isCodeThread(activeThread, state.remoteChannels)) {
      set({ route: 'chat', remoteGuardChannelId: null })
      if (stateHasRecoverableActiveTurn(state)) {
        await get().recoverActiveTurn()
      }
      return
    }

    const codeThreads = state.threads.filter((thread) => isCodeThread(thread, state.remoteChannels))
    const selectedWorkspace = normalizeWorkspaceRoot(state.workspaceRoot)
    const target =
      latestThread(codeThreads.filter((thread) => threadBelongsToWorkspace(thread, selectedWorkspace))) ??
      latestThread(codeThreads)

    set({ route: 'chat', remoteGuardChannelId: null })
    if (target && state.runtimeConnection === 'ready') {
      await get().selectThread(target.id)
      return
    }

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    const nextWatch = { ...state.watchTurnCompletion }
    if (state.activeThreadId && state.busy) {
      nextWatch[state.activeThreadId] = true
      watchTurnCompletionNotification(state.activeThreadId)
    }
    set({
      ...clearedThreadSelection(),
      route: 'chat',
      remoteGuardChannelId: null,
      watchTurnCompletion: nextWatch
    })
    syncTurnCompletionPoll(set, get)
  },

  probeRuntime: async (mode = 'user') => {
    const prev = get().runtimeConnection
    if (mode === 'user') set({ runtimeConnection: 'checking' })
    try {
      if (typeof window.sciforge === 'undefined') {
        throw new Error(
          'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.'
        )
      }
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      const p = getProvider()
      await p.connect()
      set({ runtimeConnection: 'ready', error: null, runtimeErrorDetail: null })
      void get().loadComposerModels()
      if (prev !== 'ready' || mode === 'user') {
        try {
          await get().refreshThreads()
        } catch {
          /* refreshThreads sets state */
        }
      }
      syncRuntimeThreadRefreshPoll(get)
      if (get().activeThreadId && stateHasRecoverableActiveTurn(get())) {
        await get().recoverActiveTurn()
      }
    } catch (e) {
      const msg = formatRuntimeError(e)
      const detail = runtimeErrorDetail(e)
      const needsSettings = shouldOpenSettingsForError(e)
      if (mode === 'user') {
        stopRuntimeThreadRefreshPoll()
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      } else if (prev === 'ready') {
        stopRuntimeThreadRefreshPoll()
        stopTurnCompletionPoll()
        set({
          runtimeConnection: 'offline',
          error: msg,
          runtimeErrorDetail: detail,
          ...(needsSettings
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    }
  },

  boot: async () => {
    if (bootPromise) return bootPromise
    bootPromise = (async () => {
      try {
        if (typeof window.sciforge === 'undefined') {
          set({
            error: formatRuntimeError(
              'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.'
            ),
            runtimeConnection: 'offline',
            runtimeErrorDetail: 'Preload bridge missing (window.sciforge). Restart the app or check BrowserWindow preload path.',
            initialSetupOpen: false,
            initialSetupMode: 'required'
          })
          return
        }
        const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        const hiddenCodeWorkspaceRoots = restoreHiddenCodeWorkspaceRoots(
          readHiddenCodeWorkspaceRoots(),
          [workspaceRoot]
        )
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(readCodeWorkspaceRoots(), [workspaceRoot])
        const needsInitialSetup = !getActiveAgentApiKey(settings).trim()
        applyTheme(settings.theme)
        applyUiFontScale(settings.uiFontScale)
        await get().applyI18nFromSettings(settings.locale)
        const onRemoteChannelActivity = onRemoteChannelActivityApi(window.sciforge)
        if (!remoteChannelActivityUnsubscribe && typeof onRemoteChannelActivity === 'function') {
          remoteChannelActivityUnsubscribe = onRemoteChannelActivity(({
            channelId,
            threadId,
            runtimeId,
            previousThreadId
          }) => {
            void (async () => {
              if (typeof window.sciforge === 'undefined') return
              await syncRemoteChannelActivityToStore(set, get, { channelId, threadId, runtimeId, previousThreadId })
            })()
          })
        }
        set({
          route: 'chat',
          remoteGuardChannelId: null,
          initialSetupOpen: needsInitialSetup,
          initialSetupMode: 'required',
          workspaceRoot,
          codeWorkspaceRoots,
          hiddenCodeWorkspaceRoots,
          workspaceLabel: workspaceLabelFromPath(workspaceRoot),
          activeAgentRuntime: getActiveAgentRuntime(settings),
          remoteChannels: settings.remoteChannel.channels,
          activeRemoteChannelId: settings.remoteChannel.channels.find((channel) => channel.enabled)?.id ?? '',
          runtimeConnection: needsInitialSetup ? 'idle' : get().runtimeConnection,
          error: needsInitialSetup ? null : get().error,
          runtimeErrorDetail: needsInitialSetup ? null : get().runtimeErrorDetail
        })
        if (needsInitialSetup) return
        const initialPick = get().composerPickList
        const fromStorage = readStoredComposerModel(initialPick)
        if (fromStorage) {
          set({ composerModel: fromStorage })
        }
        scheduleStartupRuntimeProbe(get)
      } catch (e) {
        set({
          error: formatRuntimeError(e),
          runtimeErrorDetail: runtimeErrorDetail(e),
          runtimeConnection: 'offline',
          initialSetupOpen: false,
          initialSetupMode: 'required',
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
      }
    })().finally(() => {
      bootPromise = null
    })
    return bootPromise
  },

  chooseWorkspace: async ({ createThreadAfter = false, selectThreadAfter = true } = {}) => {
    try {
      if (typeof window.sciforge === 'undefined' || typeof window.sciforge.pickWorkspaceDirectory !== 'function') {
        throw new Error(i18n.t('common:workspacePickerUnavailable'))
      }
      const picked = await window.sciforge.pickWorkspaceDirectory(get().workspaceRoot || undefined)
      if (picked.canceled || !picked.path) {
        if (createThreadAfter) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
        }
        return null
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: picked.path })
      const workspaceRoot = normalizeWorkspaceRoot(next.workspaceRoot)
      // New workspace picked: let the Project DAG button prompt for the
      // project's purpose (it listens for this event in the top bar).
      window.dispatchEvent(
        new CustomEvent('sciforge:project-dag-setup', { detail: { workspaceRoot } })
      )
      const hiddenCodeWorkspaceRoots = restoreHiddenCodeWorkspaceRoots(
        get().hiddenCodeWorkspaceRoots ?? [],
        [workspaceRoot]
      )
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])

      // Update the active thread's workspace so the current session
      // moves to the newly picked directory instead of creating a
      // new thread or switching away. Only treat the thread as moved
      // when the PATCH actually succeeds — otherwise we must fall
      // through to the fallback selection below, or the global
      // workspaceRoot and the active thread would diverge.
      const activeThreadId = get().activeThreadId
      let movedActiveThread = false
      if (activeThreadId && workspaceRoot) {
        const p = getProvider()
        if (typeof p.updateThreadWorkspace === 'function') {
          try {
            await p.updateThreadWorkspace(activeThreadId, workspaceRoot)
            // Update the local threads list so the sidebar shows the
            // thread under the new workspace immediately.
            set((s) => ({
              threads: s.threads.map((thread) =>
                thread.id === activeThreadId ? { ...thread, workspace: workspaceRoot } : thread
              )
            }))
            movedActiveThread = true
          } catch {
            // PATCH failed — leave movedActiveThread false so we fall
            // through to the existing fallback selection below.
          }
        }
      }

      set({
        workspaceRoot,
        codeWorkspaceRoots,
        hiddenCodeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(workspaceRoot),
        error: null
      })
      await get().refreshThreads()
      if (workspaceRoot) {
        if (!selectThreadAfter) return workspaceRoot
        // If we successfully moved the active thread, stay on it.
        if (movedActiveThread) return workspaceRoot
        const workspaceThreads = get().threads
          .filter((thread) => isCodeThread(thread, get().remoteChannels))
          .filter((thread) => threadBelongsToWorkspace(thread, workspaceRoot))
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

        if (createThreadAfter) {
          await get().createThread({ workspaceRoot })
        } else {
          const targetThreadId = workspaceThreads[0]?.id
          if (targetThreadId && get().activeThreadId !== targetThreadId) {
            await get().selectThread(targetThreadId)
          } else if (!targetThreadId) {
            const activeThread = get().activeThreadId
              ? get().threads.find((thread) => thread.id === get().activeThreadId) ?? null
              : null
            if (!activeThread || !threadBelongsToWorkspace(activeThread, workspaceRoot)) {
              const state = get()
              const nextWatch = { ...(state.watchTurnCompletion ?? {}) }
              if (state.activeThreadId && state.busy) {
                nextWatch[state.activeThreadId] = true
                watchTurnCompletionNotification(state.activeThreadId)
              }
              sseAbortRef.current?.abort()
              sseAbortRef.current = null
              clearBusyWatchdog()
              set({
                ...clearedThreadSelection(),
                route: 'chat',
                remoteGuardChannelId: null,
                watchTurnCompletion: nextWatch
              })
              syncTurnCompletionPoll(set, get)
            }
          }
        }
      }
      return workspaceRoot
    } catch (e) {
      set({
        error: formatWorkspacePickerError(e)
      })
      return null
    }
  },

  clearWorkspace: async () => {
    try {
      if (typeof window.sciforge === 'undefined' || typeof window.sciforge.setSettings !== 'function') {
        return
      }
      const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
      set({
        workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
        codeWorkspaceRoots: get().codeWorkspaceRoots,
        workspaceLabel: workspaceLabelFromPath(''),
        error: null
      })
      await get().refreshThreads()
    } catch {
      // silently ignore — the workspace will remain set
    }
  },

  deleteWorkspace: async (workspacePath) => {
    const normalizedPath = normalizeWorkspaceRoot(workspacePath)
    if (!normalizedPath) return
    const { activeThreadId } = get()
    const workspaceThreads = get().threads.filter((thread) =>
      threadBelongsToWorkspace(thread, normalizedPath)
    )
    const removingActive = workspaceThreads.some((th) => th.id === activeThreadId)
    if (removingActive) {
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
    }
    const hiddenCodeWorkspaceRoots = hideCodeWorkspaceRoot(
      get().hiddenCodeWorkspaceRoots ?? [],
      normalizedPath
    )
    const codeWorkspaceRoots = forgetCodeWorkspaceRoot(get().codeWorkspaceRoots, normalizedPath)
    const removeIds = new Set(workspaceThreads.map((th) => th.id))
    set((s) => {
      const w = { ...s.watchTurnCompletion }
      const u = { ...s.unreadThreadIds }
      for (const tid of removeIds) {
        delete w[tid]
        delete u[tid]
        clearWatchedCompletionNotification(tid)
      }
      return {
        codeWorkspaceRoots,
        hiddenCodeWorkspaceRoots,
        watchTurnCompletion: w,
        unreadThreadIds: u,
        ...(removingActive ? clearedThreadSelection() : {}),
        error: null
      }
    })
    // If the removed workspace is the current workspaceRoot, clear it.
    if (normalizeWorkspaceRoot(get().workspaceRoot) === normalizedPath) {
      try {
        if (typeof window.sciforge?.setSettings === 'function') {
          const next = await rendererRuntimeClient.setSettings({ workspaceRoot: '' })
          set({
            workspaceRoot: normalizeWorkspaceRoot(next.workspaceRoot),
            codeWorkspaceRoots: get().codeWorkspaceRoots,
            workspaceLabel: workspaceLabelFromPath('')
          })
        }
      } catch {
        /* silently keep workspaceRoot if settings clear fails */
      }
    }
    await get().refreshThreads()
  },

  refreshThreads: async () => {
    if (get().runtimeConnection !== 'ready') return
    const requestSeq = ++refreshThreadsRequestSeq
    try {
      const p = getProvider()
      let rawThreads: NormalizedThread[]
      try {
        rawThreads = await p.listThreads({ limit: 200, includeArchived: true })
      } catch {
        rawThreads = await p.listThreads()
      }
      const threads = rawThreads.map((thread) => ({
        ...thread,
        workspace: normalizeWorkspaceRoot(thread.workspace)
      }))
      const sddThreadRegistry = readSddThreadRegistry()
      const hiddenCodeWorkspaceRoots = get().hiddenCodeWorkspaceRoots ?? []
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(
        get().codeWorkspaceRoots,
        filterHiddenCodeWorkspaceRoots(
          threads
            .filter((thread) => isCodeThread(thread, get().remoteChannels))
            .map((thread) => thread.workspace),
          hiddenCodeWorkspaceRoots
        )
      )
      const applySidebarThreads = async (candidateThreads: NormalizedThread[]): Promise<void> => {
        const sidebarThreads = candidateThreads.filter((thread) =>
          !isSddAssistantThread(thread, sddThreadRegistry) &&
          !isEmptySddAssistantThreadCandidate(thread)
        )
        if (requestSeq !== refreshThreadsRequestSeq) return
        const forkRegistry = hydrateThreadForkRegistry(sidebarThreads, readThreadForkRegistry())
        saveThreadForkRegistry(forkRegistry)
        const enrichedThreads = enrichThreadsWithForkInfo(sidebarThreads, forkRegistry)
        // Preserve the active runtime thread when it is not in the listing yet.
        // A brand-new thread can be absent from `listThreads` until the first
        // message is written. Without this, the optimistic thread would be wiped
        // from the sidebar and its live turn aborted by the selection clearing
        // path below.
        const activeId = get().activeThreadId
        const activeRawThread = activeId
          ? threads.find((thread) => thread.id === activeId) ?? null
          : null
        const activeThreadIsSdd =
          isSddAssistantThread(activeRawThread, sddThreadRegistry) ||
          isSddAssistantThread(
            activeId ? get().threads.find((thread) => thread.id === activeId) ?? null : null,
            sddThreadRegistry
          ) ||
          isEmptySddAssistantThreadCandidate(activeRawThread) ||
          isEmptySddAssistantThreadCandidate(
            activeId ? get().threads.find((thread) => thread.id === activeId) ?? null : null
          )
        const activeThreadWasFilteredFromSidebar =
          !activeThreadIsSdd &&
          activeThreadFilteredFromSidebar({ activeId, rawThreads: threads, sidebarThreads })
        const preservedSddActiveThread =
          activeThreadIsSdd && activeId
            ? activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null
            : null
        const pendingActiveThread =
          activeId != null &&
          !activeThreadWasFilteredFromSidebar &&
          !enrichedThreads.some((thread) => thread.id === activeId)
            ? get().threads.find((thread) => thread.id === activeId) ?? null
            : null
        let displayThreads = pendingActiveThread
          ? [pendingActiveThread, ...enrichedThreads]
          : enrichedThreads
        if (
          preservedSddActiveThread &&
          !displayThreads.some((thread) => thread.id === preservedSddActiveThread.id)
        ) {
          displayThreads = [preservedSddActiveThread, ...displayThreads]
        }
        const activeThreadId = get().activeThreadId
        const activeThread = activeThreadId
          ? displayThreads.find((thread) => thread.id === activeThreadId) ?? null
          : null
        const activeThreadIsManagedInCodeRoute =
          get().route === 'chat' &&
          activeThread != null &&
          isRemoteChannelThread(activeThread, get().remoteChannels)
        const activeThreadHasLocalConversation =
          activeId != null &&
          (
            get().blocks.length > 0 ||
            Boolean((get().liveAssistant ?? '').trim()) ||
            Boolean((get().liveReasoning ?? '').trim()) ||
            stateHasRecoverableActiveTurn(get())
          )
        const shouldClearSelection =
          activeThreadId != null &&
          !activeThreadHasLocalConversation &&
          !displayThreads.some((thread) => thread.id === activeThreadId)
        const locallyActiveThread =
          activeThreadHasLocalConversation && activeId
            ? preserveLocalActiveThreadForSidebar(
                activeRawThread ?? get().threads.find((thread) => thread.id === activeId) ?? null,
                get().blocks
              )
            : null
        if (
          locallyActiveThread &&
          !displayThreads.some((thread) => thread.id === locallyActiveThread.id)
        ) {
          displayThreads = [locallyActiveThread, ...displayThreads]
        }
        if (shouldClearSelection) {
          sseAbortRef.current?.abort()
          sseAbortRef.current = null
        }
        const validIds = new Set(displayThreads.map((t) => t.id))
        set((s) => {
          const w: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(s.watchTurnCompletion)) {
            if (v && validIds.has(k)) {
              w[k] = true
            } else {
              clearWatchedCompletionNotification(k)
            }
          }
          const u: Record<string, boolean> = {}
          for (const [k, v] of Object.entries(s.unreadThreadIds)) {
            if (v && validIds.has(k)) u[k] = true
          }
          return {
            threads: displayThreads,
            codeWorkspaceRoots: filterHiddenCodeWorkspaceRoots(
              compactCodeWorkspaceRoots([
                ...displayThreads
                  .filter((thread) => isCodeThread(thread, s.remoteChannels))
                  .map((thread) => thread.workspace),
                ...codeWorkspaceRoots
              ]),
              s.hiddenCodeWorkspaceRoots ?? []
            ),
            watchTurnCompletion: w,
            unreadThreadIds: u,
            ...(shouldClearSelection ? clearedThreadSelection() : {})
          }
        })
        syncTurnCompletionPoll(set, get)
        if (!shouldClearSelection && get().activeThreadId && stateHasRecoverableActiveTurn(get())) {
          armBusyWatchdog(set, get)
        }
        syncRuntimeThreadRefreshPoll(get)
        if (activeThreadIsManagedInCodeRoute) {
          await get().openCode()
        }
      }

      const filteredThreads = await filterThreadsForSidebar(threads, p)
      await applySidebarThreads(filteredThreads)
    } catch (e) {
      if (requestSeq !== refreshThreadsRequestSeq) return
      stopRuntimeThreadRefreshPoll()
      stopTurnCompletionPoll()
      set({
        runtimeConnection: 'offline',
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  setThreadSearch: (query) => {
    set({ threadSearch: query })
  },

  setShowArchivedThreads: (show) => {
    set({ showArchivedThreads: show })
    if (show && get().runtimeConnection === 'ready') {
      void get().refreshThreads()
    }
  },
  }
}
