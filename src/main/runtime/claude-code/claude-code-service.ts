import { randomUUID } from 'node:crypto'
import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage,
  SDKUserMessage,
  SessionStoreEntry
} from '@anthropic-ai/claude-agent-sdk'
import { query as claudeAgentSdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type {
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscriptEntry,
  AgentRuntimeListThreadChildrenResponse,
  AgentRuntimeReadChildTranscriptResponse,
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeTurn,
  AgentRuntimeUsage,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import {
  isComputerUseEnabledForRuntime,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  prepareClaudeCodeSdkLaunch,
  resolveClaudeWorkspace
} from './claude-code-config'
import type { ComputerUseMcpLaunchConfig } from '../../computer-use-mcp-config'
import { ClaudeCodeSessionStore } from './claude-code-session-store'
import {
  ClaudeCodeEventStore,
  ClaudeCodeThreadStore,
  storedThreadDetail,
  storedThreadToRuntimeThread,
  type ClaudeCodeStoredEvent
} from './claude-code-store'

export type ClaudeAgentSdk = {
  query(params: {
    prompt: string | AsyncIterable<SDKUserMessage>
    options?: ClaudeAgentSdkOptions
  }): ClaudeAgentSdkQuery
}

export type ClaudeCodeRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  storageRoot: string
  managedConfigDir?: string
  computerUseMcpLaunch?: ComputerUseMcpLaunchConfig
  claudeAgentSdk?: ClaudeAgentSdk
}

export type ClaudeCodeRuntimeFailure = {
  ok: false
  message: string
  code?: string
  recoverable?: boolean
}

export type ClaudeCodeRuntimeOk<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok: true
} & T

export type ClaudeCodeConnectResult =
  | ClaudeCodeRuntimeOk<{ info: Record<string, unknown> }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadListResult =
  | ClaudeCodeRuntimeOk<{ threads: AgentRuntimeThread[] }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadStartResult =
  | ClaudeCodeRuntimeOk<{ thread: AgentRuntimeThread }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeThreadReadResult =
  | ClaudeCodeRuntimeOk<{ detail: AgentRuntimeThreadDetail }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeTurnStartResult =
  | ClaudeCodeRuntimeOk<{ threadId: string; turnId: string; userMessageItemId: string }>
  | ClaudeCodeRuntimeFailure

export type ClaudeCodeTurnMutationResult =
  | ClaudeCodeRuntimeOk
  | ClaudeCodeRuntimeFailure

type ActiveClaudeTurn = {
  threadId: string
  turnId: string
  abortController: AbortController
  query: ClaudeAgentSdkQuery
  assistantItemId: string
}

type ClaudeRuntimeEventSubscriber = {
  threadId: string
  queue: AgentRuntimeEvent[]
  wake: (() => void) | null
  closed: boolean
}

type ClaudeSdkTurnState = {
  assistantTextSeen: boolean
  firstDeltaEmitted: boolean
  terminalState: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state']
  terminalMessage?: string
  toolUses: Map<string, { name: string; input: Record<string, unknown> }>
}

export class ClaudeCodeRuntimeService {
  private readonly sdk: ClaudeAgentSdk
  private readonly threadStore: ClaudeCodeThreadStore
  private readonly eventStore: ClaudeCodeEventStore
  private readonly sessionStore: ClaudeCodeSessionStore
  private readonly activeTurns = new Map<string, ActiveClaudeTurn>()
  private readonly eventSubscribers = new Set<ClaudeRuntimeEventSubscriber>()
  private readonly childState = new Map<string, AgentRuntimeChild>()

  constructor(private readonly options: ClaudeCodeRuntimeServiceOptions) {
    this.sdk = options.claudeAgentSdk ?? { query: claudeAgentSdkQuery }
    this.threadStore = new ClaudeCodeThreadStore({ rootDir: options.storageRoot })
    this.eventStore = new ClaudeCodeEventStore({ rootDir: options.storageRoot })
    this.sessionStore = new ClaudeCodeSessionStore({ rootDir: options.storageRoot })
  }

  isComputerUseMcpConfigured(settings?: AppSettingsV1): boolean {
    if (settings && !isComputerUseEnabledForRuntime(settings, 'claude')) return false
    return Boolean(this.options.computerUseMcpLaunch)
  }

  async connect(): Promise<ClaudeCodeConnectResult> {
    try {
      const settings = await this.options.settings()
      const runtime = settings.agents.claude
      const command = runtime?.command?.trim() || 'claude'
      return { ok: true, info: { command, sdk: '@anthropic-ai/claude-agent-sdk' } }
    } catch (error) {
      return failure(error, 'claude_sdk_unavailable')
    }
  }

