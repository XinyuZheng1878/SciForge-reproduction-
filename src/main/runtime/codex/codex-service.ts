import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  getCodexRuntimeSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ApprovalPolicy,
  type SandboxMode
} from '../../../shared/app-settings'
import type {
  CodexChatBlock,
  CodexConnectResult,
  CodexEventPayload,
  CodexNormalizedThread,
  CodexSessionResumeResult,
  CodexThreadEventPayload,
  CodexThreadDetail,
  CodexThreadForkResult,
  CodexThreadListResult,
  CodexThreadListOptions,
  CodexThreadMutationResult,
  CodexThreadReadResult,
  CodexThreadStartPayload,
  CodexThreadStartResult,
  CodexTurnInterruptOptions,
  CodexTurnMutationResult,
  CodexTurnStartPayload,
  CodexTurnStartResult,
  CodexTurnSteerPayload
} from './codex-runtime-api'
import type {
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import {
  CODEX_MAIN_IPC_CHANNELS,
  createCodexAppServerClient,
  type CodexAppServerInputItem,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions,
  type CodexAppServerThreadSandboxPolicy,
  type CodexAppServerTurnSandboxPolicy,
  type CodexAppServerThreadStartParams
} from './app-server/json-rpc-client'
import type {
  CodexAppServerPendingRequest,
  CodexAppServerResolveApprovalInput,
  CodexAppServerResolveUserInputInput
} from './app-server/request-registry'
import {
  codexAppServerThreadReasoningConfig,
  codexAppServerTurnReasoningParams
} from './app-server/reasoning-config'
import { normalizeCodexEvent } from './app-server/event-normalizer'
import { CodexEventStore, type CodexStoredEvent } from './codex-event-store'
import { CodexThreadStore, type CodexStoredThread } from './codex-thread-store'
import { CodexUsageStore } from './codex-usage-store'
import { prepareCodexAppServerLaunch, resolveCodexWorkspace } from './codex-config'

export type CodexRuntimeEventSink = {
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.event, payload: CodexEventPayload): void
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.error, payload: { message: string; detail?: unknown }): void
  send(channel: typeof CODEX_MAIN_IPC_CHANNELS.closed, payload: { reason?: string }): void
}

export type CodexRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  sink: CodexRuntimeEventSink
  appVersion?: string
  storageRoot?: string
  managedCodexHome?: string
  createClient?: (options: CodexAppServerJsonRpcClientOptions) => CodexAppServerJsonRpcClient
}

type CodexTurnTiming = {
  startedAtMs: number
  firstDeltaSeen: boolean
}

type CodexRuntimeStatusInput = {
  threadId: string
  turnId?: string
  itemId?: string
  phase: NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase']
  message?: string
  latencyMs?: number
  createdAt?: string
}

type CodexRuntimeEventSubscriber = {
  threadId: string
  queue: CodexThreadEventPayload[]
  wake: (() => void) | null
  closed: boolean
}

export class CodexRuntimeService {
  private client: CodexAppServerJsonRpcClient | null = null
  private clientPromise: Promise<CodexAppServerJsonRpcClient> | null = null
  private clientConnected = false
  private clientInfo: unknown = null
  private subscription: Promise<void> | null = null
  private readonly threadStore: CodexThreadStore | null
  private readonly eventStore: CodexEventStore | null
  private readonly usageStore: CodexUsageStore | null
  private readonly activeTurns = new Map<string, string>()
  private readonly turnTimings = new Map<string, CodexTurnTiming>()
  private readonly turnModelHints = new Map<string, string>()
  private readonly eventSubscribers = new Set<CodexRuntimeEventSubscriber>()

  constructor(private readonly options: CodexRuntimeServiceOptions) {
    this.threadStore = options.storageRoot ? new CodexThreadStore({ rootDir: options.storageRoot }) : null
    this.eventStore = options.storageRoot ? new CodexEventStore({ rootDir: options.storageRoot }) : null
    this.usageStore = options.storageRoot ? new CodexUsageStore({ rootDir: options.storageRoot }) : null
  }

