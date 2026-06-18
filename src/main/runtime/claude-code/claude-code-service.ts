import {
  spawn as spawnChild,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  AgentRuntimeEvent,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeTurn,
  AgentRuntimeUsage,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import {
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  prepareClaudeCodeTurnLaunch,
  resolveClaudeWorkspace
} from './claude-code-config'
import {
  ClaudeCodeEventStore,
  ClaudeCodeThreadStore,
  storedThreadDetail,
  storedThreadToRuntimeThread,
  type ClaudeCodeStoredEvent
} from './claude-code-store'

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcessWithoutNullStreams

export type ClaudeCodeRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  storageRoot: string
  managedConfigDir?: string
  spawn?: SpawnFn
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
  child: ChildProcessWithoutNullStreams
  assistantItemId: string
}

type ClaudeRuntimeEventSubscriber = {
  threadId: string
  queue: AgentRuntimeEvent[]
  wake: (() => void) | null
  closed: boolean
}

type ClaudeStreamRecord = Record<string, unknown>

export class ClaudeCodeRuntimeService {
  private readonly spawnImpl: SpawnFn
  private readonly threadStore: ClaudeCodeThreadStore
  private readonly eventStore: ClaudeCodeEventStore
  private readonly activeTurns = new Map<string, ActiveClaudeTurn>()
  private readonly eventSubscribers = new Set<ClaudeRuntimeEventSubscriber>()

  constructor(private readonly options: ClaudeCodeRuntimeServiceOptions) {
    this.spawnImpl = options.spawn ?? ((command, args, spawnOptions) => spawnChild(command, args, spawnOptions))
    this.threadStore = new ClaudeCodeThreadStore({ rootDir: options.storageRoot })
    this.eventStore = new ClaudeCodeEventStore({ rootDir: options.storageRoot })
  }