  async listThreads(options: {
    limit?: number
    search?: string
    includeArchived?: boolean
    archivedOnly?: boolean
  } = {}): Promise<ClaudeCodeThreadListResult> {
    try {
      const stored = await this.threadStore.list({
        includeArchived: options.includeArchived === true || options.archivedOnly === true
      })
      const search = options.search?.trim().toLowerCase() ?? ''
      const threads = stored
        .filter((thread) => options.archivedOnly === true ? thread.archived : true)
        .filter((thread) => search ? thread.title.toLowerCase().includes(search) : true)
        .slice(0, options.limit ?? 100)
        .map(storedThreadToRuntimeThread)
      return { ok: true, threads }
    } catch (error) {
      return failure(error)
    }
  }

  async startThread(payload: {
    workspace?: string
    title?: string
  }): Promise<ClaudeCodeThreadStartResult> {
    try {
      const settings = await this.options.settings()
      const workspace = resolveClaudeWorkspace(settings, payload.workspace)
      const model = resolveRuntimeModelRouterSettings(settings).model
      const thread = await this.threadStore.upsert({
        guiThreadId: `claude-thread-${randomUUID()}`,
        workspace,
        title: payload.title || 'Claude Code thread',
        model,
        latestTurnStatus: 'queued'
      })
      await this.emit({
        threadId: thread.guiThreadId,
        kind: 'thread_lifecycle',
        state: 'created',
        thread: storedThreadToRuntimeThread(thread)
      })
      return { ok: true, thread: storedThreadToRuntimeThread(thread) }
    } catch (error) {
      return failure(error)
    }
  }