  async connect(): Promise<CodexConnectResult> {
    try {
      const { info } = await this.ensureConnectedClient()
      return { ok: true, info: asRecord(info) ?? {} }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async listThreads(options: CodexThreadListOptions = {}): Promise<CodexThreadListResult> {
    const stored = await this.storedThreads({
      includeArchived: options.includeArchived === true || options.archivedOnly === true
    })
    try {
      const { client } = await this.ensureConnectedClient()
      const response = await client.listThreads({
        limit: options.limit ?? 100,
        ...(options.search ? { search: options.search } : {}),
        ...(options.includeArchived === true ? { includeArchived: true } : {}),
        ...(options.archivedOnly === true ? { archivedOnly: true } : {})
      })
      const liveThreads = readThreadList(response).map(normalizeThread)
      const persisted = await Promise.all(liveThreads.map((thread) => this.persistThread(thread)))
      const mappedLiveThreads = liveThreads.map((thread, index) => {
        const storedThread = persisted[index]
        return storedThread ? { ...thread, id: storedThread.guiThreadId } : thread
      })
      return {
        ok: true,
        threads: filterThreadList(
          mergeThreads(mappedLiveThreads, stored.map(storedThreadToNormalizedThread)),
          options
        )
      }
    } catch (error) {
      await this.discardClientAfterFailure()
      if (stored.length > 0) {
        return { ok: true, threads: filterThreadList(stored.map(storedThreadToNormalizedThread), options) }
      }
      return failure(error)
    }
  }

  async startThread(payload: CodexThreadStartPayload): Promise<CodexThreadStartResult> {
    try {
      const startedAtMs = Date.now()
      const settings = await this.options.settings()
      const workspace = resolveCodexWorkspace(settings, payload.workspace)
      const startupStatusThreadId = `codex-thread-start-${startedAtMs}`
      const coldStart = !this.isClientWarm()
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'process_start',
          message: 'Starting Codex app-server'
        }, { persist: false })
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'initialize_start',
          message: 'Initializing Codex app-server'
        }, { persist: false })
      }
      const { client } = await this.ensureConnectedClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: startupStatusThreadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        }, { persist: false })
      }
      const response = await client.startThread({
        ...baseThreadParams(settings, workspace),
        ...codexModelRouterThreadParams(settings),
        serviceName: 'DeepSeek GUI',
        ephemeral: false
      })
      const thread = normalizeThread(readThread(response))
      const storedThread = await this.persistThread({
        ...thread,
        workspace: thread.workspace || workspace,
        title: payload.title || thread.title
      })
      await this.emitRuntimeStatus({
        threadId: storedThread?.guiThreadId ?? thread.id,
        phase: 'thread_start_done',
        message: 'Codex thread ready',
        latencyMs: elapsedMs(startedAtMs)
      })
      return { ok: true, thread: { ...thread, title: payload.title || thread.title } }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async readThread(threadId: string): Promise<CodexThreadReadResult> {
    const storedDetail = await this.readStoredDetail(threadId)
    const storedThread = await this.findStoredThread(threadId)
    const codexThreadId = storedThread?.codexThreadId ?? threadId
    try {
      const { client } = await this.ensureConnectedClient()
      const response = await client.readThread({ threadId: codexThreadId, includeTurns: true })
      const thread = readThread(response)
      const detail = threadDetail(thread)
      const usage = await this.usageStore?.threadUsage(storedThread?.guiThreadId ?? threadId)
      const detailWithUsage = usage ? { ...detail, usage } : detail
      const storedDetailWithUsage = storedDetail && usage ? { ...storedDetail, usage } : storedDetail
      return { ok: true, detail: detailWithUsage.blocks.length > 0 ? detailWithUsage : storedDetailWithUsage ?? detailWithUsage }
    } catch (error) {
      if (isMissingOrUnmaterializedThreadError(error) && isEmptyStoredThread(storedThread, storedDetail)) {
        return { ok: true, detail: emptyThreadDetail() }
      }
      await this.discardClientAfterFailure()
      if (storedDetail) return { ok: true, detail: storedDetail }
      return failure(error)
    }
  }

  async readStoredEvents(threadId: string, sinceSeq = 0): Promise<CodexThreadEventPayload[]> {
    if (!this.eventStore) return []
    const events = await this.eventStore.read(threadId, { sinceSeq })
    return events.map((event) => event.event)
  }

  async *subscribeEvents(
    threadId: string,
    sinceSeq = 0,
    signal?: AbortSignal
  ): AsyncIterable<CodexThreadEventPayload> {
    let latestSeq = sinceSeq
    const subscriber = this.addEventSubscriber(threadId)
    const onAbort = (): void => this.closeEventSubscriber(subscriber)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (const event of await this.readStoredEvents(threadId, sinceSeq)) {
        latestSeq = Math.max(latestSeq, event.seq ?? latestSeq)
        yield event
      }
      while (!signal?.aborted && !subscriber.closed) {
        const event = await this.nextSubscriberEvent(subscriber)
        if (!event) break
        if (typeof event.seq === 'number' && event.seq <= latestSeq) continue
        latestSeq = Math.max(latestSeq, event.seq ?? latestSeq)
        yield event
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.closeEventSubscriber(subscriber)
    }
  }

  async renameThread(threadId: string, title: string): Promise<CodexThreadMutationResult> {
    try {
      const stored = await this.findStoredThread(threadId)
      const { client } = await this.ensureConnectedClient()
      await client.request('thread/name/set', { threadId: stored?.codexThreadId ?? threadId, name: title })
      if (stored) {
        await this.threadStore?.upsert({
          guiThreadId: stored.guiThreadId,
          codexThreadId: stored.codexThreadId,
          title
        })
      }
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async deleteThread(threadId: string): Promise<CodexThreadMutationResult> {
    return this.archiveThread(threadId, true)
  }

  async archiveThread(threadId: string, archived: boolean): Promise<CodexThreadMutationResult> {
    try {
      const stored = await this.findStoredThread(threadId)
      if (archived) {
        const { client } = await this.ensureConnectedClient()
        await client.request('thread/archive', { threadId: stored?.codexThreadId ?? threadId })
        await this.threadStore?.archive(stored?.guiThreadId ?? threadId)
      } else if (stored) {
        await this.threadStore?.upsert({
          guiThreadId: stored.guiThreadId,
          codexThreadId: stored.codexThreadId,
          archived: false
        })
      }
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async startTurn(payload: CodexTurnStartPayload): Promise<CodexTurnStartResult> {
    try {
      const startedAtMs = Date.now()
      const settings = await this.options.settings()
      const runtime = getCodexRuntimeSettings(settings)
      const routerModel = codexModelRouterModel(settings)
      const storedThread = await this.findStoredThread(payload.threadId)
      const storedDetailBeforeTurn = await this.readStoredDetail(payload.threadId)
      const workspace = resolveCodexWorkspace(settings, payload.workspace || storedThread?.workspace)
      let codexThreadId = storedThread?.codexThreadId ?? payload.threadId
      const coldStart = !this.isClientWarm()
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'process_start',
          message: 'Starting Codex app-server'
        })
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'initialize_start',
          message: 'Initializing Codex app-server'
        })
      }
      const { client } = await this.ensureConnectedClient(settings)
      if (coldStart) {
        await this.emitRuntimeStatus({
          threadId: payload.threadId,
          phase: 'initialize_done',
          message: 'Codex app-server initialized',
          latencyMs: elapsedMs(startedAtMs)
        })
      }
      let response: unknown
      try {
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          text: payload.text,
          displayText: payload.displayText,
          workspace,
          model: routerModel,
          reasoningEffort: payload.reasoningEffort,
          runtime
        }))
      } catch (error) {
        if (
          !isMissingOrUnmaterializedThreadError(error) ||
          !canRematerializeMissingThread(storedThread, storedDetailBeforeTurn)
        ) {
          throw error
        }
        const replacement = await this.rematerializeThread({
          client,
          settings,
          guiThreadId: payload.threadId,
          storedThread,
          workspace
        })
        codexThreadId = replacement.codexThreadId
        response = await client.startTurn(turnStartParams({
          threadId: codexThreadId,
          text: payload.text,
          displayText: payload.displayText,
          workspace,
          model: routerModel,
          reasoningEffort: payload.reasoningEffort,
          runtime
        }))
      }
      const turn = asRecord(asRecord(response)?.turn) ?? {}
      const turnId = stringValue(turn.id) || ''
      this.recordActiveTurn(payload.threadId, turnId, startedAtMs)
      this.recordTurnModelHint(payload.threadId, turnId, routerModel)
      await this.emitRuntimeStatus({
        threadId: payload.threadId,
        ...(turnId ? { turnId } : {}),
        phase: 'turn_start_sent',
        message: 'Codex turn start sent',
        latencyMs: elapsedMs(startedAtMs)
      })
      const userMessageItemId = stringValue(turn.userMessageItemId) || `codex-user-${Date.now()}`
      const userEvent = await this.persistEvent(payload.threadId, {
        threadId: payload.threadId,
        ...(turnId ? { turnId } : {}),
        userMessage: {
          itemId: userMessageItemId,
          turnId,
          createdAt: new Date().toISOString(),
          text: payload.text
        }
      })
      if (userEvent) this.broadcastEvent(userEvent.event)
      return {
        ok: true,
        threadId: payload.threadId,
        turnId,
        userMessageItemId
      }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async interruptTurn(
    threadId: string,
    turnId: string,
    options: CodexTurnInterruptOptions = {}
  ): Promise<CodexTurnMutationResult> {
    try {
      const invalidTarget = this.validateActiveTurn(threadId, turnId)
      if (invalidTarget) return invalidTarget
      const codexThreadId = await this.codexThreadIdFor(threadId)
      const { client } = await this.ensureConnectedClient()
      await client.interruptTurn({ threadId: codexThreadId, turnId })
      if (options.discard) await this.stop()
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async steerTurn(payload: CodexTurnSteerPayload): Promise<CodexTurnMutationResult> {
    try {
      const invalidTarget = this.validateActiveTurn(payload.threadId, payload.turnId)
      if (invalidTarget) return invalidTarget
      const codexThreadId = await this.codexThreadIdFor(payload.threadId)
      const { client } = await this.ensureConnectedClient()
      await client.steerTurn({
        threadId: codexThreadId,
        expectedTurnId: payload.turnId,
        input: [textInput(payload.text)]
      })
      return { ok: true }
    } catch (error) {
      await this.discardClientAfterFailure()
      return failure(error)
    }
  }

  async compactThread(_threadId: string, _reason?: string): Promise<CodexThreadMutationResult> {
    return { ok: true }
  }

  async forkThread(
    _threadId: string,
    _options?: { relation?: 'primary' | 'fork' | 'side'; title?: string }
  ): Promise<CodexThreadForkResult> {
    return unsupportedFailure('Codex thread fork is not supported yet.')
  }

  async resumeSession(
    _sessionId: string,
    _options?: { model?: string; mode?: string }
  ): Promise<CodexSessionResumeResult> {
    return unsupportedFailure('Codex session resume is not supported yet.', 'not_implemented')
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    if (!this.usageStore) {
      return {
        supported: false,
        reason: 'usage unsupported',
        groupBy: input.groupBy,
        buckets: [],
        totals: {}
      }
    }
    return this.usageStore.summary(input, { threads: await this.storedThreads({ includeArchived: true }) })
  }

  pendingServerRequests(): CodexAppServerPendingRequest[] {
    return this.client?.pendingServerRequests() ?? []
  }

  async resolveApproval(input: CodexAppServerResolveApprovalInput): Promise<CodexTurnMutationResult> {
    try {
      if (!this.client) throw new Error('No Codex app-server request is pending.')
      this.client.resolveApproval(input)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async resolveUserInput(input: CodexAppServerResolveUserInputInput): Promise<CodexTurnMutationResult> {
    try {
      if (!this.client) throw new Error('No Codex app-server request is pending.')
      this.client.resolveUserInput(input)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async stop(): Promise<void> {
    const client = this.client
    this.client = null
    this.clientPromise = null
    this.clientConnected = false
    this.clientInfo = null
    this.subscription = null
    this.activeTurns.clear()
    this.turnTimings.clear()
    this.turnModelHints.clear()
    this.closeAllEventSubscribers()
    if (client) await client.stop()
  }

  private async discardClientAfterFailure(): Promise<void> {
    const client = this.client
    this.client = null
    this.clientPromise = null
    this.clientConnected = false
    this.clientInfo = null
    this.subscription = null
    this.activeTurns.clear()
    this.turnTimings.clear()
    this.turnModelHints.clear()
    this.closeAllEventSubscribers()
    if (!client) return
    try {
      await client.stop()
    } catch {
      // The request path already has the meaningful failure. Cleanup is best-effort.
    }
  }

  private async ensureClient(settings?: AppSettingsV1): Promise<CodexAppServerJsonRpcClient> {
    if (this.client) return this.client
    if (this.clientPromise) return this.clientPromise
    const promise = (async () => {
      const current = settings ?? await this.options.settings()
      const launch = await prepareCodexAppServerLaunch({
        settings: current,
        managedCodexHome: this.options.managedCodexHome
      })
      const createClient = this.options.createClient ?? createCodexAppServerClient
      const client = createClient({
        command: launch.command,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.env,
        clientInfo: {
          name: 'deepseek-gui',
          title: 'DeepSeek GUI',
          version: this.options.appVersion ?? '0.1.0'
        },
        pendingServerRequests: {
          onPendingRequest: (request) => {
            void this.publishPendingServerRequest(request).catch((error) => {
              this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
                message: error instanceof Error ? error.message : String(error),
                detail: error
              })
            })
          }
        }
      })
      this.client = client
      this.subscription = this.forwardEvents(client)
      void this.subscription.catch(() => undefined)
      return client
    })()
    this.clientPromise = promise
    try {
      return await promise
    } finally {
      if (this.clientPromise === promise) this.clientPromise = null
    }
  }

  private async ensureConnectedClient(settings?: AppSettingsV1): Promise<{
    client: CodexAppServerJsonRpcClient
    info: unknown
  }> {
    const client = await this.ensureClient(settings)
    if (this.clientConnected) return { client, info: this.clientInfo ?? {} }
    const info = await client.connect()
    this.clientConnected = true
    this.clientInfo = info
    return { client, info }
  }

  isClientWarm(): boolean {
    return this.client !== null && this.clientConnected
  }

  private async forwardEvents(client: CodexAppServerJsonRpcClient): Promise<void> {
    for await (const event of client.subscribe()) {
      if (event.type === 'event') {
        const normalized = normalizeCodexEvent(event.payload)
        if (normalized) {
          const stored = await this.persistEvent(normalized.threadId, normalized)
          const runtimeEvent = stored?.event ?? normalized
          await this.recordUsageEvent(runtimeEvent, stored?.createdAt)
          await this.emitFirstDeltaIfNeeded(runtimeEvent)
          await this.emitTurnDoneIfNeeded(runtimeEvent)
          this.noteRuntimeEvent(runtimeEvent)
          this.broadcastEvent(runtimeEvent)
          this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: runtimeEvent })
        }
        continue
      }
      if (event.type === 'error') {
        this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, event.error)
        continue
      }
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.closed, { reason: event.reason })
      if (this.client === client) {
        await this.discardClientAfterFailure()
      }
      return
    }
  }

  private async storedThreads(options: { includeArchived?: boolean } = {}): Promise<CodexStoredThread[]> {
    return this.threadStore?.list(options) ?? []
  }

  private async persistThread(
    thread: CodexNormalizedThread,
    options: { guiThreadId?: string; workspace?: string; title?: string } = {}
  ): Promise<CodexStoredThread | null> {
    if (!this.threadStore || !thread.id) return null
    return this.threadStore.upsert({
      ...(options.guiThreadId !== undefined ? { guiThreadId: options.guiThreadId } : {}),
      codexThreadId: thread.id,
      workspace: options.workspace ?? thread.workspace,
      title: options.title ?? thread.title,
      archived: thread.archived,
      latestTurnId: thread.latestTurnId
    })
  }

  private async persistEvent(
    threadId: string,
    event: CodexEventPayload['event']
  ): Promise<CodexStoredEvent | null> {
    if (!this.eventStore) return null
    const storedThread = await this.threadStore?.get(threadId) ?? await this.threadStore?.getByCodexThreadId(threadId)
    const guiThreadId = storedThread?.guiThreadId ?? threadId
    const stored = await this.eventStore.append(guiThreadId, { ...event, threadId: guiThreadId })
    if (storedThread || eventShouldUpsertThread(event)) {
      await this.threadStore?.upsert({
        guiThreadId,
        codexThreadId: storedThread?.codexThreadId ?? threadId,
        workspace: storedThread?.workspace,
        title: storedThread?.title,
        latestSeq: stored.seq
      })
    }
    return stored
  }

  private addEventSubscriber(threadId: string): CodexRuntimeEventSubscriber {
    const subscriber: CodexRuntimeEventSubscriber = {
      threadId,
      queue: [],
      wake: null,
      closed: false
    }
    this.eventSubscribers.add(subscriber)
    return subscriber
  }

  private closeEventSubscriber(subscriber: CodexRuntimeEventSubscriber): void {
    subscriber.closed = true
    this.eventSubscribers.delete(subscriber)
    const wake = subscriber.wake
    subscriber.wake = null
    wake?.()
  }

  private closeAllEventSubscribers(): void {
    for (const subscriber of [...this.eventSubscribers]) {
      this.closeEventSubscriber(subscriber)
    }
  }

  private broadcastEvent(event: CodexThreadEventPayload): void {
    for (const subscriber of this.eventSubscribers) {
      if (subscriber.threadId !== event.threadId || subscriber.closed) continue
      subscriber.queue.push(event)
      const wake = subscriber.wake
      subscriber.wake = null
      wake?.()
    }
  }

  private async nextSubscriberEvent(
    subscriber: CodexRuntimeEventSubscriber
  ): Promise<CodexThreadEventPayload | null> {
    while (!subscriber.closed) {
      const event = subscriber.queue.shift()
      if (event) return event
      await new Promise<void>((resolve) => {
        subscriber.wake = resolve
      })
    }
    return null
  }

  private async readStoredDetail(threadId: string): Promise<CodexThreadDetail | null> {
    if (!this.eventStore) return null
    const events = await this.eventStore.read(threadId, { includeAll: true })
    if (events.length === 0) return null
    const latest = events.at(-1)
    return {
      blocks: storedEventsToBlocks(events),
      latestSeq: latest?.seq ?? 0,
      latestTurnId: latest?.event.userMessage?.turnId
    }
  }

  private async findStoredThread(threadId: string): Promise<CodexStoredThread | null> {
    return await this.threadStore?.get(threadId) ?? await this.threadStore?.getByCodexThreadId(threadId) ?? null
  }

  private async codexThreadIdFor(threadId: string): Promise<string> {
    const storedThread = await this.findStoredThread(threadId)
    return storedThread?.codexThreadId ?? threadId
  }

  private async rematerializeThread(input: {
    client: CodexAppServerJsonRpcClient
    settings: AppSettingsV1
    guiThreadId: string
    storedThread: CodexStoredThread | null
    workspace: string
  }): Promise<CodexStoredThread> {
    const response = await input.client.startThread({
      ...baseThreadParams(input.settings, input.workspace),
      ...codexModelRouterThreadParams(input.settings),
      serviceName: 'DeepSeek GUI',
      ephemeral: false
    })
    const thread = normalizeThread(readThread(response))
    if (!thread.id) throw new Error('Codex app-server did not return a replacement thread id.')
    const stored = await this.persistThread(thread, {
      guiThreadId: input.storedThread?.guiThreadId ?? input.guiThreadId,
      workspace: thread.workspace || input.storedThread?.workspace || input.workspace,
      title: input.storedThread?.title || thread.title
    })
    if (!stored) throw new Error('Codex thread store is unavailable.')
    return stored
  }

  private recordActiveTurn(threadId: string, turnId: string, startedAtMs = Date.now()): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    if (!normalizedThreadId || !normalizedTurnId) return
    this.activeTurns.set(normalizedThreadId, normalizedTurnId)
    this.turnTimings.set(turnTimingKey(normalizedThreadId, normalizedTurnId), {
      startedAtMs,
      firstDeltaSeen: false
    })
  }

  private recordTurnModelHint(threadId: string, turnId: string, model?: string): void {
    const normalizedThreadId = threadId.trim()
    const normalizedTurnId = turnId.trim()
    const normalizedModel = model?.trim()
    if (!normalizedThreadId || !normalizedTurnId || !normalizedModel) return
    this.turnModelHints.set(turnTimingKey(normalizedThreadId, normalizedTurnId), normalizedModel)
  }

  private validateActiveTurn(threadId: string, turnId: string): CodexTurnMutationResult | null {
    const activeTurnId = this.activeTurns.get(threadId)
    if (!activeTurnId) {
      return controlTargetFailure(`No active Codex turn is running for thread ${threadId}.`)
    }
    if (activeTurnId !== turnId) {
      return controlTargetFailure(`Codex turn ${turnId} is not the active turn for thread ${threadId}.`)
    }
    return null
  }

  private noteRuntimeEvent(event: CodexThreadEventPayload): void {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return
    if (event.turnComplete || isTerminalRuntimeError(event.runtimeError)) {
      this.activeTurns.delete(event.threadId)
      this.turnTimings.delete(turnTimingKey(event.threadId, turnId))
    }
  }

  private async emitFirstDeltaIfNeeded(event: CodexThreadEventPayload): Promise<void> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || !event.deltas?.length || this.activeTurns.get(event.threadId) !== turnId) return
    const timing = this.turnTimings.get(turnTimingKey(event.threadId, turnId))
    if (!timing || timing.firstDeltaSeen) return
    timing.firstDeltaSeen = true
    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'first_delta',
      message: 'First Codex delta received',
      latencyMs: elapsedMs(timing.startedAtMs)
    })
  }

  private async emitTurnDoneIfNeeded(event: CodexThreadEventPayload): Promise<void> {
    const turnId = event.turnId || event.userMessage?.turnId || ''
    if (!turnId || this.activeTurns.get(event.threadId) !== turnId) return
    if (!event.turnComplete && !isTerminalRuntimeError(event.runtimeError)) return
    const timing = this.turnTimings.get(turnTimingKey(event.threadId, turnId))
    await this.emitRuntimeStatus({
      threadId: event.threadId,
      turnId,
      phase: 'turn_done',
      message: event.turnComplete ? 'Codex turn completed' : 'Codex turn ended with an error',
      ...(timing ? { latencyMs: elapsedMs(timing.startedAtMs) } : {})
    })
  }

  private async emitRuntimeStatus(
    event: CodexRuntimeStatusInput,
    options: { persist?: boolean } = {}
  ): Promise<void> {
    const runtimeEvent: CodexThreadEventPayload = {
      threadId: event.threadId,
      ...(event.turnId ? { turnId: event.turnId } : {}),
      runtimeStatus: {
        itemId: event.itemId ?? runtimeStatusItemId(event.threadId, event.turnId, event.phase),
        phase: event.phase,
        message: event.message,
        latencyMs: event.latencyMs,
        createdAt: event.createdAt ?? new Date().toISOString()
      }
    }
    const shouldPersist = options.persist !== false
    const stored = shouldPersist ? await this.persistEvent(event.threadId, runtimeEvent) : null
    const published = stored?.event ?? runtimeEvent
    this.broadcastEvent(published)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: published })
  }

  private async recordUsageEvent(event: CodexThreadEventPayload, createdAt?: string): Promise<void> {
    if (!event.usage || !this.usageStore) return
    const turnId = event.turnId || event.userMessage?.turnId || ''
    await this.usageStore.record({
      threadId: event.threadId,
      turnId,
      createdAt,
      model: this.turnModelHints.get(turnTimingKey(event.threadId, turnId)),
      usage: event.usage
    })
  }

  private async publishPendingServerRequest(request: CodexAppServerPendingRequest): Promise<void> {
    const event = pendingServerRequestEvent(request)
    if (!event) {
      this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.error, {
        message: 'Codex requested user interaction but did not include a thread context.'
      })
      return
    }
    const runtimeEvent = await this.eventForGuiThread(event)
    this.broadcastEvent(runtimeEvent)
    this.options.sink.send(CODEX_MAIN_IPC_CHANNELS.event, { event: runtimeEvent })
  }

  private async eventForGuiThread(event: CodexThreadEventPayload): Promise<CodexThreadEventPayload> {
    const storedThread = await this.findStoredThread(event.threadId)
    const guiThreadId = storedThread?.guiThreadId ?? event.threadId
    return guiThreadId === event.threadId ? event : { ...event, threadId: guiThreadId }
  }
}

