import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import {
  getClaudeRuntimeSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1,
  type ClaudeRuntimeSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeEvent,
  AgentRuntimeItem,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeTurn,
  AgentRuntimeUsage
} from '../../../shared/agent-runtime-contract'

const execFileAsync = promisify(execFile)
const UPSTREAM_PROVIDER_SECRET_ENVS = [
  'ANTHROPIC_AUTH_TOKEN',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'COHERE_API_KEY',
  'OPENROUTER_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_AWS_API_KEY',
  'ANTHROPIC_BEDROCK_MANTLE_API_KEY'
] as const
const UPSTREAM_PROVIDER_ENV_PREFIXES = [
  'OPENAI',
  'DEEPSEEK',
  'QWEN',
  'DASHSCOPE',
  'GEMINI',
  'GOOGLE',
  'GROQ',
  'MISTRAL',
  'COHERE',
  'OPENROUTER',
  'AZURE_OPENAI'
] as const
const UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES = [
  'MODEL',
  'BASE_URL',
  'API_BASE',
  'API_BASE_URL'
] as const

export type ClaudeRuntimeServiceOptions = {
  settings: () => Promise<AppSettingsV1>
  storageRoot: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

export type ClaudeRuntimeFailure = {
  ok: false
  message: string
  code?: string
  recoverable?: boolean
}

export type ClaudeRuntimeOk<T extends Record<string, unknown> = Record<string, unknown>> = {
  ok: true
} & T

type ClaudeRuntimeResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ClaudeRuntimeOk<T>
  | ClaudeRuntimeFailure

type ClaudeStoredThread = {
  guiThreadId: string
  claudeSessionId: string
  runtimeId: 'claude'
  workspace: string
  title: string
  createdAt: string
  updatedAt: string
  archived: boolean
  latestSeq: number
  latestTurnId?: string
  latestUserMessageId?: string
}

type ClaudeStoredEvent = {
  seq: number
  threadId: string
  createdAt: string
  event: AgentRuntimeEvent
}

type ClaudeEventSubscriber = {
  threadId: string
  queue: AgentRuntimeEvent[]
  wake: (() => void) | null
  closed: boolean
}

type ClaudeActiveTurn = {
  process?: ChildProcessWithoutNullStreams
  abort?: AbortController
  threadId: string
  turnId: string
}

export class ClaudeRuntimeService {
  private readonly threadStore: ClaudeThreadStore
  private readonly eventStore: ClaudeEventStore
  private readonly subscribers = new Set<ClaudeEventSubscriber>()
  private readonly activeTurns = new Map<string, ClaudeActiveTurn>()

  constructor(private readonly options: ClaudeRuntimeServiceOptions) {
    this.threadStore = new ClaudeThreadStore({ rootDir: options.storageRoot })
    this.eventStore = new ClaudeEventStore({ rootDir: options.storageRoot })
  }

  async connect(): Promise<ClaudeRuntimeResult<{ info: Record<string, unknown> }>> {
    try {
      const settings = await this.options.settings()
      const runtime = getClaudeRuntimeSettings(settings)
      const { stdout } = await execFileAsync(runtime.command, ['--version'], {
        env: claudeRuntimeEnv(this.options.env ?? process.env, settings, runtime),
        timeout: 15_000
      })
      return {
        ok: true,
        info: {
          command: runtime.command,
          version: stdout.trim()
        }
      }
    } catch (error) {
      return failure(error, 'CLAUDE_CONNECT_FAILED')
    }
  }

  async listThreads(options: {
    limit?: number
    search?: string
    includeArchived?: boolean
    archivedOnly?: boolean
  } = {}): Promise<ClaudeRuntimeResult<{ threads: AgentRuntimeThread[] }>> {
    try {
      const threads = await this.threadStore.list({
        includeArchived: options.includeArchived === true || options.archivedOnly === true
      })
      const search = options.search?.trim().toLowerCase() ?? ''
      const filtered = threads
        .filter((thread) => options.archivedOnly === true ? thread.archived : true)
        .filter((thread) => !search || thread.title.toLowerCase().includes(search))
        .slice(0, options.limit ?? 100)
      return { ok: true, threads: filtered.map((thread) => storedThreadToRuntimeThread(thread)) }
    } catch (error) {
      return failure(error, 'CLAUDE_LIST_THREADS_FAILED')
    }
  }

  async startThread(input: {
    workspace?: string
    title?: string
    model?: string
  }): Promise<ClaudeRuntimeResult<{ thread: AgentRuntimeThread }>> {
    try {
      const settings = await this.options.settings()
      const workspace = expandHome(input.workspace || settings.workspaceRoot || '~')
      const thread = await this.threadStore.upsert({
        guiThreadId: randomUUID(),
        claudeSessionId: randomUUID(),
        workspace,
        title: input.title || 'Claude thread'
      })
      return { ok: true, thread: storedThreadToRuntimeThread(thread, input.model) }
    } catch (error) {
      return failure(error, 'CLAUDE_START_THREAD_FAILED')
    }
  }

  async readThread(threadId: string): Promise<ClaudeRuntimeResult<{ detail: AgentRuntimeThreadDetail }>> {
    try {
      const thread = await this.threadStore.get(threadId)
      if (!thread) throw new Error(`Claude thread not found: ${threadId}`)
      const events = (await this.eventStore.read(thread.guiThreadId, { includeAll: true })).map((item) => item.event)
      return {
        ok: true,
        detail: buildThreadDetail(thread, events)
      }
    } catch (error) {
      return failure(error, 'CLAUDE_READ_THREAD_FAILED')
    }
  }

  async startTurn(input: {
    threadId: string
    text: string
    displayText?: string
    workspace?: string
    model?: string
    reasoningEffort?: string
  }): Promise<ClaudeRuntimeResult<{ threadId: string; turnId: string; userMessageItemId: string }>> {
    try {
      const settings = await this.options.settings()
      const runtime = getClaudeRuntimeSettings(settings)
      const existing = await this.threadStore.get(input.threadId)
      if (!existing) throw new Error(`Claude thread not found: ${input.threadId}`)
      const workspace = expandHome(input.workspace || existing.workspace || settings.workspaceRoot || '~')
      const turnId = randomUUID()
      const userMessageItemId = `claude-user-${turnId}`
      await this.threadStore.upsert({
        guiThreadId: existing.guiThreadId,
        claudeSessionId: existing.claudeSessionId,
        workspace,
        title: existing.title === 'Claude thread' ? titleFromPrompt(input.text) : existing.title,
        latestTurnId: turnId,
        latestUserMessageId: userMessageItemId
      })
      await this.publish({
        kind: 'user_message',
        runtimeId: 'claude',
        threadId: existing.guiThreadId,
        turnId,
        itemId: userMessageItemId,
        text: input.text,
        displayText: input.displayText,
        createdAt: new Date().toISOString()
      })
      await this.publish({
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: existing.guiThreadId,
        turnId,
        state: 'started',
        createdAt: new Date().toISOString()
      })
      this.spawnTurn({
        thread: existing,
        settings,
        runtime,
        workspace,
        turnId,
        text: input.text,
        model: input.model,
        reasoningEffort: input.reasoningEffort
      })
      return { ok: true, threadId: existing.guiThreadId, turnId, userMessageItemId }
    } catch (error) {
      return failure(error, 'CLAUDE_START_TURN_FAILED')
    }
  }

  async interruptTurn(threadId: string, turnId: string): Promise<ClaudeRuntimeResult> {
    const active = this.activeTurns.get(turnId)
    if (active && active.threadId === threadId) {
      active.process?.kill('SIGTERM')
      active.abort?.abort()
      this.activeTurns.delete(turnId)
      await this.publish({
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId,
        turnId,
        state: 'aborted',
        createdAt: new Date().toISOString()
      })
    }
    return { ok: true }
  }

  async renameThread(threadId: string, title: string): Promise<ClaudeRuntimeResult> {
    try {
      const existing = await this.threadStore.get(threadId)
      if (!existing) throw new Error(`Claude thread not found: ${threadId}`)
      await this.threadStore.upsert({
        guiThreadId: existing.guiThreadId,
        claudeSessionId: existing.claudeSessionId,
        title
      })
      return { ok: true }
    } catch (error) {
      return failure(error, 'CLAUDE_RENAME_THREAD_FAILED')
    }
  }

  async deleteThread(threadId: string): Promise<ClaudeRuntimeResult> {
    try {
      await this.threadStore.archive(threadId)
      return { ok: true }
    } catch (error) {
      return failure(error, 'CLAUDE_DELETE_THREAD_FAILED')
    }
  }

  async *subscribeEvents(
    threadId: string,
    sinceSeq = 0,
    signal?: AbortSignal
  ): AsyncIterable<AgentRuntimeEvent> {
    for (const stored of await this.eventStore.read(threadId, { sinceSeq })) {
      if (signal?.aborted) return
      yield stored.event
    }
    const subscriber: ClaudeEventSubscriber = {
      threadId,
      queue: [],
      wake: null,
      closed: false
    }
    this.subscribers.add(subscriber)
    const abort = (): void => {
      subscriber.closed = true
      subscriber.wake?.()
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (!subscriber.closed && !signal?.aborted) {
        if (subscriber.queue.length === 0) {
          await new Promise<void>((resolve) => {
            subscriber.wake = resolve
          })
          subscriber.wake = null
        }
        while (subscriber.queue.length > 0) {
          const event = subscriber.queue.shift()
          if (!event || signal?.aborted) return
          yield event
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort)
      this.subscribers.delete(subscriber)
    }
  }

  async readStoredEvents(threadId: string, sinceSeq = 0): Promise<AgentRuntimeEvent[]> {
    return (await this.eventStore.read(threadId, { sinceSeq })).map((item) => item.event)
  }

  async publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent> {
    return this.publish(event)
  }

  async usage(): Promise<ClaudeRuntimeResult<{
    groupBy?: string
    buckets: []
    totals: Record<string, unknown>
  }>> {
    return { ok: true, buckets: [], totals: {} }
  }

  async runtimeInfo(): Promise<Record<string, unknown>> {
    const connect = await this.connect()
    return {
      host: 'claude',
      transport: 'cli_process',
      ...(connect.ok ? { info: connect.info } : { error: connect.message })
    }
  }

  private spawnTurn(input: {
    thread: ClaudeStoredThread
    settings: AppSettingsV1
    runtime: ClaudeRuntimeSettingsV1
    workspace: string
    turnId: string
    text: string
    model?: string
    reasoningEffort?: string
  }): void {
    void this.runModelRouterTurn(input).catch((error) => {
      void this.publishError(input.thread.guiThreadId, input.turnId, error)
      void this.publish({
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: input.thread.guiThreadId,
        turnId: input.turnId,
        state: 'failed',
        message: error instanceof Error ? error.message : String(error),
        createdAt: new Date().toISOString()
      })
    }).finally(() => {
      this.activeTurns.delete(input.turnId)
    })
  }

  private async runModelRouterTurn(input: {
    thread: ClaudeStoredThread
    settings: AppSettingsV1
    runtime: ClaudeRuntimeSettingsV1
    workspace: string
    turnId: string
    text: string
    model?: string
    reasoningEffort?: string
  }): Promise<void> {
    const router = resolveRuntimeModelRouterSettings(input.settings)
    if (!router.apiKey) throw new Error('Claude Model Router runtime API key is required.')
    const abort = new AbortController()
    this.activeTurns.set(input.turnId, {
      abort,
      threadId: input.thread.guiThreadId,
      turnId: input.turnId
    })
    await this.publish({
      kind: 'runtime_status',
      runtimeId: 'claude',
      threadId: input.thread.guiThreadId,
      turnId: input.turnId,
      itemId: `claude-router-init-${input.turnId}`,
      phase: 'initialize_done',
      message: 'Claude runtime routed through Model Router',
      metadata: {
        model: router.model,
        transport: 'model_router_responses'
      },
      createdAt: new Date().toISOString()
    })
    const fetchImpl = this.options.fetchImpl ?? fetch
    const response = await fetchImpl(modelRouterResponsesUrl(router.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${router.apiKey}`
      },
      body: JSON.stringify({
        model: router.model,
        input: input.text,
        metadata: {
          runtimeId: 'claude',
          claudeSessionId: input.thread.claudeSessionId
        }
      }),
      signal: abort.signal
    })
    const bodyText = await response.text()
    if (!response.ok) {
      throw new Error(`Model Router HTTP ${response.status}: ${bodyText.slice(0, 500)}`)
    }
    const parsed = JSON.parse(bodyText) as Record<string, unknown>
    const text = typeof parsed.output_text === 'string' ? parsed.output_text : ''
    if (text) {
      await this.publish({
        kind: 'assistant_delta',
        runtimeId: 'claude',
        threadId: input.thread.guiThreadId,
        turnId: input.turnId,
        itemId: `claude-assistant-${input.turnId}`,
        text,
        createdAt: new Date().toISOString()
      })
    }
    const usage = usageFromModelRouterResponse(parsed)
    if (usage) {
      await this.publish({
        kind: 'usage',
        runtimeId: 'claude',
        threadId: input.thread.guiThreadId,
        turnId: input.turnId,
        usage,
        createdAt: new Date().toISOString()
      })
    }
    await this.publish({
      kind: 'turn_lifecycle',
      runtimeId: 'claude',
      threadId: input.thread.guiThreadId,
      turnId: input.turnId,
      state: 'completed',
      createdAt: new Date().toISOString()
    })
  }

  private spawnClaudeCliTurn(input: {
    thread: ClaudeStoredThread
    settings: AppSettingsV1
    runtime: ClaudeRuntimeSettingsV1
    workspace: string
    turnId: string
    text: string
    model?: string
    reasoningEffort?: string
  }): void {
    const args = claudeTurnArgs(input)
    const child = spawn(input.runtime.command, args, {
      cwd: input.workspace,
      env: claudeRuntimeEnv(this.options.env ?? process.env, input.settings, input.runtime)
    })
    this.activeTurns.set(input.turnId, {
      process: child,
      threadId: input.thread.guiThreadId,
      turnId: input.turnId
    })
    void this.consumeClaudeProcess(child, input).catch((error) => {
      void this.publishError(input.thread.guiThreadId, input.turnId, error)
    })
  }

  private async consumeClaudeProcess(
    child: ChildProcessWithoutNullStreams,
    input: {
      thread: ClaudeStoredThread
      runtime: ClaudeRuntimeSettingsV1
      turnId: string
    }
  ): Promise<void> {
    const assistantItemId = `claude-assistant-${input.turnId}`
    let assistantText = ''
    let stderr = ''
    const closePromise = new Promise<number | null>((resolve) => {
      child.once('close', resolve)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const lines = createInterface({ input: child.stdout })
    for await (const line of lines) {
      const parsed = parseJsonLine(line)
      if (!parsed) continue
      const type = stringValue(parsed.type)
      if (type === 'system' && stringValue(parsed.subtype) === 'init') {
        await this.publish({
          kind: 'runtime_status',
          runtimeId: 'claude',
          threadId: input.thread.guiThreadId,
          turnId: input.turnId,
          itemId: `claude-init-${input.turnId}`,
          phase: 'initialize_done',
          message: 'Claude Code initialized',
          metadata: {
            sessionId: stringValue(parsed.session_id),
            model: stringValue(parsed.model),
            version: stringValue(parsed.claude_code_version)
          },
          createdAt: new Date().toISOString()
        })
        continue
      }
      if (type === 'assistant') {
        const text = assistantTextFromMessage(parsed.message)
        if (text) {
          assistantText += text
          await this.publish({
            kind: 'assistant_delta',
            runtimeId: 'claude',
            threadId: input.thread.guiThreadId,
            turnId: input.turnId,
            itemId: assistantItemId,
            text,
            createdAt: new Date().toISOString()
          })
        }
        if (stringValue(parsed.error)) {
          await this.publishError(input.thread.guiThreadId, input.turnId, stringValue(parsed.error), 'CLAUDE_MESSAGE_ERROR')
        }
        continue
      }
      if (type === 'result') {
        const usage = usageFromClaudeResult(parsed)
        if (usage) {
          await this.publish({
            kind: 'usage',
            runtimeId: 'claude',
            threadId: input.thread.guiThreadId,
            turnId: input.turnId,
            usage,
            createdAt: new Date().toISOString()
          })
        }
        const resultText = stringValue(parsed.result)
        if (!assistantText && resultText) {
          await this.publish({
            kind: 'assistant_delta',
            runtimeId: 'claude',
            threadId: input.thread.guiThreadId,
            turnId: input.turnId,
            itemId: assistantItemId,
            text: resultText,
            createdAt: new Date().toISOString()
          })
        }
        const isError = parsed.is_error === true
        await this.publish({
          kind: 'turn_lifecycle',
          runtimeId: 'claude',
          threadId: input.thread.guiThreadId,
          turnId: input.turnId,
          state: isError ? 'failed' : 'completed',
          message: isError ? resultText || 'Claude Code turn failed.' : undefined,
          createdAt: new Date().toISOString()
        })
      }
    }

    const code = await closePromise
    this.activeTurns.delete(input.turnId)
    if (code && code !== 0) {
      await this.publishError(
        input.thread.guiThreadId,
        input.turnId,
        stderr.trim() || `Claude Code exited with status ${code}.`,
        'CLAUDE_PROCESS_FAILED'
      )
      await this.publish({
        kind: 'turn_lifecycle',
        runtimeId: 'claude',
        threadId: input.thread.guiThreadId,
        turnId: input.turnId,
        state: 'failed',
        message: stderr.trim() || `Claude Code exited with status ${code}.`,
        createdAt: new Date().toISOString()
      })
    }
  }

  private async publishError(
    threadId: string,
    turnId: string,
    error: unknown,
    code = 'CLAUDE_RUNTIME_ERROR'
  ): Promise<AgentRuntimeEvent> {
    return this.publish({
      kind: 'error',
      runtimeId: 'claude',
      threadId,
      turnId,
      itemId: `claude-error-${turnId}-${Date.now()}`,
      recoverable: true,
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      code,
      createdAt: new Date().toISOString()
    })
  }

  private async publish(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent> {
    const stored = await this.eventStore.append(event.threadId, event)
    await this.threadStore.updateLatestSeq(event.threadId, stored.seq)
    for (const subscriber of this.subscribers) {
      if (subscriber.closed || subscriber.threadId !== stored.threadId) continue
      subscriber.queue.push(stored.event)
      subscriber.wake?.()
    }
    return stored.event
  }
}

function modelRouterResponsesUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/responses`
}

function usageFromModelRouterResponse(payload: Record<string, unknown>): AgentRuntimeUsage | null {
  const usage = isRecord(payload.usage) ? payload.usage : null
  if (!usage) return null
  const inputTokens = numberValue(usage.input_tokens) ?? numberValue(usage.prompt_tokens)
  const outputTokens = numberValue(usage.output_tokens) ?? numberValue(usage.completion_tokens)
  const reasoningTokens = numberValue(usage.reasoning_output_tokens)
  const cacheReadTokens = numberValue(usage.cached_input_tokens)
  const totalTokens = numberValue(usage.total_tokens)
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens
  }
}

function claudeTurnArgs(input: {
  thread: ClaudeStoredThread
  runtime: ClaudeRuntimeSettingsV1
  turnId: string
  text: string
  model?: string
  reasoningEffort?: string
}): string[] {
  const model = (input.model || input.runtime.model).trim()
  return [
    '-p',
    '--bare',
    '--verbose',
    '--output-format',
    'stream-json',
    '--session-id',
    input.thread.claudeSessionId,
    ...(model ? ['--model', model] : []),
    ...(input.runtime.permissionMode ? ['--permission-mode', input.runtime.permissionMode] : []),
    ...reasoningArgs(input.reasoningEffort),
    ...input.runtime.extraArgs,
    input.text
  ]
}

function reasoningArgs(value: string | undefined): string[] {
  const effort = value?.trim()
  if (!effort || effort === 'off') return []
  if (effort === 'xhigh' || effort === 'max') return ['--effort', effort]
  if (effort === 'low' || effort === 'medium' || effort === 'high') return ['--effort', effort]
  return []
}

export function claudeRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  settings: AppSettingsV1,
  runtime: ClaudeRuntimeSettingsV1
): NodeJS.ProcessEnv {
  const env = { ...baseEnv }
  const configDir = runtime.claudeHome.trim()
  if (configDir) env.CLAUDE_CONFIG_DIR = expandHome(configDir)
  for (const key of UPSTREAM_PROVIDER_SECRET_ENVS) {
    delete env[key]
  }
  for (const key of Object.keys(env)) {
    if (isUpstreamProviderConfigEnv(key)) delete env[key]
  }
  const router = resolveRuntimeModelRouterSettings(settings)
  const baseUrl = claudeAnthropicBaseUrl(router.baseUrl)
  if (!baseUrl) throw new Error('Claude Model Router base URL is required.')
  if (!isLocalHttpUrl(baseUrl)) throw new Error('Claude Model Router base URL must be local.')
  if (!router.apiKey) throw new Error('Claude Model Router runtime API key is required.')
  env.ANTHROPIC_BASE_URL = baseUrl
  env.ANTHROPIC_API_KEY = router.apiKey
  env.ANTHROPIC_MODEL = router.model
  env.ANTHROPIC_SMALL_FAST_MODEL = router.model
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

function claudeAnthropicBaseUrl(raw: string): string {
  const baseUrl = raw.trim().replace(/\/+$/, '')
  return baseUrl.endsWith('/v1') ? baseUrl.slice(0, -3) : baseUrl
}

function appendNoProxyLoopbacks(value: string | undefined): string {
  const required = ['127.0.0.1', 'localhost', '::1']
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const existing = new Set(parts.map((part) => part.toLowerCase()))
  for (const entry of required) {
    if (!existing.has(entry.toLowerCase())) parts.push(entry)
  }
  return parts.join(',')
}

function isLocalHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

function isUpstreamProviderConfigEnv(key: string): boolean {
  if (key === 'MODEL_PROVIDER') return true
  if (/^ANTHROPIC_(?:BEDROCK|VERTEX|FOUNDRY|AWS|DEFAULT|CUSTOM)_[A-Z0-9_]+$/.test(key)) return true
  if (/^ANTHROPIC_DEFAULT_[A-Z0-9_]+_MODEL$/.test(key)) return true
  return UPSTREAM_PROVIDER_ENV_PREFIXES.some((prefix) =>
    UPSTREAM_PROVIDER_CONFIG_ENV_SUFFIXES.some((suffix) => key === `${prefix}_${suffix}`)
  )
}

function storedThreadToRuntimeThread(thread: ClaudeStoredThread, model?: string): AgentRuntimeThread {
  return {
    id: thread.guiThreadId,
    runtimeId: 'claude',
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    workspace: thread.workspace,
    archived: thread.archived,
    model,
    status: activeStatus(thread.latestTurnId),
    latestTurnId: thread.latestTurnId,
    backendThreadId: thread.claudeSessionId
  }
}

function activeStatus(_turnId: string | undefined): string | undefined {
  return undefined
}

function buildThreadDetail(thread: ClaudeStoredThread, events: AgentRuntimeEvent[]): AgentRuntimeThreadDetail {
  const turns = new Map<string, AgentRuntimeTurn>()
  const items = new Map<string, AgentRuntimeItem>()
  let usage: AgentRuntimeUsage | undefined
  for (const event of events) {
    const turnId = event.turnId
    if (turnId && !turns.has(turnId)) {
      turns.set(turnId, {
        id: turnId,
        threadId: thread.guiThreadId,
        status: 'running',
        items: []
      })
    }
    if (event.kind === 'turn_lifecycle' && turnId) {
      const turn = turns.get(turnId)
      if (turn) {
        turn.status = lifecycleToTurnStatus(event.state)
        if (event.state === 'started') turn.startedAt = event.createdAt
        if (event.state !== 'started') turn.completedAt = event.createdAt
      }
    } else if (event.kind === 'user_message') {
      items.set(event.itemId, {
        id: event.itemId,
        turnId,
        kind: 'user_message',
        text: event.displayText ?? event.text,
        createdAt: event.createdAt
      })
    } else if (event.kind === 'assistant_delta') {
      const existing = items.get(event.itemId)
      items.set(event.itemId, {
        id: event.itemId,
        turnId,
        kind: 'assistant_message',
        text: `${existing?.text ?? ''}${event.text}`,
        createdAt: existing?.createdAt ?? event.createdAt
      })
    } else if (event.kind === 'tool_event') {
      items.set(event.itemId, {
        id: event.itemId,
        turnId,
        kind: 'tool',
        summary: event.summary,
        status: event.status,
        toolKind: event.toolKind,
        detail: event.detail,
        meta: event.meta,
        createdAt: event.createdAt
      })
    } else if (event.kind === 'item_snapshot') {
      items.set(event.item.id, event.item)
    } else if (event.kind === 'error') {
      items.set(event.itemId ?? `claude-error-${items.size}`, {
        id: event.itemId ?? `claude-error-${items.size}`,
        turnId,
        kind: 'system',
        text: event.message,
        status: 'error',
        meta: { code: event.code, detail: event.detail },
        createdAt: event.createdAt
      })
    } else if (event.kind === 'usage') {
      usage = event.usage
    }
  }
  const itemList = [...items.values()]
  for (const turn of turns.values()) {
    turn.items = itemList.filter((item) => item.turnId === turn.id)
  }
  return {
    ...storedThreadToRuntimeThread(thread),
    latestSeq: Math.max(0, ...events.map((event) => event.seq ?? 0)),
    latestTurnId: thread.latestTurnId,
    turns: [...turns.values()],
    items: itemList,
    usage
  }
}

function lifecycleToTurnStatus(state: 'started' | 'completed' | 'failed' | 'aborted' | 'steered'): AgentRuntimeTurn['status'] {
  if (state === 'started') return 'running'
  return state
}

class ClaudeThreadStore {
  private readonly filePath: string
  private transactionQueue: Promise<void> = Promise.resolve()

  constructor(options: { rootDir: string }) {
    this.filePath = join(options.rootDir, 'threads.json')
  }

  async list(options: { includeArchived?: boolean } = {}): Promise<ClaudeStoredThread[]> {
    const snapshot = await this.load()
    const threads = options.includeArchived ? snapshot : snapshot.filter((thread) => !thread.archived)
    return [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  async get(guiThreadId: string): Promise<ClaudeStoredThread | null> {
    const id = guiThreadId.trim()
    if (!id) return null
    return (await this.load()).find((thread) => thread.guiThreadId === id) ?? null
  }

  async upsert(input: {
    guiThreadId?: string
    claudeSessionId: string
    workspace?: string
    title?: string
    archived?: boolean
    latestSeq?: number
    latestTurnId?: string
    latestUserMessageId?: string
  }): Promise<ClaudeStoredThread> {
    return this.enqueue(async () => {
      const snapshot = await this.load()
      const guiThreadId = input.guiThreadId?.trim() || input.claudeSessionId.trim()
      const existingIndex = snapshot.findIndex((thread) =>
        thread.guiThreadId === guiThreadId || thread.claudeSessionId === input.claudeSessionId.trim()
      )
      const existing = existingIndex >= 0 ? snapshot[existingIndex] : null
      const now = new Date().toISOString()
      const next: ClaudeStoredThread = {
        guiThreadId,
        claudeSessionId: input.claudeSessionId.trim(),
        runtimeId: 'claude',
        workspace: nonEmpty(input.workspace, existing?.workspace ?? ''),
        title: nonEmpty(input.title, existing?.title ?? 'Claude thread'),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        archived: input.archived ?? existing?.archived ?? false,
        latestSeq: typeof input.latestSeq === 'number'
          ? Math.max(0, Math.floor(input.latestSeq))
          : existing?.latestSeq ?? 0,
        ...(input.latestTurnId !== undefined
          ? { latestTurnId: input.latestTurnId }
          : existing?.latestTurnId ? { latestTurnId: existing.latestTurnId } : {}),
        ...(input.latestUserMessageId !== undefined
          ? { latestUserMessageId: input.latestUserMessageId }
          : existing?.latestUserMessageId ? { latestUserMessageId: existing.latestUserMessageId } : {})
      }
      const nextSnapshot = [...snapshot]
      if (existingIndex >= 0) nextSnapshot[existingIndex] = next
      else nextSnapshot.push(next)
      await this.save(nextSnapshot)
      return next
    })
  }

  async archive(guiThreadId: string): Promise<void> {
    const existing = await this.get(guiThreadId)
    if (!existing) return
    await this.upsert({
      guiThreadId: existing.guiThreadId,
      claudeSessionId: existing.claudeSessionId,
      archived: true
    })
  }

  async updateLatestSeq(guiThreadId: string, latestSeq: number): Promise<void> {
    const existing = await this.get(guiThreadId)
    if (!existing) return
    await this.upsert({
      guiThreadId: existing.guiThreadId,
      claudeSessionId: existing.claudeSessionId,
      latestSeq
    })
  }

  private async load(): Promise<ClaudeStoredThread[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as { threads?: unknown }
      return Array.isArray(parsed.threads)
        ? parsed.threads.map(normalizeThread).filter((thread): thread is ClaudeStoredThread => Boolean(thread))
        : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async save(threads: ClaudeStoredThread[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmpPath, `${JSON.stringify({ version: 1, threads }, null, 2)}\n`, 'utf8')
    await rename(tmpPath, this.filePath)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transactionQueue.then(task, task)
    this.transactionQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

class ClaudeEventStore {
  private readonly rootDir: string
  private readonly threadQueues = new Map<string, Promise<void>>()

  constructor(options: { rootDir: string }) {
    this.rootDir = options.rootDir
  }

  async append(threadId: string, event: AgentRuntimeEvent): Promise<ClaudeStoredEvent> {
    const normalizedThreadId = requireNonEmpty(threadId || event.threadId, 'Claude thread id is required.')
    return this.enqueueForThread(normalizedThreadId, async () => {
      const existing = await this.read(normalizedThreadId, { includeAll: true })
      const seq = Math.max(0, ...existing.map((item) => item.seq)) + 1
      const stored: ClaudeStoredEvent = {
        seq,
        threadId: normalizedThreadId,
        createdAt: new Date().toISOString(),
        event: {
          ...event,
          runtimeId: 'claude',
          threadId: normalizedThreadId,
          seq
        }
      }
      await mkdir(dirname(this.eventsPath(normalizedThreadId)), { recursive: true })
      await appendFile(this.eventsPath(normalizedThreadId), `${JSON.stringify(stored)}\n`, 'utf8')
      return stored
    })
  }

  async read(
    threadId: string,
    options: { sinceSeq?: number; includeAll?: boolean } = {}
  ): Promise<ClaudeStoredEvent[]> {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) return []
    let raw = ''
    try {
      raw = await readFile(this.eventsPath(normalizedThreadId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const sinceSeq = options.includeAll ? 0 : Math.max(0, Math.floor(options.sinceSeq ?? 0))
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseStoredEvent)
      .filter((event): event is ClaudeStoredEvent => Boolean(event))
      .filter((event) => event.threadId === normalizedThreadId)
      .filter((event) => event.seq > sinceSeq)
      .sort((a, b) => a.seq - b.seq)
  }

  private eventsPath(threadId: string): string {
    return join(this.rootDir, 'events', `${Buffer.from(threadId, 'utf8').toString('base64url')}.jsonl`)
  }

  private enqueueForThread<T>(threadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.threadQueues.get(threadId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const next = run.then(() => undefined, () => undefined)
    this.threadQueues.set(threadId, next)
    void next.then(() => {
      if (this.threadQueues.get(threadId) === next) this.threadQueues.delete(threadId)
    })
    return run
  }
}

function normalizeThread(raw: unknown): ClaudeStoredThread | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const guiThreadId = stringValue(record.guiThreadId)
  const claudeSessionId = stringValue(record.claudeSessionId)
  if (!guiThreadId || !claudeSessionId) return null
  return {
    guiThreadId,
    claudeSessionId,
    runtimeId: 'claude',
    workspace: stringValue(record.workspace),
    title: stringValue(record.title) || 'Claude thread',
    createdAt: stringValue(record.createdAt) || new Date(0).toISOString(),
    updatedAt: stringValue(record.updatedAt) || new Date(0).toISOString(),
    archived: record.archived === true,
    latestSeq: numberValue(record.latestSeq),
    ...(stringValue(record.latestTurnId) ? { latestTurnId: stringValue(record.latestTurnId) } : {}),
    ...(stringValue(record.latestUserMessageId) ? { latestUserMessageId: stringValue(record.latestUserMessageId) } : {})
  }
}

function parseStoredEvent(line: string): ClaudeStoredEvent | null {
  try {
    const parsed = JSON.parse(line) as ClaudeStoredEvent
    if (!parsed?.event?.threadId || typeof parsed.seq !== 'number') return null
    return parsed
  } catch {
    return null
  }
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assistantTextFromMessage(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const content = (raw as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  return content
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
      const record = entry as Record<string, unknown>
      return record.type === 'text' ? stringValue(record.text) : ''
    })
    .filter(Boolean)
    .join('\n')
}

function usageFromClaudeResult(record: Record<string, unknown>): AgentRuntimeUsage | undefined {
  const usage = record.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return undefined
  const usageRecord = usage as Record<string, unknown>
  const inputTokens = numberValue(usageRecord.input_tokens) + numberValue(usageRecord.cache_read_input_tokens)
  const outputTokens = numberValue(usageRecord.output_tokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens: numberValue(usageRecord.cache_read_input_tokens),
    cacheWriteTokens: numberValue(usageRecord.cache_creation_input_tokens),
    costUsd: typeof record.total_cost_usd === 'number' ? record.total_cost_usd : undefined
  }
}

function titleFromPrompt(text: string): string {
  const first = text.trim().replace(/\s+/g, ' ').slice(0, 80)
  return first || 'Claude thread'
}

function failure(error: unknown, code: string): ClaudeRuntimeFailure {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    code,
    recoverable: true
  }
}

function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function requireNonEmpty(value: string, message: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(message)
  return trimmed
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0
}