  async readThread(threadId: string): Promise<ClaudeCodeThreadReadResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) {
        return {
          ok: true,
          detail: {
            id: threadId,
            runtimeId: 'claude',
            title: 'Claude Code thread',
            updatedAt: new Date().toISOString(),
            latestSeq: 0,
            turns: [],
            items: []
          }
        }
      }
      return { ok: true, detail: await storedThreadDetail(thread, this.eventStore) }
    } catch (error) {
      return failure(error)
    }
  }

  async publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent> {
    const stored = await this.emit(event)
    return stored.event
  }

  async startTurn(payload: {
    threadId: string
    text: string
    displayText?: string
    workspace?: string
  }): Promise<ClaudeCodeTurnStartResult> {
    try {
      const settings = await this.options.settings()
      const existingThread = await this.threadStore.get(payload.threadId)
      const workspace = resolveClaudeWorkspace(settings, payload.workspace || existingThread?.workspace)
      const turnId = `claude-turn-${randomUUID()}`
      const userMessageItemId = `claude-user-${randomUUID()}`
      const assistantItemId = `claude-assistant-${randomUUID()}`
      const launch = await prepareClaudeCodeSdkLaunch({
        settings,
        text: payload.text,
        workspace,
        sessionId: existingThread?.claudeSessionId,
        managedConfigDir: this.options.managedConfigDir,
        computerUseMcpLaunch: isComputerUseEnabledForRuntime(settings, 'claude') && this.options.computerUseMcpLaunch
          ? {
              ...this.options.computerUseMcpLaunch,
              defaultAgentId: `claude:${payload.threadId}`,
              defaultThreadId: payload.threadId,
              defaultTurnId: turnId,
              defaultSessionId: `claude:${payload.threadId}`
            }
          : undefined
      })
      const storedThread = await this.threadStore.upsert({
        guiThreadId: payload.threadId,
        workspace,
        title: existingThread?.title || firstLineTitle(payload.displayText || payload.text),
        model: launch.model,
        latestTurnId: turnId,
        latestUserMessageId: userMessageItemId,
        latestTurnStatus: 'running'
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'user_message',
        itemId: userMessageItemId,
        text: payload.text,
        displayText: payload.displayText
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'turn_lifecycle',
        state: 'started'
      })
      await this.emit({
        threadId: payload.threadId,
        turnId,
        kind: 'runtime_status',
        phase: 'process_start',
        message: 'Starting Claude Agent SDK',
        metadata: {
          model: launch.model,
          permissionMode: launch.permissionMode,
          configDir: launch.configDir,
          pathToClaudeCodeExecutable: launch.pathToClaudeCodeExecutable
        }
      })
      const abortController = new AbortController()
      const query = this.sdk.query({
        prompt: launch.prompt,
        options: {
          ...launch.sdkOptions,
          abortController,
          forwardSubagentText: true,
          agentProgressSummaries: true,
          sessionStore: this.sessionStore,
          sessionStoreFlush: 'eager'
        }
      })
      this.activeTurns.set(payload.threadId, {
        threadId: payload.threadId,
        turnId,
        abortController,
        query,
        assistantItemId
      })
      void this.runClaudeTurn({
        query,
        threadId: payload.threadId,
        turnId,
        assistantItemId,
        startedAtMs: Date.now(),
        fallbackThread: storedThread.guiThreadId
      })
      return { ok: true, threadId: payload.threadId, turnId, userMessageItemId }
    } catch (error) {
      return failure(error)
    }
  }

  async interruptTurn(
    threadId: string,
    turnId: string
  ): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const active = this.activeTurns.get(threadId)
      if (!active || active.turnId !== turnId) return { ok: true }
      active.abortController.abort()
      active.query.close?.()
      await this.completeTurn(threadId, turnId, 'aborted', 'Claude Code turn interrupted.')
      this.activeTurns.delete(threadId)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async steerTurn(): Promise<ClaudeCodeTurnMutationResult> {
    return {
      ok: false,
      message: 'Claude Code CLI runtime does not support steering an active turn.',
      code: 'capability_unavailable',
      recoverable: true
    }
  }

  async renameThread(threadId: string, title: string): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) return { ok: true }
      const next = await this.threadStore.upsert({ guiThreadId: threadId, title })
      await this.emit({
        threadId,
        kind: 'thread_lifecycle',
        state: 'updated',
        thread: storedThreadToRuntimeThread(next)
      })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async deleteThread(threadId: string): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const active = this.activeTurns.get(threadId)
      if (active) {
        active.abortController.abort()
        active.query.close?.()
      }
      this.activeTurns.delete(threadId)
      await this.threadStore.delete(threadId)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async archiveThread(threadId: string, archived: boolean): Promise<ClaudeCodeTurnMutationResult> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) return { ok: true }
      const next = await this.threadStore.upsert({ guiThreadId: threadId, archived })
      await this.emit({
        threadId,
        kind: 'thread_lifecycle',
        state: 'archived',
        thread: storedThreadToRuntimeThread(next)
      })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    return {
      supported: false,
      reason: 'Claude Code SDK token usage is only available per turn when emitted by the SDK stream.',
      groupBy: input.groupBy,
      buckets: [],
      totals: {}
    }
  }

  async listThreadChildren(input: {
    threadId: string
    parentTurnId?: string
    activeOnly?: boolean
    cursor?: string
    limit?: number
  }): Promise<AgentRuntimeListThreadChildrenResponse> {
    const children = await this.childrenForThread(input.threadId)
    const filtered = children
      .filter((child) => input.parentTurnId ? child.parentTurnId === input.parentTurnId : true)
      .filter((child) => input.activeOnly ? isChildActive(child) : true)
      .slice(0, Math.max(0, Math.floor(input.limit ?? 100)))
    return {
      runtimeId: 'claude',
      threadId: input.threadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      children: filtered
    }
  }

  async readChildTranscript(input: {
    parentThreadId: string
    parentTurnId?: string
    childId: string
    transcriptRef?: unknown
    cursor?: string
    limit?: number
  }): Promise<AgentRuntimeReadChildTranscriptResponse> {
    const children = await this.childrenForThread(input.parentThreadId)
    const child = children.find((candidate) =>
      candidate.id === input.childId &&
      (input.parentTurnId ? candidate.parentTurnId === input.parentTurnId : true)
    )
    const ref = optionalRecord(input.transcriptRef) ?? optionalRecord(child?.transcriptRef) ?? {}
    const metadata = recordValue(ref.metadata)
    const sessionId = stringField(metadata.sessionId) ||
      stringField(recordValue(child?.metadata).sessionId)
    const subpath = stringField(metadata.subpath) ||
      stringField(recordValue(child?.metadata).transcriptSubpath) ||
      transcriptSubpathForAgent(input.childId)
    const transcript = sessionId
      ? await this.sessionStore.readTranscript({ sessionId, subpath })
      : null
    if (!transcript) {
      return {
        transcript: {
          runtimeId: 'claude',
          parentThreadId: input.parentThreadId,
          ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
          childId: input.childId,
          ...(child ? { child } : {}),
          ...(child?.transcriptRef ? { transcriptRef: child.transcriptRef } : {}),
          entries: [],
          degraded: true,
          reason: sessionId
            ? `Claude subagent transcript ${subpath}.jsonl has not been mirrored yet.`
            : 'Claude child transcript is not available without an SDK session id.'
        }
      }
    }
    const entries = transcript.entries
      .map((entry, index) => transcriptEntryFromSessionStore(entry, index))
      .slice(0, Math.max(0, Math.floor(input.limit ?? 500)))
    return {
      transcript: {
        runtimeId: 'claude',
        parentThreadId: input.parentThreadId,
        ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
        childId: input.childId,
        ...(child ? { child } : {}),
        transcriptRef: child?.transcriptRef ?? transcriptRef({
          childId: input.childId,
          sessionId: transcript.key.sessionId,
          projectKey: transcript.key.projectKey,
          subpath: transcript.key.subpath,
          path: transcript.path
        }),
        entries,
        summary: child?.summary,
        usage: child?.usage,
        metadata: {
          source: 'claude-agent-sdk.sessionStore',
          path: transcript.path,
          projectKey: transcript.key.projectKey,
          sessionId: transcript.key.sessionId,
          subpath: transcript.key.subpath
        }
      }
    }
  }

  async readStoredEvents(threadId: string, sinceSeq = 0): Promise<AgentRuntimeEvent[]> {
    const events = await this.eventStore.read(threadId, { sinceSeq })
    return events.map((event) => event.event)
  }

  async *subscribeEvents(
    threadId: string,
    sinceSeq = 0,
    signal?: AbortSignal
  ): AsyncIterable<AgentRuntimeEvent> {
    let latestSeq = sinceSeq
    const subscriber: ClaudeRuntimeEventSubscriber = {
      threadId,
      queue: [],
      wake: null,
      closed: false
    }
    const onAbort = (): void => {
      subscriber.closed = true
      subscriber.wake?.()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    this.eventSubscribers.add(subscriber)
    try {
      const stored = await this.eventStore.read(threadId, { sinceSeq })
      for (const event of stored) {
        if (signal?.aborted || subscriber.closed) return
        latestSeq = Math.max(latestSeq, event.seq)
        yield event.event
      }
      while (!subscriber.closed && !signal?.aborted) {
        if (subscriber.queue.length === 0) {
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve
          })
          subscriber.wake = null
          continue
        }
        const event = subscriber.queue.shift()
        if (!event) continue
        if (typeof event.seq === 'number' && event.seq <= latestSeq) continue
        if (typeof event.seq === 'number') latestSeq = event.seq
        yield event
      }
    } finally {
      subscriber.closed = true
      signal?.removeEventListener('abort', onAbort)
      this.eventSubscribers.delete(subscriber)
    }
  }

  async runtimeInfo(): Promise<Record<string, unknown>> {
    const settings = await this.options.settings()
    const runtime = settings.agents.claude
    const router = resolveRuntimeModelRouterSettings(settings)
    return {
      host: 'claude-code',
      command: runtime?.command || 'claude',
      configDir: this.options.managedConfigDir || runtime?.configDir || '',
      model: router.model,
      baseUrl: router.baseUrl,
      activeTurns: this.activeTurns.size
    }
  }

  async stop(): Promise<void> {
    for (const active of this.activeTurns.values()) {
      active.abortController.abort()
      active.query.close?.()
    }
    this.activeTurns.clear()
    for (const subscriber of this.eventSubscribers) {
      subscriber.closed = true
      subscriber.wake?.()
    }
    this.eventSubscribers.clear()
  }

  private async runClaudeTurn(options: {
    query: ClaudeAgentSdkQuery
    threadId: string
    turnId: string
    assistantItemId: string
    startedAtMs: number
    fallbackThread: string
  }): Promise<void> {
    const state: ClaudeSdkTurnState = {
      assistantTextSeen: false,
      firstDeltaEmitted: false,
      terminalState: 'completed',
      toolUses: new Map()
    }
    try {
      for await (const message of options.query) {
        await this.handleSdkMessage(message, options, state)
      }
      if (this.activeTurns.get(options.threadId)?.turnId !== options.turnId) return
      this.activeTurns.delete(options.threadId)
      await this.completeTurn(options.threadId, options.turnId, state.terminalState, state.terminalMessage)
    } catch (error) {
      if (this.activeTurns.get(options.threadId)?.turnId !== options.turnId) return
      await this.failTurn(options.threadId, options.turnId, error)
    }
  }

  private async handleSdkMessage(
    message: SDKMessage,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const sessionId = stringField(record.session_id)
    if (sessionId) {
      await this.threadStore.upsert({
        guiThreadId: options.threadId,
        claudeSessionId: sessionId
      })
    }

    if (message.type === 'assistant') {
      await this.handleAssistantMessage(message, options, state)
      return
    }
    if (message.type === 'user') {
      await this.handleUserMessage(message, options, state)
      return
    }
    if (message.type === 'result') {
      await this.handleResultMessage(message, options, state)
      return
    }
    if (message.type === 'system') {
      await this.handleSystemMessage(message, options, state)
    }
  }

  private async handleAssistantMessage(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const messageRecord = recordValue(message.message)
    const usage = extractUsage(messageRecord)
    if (usage) {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'usage',
        usage
      })
    }

    for (const part of contentParts(messageRecord.content)) {
      if (part.type !== 'tool_use') continue
      const name = stringField(part.name) || 'tool'
      const itemId = stringField(part.id) || `claude-tool-${randomUUID()}`
      state.toolUses.set(itemId, {
        name,
        input: recordValue(part.input)
      })
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'tool_event',
        itemId,
        status: 'running',
        toolKind: toolKindFromName(name),
        summary: `Claude Code tool: ${name}`,
        detail: stringifyUnknown(part.input),
        meta: { name }
      })
    }

    const text = textFromContent(messageRecord.content)
    if (text) {
      await this.emitAssistantText(text, options, state)
    }
  }

  private async handleUserMessage(
    message: Extract<SDKMessage, { type: 'user' }>,
    options: {
      threadId: string
      turnId: string
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const messageRecord = recordValue(message.message)
    for (const part of contentParts(messageRecord.content)) {
      if (part.type !== 'tool_result') continue
      const itemId = stringField(part.tool_use_id) || `claude-tool-${randomUUID()}`
      const toolUse = state.toolUses.get(itemId)
      const payload = firstRecord(
        parseToolResultPayload(part.content),
        recordValue(message.tool_use_result)
      )
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'tool_event',
        itemId,
        status: part.is_error === true ? 'error' : 'success',
        toolKind: toolKindFromName(toolUse?.name ?? 'tool'),
        summary: toolUse?.name ? `Claude Code tool result: ${toolUse.name}` : 'Claude Code tool result',
        detail: textFromContent(part.content) || stringifyUnknown(part.content),
        meta: {
          ...(toolUse?.name ? { name: toolUse.name } : {}),
          ...(payload ? { output: payload } : {})
        }
      })
      if (toolUse?.name && payload) {
        await this.emitChildFromToolResult({
          threadId: options.threadId,
          turnId: options.turnId,
          toolUseId: itemId,
          toolName: toolUse.name,
          toolInput: toolUse.input,
          payload,
          isError: part.is_error === true,
          sessionId: stringField(recordValue(message).session_id)
        })
      }
    }
  }

  private async handleResultMessage(
    message: Extract<SDKMessage, { type: 'result' }>,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const usage = extractUsage(record)
    if (usage) {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'usage',
        usage
      })
    }
    if (record.is_error === true) {
      const messageText = arrayValue(record.errors).map((entry) => String(entry)).join('; ') ||
        stringField(record.result) ||
        'Claude Code SDK returned an error result.'
      state.terminalState = 'failed'
      state.terminalMessage = messageText
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'error',
        itemId: `claude-error-${randomUUID()}`,
        recoverable: false,
        severity: 'error',
        message: messageText,
        code: stringField(record.subtype) || undefined,
        detail: stringifyUnknown(record)
      })
      return
    }
    const text = stringField(record.result)
    if (text && !state.assistantTextSeen) {
      await this.emitAssistantText(text, options, state)
    }
  }

  private async handleSystemMessage(
    message: Extract<SDKMessage, { type: 'system' }>,
    options: {
      threadId: string
      turnId: string
    },
    _state: ClaudeSdkTurnState
  ): Promise<void> {
    const record = recordValue(message)
    const subtype = stringField(record.subtype)
    if (subtype === 'init') {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'initialize_done',
        metadata: {
          sessionId: stringField(record.session_id),
          claudeCodeVersion: stringField(record.claude_code_version),
          model: stringField(record.model),
          permissionMode: stringField(record.permissionMode),
          cwd: stringField(record.cwd),
          tools: arrayValue(record.tools).filter((tool): tool is string => typeof tool === 'string')
        }
      })
      return
    }
    if (
      subtype === 'task_started' ||
      subtype === 'task_progress' ||
      subtype === 'task_updated' ||
      subtype === 'task_notification'
    ) {
      const child = await this.childFromTaskMessage(record, options.threadId, options.turnId)
      if (child) await this.emitChild(child)
      return
    }
    if (subtype === 'mirror_error') {
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'tool_running',
        message: stringField(record.error) || 'Claude transcript mirror failed.',
        metadata: {
          severity: 'warning',
          key: record.key
        }
      })
    }
  }

  private async emitAssistantText(
    text: string,
    options: {
      threadId: string
      turnId: string
      assistantItemId: string
      startedAtMs: number
    },
    state: ClaudeSdkTurnState
  ): Promise<void> {
    state.assistantTextSeen = true
    await this.emit({
      threadId: options.threadId,
      turnId: options.turnId,
      kind: 'assistant_delta',
      itemId: options.assistantItemId,
      text
    })
    if (!state.firstDeltaEmitted) {
      state.firstDeltaEmitted = true
      await this.emit({
        threadId: options.threadId,
        turnId: options.turnId,
        kind: 'runtime_status',
        phase: 'first_delta',
        latencyMs: Date.now() - options.startedAtMs
      })
    }
  }

  private async emitChildFromToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolName: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<void> {
    if (input.toolName === 'Agent') {
      await this.emitChild(await this.childFromAgentToolResult(input))
      return
    }
    if (input.toolName === 'Workflow') {
      await this.emitChild(await this.childFromWorkflowToolResult(input))
    }
  }

  private async childFromAgentToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<AgentRuntimeChild> {
    const agentId = stringField(input.payload.agentId) ||
      stringField(input.payload.agent_id) ||
      input.toolUseId
    const agentType = stringField(input.payload.agentType) ||
      stringField(input.payload.agent_type) ||
      stringField(input.payload.subagent_type) ||
      stringField(input.toolInput.agentType) ||
      stringField(input.toolInput.agent_type) ||
      stringField(input.toolInput.subagent_type)
    const prompt = stringField(input.payload.prompt) || stringField(input.toolInput.prompt)
    const status = childStatus(input.payload.status, input.isError ? 'failed' : 'completed')
    const totalTokens = numberField(input.payload.totalTokens) ||
      numberField(input.payload.total_tokens)
    const usage = usageFromRecord(input.payload.usage, totalTokens)
    const outputFile = stringField(input.payload.outputFile) ||
      stringField(input.payload.output_file)
    const subpath = transcriptSubpathForAgent(agentId)
    return {
      id: agentId,
      runtimeId: 'claude',
      parentThreadId: input.threadId,
      parentTurnId: input.turnId,
      kind: 'agent',
      status,
      ...(agentType ? { name: agentType, label: agentType } : {}),
      ...(prompt ? { prompt } : {}),
      ...(usage ? { usage } : {}),
      ...(outputFile ? { summary: outputFile } : {}),
      transcriptRef: transcriptRef({
        childId: agentId,
        sessionId: input.sessionId,
        subpath
      }),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: 'claude.Agent',
        toolUseId: input.toolUseId,
        agentId,
        ...(agentType ? { agentType } : {}),
        ...(outputFile ? { outputFile } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId, transcriptSubpath: subpath } : {})
      }
    }
  }

  private async childFromWorkflowToolResult(input: {
    threadId: string
    turnId: string
    toolUseId: string
    toolInput: Record<string, unknown>
    payload: Record<string, unknown>
    isError: boolean
    sessionId: string
  }): Promise<AgentRuntimeChild> {
    const taskId = stringField(input.payload.taskId) ||
      stringField(input.payload.task_id) ||
      stringField(input.toolInput.taskId) ||
      stringField(input.toolInput.task_id)
    const runId = stringField(input.payload.runId) ||
      stringField(input.payload.run_id) ||
      stringField(input.toolInput.runId) ||
      stringField(input.toolInput.run_id)
    const workflowName = stringField(input.payload.workflowName) ||
      stringField(input.payload.workflow_name) ||
      stringField(input.toolInput.workflowName) ||
      stringField(input.toolInput.workflow_name) ||
      stringField(input.toolInput.name)
    const summary = stringField(input.payload.summary)
    const transcriptDir = stringField(input.payload.transcriptDir) ||
      stringField(input.payload.transcript_dir)
    const scriptPath = stringField(input.payload.scriptPath) ||
      stringField(input.payload.script_path)
    const status = childStatus(input.payload.status, input.isError ? 'failed' : 'completed')
    return {
      id: runId || taskId || input.toolUseId,
      runtimeId: 'claude',
      parentThreadId: input.threadId,
      parentTurnId: input.turnId,
      kind: 'workflow',
      status,
      ...(workflowName ? { name: workflowName, label: workflowName } : {}),
      ...(summary ? { summary } : {}),
      ...(transcriptDir ? {
        transcriptRef: transcriptRef({
          childId: runId || taskId || input.toolUseId,
          sessionId: input.sessionId,
          source: 'claude.Workflow',
          path: transcriptDir,
          kind: 'directory'
        })
      } : {}),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: 'claude.Workflow',
        toolUseId: input.toolUseId,
        ...(taskId ? { taskId } : {}),
        ...(runId ? { runId } : {}),
        ...(workflowName ? { workflowName } : {}),
        ...(transcriptDir ? { transcriptDir } : {}),
        ...(scriptPath ? { scriptPath } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {})
      }
    }
  }

  private async childFromTaskMessage(
    record: Record<string, unknown>,
    threadId: string,
    turnId: string
  ): Promise<AgentRuntimeChild | null> {
    const subtype = stringField(record.subtype)
    const taskId = stringField(record.task_id)
    if (!taskId) return null
    const sessionId = stringField(record.session_id)
    const workflowName = stringField(record.workflow_name)
    const subagentType = stringField(record.subagent_type)
    const isWorkflow = stringField(record.task_type) === 'local_workflow' || Boolean(workflowName)
    const status = subtype === 'task_notification'
      ? childStatus(record.status, 'completed')
      : subtype === 'task_updated'
        ? childStatus(recordValue(record.patch).status, 'running')
        : 'running'
    const usageRecord = recordValue(record.usage)
    const subpath = !isWorkflow ? transcriptSubpathForAgent(taskId) : ''
    return {
      id: taskId,
      runtimeId: 'claude',
      parentThreadId: threadId,
      parentTurnId: turnId,
      kind: isWorkflow ? 'workflow' : 'agent',
      status,
      ...(workflowName || subagentType ? {
        name: workflowName || subagentType,
        label: workflowName || subagentType
      } : {}),
      prompt: stringField(record.prompt) || stringField(record.description) || undefined,
      summary: stringField(record.summary) || undefined,
      usage: usageFromRecord(usageRecord, numberField(usageRecord.total_tokens)),
      ...(!isWorkflow && sessionId ? {
        transcriptRef: transcriptRef({
          childId: taskId,
          sessionId,
          subpath
        })
      } : {}),
      updatedAt: new Date().toISOString(),
      ...(status === 'completed' || status === 'failed' || status === 'aborted'
        ? { completedAt: new Date().toISOString() }
        : {}),
      metadata: {
        source: `claude-agent-sdk.${subtype}`,
        taskId,
        ...(stringField(record.tool_use_id) ? { toolUseId: stringField(record.tool_use_id) } : {}),
        ...(stringField(record.task_type) ? { taskType: stringField(record.task_type) } : {}),
        ...(subagentType ? { agentType: subagentType } : {}),
        ...(workflowName ? { workflowName } : {}),
        ...(stringField(record.output_file) ? { outputFile: stringField(record.output_file) } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(!isWorkflow && subpath ? { transcriptSubpath: subpath } : {})
      }
    }
  }

  private async emitChild(child: AgentRuntimeChild): Promise<void> {
    const key = childStateKey(child.parentThreadId, child.id)
    const existing = this.childState.get(key) ?? await this.latestStoredChild(child.parentThreadId, child.id)
    const next = mergeChild(existing, child)
    this.childState.set(key, next)
    await this.emit({
      threadId: next.parentThreadId,
      turnId: next.parentTurnId,
      kind: 'child_event',
      child: next
    })
  }

  private async latestStoredChild(threadId: string, childId: string): Promise<AgentRuntimeChild | null> {
    return (await this.childrenForThread(threadId)).find((child) => child.id === childId) ?? null
  }

  private async childrenForThread(threadId: string): Promise<AgentRuntimeChild[]> {
    const storedEvents = await this.eventStore.read(threadId, { includeAll: true })
    const children = new Map<string, AgentRuntimeChild>()
    for (const stored of storedEvents) {
      const event = stored.event
      if (event.kind !== 'child_event') continue
      const child = event.child
      children.set(child.id, mergeChild(children.get(child.id), child))
    }
    return [...children.values()]
      .filter((child) => child.parentThreadId === threadId)
      .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? '') - Date.parse(a.updatedAt ?? a.createdAt ?? ''))
  }

  private async completeTurn(
    threadId: string,
    turnId: string,
    state: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state'],
    message?: string
  ): Promise<void> {
    const status = turnStatusFromLifecycle(state)
    const latestSeq = await this.eventStore.latestSeq(threadId)
    await this.threadStore.upsert({
      guiThreadId: threadId,
      latestSeq,
      latestTurnId: turnId,
      latestTurnStatus: status
    })
    await this.emit({
      threadId,
      turnId,
      kind: 'runtime_status',
      phase: 'turn_done',
      message
    })
    await this.emit({
      threadId,
      turnId,
      kind: 'turn_lifecycle',
      state,
      message
    })
  }

  private async failTurn(threadId: string, turnId: string, error: unknown): Promise<void> {
    if (this.activeTurns.get(threadId)?.turnId === turnId) {
      this.activeTurns.delete(threadId)
    }
    const message = error instanceof Error ? error.message : String(error)
    await this.emit({
      threadId,
      turnId,
      kind: 'error',
      itemId: `claude-error-${randomUUID()}`,
      recoverable: false,
      severity: 'error',
      message,
      code: (error as NodeJS.ErrnoException)?.code
    })
    await this.completeTurn(threadId, turnId, 'failed', message)
  }

  private async emit(event: AgentRuntimeEvent): Promise<ClaudeCodeStoredEvent> {
    const stored = await this.eventStore.append(event.threadId, event)
    const latestSeq = stored.seq
    const thread = await this.threadStore.get(stored.threadId)
    if (thread) {
      await this.threadStore.upsert({
        guiThreadId: stored.threadId,
        latestSeq
      })
    }
    for (const subscriber of this.eventSubscribers) {
      if (subscriber.closed || subscriber.threadId !== stored.threadId) continue
      subscriber.queue.push(stored.event)
      subscriber.wake?.()
    }
    return stored
  }
}