function mergeThreads(
  liveThreads: CodexNormalizedThread[],
  storedThreads: CodexNormalizedThread[]
): CodexNormalizedThread[] {
  const byId = new Map<string, CodexNormalizedThread>()
  for (const thread of storedThreads) byId.set(thread.id, thread)
  for (const thread of liveThreads) byId.set(thread.id, { ...byId.get(thread.id), ...thread })
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

function filterThreadList(
  threads: CodexNormalizedThread[],
  options: CodexThreadListOptions
): CodexNormalizedThread[] {
  const includeArchived = options.includeArchived === true
  const archivedOnly = options.archivedOnly === true
  const search = options.search?.trim().toLowerCase() ?? ''
  let output = threads
  if (archivedOnly) {
    output = output.filter((thread) => thread.archived === true)
  } else if (!includeArchived) {
    output = output.filter((thread) => thread.archived !== true)
  }
  if (search) {
    output = output.filter((thread) =>
      [thread.title, thread.preview, thread.workspace, thread.model]
        .some((value) => value?.toLowerCase().includes(search))
    )
  }
  if (typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0) {
    output = output.slice(0, Math.floor(options.limit))
  }
  return output
}

function storedThreadToNormalizedThread(thread: CodexStoredThread): CodexNormalizedThread {
  return {
    id: thread.guiThreadId,
    title: thread.title,
    updatedAt: thread.updatedAt,
    model: '',
    mode: 'agent',
    workspace: thread.workspace,
    archived: thread.archived,
    latestTurnId: thread.latestTurnId
  }
}

function storedEventsToBlocks(events: CodexStoredEvent[]): CodexChatBlock[] {
  const blocks: CodexChatBlock[] = []
  for (const item of events) {
    const event = item.event
    if (event.userMessage) {
      blocks.push({
        kind: 'user',
        id: event.userMessage.itemId || `user-${item.seq}`,
        createdAt: event.userMessage.createdAt ?? item.createdAt,
        text: event.userMessage.text
      })
    }
    if (event.deltas) {
      for (const [index, delta] of event.deltas.entries()) {
        blocks.push({
          kind: delta.kind === 'agent_reasoning' ? 'reasoning' : 'assistant',
          id: `${delta.kind}-${item.seq}-${index}`,
          createdAt: item.createdAt,
          text: delta.text
        })
      }
    }
    if (event.tool) {
      blocks.push({
        kind: 'tool',
        id: event.tool.itemId || `tool-${item.seq}`,
        createdAt: item.createdAt,
        summary: event.tool.summary,
        status: event.tool.status,
        toolKind: event.tool.toolKind,
        detail: event.tool.detail,
        filePath: event.tool.filePath,
        meta: event.tool.meta
      })
    }
    if (event.runtimeError) {
      blocks.push({
        kind: 'system',
        id: event.runtimeError.itemId || `error-${item.seq}`,
        createdAt: event.runtimeError.createdAt ?? item.createdAt,
        text: event.runtimeError.message,
        code: event.runtimeError.code,
        severity: event.runtimeError.severity
      })
    }
  }
  return blocks
}

function baseThreadParams(settings: AppSettingsV1, workspace?: string): CodexAppServerThreadStartParams {
  const runtime = getCodexRuntimeSettings(settings)
  const cwd = resolveCodexWorkspace(settings, workspace)
  return {
    cwd,
    approvalPolicy: mapApprovalPolicy(runtime.approvalPolicy),
    sandbox: mapThreadSandboxMode(runtime.sandboxMode),
    config: codexAppServerThreadReasoningConfig()
  }
}

function codexModelRouterThreadParams(
  settings: AppSettingsV1
): Pick<CodexAppServerThreadStartParams, 'model' | 'modelProvider'> {
  return {
    model: codexModelRouterModel(settings),
    modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
  }
}

function codexModelRouterModel(settings: AppSettingsV1): string {
  return resolveRuntimeModelRouterSettings(settings).model
}

function turnStartParams(input: {
  threadId: string
  text: string
  displayText?: string
  workspace: string
  model?: string
  reasoningEffort?: string
  runtime: ReturnType<typeof getCodexRuntimeSettings>
}): Parameters<CodexAppServerJsonRpcClient['startTurn']>[0] {
  return {
    threadId: input.threadId,
    input: [textInput(input.text, input.displayText)],
    cwd: input.workspace,
    ...(input.displayText?.trim() && input.displayText.trim() !== input.text.trim()
      ? { displayText: input.displayText.trim() }
      : {}),
    ...(input.model ? { model: input.model } : {}),
    approvalPolicy: mapApprovalPolicy(input.runtime.approvalPolicy),
    sandboxPolicy: mapTurnSandboxMode(input.runtime.sandboxMode, input.workspace),
    ...codexAppServerTurnReasoningParams({ reasoningEffort: input.reasoningEffort })
  }
}

function mapApprovalPolicy(policy: ApprovalPolicy): 'never' | 'on-request' | 'untrusted' {
  if (policy === 'never' || policy === 'untrusted') return policy
  return 'on-request'
}

function mapThreadSandboxMode(mode: SandboxMode): CodexAppServerThreadSandboxPolicy {
  if (mode === 'read-only' || mode === 'workspace-write' || mode === 'danger-full-access') return mode
  return 'workspace-write'
}

function mapTurnSandboxMode(mode: SandboxMode, cwd: string): CodexAppServerTurnSandboxPolicy {
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false }
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' }
  return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: true }
}

