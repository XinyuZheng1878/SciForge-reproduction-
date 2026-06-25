import type { AgentProvider, AgentProviderCapabilities, NormalizedThread, ReviewTarget, ThreadEventSink } from '../agent/types'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import i18n from '../i18n'
import { applyTheme, applyUiFontScale } from '../lib/apply-theme'
import { formatWorkspacePickerError } from '../lib/format-workspace-picker-error'
import { formatRuntimeError } from '../lib/format-runtime-error'
import { parseRuntimeErrorBody } from '@shared/runtime-error'
import {
  deriveThreadTitleFromPrompt,
  getDefaultThreadTitle,
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
import { parseSteerCommand } from '../lib/steer-command'
import { buildClawRuntimePrompt, buildCodeRuntimePrompt, getActiveAgentApiKey, type AgentRuntimeId } from '@shared/app-settings'
import type { AgentRuntimeContextState, AgentRuntimeFileReference } from '@shared/agent-runtime-contract'
import type { ChatState, ChatStoreGet, ChatStoreSet, QueuedUserMessage } from './chat-store-types'
import {
  activeClawChannel,
  clawThreadIdsFromChannels,
  compactCodeWorkspaceRoots,
  forgetCodeWorkspaceRoot,
  hydrateBlockModelLabels,
  isClawThread,
  optimisticUserModelLabel,
  readCodeWorkspaceRoots,
  readStoredComposerModel,
  rememberCodeWorkspaceRoots,
  rememberTurnModel
} from './chat-store-helpers'
import {
  clearedThreadSelection,
  collectAssistantTextForTurn,
  findLatestUserBlockId,
  findReusableEmptyThreadId,
  hasPendingRuntimeWork,
  reconcileOptimisticUserBlock,
  rememberProviderThreadRuntime,
  settlePendingRuntimeWorkAfterCompletion,
  threadSnapshotLooksRunning,
  threadBelongsToWorkspace
} from './chat-store-runtime-helpers'
import {
  clearBusyWatchdog,
  resetBusyRecoveryAttempts,
  scheduleStartupRuntimeProbe,
  stopTurnCompletionPoll
} from './chat-store-schedulers'
import {
  armBusyWatchdog,
  buildFollowupMessageFromUserInput,
  buildThreadEventSink,
  clearWatchedCompletionNotification,
  finalizeTurnTiming,
  flushLiveBlocks,
  forkedMessageCount,
  forkedTurnCount,
  isCodeThread,
  latestThread,
  rememberPendingClawFeishuMirror,
  runtimeErrorDetail,
  runtimeStreamRecoveringMessage,
  shouldOpenSettingsForError,
  syncTurnCompletionPoll,
  watchTurnCompletionNotification
} from './chat-store-runtime'

type SseAbortRef = { current: AbortController | null }

function normalizeRuntimeFileReferencePath(value: string): string | null {
  const normalized = value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/^\.\//u, '')
  if (!normalized || normalized === '.' || normalized === '..') return null
  if (normalized.includes('\0')) return null
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)) return null
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized)) return null
  const parts = normalized.split('/').filter((part) => part && part !== '.')
  if (parts.length === 0 || parts.includes('..')) return null
  return parts.join('/')
}

function fileNameFromRelativePath(relativePath: string): string {
  return relativePath.split('/').filter(Boolean).pop() ?? relativePath
}

function normalizeRuntimeFileReferences(
  references: AgentRuntimeFileReference[] | undefined
): AgentRuntimeFileReference[] {
  if (!references?.length) return []
  const safeReferences: AgentRuntimeFileReference[] = []
  for (const reference of references) {
    const relativePath =
      normalizeRuntimeFileReferencePath(reference.relativePath) ??
      normalizeRuntimeFileReferencePath(reference.path)
    if (!relativePath) continue
    safeReferences.push({
      path: relativePath,
      relativePath,
      name: reference.name.trim() || fileNameFromRelativePath(relativePath),
      ...(reference.kind ? { kind: reference.kind } : {}),
      ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
      delivery: reference.delivery ?? (reference.modelRouterObject ? 'model_router_object' : 'inline_context'),
      ...(reference.modelRouterObject ? { modelRouterObject: true } : {})
    })
  }
  return safeReferences
}

async function readProviderContextState(
  provider: AgentProvider,
  threadId: string
): Promise<AgentRuntimeContextState | null> {
  if (typeof provider.getContextState !== 'function') return null
  try {
    return await provider.getContextState(threadId)
  } catch {
    return null
  }
}

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
  sseAbortRef: SseAbortRef
}

let drainingQueuedMessages = false

function stripIpcErrorPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
}