function extractUsage(record: Record<string, unknown>): AgentRuntimeUsage | null {
  const message = recordValue(record.message)
  return usageFromRecord(record.usage, 0) ?? usageFromRecord(message.usage, 0) ?? null
}

function usageFromRecord(value: unknown, fallbackTotalTokens: number): AgentRuntimeUsage | undefined {
  const source = optionalRecord(value)
  const inputTokens = source
    ? numberField(source.inputTokens) || numberField(source.input_tokens)
    : 0
  const outputTokens = source
    ? numberField(source.outputTokens) || numberField(source.output_tokens)
    : 0
  const cacheReadTokens = source
    ? numberField(source.cacheReadTokens) || numberField(source.cache_read_input_tokens)
    : 0
  const cacheWriteTokens = source
    ? numberField(source.cacheWriteTokens) || numberField(source.cache_creation_input_tokens)
    : 0
  const totalTokens = source
    ? numberField(source.totalTokens) || numberField(source.total_tokens)
    : 0
  const computedTotal = totalTokens || fallbackTotalTokens ||
    inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  if (computedTotal <= 0) return undefined
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: computedTotal
  }
}

function contentParts(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return []
  return content.filter(isRecord)
}

function parseToolResultPayload(content: unknown): Record<string, unknown> {
  if (isRecord(content)) return content
  const text = textFromContent(content).trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    return recordValue(parsed)
  } catch {
    return {}
  }
}