function textInput(text: string, displayText?: string): CodexAppServerInputItem {
  const trimmedDisplayText = displayText?.trim()
  return {
    type: 'text',
    text,
    text_elements: [],
    ...(trimmedDisplayText && trimmedDisplayText !== text.trim()
      ? { displayText: trimmedDisplayText, meta: { displayText: trimmedDisplayText } }
      : {})
  }
}

function pendingServerRequestEvent(request: CodexAppServerPendingRequest): CodexThreadEventPayload | null {
  if (!request.threadId) return null
  return {
    threadId: request.threadId,
    ...(request.turnId ? { turnId: request.turnId } : {}),
    tool: {
      itemId: request.itemId || String(request.requestId),
      summary: request.summary,
      status: 'running',
      toolKind: pendingToolKind(request),
      meta: {
        codexRequestId: request.requestId,
        codexRequestKind: request.kind,
        codexRequestMethod: request.method,
        ...(request.kind === 'user_input' ? { questions: safeQuestions(request.params.questions) } : {})
      }
    }
  }
}

function pendingToolKind(
  request: CodexAppServerPendingRequest
): NonNullable<CodexThreadEventPayload['tool']>['toolKind'] {
  if (request.method === 'item/commandExecution/requestApproval') return 'command_execution'
  if (request.method === 'item/fileChange/requestApproval') return 'file_change'
  return 'tool_call'
}