function structuredRuntimeErrorCode(error: unknown): string | null {
  const raw = stripIpcErrorPrefix(error instanceof Error ? error.message : String(error ?? ''))
  const parsed = parseRuntimeErrorBody(raw, '')
  return parsed.code === 'unknown' ? null : parsed.code
}

function providerSupportsCapability(
  provider: { getCapabilities?: () => Partial<AgentProviderCapabilities> },
  capability: keyof AgentProviderCapabilities
): boolean {
  return provider.getCapabilities?.()[capability] === true
}

function canSteerPlainTextMessage(
  message: Pick<QueuedUserMessage, 'attachmentIds' | 'attachments' | 'fileReferences' | 'guiPlan'>
): boolean {
  return !message.attachmentIds?.length &&
    !message.attachments?.length &&
    !message.fileReferences?.length &&
    !message.guiPlan
}

function upsertRuntimeTargetThread(
  threads: NormalizedThread[],
  input: {
    previousThreadId: string
    nextThreadId: string
    runtimeId: AgentRuntimeId
    updatedAt: string
  }
): NormalizedThread[] {
  const existing = threads.find((thread) => thread.id === input.nextThreadId)
  const previous = threads.find((thread) => thread.id === input.previousThreadId)
  const next: NormalizedThread = {
    ...(previous ?? {
      id: input.nextThreadId,
      title: input.nextThreadId.slice(0, 8),
      model: '',
      mode: 'agent'
    }),
    ...(existing ?? {}),
    id: input.nextThreadId,
    runtimeId: input.runtimeId,
    updatedAt: input.updatedAt,
    title: existing?.title ?? previous?.title ?? input.nextThreadId.slice(0, 8),
    model: existing?.model ?? previous?.model ?? '',
    mode: existing?.mode ?? previous?.mode ?? 'agent',
    workspace: existing?.workspace ?? previous?.workspace
  }
  const withoutTarget = threads.filter((thread) => thread.id !== input.nextThreadId)
  return [next, ...withoutTarget]
}

export function publishActiveClawThreadContext(state: ChatState, threadId: string | null): void {
  if (typeof window.dsGui?.updateClawActiveThreadContext !== 'function') return
  if (!threadId) {
    void window.dsGui.updateClawActiveThreadContext(null).catch(() => undefined)
    return
  }
  const thread = state.threads.find((item) => item.id === threadId)
  if (thread && isClawThread(thread, state.clawChannels)) {
    void window.dsGui.updateClawActiveThreadContext(null).catch(() => undefined)
    return
  }
  void window.dsGui.updateClawActiveThreadContext({
    threadId,
    runtimeId: thread?.runtimeId,
    workspaceRoot: thread?.workspace || state.workspaceRoot || undefined
  }).catch(() => undefined)
}

function subscribeThreadEventsWithRecovery(
  provider: AgentProvider,
  threadId: string,
  sinceSeq: number,
  sink: ThreadEventSink,
  signal: AbortSignal,
  get: ChatStoreGet
): void {
  rememberProviderThreadRuntime(provider, threadId, get().threads)
  void provider.subscribeThreadEvents(threadId, sinceSeq, sink, signal)
    .catch(() => undefined)
    .then(() => {
      if (signal.aborted) return
      const state = get()
      if (state.activeThreadId !== threadId || !state.busy) return
      void state.recoverActiveTurn()
    })
}

function threadSnapshotHasTurnEvidence(
  blocks: Parameters<typeof threadSnapshotLooksRunning>[0],
  latestTurnId?: string,
  latestUserMessageId?: string
): boolean {
  return Boolean(
    latestTurnId?.trim() ||
    latestUserMessageId?.trim() ||
    blocks.some(hasPendingRuntimeWork)
  )
}

function settleStalePendingBlocksWhenIdle<T extends Parameters<typeof threadSnapshotLooksRunning>[0]>(
  blocks: T,
  busy: boolean
): T {
  return busy ? blocks : settlePendingRuntimeWorkAfterCompletion(blocks) as T
}