function firstRecord(...records: Record<string, unknown>[]): Record<string, unknown> | null {
  return records.find((record) => Object.keys(record).length > 0) ?? null
}

function childStatus(value: unknown, fallback: AgentRuntimeChildStatus): AgentRuntimeChildStatus {
  const normalized = stringField(value)
  if (
    normalized === 'queued' ||
    normalized === 'running' ||
    normalized === 'completed' ||
    normalized === 'failed' ||
    normalized === 'aborted' ||
    normalized === 'unknown'
  ) {
    return normalized
  }
  if (normalized === 'pending') return 'queued'
  if (normalized === 'success') return 'completed'
  if (normalized === 'error') return 'failed'
  if (normalized === 'killed' || normalized === 'stopped') return 'aborted'
  return fallback
}

function isChildActive(child: Pick<AgentRuntimeChild, 'status'>): boolean {
  return child.status === 'queued' || child.status === 'running'
}

function transcriptSubpathForAgent(agentId: string): string {
  const normalized = agentId.trim()
  return `subagents/agent-${normalized || 'unknown'}`
}

function transcriptRef(input: {
  childId: string
  sessionId?: string
  projectKey?: string
  subpath?: string
  source?: string
  path?: string
  kind?: 'file' | 'directory'
}): NonNullable<AgentRuntimeChild['transcriptRef']> {
  const kind = input.kind ?? 'file'
  const subpath = input.subpath?.trim()
  const path = input.path || (subpath ? `${subpath}.jsonl` : undefined)
  return {
    id: subpath || input.childId,
    kind,
    label: kind === 'directory' ? 'Claude workflow transcript' : 'Claude subagent transcript',
    ...(path ? { path } : {}),
    mimeType: kind === 'file' ? 'application/jsonl' : undefined,
    runtimeId: 'claude',
    childId: input.childId,
    transcriptId: subpath || input.childId,
    source: input.source ?? 'claude-agent-sdk.sessionStore',
    metadata: {
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.projectKey ? { projectKey: input.projectKey } : {}),
      ...(subpath ? { subpath } : {}),
      ...(path ? { path } : {})
    }
  } as NonNullable<AgentRuntimeChild['transcriptRef']>
}