function safeQuestions(value: unknown): Array<Record<string, unknown>> {
  return arrayValue(value).map(asRecord).filter(Boolean).map((question) => ({
    id: stringValue(question?.id),
    header: stringValue(question?.header),
    question: stringValue(question?.question),
    options: arrayValue(question?.options).map(asRecord).filter(Boolean).map((option) => ({
      label: stringValue(option?.label),
      description: stringValue(option?.description)
    }))
  }))
}

function normalizeThread(thread: Record<string, unknown>): CodexNormalizedThread {
  const id = stringValue(thread.id)
  const updatedAtSeconds = numberValue(thread.updatedAt) ?? numberValue(thread.createdAt)
  const updatedAt = updatedAtSeconds
    ? new Date(updatedAtSeconds * 1000).toISOString()
    : new Date().toISOString()
  const name = stringValue(thread.name)
  const preview = stringValue(thread.preview)
  const turns = arrayValue(thread.turns)
  const latestTurn = asRecord(turns.at(-1))
  return {
    id,
    title: name || preview || 'Codex thread',
    updatedAt,
    model: stringValue(thread.model) || '',
    mode: 'agent',
    workspace: stringValue(thread.cwd),
    status: stringValue(thread.status),
    archived: stringValue(thread.status) === 'archived',
    preview,
    latestTurnId: stringValue(latestTurn?.id),
    latestTurnStatus: stringValue(latestTurn?.status)
  }
}