export function createThreadActions(
  { set, get, sseAbortRef }: StoreActionContext
): Pick<ChatState, 'createThread' | 'refreshActiveThreadContextState' | 'recoverActiveTurn' | 'selectThread' | 'drainQueuedMessages' | 'removeQueuedMessage' | 'steerQueuedMessage' | 'sendMessage' | 'reviewActiveThread'> {
  return {
  refreshActiveThreadContextState: async (threadId) => {
    const targetThreadId = threadId?.trim() || get().activeThreadId
    if (!targetThreadId) {
      set({ activeThreadContextState: null })
      return
    }
    const p = getProvider()
    const contextState = await readProviderContextState(p, targetThreadId)
    if (get().activeThreadId !== targetThreadId) return
    set({ activeThreadContextState: contextState })
  },

  createThread: async (options = {}) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    try {
      const p = getProvider()
      const settings = await rendererRuntimeClient.getSettings()
      const activeThread = get().activeThreadId
        ? get().threads.find((thread) => thread.id === get().activeThreadId)
        : null
      const workspaceRoot =
        normalizeWorkspaceRoot(options.workspaceRoot) ||
        (activeThread && !isInternalTemporaryWorkspace(activeThread.workspace)
          ? normalizeWorkspaceRoot(activeThread.workspace)
          : '') ||
        normalizeWorkspaceRoot(settings.workspaceRoot)
      if (!workspaceRoot) {
        await get().chooseWorkspace({ createThreadAfter: true })
        return
      }
      const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
      set({ codeWorkspaceRoots })
      const reusableThreadId = options.forceNew
        ? null
        : await findReusableEmptyThreadId(
            get(),
            p,
            workspaceRoot,
            (thread) => isCodeThread(thread, get().clawChannels)
          )
      if (reusableThreadId) {
        if (get().activeThreadId !== reusableThreadId) {
          await get().selectThread(reusableThreadId)
        } else {
          set({ error: null })
        }
        return
      }
      const t = await p.createThread({
        workspace: workspaceRoot,
        title: getDefaultThreadTitle(),
        mode: 'agent'
      })
      // Register + activate optimistically before refreshing. A freshly created
      // Kun thread may not be listed until the first message is written.
      // Setting it active first lets refreshThreads preserve it in the sidebar.
      set((s) => ({
        activeThreadId: t.id,
        activeRemoteChannelId: null,
        codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, t.workspace]),
        threads: s.threads.some((thread) => thread.id === t.id) ? s.threads : [t, ...s.threads]
      }))
      await get().selectThread(t.id)
      await get().refreshThreads()
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  recoverActiveTurn: async () => {
    const state = get()
    if (!state.activeThreadId) return false
    const { activeThreadId } = state
    const p = getProvider()
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    set({ error: runtimeStreamRecoveringMessage() })
    try {
      rememberProviderThreadRuntime(p, activeThreadId, state.threads)
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        goal,
        todos
      } = await p.getThreadDetail(activeThreadId)
      const contextState = await readProviderContextState(p, activeThreadId)
      if (get().activeThreadId !== activeThreadId) {
        if (get().error === runtimeStreamRecoveringMessage()) {
          set({ error: null })
        }
        return false
      }
      const hydratedBlocks = hydrateBlockModelLabels(activeThreadId, rawBlocks)
      const busy = threadSnapshotHasTurnEvidence(hydratedBlocks, latestTurnId, latestUserMessageId) &&
        threadSnapshotLooksRunning(hydratedBlocks, threadStatus)
      const blocks = settleStalePendingBlocksWhenIdle(hydratedBlocks, busy)
      const currentTurnUserId = busy
        ? state.currentTurnUserId ?? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      const currentTurnId = busy ? state.currentTurnId ?? latestTurnId ?? null : null

      set((s) => ({
        activeThreadId,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        activeThreadContextState: contextState,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: busy ? runtimeStreamRecoveringMessage() : null,
        busy,
        currentTurnId,
        currentTurnUserId,
        turnDurationByUserId,
        queuedMessages: s.queuedMessages
      }))
      publishActiveClawThreadContext(get(), activeThreadId)

      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: latestSeq })
      void p.subscribeThreadEvents(activeThreadId, latestSeq, sink, ac.signal)
      if (busy) {
        armBusyWatchdog(set, get)
      } else {
        resetBusyRecoveryAttempts()
        if (get().queuedMessages.length > 0) {
          void get().drainQueuedMessages()
        }
      }
      return busy
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      if (state.busy) armBusyWatchdog(set, get)
      return state.busy
    }
  },

  selectThread: async (id) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return
    }
    const prevId = get().activeThreadId
    const prevBusy = get().busy
    let nextWatch = { ...get().watchTurnCompletion }
    delete nextWatch[id]
    clearWatchedCompletionNotification(id)
    if (prevId && prevId !== id && prevBusy) {
      nextWatch[prevId] = true
      watchTurnCompletionNotification(prevId)
    }
    const nextUnread = { ...get().unreadThreadIds }
    delete nextUnread[id]

    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    const p = getProvider()
    try {
      resetBusyRecoveryAttempts()
      clearBusyWatchdog()
      rememberProviderThreadRuntime(p, id, get().threads)
      const {
        blocks: rawBlocks,
        latestSeq,
        threadStatus,
        latestTurnId,
        latestUserMessageId,
        turnDurationByUserId = {},
        usage: threadUsage,
        goal,
        todos
      } = await p.getThreadDetail(id)
      const contextState = await readProviderContextState(p, id)
      const hydratedBlocks = hydrateBlockModelLabels(id, rawBlocks)
      const busy = threadSnapshotHasTurnEvidence(hydratedBlocks, latestTurnId, latestUserMessageId) &&
        threadSnapshotLooksRunning(hydratedBlocks, threadStatus)
      const blocks = settleStalePendingBlocksWhenIdle(hydratedBlocks, busy)
      const currentTurnUserId = busy
        ? latestUserMessageId ?? findLatestUserBlockId(blocks)
        : null
      set({
        watchTurnCompletion: nextWatch,
        unreadThreadIds: nextUnread,
        activeThreadId: id,
        activeRemoteChannelId: null,
        activeThreadGoal: goal ?? null,
        activeThreadTodos: todos ?? null,
        activeThreadContextState: contextState,
        blocks,
        lastSeq: latestSeq,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        busy,
        currentTurnId: busy ? latestTurnId ?? null : null,
        currentTurnUserId,
        turnStartedAtByUserId: {},
        turnDurationByUserId,
        turnReasoningFirstAtByUserId: {},
        turnReasoningLastAtByUserId: {},
        inspectorSelectedId: null,
        queuedMessages: []
      })
      publishActiveClawThreadContext(get(), id)
      syncTurnCompletionPoll(set, get)
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: id, signal: ac.signal, sinceSeq: latestSeq })
      subscribeThreadEventsWithRecovery(p, id, latestSeq, sink, ac.signal, get)
      if (busy) armBusyWatchdog(set, get)
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
    }
  },

  drainQueuedMessages: async () => {
    if (drainingQueuedMessages) return
    drainingQueuedMessages = true
    try {
      while (true) {
        const state = get()
        const queuedMessages = state.queuedMessages.filter((message) => !message.guiPlan)
        if (queuedMessages.length !== state.queuedMessages.length) {
          set({ queuedMessages })
        }
        const next = queuedMessages[0]
        if (!next || state.busy) return
        if (
          (next.threadId && next.threadId !== state.activeThreadId) ||
          (next.runtimeId && state.threads.find((thread) => thread.id === state.activeThreadId)?.runtimeId !== next.runtimeId)
        ) {
          set((s) => ({
            queuedMessages: s.queuedMessages.filter((message) => message.id !== next.id)
          }))
          continue
        }
        const started = await get().sendMessage(next.text, next.mode, { queued: next })
        if (!started) return
      }
    } finally {
      drainingQueuedMessages = false
    }
  },

  removeQueuedMessage: (id) =>
    set((s) => ({
      queuedMessages: s.queuedMessages.filter((message) => message.id !== id)
    })),

  steerQueuedMessage: async (id) => {
    const state = get()
    const queued = state.queuedMessages.find((message) => message.id === id)
    if (!queued) return false
    const activeThreadId = state.activeThreadId
    const currentTurnId = state.currentTurnId
    const p = getProvider()
    const canSteerActiveTurn =
      Boolean(activeThreadId && currentTurnId) &&
      (!queued.threadId || queued.threadId === activeThreadId) &&
      (!queued.runtimeId || get().threads.find((thread) => thread.id === activeThreadId)?.runtimeId === queued.runtimeId) &&
      typeof p.steerUserMessage === 'function' &&
      providerSupportsCapability(p, 'steer') &&
      canSteerPlainTextMessage(queued)
    if (!canSteerActiveTurn || !activeThreadId || !currentTurnId || !p.steerUserMessage) {
      set({ error: i18n.t('common:runtimeSteerUnsupported') })
      return false
    }
    try {
      rememberProviderThreadRuntime(p, activeThreadId, get().threads)
      await p.steerUserMessage(activeThreadId, currentTurnId, queued.text)
      set((s) => ({
        queuedMessages: s.queuedMessages.filter((message) => message.id !== id),
        error: null
      }))
      return true
    } catch (e) {
      set({
        error: formatRuntimeError(e),
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      return false
    }
  },

  sendMessage: async (text, mode, overrides) => {
    const trimmedText = text.trim()
    if (!trimmedText) return false
    const steerCommandText = parseSteerCommand(trimmedText)
    const explicitSteerText = steerCommandText !== false ? steerCommandText.trim() : null
    const messageText = explicitSteerText ?? trimmedText
    if (!messageText) {
      set({ error: i18n.t('common:steerCommandRequiresMessage') })
      return false
    }
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    const queued = overrides?.queued
    const sourceRoute = queued?.sourceRoute ?? overrides?.sourceRoute ?? get().route
    const requestedGovernanceProfile = queued?.governanceProfile ?? overrides?.governanceProfile
    let targetThreadId = (queued?.targetThreadId ?? overrides?.targetThreadId)?.trim() || ''
    const hasPendingActiveTurn = get().blocks.some(hasPendingRuntimeWork)
    if (get().busy || hasPendingActiveTurn) {
      if (overrides?.guiPlan) {
        set({ error: i18n.t('common:composerQueuePlaceholder') })
        return false
      }
      const now = Date.now()
      const activeThreadId = get().activeThreadId
      const threadSnap = activeThreadId
        ? get().threads.find((thread) => thread.id === activeThreadId)
        : undefined
      const clawModel = activeClawChannel(get())?.model
      const overrideModel = overrides?.model?.trim()
      const composerModel =
        overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
      const userModelChip =
        overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
      const displayText = overrides?.displayText?.trim()
      const queuedTargetThreadId = targetThreadId || activeThreadId || undefined
      const reasoningEffort = overrides?.reasoningEffort?.trim()
      const attachmentIds = overrides?.attachmentIds?.filter((id) => id.trim().length > 0)
      const attachments = overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0)
      const fileReferences = normalizeRuntimeFileReferences(overrides?.fileReferences)
      const currentTurnId = get().currentTurnId
      const canSteerActiveTurn =
        explicitSteerText !== null &&
        Boolean(activeThreadId && currentTurnId) &&
        typeof p.steerUserMessage === 'function' &&
        providerSupportsCapability(p, 'steer') &&
        !attachmentIds?.length &&
        !attachments?.length &&
        fileReferences.length === 0 &&
        !overrides?.guiPlan
      if (explicitSteerText !== null && !canSteerActiveTurn) {
        set({ error: i18n.t('common:runtimeSteerUnsupported') })
        return false
      }
      if (canSteerActiveTurn && activeThreadId && currentTurnId && p.steerUserMessage) {
        try {
          rememberProviderThreadRuntime(p, activeThreadId, get().threads)
          await p.steerUserMessage(activeThreadId, currentTurnId, messageText)
          set({ error: null })
          return true
        } catch (e) {
          const code = structuredRuntimeErrorCode(e)
          if (code !== 'turn_not_running' && code !== 'capability_unavailable') {
            set({
              error: formatRuntimeError(e),
              ...(shouldOpenSettingsForError(e)
                ? { route: 'settings' as const, settingsSection: 'agents' as const }
                : {})
            })
            return false
          }
        }
      }
      set((s) => ({
        queuedMessages: [
          ...s.queuedMessages,
          {
            id: `q-${now}-${s.queuedMessages.length}`,
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(threadSnap?.runtimeId ? { runtimeId: threadSnap.runtimeId } : {}),
            text: messageText,
            ...(displayText ? { displayText } : {}),
            ...(mode ? { mode } : {}),
            sourceRoute,
            ...(queuedTargetThreadId ? { targetThreadId: queuedTargetThreadId } : {}),
            ...(requestedGovernanceProfile ? { governanceProfile: requestedGovernanceProfile } : {}),
            ...(composerModel ? { model: composerModel } : {}),
            ...(userModelChip ? { modelLabel: userModelChip } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(overrides?.guiPlan ? { guiPlan: overrides.guiPlan } : {}),
            ...(attachmentIds?.length ? { attachmentIds } : {}),
            ...(attachments?.length ? { attachments } : {}),
            ...(fileReferences?.length ? { fileReferences } : {})
          }
        ],
        error: null
      }))
      // UI/runtime can briefly drift (busy=false while runtime still has an active turn).
      // Kick recovery so queued input drains as soon as the in-flight turn settles.
      if (!get().busy && hasPendingActiveTurn) {
        void get().recoverActiveTurn()
      }
      return true
    }
    const now = Date.now()
    const userBlockId = queued?.id ?? `u-${now}`
    const attachmentIds =
      queued?.attachmentIds ??
      overrides?.attachmentIds?.filter((id) => id.trim().length > 0) ??
      []
    const attachments =
      queued?.attachments ??
      overrides?.attachments?.filter((attachment) => attachment.id.trim().length > 0) ??
      []
    const fileReferences = normalizeRuntimeFileReferences(
      queued?.fileReferences ?? overrides?.fileReferences
    )
    let activeThreadId = targetThreadId || get().activeThreadId
    const displayText = queued?.displayText ?? overrides?.displayText?.trim() ?? messageText
    const userDisplayText = displayText !== messageText ? displayText : undefined
    const generatedTitle = deriveThreadTitleFromPrompt(displayText)
    const shouldAutoRenameForRoute = sourceRoute === 'chat'
    const activeThread = activeThreadId
      ? get().threads.find((thread) => thread.id === activeThreadId) ?? null
      : null
    let shouldRenameThreadAfterSend =
      shouldAutoRenameForRoute &&
      !!activeThreadId &&
      get().blocks.every((block) => block.kind !== 'user') &&
      shouldAutoTitleThread(activeThread)
    const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
    const clawModel = activeClawChannel(get())?.model
    const overrideModel = overrides?.model?.trim()
    const composerModel =
      queued?.model ?? overrideModel ?? (get().route === 'claw' && clawModel ? clawModel : get().composerModel.trim())
    const reasoningEffort = queued?.reasoningEffort ?? overrides?.reasoningEffort?.trim()
    const userModelChip =
      queued?.modelLabel ?? overrides?.modelLabel ?? optimisticUserModelLabel(composerModel, threadSnap?.model)
    const previousBlocks = get().blocks
    const previousActiveThreadId = get().activeThreadId
    const previousLastSeq = get().lastSeq
    const previousCurrentTurnId = get().currentTurnId
    const previousCurrentTurnUserId = get().currentTurnUserId
    const previousTurnStartedAtByUserId = get().turnStartedAtByUserId
    const previousTurnDurationByUserId = get().turnDurationByUserId
    const previousTurnReasoningFirstAtByUserId = get().turnReasoningFirstAtByUserId
    const previousTurnReasoningLastAtByUserId = get().turnReasoningLastAtByUserId
    const previousQueuedMessages = get().queuedMessages
    resetBusyRecoveryAttempts()
    set((s) => ({
      busy: true,
      blocks: [
        ...s.blocks,
        {
          kind: 'user' as const,
          id: userBlockId,
          createdAt: new Date(now).toISOString(),
          text: displayText,
          ...(userModelChip ? { modelLabel: userModelChip } : {}),
          ...(userDisplayText || attachmentIds.length || attachments.length
            ? {
                meta: {
                  source: 'desktop',
                  ...(userDisplayText ? { displayText: userDisplayText } : {}),
                  ...(attachmentIds.length ? { attachmentIds } : {}),
                  ...(attachments.length ? { attachments } : {})
                }
              }
            : { meta: { source: 'desktop' } })
        }
      ],
      liveReasoning: '',
      liveAssistant: '',
      error: null,
      currentTurnUserId: userBlockId,
      turnStartedAtByUserId: { ...s.turnStartedAtByUserId, [userBlockId]: now },
      queuedMessages: queued ? s.queuedMessages.filter((message) => message.id !== queued.id) : s.queuedMessages
    }))
    if (!activeThreadId) {
      try {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({
            blocks: previousBlocks,
            busy: false,
            currentTurnId: previousCurrentTurnId,
            currentTurnUserId: previousCurrentTurnUserId,
            turnStartedAtByUserId: previousTurnStartedAtByUserId,
            turnDurationByUserId: previousTurnDurationByUserId,
            turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
            turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
            queuedMessages: previousQueuedMessages,
            error: i18n.t('common:workspaceRequiredToCreateThread')
          })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const reusableThread = reusableThreadId
          ? get().threads.find((thread) => thread.id === reusableThreadId) ?? null
          : null
        shouldRenameThreadAfterSend =
          shouldAutoRenameForRoute &&
          reusableThreadId != null && shouldAutoTitleThread(reusableThread)
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: generatedTitle,
                mode: mode ?? 'agent'
              })
            : null
        const threadId = reusableThreadId ?? createdThread?.id ?? null
        if (!threadId) {
          throw new Error('Failed to resolve target thread id.')
        }
        activeThreadId = threadId
        set((s) => ({
          activeThreadId: threadId,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
        void get().refreshThreads()
      } catch (e) {
        void window.dsGui.logError('create-thread', 'Failed to create thread', {
          message: e instanceof Error ? e.message : String(e)
        }).catch(() => undefined)
        set({
          activeThreadId: previousActiveThreadId,
          blocks: previousBlocks,
          lastSeq: previousLastSeq,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: formatRuntimeError(e),
          ...(shouldOpenSettingsForError(e)
            ? { route: 'settings' as const, settingsSection: 'agents' as const }
            : {})
        })
        return false
      }
    }
    sseAbortRef.current?.abort()
    sseAbortRef.current = null
    clearBusyWatchdog()
    try {
      if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
      const previousThreadId = activeThreadId
      const seqAtSend = get().lastSeq
      const sendingThread = get().threads.find((thread) => thread.id === previousThreadId)
      const sendingRuntimeId = sendingThread?.runtimeId ?? 'kun'
      const targetRuntimeId = get().activeAgentRuntime
      const runtimeSwitchExpected = sendingRuntimeId !== targetRuntimeId
      rememberProviderThreadRuntime(p, previousThreadId, get().threads)
      const channel = sourceRoute === 'claw' ? activeClawChannel(get()) : null
      const settings = await rendererRuntimeClient.getSettings()
      let runtimeText: string
      if (channel) {
        runtimeText = buildClawRuntimePrompt(settings, messageText, { channel })
      } else {
        runtimeText = buildCodeRuntimePrompt(settings, messageText)
      }
      const runtimeDisplayText = channel ? displayText : (userDisplayText ?? messageText)
      const governanceProfile = requestedGovernanceProfile ?? (
        channel
          ? 'remote_guard'
          : undefined
      )
      const turnHandle = await p.sendUserMessage(previousThreadId, runtimeText, {
        mode,
        ...(sendingThread?.workspace ? { workspace: sendingThread.workspace } : {}),
        ...(sendingThread?.title ? { title: sendingThread.title } : {}),
        ...(composerModel ? { model: composerModel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(governanceProfile ? { governanceProfile } : {}),
        ...(runtimeDisplayText ? { displayText: runtimeDisplayText } : {}),
        ...((queued?.guiPlan ?? overrides?.guiPlan) ? { guiPlan: queued?.guiPlan ?? overrides?.guiPlan } : {}),
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(fileReferences.length ? { fileReferences } : {})
      })
      const deliveredThreadId = turnHandle.threadId?.trim() || previousThreadId
      const { turnId, userMessageItemId } = turnHandle
      const subscribedFromSeq = runtimeSwitchExpected || deliveredThreadId !== previousThreadId ? 0 : seqAtSend
      if (runtimeSwitchExpected || deliveredThreadId !== previousThreadId) {
        set((s) => ({
          activeThreadId: deliveredThreadId,
          threads: upsertRuntimeTargetThread(s.threads, {
            previousThreadId,
            nextThreadId: deliveredThreadId,
            runtimeId: targetRuntimeId,
            updatedAt: new Date(now).toISOString()
          }),
          lastSeq: subscribedFromSeq
        }))
        activeThreadId = deliveredThreadId
      }
      // Mirror the composer model selection against the runtime's stable
      // user_message item id so the badge survives page refresh / thread
      // re-selection. The runtime itself doesn't persist per-turn metadata.
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      if (userMessageItemId && userMessageItemId !== userBlockId) {
        set((s) => ({
          blocks: reconcileOptimisticUserBlock(
            s.blocks,
            userBlockId,
            userMessageItemId,
            displayText,
            userModelChip
          ),
          currentTurnUserId: s.currentTurnUserId === userBlockId ? userMessageItemId : s.currentTurnUserId,
          turnStartedAtByUserId: (() => {
            if (s.turnStartedAtByUserId[userBlockId] === undefined) return s.turnStartedAtByUserId
            const next = { ...s.turnStartedAtByUserId, [userMessageItemId]: s.turnStartedAtByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnDurationByUserId: (() => {
            if (s.turnDurationByUserId[userBlockId] === undefined) return s.turnDurationByUserId
            const next = { ...s.turnDurationByUserId, [userMessageItemId]: s.turnDurationByUserId[userBlockId] }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningFirstAtByUserId: (() => {
            if (s.turnReasoningFirstAtByUserId[userBlockId] === undefined) return s.turnReasoningFirstAtByUserId
            const next = {
              ...s.turnReasoningFirstAtByUserId,
              [userMessageItemId]: s.turnReasoningFirstAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })(),
          turnReasoningLastAtByUserId: (() => {
            if (s.turnReasoningLastAtByUserId[userBlockId] === undefined) return s.turnReasoningLastAtByUserId
            const next = {
              ...s.turnReasoningLastAtByUserId,
              [userMessageItemId]: s.turnReasoningLastAtByUserId[userBlockId]
            }
            delete next[userBlockId]
            return next
          })()
        }))
      }
      const shouldMirrorToIm =
        Boolean(channel) ||
        clawThreadIdsFromChannels(get().clawChannels).has(activeThreadId)
      if (shouldMirrorToIm && typeof window.dsGui?.mirrorClawChannelMessage === 'function') {
        const userMirror = await window.dsGui.mirrorClawChannelMessage(
          activeThreadId,
          messageText,
          'user'
        )
        if (userMirror.ok) {
          rememberPendingClawFeishuMirror(turnId, {
            threadId: activeThreadId,
            userBlockId: userMessageItemId ?? userBlockId,
            userText: messageText
          })
        }
      }
      if (shouldRenameThreadAfterSend) {
        const renamed = await p.renameThread(activeThreadId, generatedTitle).then(() => true).catch(() => {
          /* keep message delivery successful even if auto-title update fails */
          return false
        })
        if (renamed) {
          set((s) => ({
            threads: s.threads.map((thread) =>
              thread.id === activeThreadId ? { ...thread, title: generatedTitle } : thread
            )
          }))
        }
      }
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: subscribedFromSeq })
      subscribeThreadEventsWithRecovery(p, activeThreadId, subscribedFromSeq, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      void window.dsGui.logError('send-message', 'Failed to send message', {
        message: e instanceof Error ? e.message : String(e),
        threadId: activeThreadId
      }).catch(() => undefined)
      if (structuredRuntimeErrorCode(e) === 'turn_in_progress') {
        set({
          blocks: previousBlocks,
          busy: false,
          currentTurnId: previousCurrentTurnId,
          currentTurnUserId: previousCurrentTurnUserId,
          turnStartedAtByUserId: previousTurnStartedAtByUserId,
          turnDurationByUserId: previousTurnDurationByUserId,
          turnReasoningFirstAtByUserId: previousTurnReasoningFirstAtByUserId,
          turnReasoningLastAtByUserId: previousTurnReasoningLastAtByUserId,
          queuedMessages: previousQueuedMessages,
          error: i18n.t('common:runtimeActiveTurn')
        })
        await get().recoverActiveTurn()
        await get().refreshThreads()
        return false
      }
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        queuedMessages: previousQueuedMessages,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },

  reviewActiveThread: async (target: ReviewTarget) => {
    if (get().runtimeConnection !== 'ready') {
      set({ error: i18n.t('common:runtimeActionNeedsConnection') })
      return false
    }
    const p = getProvider()
    if (typeof p.reviewThread !== 'function') {
      set({ error: i18n.t('common:reviewUnavailable') })
      return false
    }
    if (get().busy || get().blocks.some(hasPendingRuntimeWork)) {
      set({ error: i18n.t('common:composerQueuePlaceholder') })
      return false
    }
    let activeThreadId = get().activeThreadId
    try {
      if (!activeThreadId) {
        const settings = await rendererRuntimeClient.getSettings()
        const workspaceRoot = normalizeWorkspaceRoot(settings.workspaceRoot)
        if (!workspaceRoot) {
          set({ error: i18n.t('common:workspaceRequiredToCreateThread') })
          return false
        }
        const codeWorkspaceRoots = rememberCodeWorkspaceRoots(get().codeWorkspaceRoots, [workspaceRoot])
        set({ codeWorkspaceRoots })
        const reusableThreadId = await findReusableEmptyThreadId(
          get(),
          p,
          workspaceRoot,
          (thread) => isCodeThread(thread, get().clawChannels)
        )
        const createdThread =
          reusableThreadId == null
            ? await p.createThread({
                workspace: workspaceRoot,
                title: i18n.t('common:slashCommandReviewTitle'),
                mode: 'agent'
              })
            : null
        activeThreadId = reusableThreadId ?? createdThread?.id ?? null
        if (!activeThreadId) throw new Error('Failed to resolve target thread id.')
        set((s) => ({
          activeThreadId,
          codeWorkspaceRoots: rememberCodeWorkspaceRoots(s.codeWorkspaceRoots, [workspaceRoot, createdThread?.workspace]),
          lastSeq: 0,
          inspectorSelectedId: null,
          threads:
            createdThread && !s.threads.some((thread) => thread.id === createdThread.id)
              ? [createdThread, ...s.threads]
              : s.threads
        }))
      }
      const threadSnap = get().threads.find((thread) => thread.id === activeThreadId)
      rememberProviderThreadRuntime(p, activeThreadId, get().threads)
      const composerModel = get().composerModel.trim()
      const userModelChip = optimisticUserModelLabel(composerModel, threadSnap?.model)
      const seqAtSend = get().lastSeq
      resetBusyRecoveryAttempts()
      sseAbortRef.current?.abort()
      sseAbortRef.current = null
      clearBusyWatchdog()
      set({
        busy: true,
        liveReasoning: '',
        liveAssistant: '',
        error: null,
        currentTurnId: null,
        currentTurnUserId: null
      })
      const { turnId, userMessageItemId } = await p.reviewThread(activeThreadId, target, {
        ...(composerModel ? { model: composerModel } : {})
      })
      if (userMessageItemId && userModelChip) {
        rememberTurnModel(activeThreadId, userMessageItemId, userModelChip)
      }
      set({ currentTurnId: turnId })
      const ac = new AbortController()
      sseAbortRef.current = ac
      const sink = buildThreadEventSink(set, get, { threadId: activeThreadId, signal: ac.signal, sinceSeq: seqAtSend })
      subscribeThreadEventsWithRecovery(p, activeThreadId, seqAtSend, sink, ac.signal, get)
      armBusyWatchdog(set, get)
      await get().refreshThreads()
      return true
    } catch (e) {
      clearBusyWatchdog()
      set({
        error: formatRuntimeError(e),
        busy: false,
        currentTurnId: null,
        currentTurnUserId: null,
        ...(shouldOpenSettingsForError(e)
          ? { route: 'settings' as const, settingsSection: 'agents' as const }
          : {})
      })
      await get().refreshThreads()
      return false
    }
  },
  }
}