  async connect(): Promise<ClaudeCodeConnectResult> {
    try {
      const settings = await this.options.settings()
      const runtime = settings.agents.claude
      const command = runtime?.command?.trim() || 'claude'
      const version = await probeClaudeVersion(command, this.spawnImpl)
      return { ok: true, info: { command, version } }
    } catch (error) {
      return claudeCliProbeFailure(error)
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
      const launch = await prepareClaudeCodeTurnLaunch({
        settings,
        text: payload.text,
        workspace,
        sessionId: existingThread?.claudeSessionId,
        managedConfigDir: this.options.managedConfigDir
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
        message: 'Starting Claude Code CLI',
        metadata: {
          command: launch.command,
          model: launch.model,
          permissionMode: launch.permissionMode,
          configDir: launch.configDir
        }
      })
      const child = this.spawnImpl(launch.command, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
        windowsHide: true
      })
      child.stdin?.end()
      this.activeTurns.set(payload.threadId, {
        threadId: payload.threadId,
        turnId,
        child,
        assistantItemId
      })
      void this.runClaudeTurn({
        child,
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
      active.child.kill('SIGTERM')
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
      if (active) active.child.kill('SIGTERM')
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
      reason: 'Claude Code CLI token usage is only available per turn when emitted by the CLI stream.',
      groupBy: input.groupBy,
      buckets: [],
      totals: {}
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
    const stored = await this.eventStore.read(threadId, { sinceSeq })
    let latestSeq = sinceSeq
    for (const event of stored) {
      latestSeq = Math.max(latestSeq, event.seq)
      yield event.event
    }
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
      active.child.kill('SIGTERM')
    }
    this.activeTurns.clear()
    for (const subscriber of this.eventSubscribers) {
      subscriber.closed = true
      subscriber.wake?.()
    }
    this.eventSubscribers.clear()
  }

  private async runClaudeTurn(options: {
    child: ChildProcessWithoutNullStreams
    threadId: string
    turnId: string
    assistantItemId: string
    startedAtMs: number
    fallbackThread: string
  }): Promise<void> {
    let stdoutBuffer = ''
    let stderr = ''
    let assistantTextSeen = false
    let completed = false
    let lineProcessing: Promise<void> = Promise.resolve()
    const processLine = async (line: string): Promise<void> => {
      const trimmed = line.trim()
      if (!trimmed) return
      let record: ClaudeStreamRecord
      try {
        record = JSON.parse(trimmed) as ClaudeStreamRecord
      } catch {
        await this.emit({
          threadId: options.threadId,
          turnId: options.turnId,
          kind: 'runtime_status',
          phase: 'tool_running',
          message: trimmed.slice(0, 500)
        })
        return
      }
      const sessionId = extractSessionId(record)
      if (sessionId) {
        await this.threadStore.upsert({
          guiThreadId: options.threadId,
          claudeSessionId: sessionId
        })
      }
      const usage = extractUsage(record)
      if (usage) {
        await this.emit({
          threadId: options.threadId,
          turnId: options.turnId,
          kind: 'usage',
          usage
        })
      }
      for (const tool of extractToolEvents(record)) {
        await this.emit({
          threadId: options.threadId,
          turnId: options.turnId,
          kind: 'tool_event',
          itemId: tool.itemId,
          status: tool.status,
          toolKind: tool.toolKind,
          summary: tool.summary,
          detail: tool.detail,
          meta: tool.meta
        })
      }
      const error = extractError(record)
      if (error) {
        await this.emit({
          threadId: options.threadId,
          turnId: options.turnId,
          kind: 'error',
          itemId: `claude-error-${randomUUID()}`,
          recoverable: false,
          severity: 'error',
          message: error.message,
          code: error.code,
          detail: error.detail
        })
      }
      const text = extractAssistantText(record)
      if (text && !(assistantTextSeen && record.type === 'result')) {
        assistantTextSeen = true
        await this.emit({
          threadId: options.threadId,
          turnId: options.turnId,
          kind: 'assistant_delta',
          itemId: options.assistantItemId,
          text
        })
        if (!completed) {
          completed = true
          await this.emit({
            threadId: options.threadId,
            turnId: options.turnId,
            kind: 'runtime_status',
            phase: 'first_delta',
            latencyMs: Date.now() - options.startedAtMs
          })
        }
      }
    }
    const enqueueLine = (line: string): void => {
      lineProcessing = lineProcessing.then(() => processLine(line))
      void lineProcessing.catch(() => undefined)
    }

    options.child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) enqueueLine(line)
    })
    options.child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    options.child.once('error', (error) => {
      void this.failTurn(options.threadId, options.turnId, error)
    })
    options.child.once('close', (code, signal) => {
      void (async () => {
        if (stdoutBuffer.trim()) enqueueLine(stdoutBuffer)
        try {
          await lineProcessing
        } catch (error) {
          await this.failTurn(options.threadId, options.turnId, error)
          return
        }
        if (this.activeTurns.get(options.threadId)?.turnId !== options.turnId) return
        this.activeTurns.delete(options.threadId)
        if (code === 0) {
          await this.completeTurn(options.threadId, options.turnId, 'completed')
        } else {
          await this.failTurn(options.threadId, options.turnId, new Error(
            stderr.trim() || `Claude Code exited with ${signal || `code ${code ?? 'unknown'}`}.`
          ))
        }
      })()
    })
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

async function probeClaudeVersion(command: string, spawnImpl: SpawnFn): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  const child = spawnImpl(command, ['--version'], {
    env: process.env,
    windowsHide: true
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  return new Promise<string>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve((stdout || stderr).trim())
      } else {
        reject(new Error(stderr.trim() || `Claude Code version probe exited with code ${code ?? 'unknown'}.`))
      }
    })
  })
}

function extractSessionId(record: ClaudeStreamRecord): string {
  const message = isRecord(record.message) ? record.message : null
  return stringField(record.session_id) ||
    stringField(record.sessionId) ||
    stringField(record.uuid) ||
    stringField(message?.session_id)
}