function threadDetail(thread: Record<string, unknown>): CodexThreadDetail {
  const turns = arrayValue(thread.turns).map(asRecord).filter(Boolean) as Record<string, unknown>[]
  const blocks = turns.flatMap((turn) => turnBlocks(turn))
  const latestTurn = turns.at(-1)
  const latestUserMessageId = [...blocks].reverse().find((block) => block.kind === 'user')?.id
  return {
    blocks,
    latestSeq: blocks.length,
    threadStatus: stringValue(thread.status) || stringValue(latestTurn?.status),
    latestTurnId: stringValue(latestTurn?.id),
    latestUserMessageId
  }
}

function turnBlocks(turn: Record<string, unknown>): CodexChatBlock[] {
  const createdAt = secondsToIso(numberValue(turn.startedAt))
  return arrayValue(turn.items)
    .map(asRecord)
    .filter(Boolean)
    .flatMap((item) => itemBlock(item as Record<string, unknown>, stringValue(turn.id), createdAt))
}

function itemBlock(item: Record<string, unknown>, turnId: string, createdAt?: string): CodexChatBlock[] {
  const type = stringValue(item.type)
  const id = stringValue(item.id) || `${turnId}-${type || 'item'}`
  if (type === 'userMessage') {
    const meta = asRecord(item.meta)
    const displayText =
      stringValue(item.displayText) ||
      stringValue(item.display_text) ||
      stringValue(meta?.displayText)
    return [{
      kind: 'user',
      id,
      createdAt,
      text: userInputText(arrayValue(item.content)),
      ...(displayText ? { displayText } : {})
    }]
  }
  if (type === 'agentMessage') {
    return [{ kind: 'assistant', id, createdAt, text: stringValue(item.text) }]
  }
  if (type === 'reasoning') {
    const text = [...arrayValue(item.summary), ...arrayValue(item.content)]
      .map((entry) => typeof entry === 'string' ? entry : '')
      .filter(Boolean)
      .join('\n')
    return text ? [{ kind: 'reasoning', id, createdAt, text }] : []
  }
  if (type === 'plan') {
    return [{ kind: 'reasoning', id, createdAt, text: stringValue(item.text) }]
  }
  if (type === 'commandExecution') {
    const status = mapToolStatus(stringValue(item.status))
    const command = stringValue(item.command)
    return [{
      kind: 'tool',
      id,
      createdAt,
      summary: command || 'Command',
      status,
      toolKind: 'command_execution',
      detail: stringValue(item.aggregatedOutput),
      meta: {
        command,
        cwd: stringValue(item.cwd),
        exitCode: numberValue(item.exitCode)
      }
    }]
  }
  if (type === 'fileChange') {
    return [{
      kind: 'tool',
      id,
      createdAt,
      summary: 'File changes',
      status: mapToolStatus(stringValue(item.status)),
      toolKind: 'file_change',
      detail: JSON.stringify(item.changes ?? [], null, 2)
    }]
  }
  return []
}