function transcriptEntryFromSessionStore(
  entry: SessionStoreEntry,
  index: number
): AgentRuntimeChildTranscriptEntry {
  const message = recordValue(entry.message)
  const text = textFromContent(message.content) ||
    stringField(entry.content) ||
    stringField(entry.text) ||
    stringField(entry.summary)
  return {
    id: stringField(entry.uuid) || `entry-${index + 1}`,
    kind: transcriptEntryKind(entry.type),
    ...(text ? { text } : {}),
    ...(stringField(entry.summary) ? { summary: stringField(entry.summary) } : {}),
    createdAt: stringField(entry.timestamp) || undefined,
    metadata: entry
  }
}

function transcriptEntryKind(type: unknown): AgentRuntimeChildTranscriptEntry['kind'] {
  const normalized = stringField(type)
  if (normalized === 'user') return 'user_message'
  if (normalized === 'assistant') return 'assistant_message'
  if (normalized.includes('tool')) return 'tool'
  if (normalized.includes('reasoning') || normalized.includes('thinking')) return 'reasoning'
  if (normalized === 'system') return 'system'
  return 'event'
}

function childStateKey(threadId: string, childId: string): string {
  return `${threadId}\n${childId}`
}

function mergeChild(
  previous: AgentRuntimeChild | null | undefined,
  next: AgentRuntimeChild
): AgentRuntimeChild {
  return {
    ...previous,
    ...next,
    usage: next.usage ?? previous?.usage,
    transcriptRef: next.transcriptRef ?? previous?.transcriptRef,
    openAsThreadRef: next.openAsThreadRef ?? previous?.openAsThreadRef,
    metadata: {
      ...(previous?.metadata ?? {}),
      ...(next.metadata ?? {})
    }
  }
}

function firstLineTitle(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim().slice(0, 80) || 'Claude Code thread'
}

function turnStatusFromLifecycle(
  state: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state']
): AgentRuntimeTurn['status'] {
  if (state === 'completed') return 'completed'
  if (state === 'failed') return 'failed'
  if (state === 'aborted') return 'aborted'
  if (state === 'steered') return 'steered'
  return 'running'
}

function toolKindFromName(name: string): 'tool_call' | 'command_execution' | 'file_change' {
  const normalized = name.toLowerCase()
  if (normalized.includes('bash') || normalized.includes('command')) return 'command_execution'
  if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('file')) return 'file_change'
  return 'tool_call'
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      return stringField(part.text) ||
        stringField(part.content) ||
        stringField(recordValue(part.input).prompt) ||
        stringField(recordValue(part.input).description)
    })
    .filter(Boolean)
    .join('\n')
}

function failure(error: unknown, defaultCode = 'claude_runtime_error'): ClaudeCodeRuntimeFailure {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    message,
    code: (error as NodeJS.ErrnoException)?.code || defaultCode,
    recoverable: true
  }
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function recordValue(value: unknown): Record<string, unknown> {
  return optionalRecord(value) ?? {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