function extractAssistantText(record: ClaudeStreamRecord): string {
  if (record.type === 'result') return stringField(record.result)
  const delta = isRecord(record.delta) ? record.delta : null
  const deltaText = stringField(delta?.text) || stringField(delta?.content)
  if (deltaText) return deltaText
  const message = isRecord(record.message) ? record.message : record
  const contentText = textFromContent(message.content)
  if (contentText && (record.type === 'assistant' || message.role === 'assistant')) return contentText
  return ''
}

function extractToolEvents(record: ClaudeStreamRecord): Array<{
  itemId: string
  status: 'running' | 'success' | 'error'
  toolKind: 'tool_call' | 'command_execution' | 'file_change'
  summary: string
  detail?: string
  meta?: Record<string, unknown>
}> {
  const events: Array<{
    itemId: string
    status: 'running' | 'success' | 'error'
    toolKind: 'tool_call' | 'command_execution' | 'file_change'
    summary: string
    detail?: string
    meta?: Record<string, unknown>
  }> = []
  const message = isRecord(record.message) ? record.message : record
  const content = Array.isArray(message.content) ? message.content : []
  for (const part of content) {
    if (!isRecord(part)) continue
    if (part.type === 'tool_use') {
      const name = stringField(part.name) || 'tool'
      events.push({
        itemId: stringField(part.id) || `claude-tool-${randomUUID()}`,
        status: 'running',
        toolKind: toolKindFromName(name),
        summary: `Claude Code tool: ${name}`,
        detail: stringifyUnknown(part.input),
        meta: { name }
      })
    }
    if (part.type === 'tool_result') {
      events.push({
        itemId: stringField(part.tool_use_id) || `claude-tool-${randomUUID()}`,
        status: part.is_error === true ? 'error' : 'success',
        toolKind: 'tool_call',
        summary: 'Claude Code tool result',
        detail: textFromContent(part.content) || stringifyUnknown(part.content)
      })
    }
  }
  if (record.type === 'tool_use' || record.type === 'tool_result') {
    const name = stringField(record.name) || stringField(record.tool_name) || 'tool'
    events.push({
      itemId: stringField(record.id) || stringField(record.tool_use_id) || `claude-tool-${randomUUID()}`,
      status: record.type === 'tool_result' ? 'success' : 'running',
      toolKind: toolKindFromName(name),
      summary: record.type === 'tool_result' ? 'Claude Code tool result' : `Claude Code tool: ${name}`,
      detail: stringifyUnknown(record.input ?? record.content ?? record.result),
      meta: { name }
    })
  }
  return events
}

function extractUsage(record: ClaudeStreamRecord): AgentRuntimeUsage | null {
  const message = isRecord(record.message) ? record.message : null
  const source = isRecord(record.usage)
    ? record.usage
    : message && isRecord(message.usage)
      ? message.usage
      : null
  if (!source) return null
  const inputTokens = numberField(source.input_tokens)
  const outputTokens = numberField(source.output_tokens)
  const cacheReadTokens = numberField(source.cache_read_input_tokens)
  const cacheWriteTokens = numberField(source.cache_creation_input_tokens)
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  if (totalTokens <= 0) return null
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens
  }
}

function extractError(record: ClaudeStreamRecord): { message: string; code?: string; detail?: string } | null {
  if (record.type !== 'error' && !record.error) return null
  const error = isRecord(record.error) ? record.error : record
  const message = stringField(error.message) || stringField(record.message) || 'Claude Code runtime error.'
  return {
    message,
    code: stringField(error.code) || stringField(error.type) || undefined,
    detail: stringifyUnknown(error)
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
      return stringField(part.text) || stringField(part.content)
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

function claudeCliProbeFailure(error: unknown): ClaudeCodeRuntimeFailure {
  const code = (error as NodeJS.ErrnoException)?.code || 'claude_cli_unavailable'
  const detail = error instanceof Error ? error.message : String(error)
  const installHint = 'Claude Code CLI is not available. Install the `claude` CLI or update the Claude Code command path in Settings.'
  return {
    ok: false,
    message: code === 'ENOENT' ? installHint : `${installHint} ${detail}`,
    code,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