function readThreadList(response: unknown): Record<string, unknown>[] {
  const record = asRecord(response)
  const data = arrayValue(record?.data)
  if (data.length) return data.map(asRecord).filter(Boolean) as Record<string, unknown>[]
  return arrayValue(record?.threads).map(asRecord).filter(Boolean) as Record<string, unknown>[]
}

function readThread(response: unknown): Record<string, unknown> {
  const record = asRecord(response)
  return asRecord(record?.thread) ?? record ?? {}
}

function userInputText(content: unknown[]): string {
  return content
    .map((entry) => {
      const item = asRecord(entry)
      if (!item) return ''
      if (stringValue(item.type) === 'text') return stringValue(item.text)
      if (stringValue(item.type) === 'input_text') return stringValue(item.text)
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function mapToolStatus(status: string): 'running' | 'success' | 'error' {
  if (status === 'completed' || status === 'success') return 'success'
  if (status === 'failed' || status === 'error') return 'error'
  return 'running'
}

function unsupportedFailure(
  message: string,
  code = 'capability_unavailable'
): { ok: false; message: string; code: string; recoverable: true } {
  return { ok: false, code, message, recoverable: true }
}

function controlTargetFailure(message: string): { ok: false; message: string; code: string; recoverable: true } {
  return { ok: false, code: 'turn_not_running', message, recoverable: true }
}

function emptyThreadDetail(): CodexThreadDetail {
  return { blocks: [], latestSeq: 0 }
}

function isEmptyStoredThread(
  storedThread: CodexStoredThread | null,
  detail: CodexThreadDetail | null = null
): storedThread is CodexStoredThread {
  if (!storedThread) return false
  if (detail) return detail.blocks.length === 0
  return storedThread.latestSeq <= 0
}

function canRematerializeMissingThread(
  storedThread: CodexStoredThread | null,
  detail: CodexThreadDetail | null
): boolean {
  if (storedThread) return isEmptyStoredThread(storedThread, detail)
  return !detail || detail.blocks.length === 0
}

function eventShouldUpsertThread(event: CodexEventPayload['event']): boolean {
  return Boolean(
    event.userMessage ||
    event.deltas?.length ||
    event.tool ||
    event.turnComplete ||
    event.runtimeError
  )
}

function isMissingOrUnmaterializedThreadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /thread\s+.*not found|thread not found|not materialized yet|includeTurns is unavailable/i.test(message)
}

function isTerminalRuntimeError(error: CodexThreadEventPayload['runtimeError']): boolean {
  if (!error) return false
  return error.severity === 'error' || error.code === 'cancelled' || error.code === 'aborted'
}

function turnTimingKey(threadId: string, turnId: string): string {
  return `${threadId}\u0000${turnId}`
}

function runtimeStatusItemId(
  threadId: string,
  turnId: string | undefined,
  phase: NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase']
): string {
  return `codex-runtime-status-${turnId || threadId}-${phase}`
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs)
}

function failure(error: unknown): { ok: false; message: string; recoverable: true } {
  return { ok: false, message: error instanceof Error ? error.message : String(error), recoverable: true }
}

function secondsToIso(value: number | undefined): string | undefined {
  return typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
