import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { CodexRuntimeService } from './codex-service'
import { CodexEventStore } from './codex-event-store'
import { CodexThreadStore } from './codex-thread-store'
import {
  CODEX_MAIN_IPC_CHANNELS,
  type CodexAppServerClientEvent,
  type CodexAppServerJsonRpcClient,
  type CodexAppServerJsonRpcClientOptions
} from './codex-app-server-client'
import type { CodexAppServerPendingRequest } from './app-server/request-registry'
import type { CodexThreadEventPayload } from './codex-runtime-api'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function failingClient(): CodexAppServerJsonRpcClient {
  return {
    connect: vi.fn(async () => { throw new Error('app-server offline') }),
    listThreads: vi.fn(async () => { throw new Error('app-server offline') }),
    readThread: vi.fn(async () => { throw new Error('app-server offline') }),
    startThread: vi.fn(async () => { throw new Error('app-server offline') }),
    startTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    interruptTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    steerTurn: vi.fn(async () => { throw new Error('app-server offline') }),
    request: vi.fn(async () => { throw new Error('app-server offline') }),
    subscribe: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        /* empty */
      }
    })),
    stop: vi.fn(async () => undefined)
  } as unknown as CodexAppServerJsonRpcClient
}

function controllableClient(): CodexAppServerJsonRpcClient {
  return {
    connect: vi.fn(async () => ({})),
    listThreads: vi.fn(async () => ({ threads: [] })),
    readThread: vi.fn(async () => ({ thread: { id: 'thread-1', turns: [] } })),
    startThread: vi.fn(async () => ({ thread: { id: 'thread-1' } })),
    startTurn: vi.fn(async () => ({ turn: { id: 'turn-1' } })),
    interruptTurn: vi.fn(async () => ({})),
    steerTurn: vi.fn(async () => ({})),
    request: vi.fn(async () => ({})),
    subscribe: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        /* empty */
      }
    })),
    stop: vi.fn(async () => undefined)
  } as unknown as CodexAppServerJsonRpcClient
}

function clientWithQueuedEvents(): {
  client: CodexAppServerJsonRpcClient
  push: (event: CodexAppServerClientEvent) => void
  close: () => void
} {
  const events: CodexAppServerClientEvent[] = []
  let wake: (() => void) | null = null
  let closed = false
  const wakeReader = (): void => {
    const current = wake
    wake = null
    current?.()
  }
  async function* stream(): AsyncIterable<CodexAppServerClientEvent> {
    while (!closed || events.length > 0) {
      if (events.length > 0) {
        yield events.shift() as CodexAppServerClientEvent
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  }
  const client = {
    ...controllableClient(),
    subscribe: vi.fn(() => stream())
  } as unknown as CodexAppServerJsonRpcClient
  return {
    client,
    push: (event) => {
      events.push(event)
      wakeReader()
    },
    close: () => {
      closed = true
      wakeReader()
    }
  }
}

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'deepseek-gui-codex-service-'))
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('CodexRuntimeService storage fallback', () => {
  it('lists stored Codex threads when app-server list is unavailable', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({
        id: 'codex-thread-1',
        title: 'Stored Codex',
        workspace: '/tmp/workspace'
      })]
    })
  })

  it('includes archived stored Codex threads when requested', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'codex-active',
      codexThreadId: 'codex-active',
      workspace: '/tmp/workspace',
      title: 'Active Codex'
    })
    await threadStore.upsert({
      guiThreadId: 'codex-archived',
      codexThreadId: 'codex-archived',
      workspace: '/tmp/workspace',
      title: 'Archived Codex',
      archived: true
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.listThreads()).resolves.toEqual({
      ok: true,
      threads: [expect.objectContaining({ id: 'codex-active', archived: false })]
    })
    await expect(service.listThreads({ includeArchived: true })).resolves.toEqual({
      ok: true,
      threads: expect.arrayContaining([
        expect.objectContaining({ id: 'codex-active', archived: false }),
        expect.objectContaining({ id: 'codex-archived', archived: true })
      ])
    })
  })

  it('replays stored normalized events as chat blocks when app-server read is unavailable', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      userMessage: {
        itemId: 'user-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      deltas: [{ kind: 'agent_message', text: 'hi there' }]
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        blocks: [
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello' }),
          expect.objectContaining({ kind: 'assistant', text: 'hi there' })
        ]
      })
    })
  })

  it('treats stored turns without an active runtime as failed after restart', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => failingClient()
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 1,
        latestTurnId: 'turn-1',
        threadStatus: 'failed',
        blocks: [expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' })]
      })
    })
  })

  it('prefers stored terminal turn state when app-server live read still reports running', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      userMessage: {
        itemId: 'user-1',
        turnId: 'turn-1',
        text: 'hello'
      }
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnId: 'turn-1',
      turnComplete: true
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockResolvedValue({
      thread: {
        id: 'codex-thread-1',
        turns: [{
          id: 'turn-1',
          status: 'running',
          items: [{
            id: 'user-1',
            type: 'userMessage',
            content: [{ type: 'text', text: 'hello' }]
          }]
        }]
      }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('codex-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: 2,
        latestTurnId: 'turn-1',
        threadStatus: 'completed',
        blocks: [expect.objectContaining({ kind: 'user', id: 'user-1', turnId: 'turn-1', text: 'hello' })]
      })
    })
  })

  it('returns an empty stored detail for an unmaterialized Codex thread', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Draft Codex thread'
    })
    const client = controllableClient()
    vi.mocked(client.readThread).mockRejectedValue(
      new Error('thread codex-thread-1 is not materialized yet; includeTurns is unavailable before first user message')
    )
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.readThread('gui-thread-1')).resolves.toEqual({
      ok: true,
      detail: { blocks: [], latestSeq: 0 }
    })
    expect(client.readThread).toHaveBeenCalledWith({ threadId: 'codex-thread-1', includeTurns: true })
  })

  it('keeps the app-server client alive when readThread falls back during an active turn', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Active Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startTurn).mockResolvedValue({
      turn: { id: 'turn-1', userMessageItemId: 'user-1' }
    })
    vi.mocked(client.readThread).mockRejectedValue(
      new Error('thread codex-thread-1 is not materialized yet; includeTurns is unavailable while the turn is starting')
    )
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello from IM'
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })
    await expect(service.readThread('gui-thread-1')).resolves.toEqual({
      ok: true,
      detail: expect.objectContaining({
        latestSeq: expect.any(Number),
        latestTurnId: 'turn-1',
        blocks: expect.arrayContaining([
          expect.objectContaining({ kind: 'user', id: 'user-1', text: 'hello from IM' })
        ])
      })
    })
    expect(client.stop).not.toHaveBeenCalled()

    await expect(service.interruptTurn('gui-thread-1', 'turn-1')).resolves.toMatchObject({ ok: true })
    expect(client.interruptTurn).toHaveBeenCalledWith({
      threadId: 'codex-thread-1',
      turnId: 'turn-1'
    })
  })

  it('replays stored normalized events without starting app-server JSON-RPC', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      deltas: [{ kind: 'agent_message', text: 'one' }]
    })
    await eventStore.append('codex-thread-1', {
      threadId: 'codex-thread-1',
      turnComplete: true
    })
    const createClient = vi.fn(() => failingClient())
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient
    })

    await expect(service.readStoredEvents('codex-thread-1', 1)).resolves.toEqual([
      { threadId: 'codex-thread-1', seq: 2, turnComplete: true }
    ])
    expect(createClient).not.toHaveBeenCalled()
  })
})

describe('CodexRuntimeService compatibility operations', () => {
  it('shares in-flight app-server client creation across concurrent connects', async () => {
    const settingsGate = deferred<AppSettingsV1>()
    const firstClient = controllableClient()
    const secondClient = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      settings: () => settingsGate.promise,
      sink: { send: vi.fn() },
      createClient
    })

    const firstConnect = service.connect()
    const secondConnect = service.connect()
    await Promise.resolve()
    expect(createClient).not.toHaveBeenCalled()

    settingsGate.resolve(settings())

    await expect(Promise.all([firstConnect, secondConnect])).resolves.toEqual([
      { ok: true, info: {} },
      { ok: true, info: {} }
    ])
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(firstClient.subscribe).toHaveBeenCalledTimes(1)
    expect(secondClient.subscribe).not.toHaveBeenCalled()
  })

  it('returns recoverable failures when app-server requests fail', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => failingClient()
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
      message: 'app-server offline',
      recoverable: true
    })
  })

  it('recreates the app-server client after a recoverable failure', async () => {
    const firstClient = failingClient()
    const secondClient = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(firstClient)
      .mockReturnValueOnce(secondClient)
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient
    })

    await expect(service.connect()).resolves.toEqual({
      ok: false,
      message: 'app-server offline',
      recoverable: true
    })
    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })

    expect(createClient).toHaveBeenCalledTimes(2)
    expect(firstClient.stop).toHaveBeenCalled()
  })

  it('recreates the app-server client after the event stream closes asynchronously', async () => {
    const first = clientWithQueuedEvents()
    const secondClient = controllableClient()
    const createClient = vi.fn()
      .mockReturnValueOnce(first.client)
      .mockReturnValueOnce(secondClient)
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient
    })

    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })
    first.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })
    first.close()
    await vi.waitFor(() => {
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'error' })
    })

    await expect(service.connect()).resolves.toEqual({ ok: true, info: {} })
    expect(createClient).toHaveBeenCalledTimes(2)
    expect(secondClient.connect).toHaveBeenCalled()
  })

  it('marks active turns failed when the app-server event stream closes', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    sink.send.mockClear()

    queued.push({
      type: 'closed',
      channel: CODEX_MAIN_IPC_CHANNELS.closed,
      reason: 'error'
    })

    await vi.waitFor(() => {
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: expect.objectContaining({
          threadId: 'thread-1',
          turnId: 'turn-1',
          runtimeError: expect.objectContaining({
            code: 'runtime_disconnected',
            severity: 'error'
          })
        })
      })
    })
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
      event: expect.objectContaining({
        threadId: 'thread-1',
        turnId: 'turn-1',
        runtimeStatus: expect.objectContaining({ phase: 'turn_done' })
      })
    })
    expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.closed, { reason: 'error' })
    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toMatchObject({
      ok: false,
      code: 'turn_not_running'
    })
    queued.close()
  })

  it('initializes the app-server session before thread operations', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Direct UI thread' })).resolves.toMatchObject({
      ok: true,
      thread: expect.objectContaining({ id: 'thread-1' })
    })

    expect(client.connect).toHaveBeenCalled()
    expect(client.startThread).toHaveBeenCalled()
    expect(vi.mocked(client.connect).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(client.startThread).mock.invocationCallOrder[0]
    )
  })

  it('forces Codex thread starts through the managed Model Router provider', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        provider: {
          apiKey: 'sk-user-provider',
          baseUrl: 'https://api.external-provider.test/v1',
          providers: [{
            id: 'external-provider',
            name: 'External Provider',
            apiKey: 'sk-profile',
            baseUrl: 'https://profile.external-provider.test/v1',
            endpointFormat: 'responses',
            models: ['external-model']
          }]
        },
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            profile: 'external-profile',
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({
      title: 'Router-only thread',
      model: 'external-payload-model',
      modelProvider: 'external-payload-provider',
      profile: 'external-payload-profile',
      baseUrl: 'https://payload.external-provider.test/v1',
      apiKey: 'sk-payload'
    } as unknown as Parameters<CodexRuntimeService['startThread']>[0])).resolves.toMatchObject({
      ok: true
    })

    const params = vi.mocked(client.startThread).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(params).not.toEqual(expect.objectContaining({
      profile: expect.anything(),
      baseUrl: expect.anything(),
      apiKey: expect.anything()
    }))
    expect(params).not.toEqual(expect.objectContaining({
      model: 'external-payload-model',
      modelProvider: 'external-payload-provider'
    }))
    expect(params).not.toEqual(expect.objectContaining({
      model: 'external-runtime-model',
      modelProvider: 'external-runtime-provider'
    }))
  })

  it('launches Codex app-server with the managed Codex home rather than settings codexHome', async () => {
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'service-managed-codex-home-'))
    const persistedCodexHome = await mkdtemp(join(tmpdir(), 'service-global-codex-home-'))
    const launches: CodexAppServerJsonRpcClientOptions[] = []
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      launches.push(options)
      return controllableClient()
    })
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome: persistedCodexHome
          }
        }
      }),
      sink: { send: vi.fn() },
      managedCodexHome,
      createClient
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })

    const launch = launches[0]
    expect(launch?.env?.CODEX_HOME).toBe(managedCodexHome)
    expect(launch?.env?.CODEX_HOME).not.toBe(persistedCodexHome)
  })

  it('forces Codex turns through the managed Model Router alias', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            profile: 'external-profile',
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'hello',
      model: 'external-payload-model',
      profile: 'external-payload-profile',
      baseUrl: 'https://payload.external-provider.test/v1',
      apiKey: 'sk-payload'
    } as unknown as Parameters<CodexRuntimeService['startTurn']>[0])).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    const params = vi.mocked(client.startTurn).mock.calls[0]?.[0] ?? {}
    expect(params).toEqual(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(params).not.toEqual(expect.objectContaining({
      modelProvider: expect.anything(),
      profile: expect.anything(),
      baseUrl: expect.anything(),
      apiKey: expect.anything()
    }))
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-payload-model' }))
    expect(params).not.toEqual(expect.objectContaining({ model: 'external-runtime-model' }))
  })

  it('forces rematerialized Codex threads through the managed Model Router provider', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Recovered Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => ({
        ...settings(),
        agents: {
          ...settings().agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            model: 'external-runtime-model',
            modelProvider: 'external-runtime-provider'
          }
        }
      }),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({
      threadId: 'gui-thread-1',
      text: 'hello',
      model: 'external-payload-model'
    })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      modelProvider: DEFAULT_MODEL_ROUTER_PROVIDER_ID
    }))
    expect(client.startThread).not.toHaveBeenCalledWith(expect.objectContaining({
      model: 'external-runtime-model',
      modelProvider: 'external-runtime-provider'
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'codex-thread-old',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'codex-thread-new',
      model: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS
    }))
  })

  it('passes explicit app-server reasoning params through thread and turn starts', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startThread({ title: 'Reasoning thread' })).resolves.toMatchObject({
      ok: true
    })
    await expect(service.startTurn({
      threadId: 'thread-1',
      text: 'think carefully',
      reasoningEffort: 'high'
    })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      config: {
        model_reasoning_effort: 'medium',
        show_raw_agent_reasoning: true,
        model_reasoning_summary: 'auto'
      }
    }))
    expect(client.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      effort: 'high',
      summary: 'auto'
    }))
  })

  it('rematerializes an empty stored GUI thread when its app-server thread is missing', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Recovered Codex'
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'codex-thread-old' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'DeepSeek GUI',
      ephemeral: false
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.runtimeStatus?.phase).filter(Boolean)).toEqual([
      'process_start',
      'initialize_start',
      'initialize_done',
      'turn_start_sent'
    ])
    expect(events.at(-1)?.event).toMatchObject({
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-1',
        text: 'hello'
      }
    })
  })

  it('rematerializes an empty stored GUI thread with only runtime status history', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Status-only Codex'
    })
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      runtimeStatus: {
        itemId: 'status-1',
        phase: 'thread_start_done',
        message: 'Codex thread ready'
      }
    })
    await threadStore.updateLatestSeq('gui-thread-1', 1)
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'codex-thread-old' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'DeepSeek GUI',
      ephemeral: false
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('materializes a missing GUI thread mapping when app-server rejects the optimistic thread id', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({ threadId: 'gui-thread-1' }))
    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'DeepSeek GUI',
      ephemeral: false
    }))
    expect(client.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({ threadId: 'codex-thread-new' }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('rematerializes a stored GUI thread in place when local event history is non-empty', async () => {
    const storageRoot = await tempRoot()
    const threadStore = new CodexThreadStore({ rootDir: storageRoot })
    await threadStore.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-old',
      workspace: '/tmp/workspace',
      title: 'Existing Codex'
    })
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-existing',
        turnId: 'turn-existing',
        createdAt: '2026-06-11T00:00:00.000Z',
        text: 'previous context'
      }
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-1'
    })

    expect(client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/tmp/workspace',
      serviceName: 'DeepSeek GUI',
      ephemeral: false
    }))
    await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
    const events = await new CodexEventStore({ rootDir: storageRoot }).read('gui-thread-1', { includeAll: true })
    expect(events.map((item) => item.event.userMessage?.text).filter(Boolean)).toEqual([
      'previous context',
      'hello'
    ])
  })

  it.each([
    {
      name: 'assistant delta',
      event: {
        threadId: 'gui-thread-1',
        deltas: [{ kind: 'agent_message' as const, text: 'previous response' }]
      }
    },
    {
      name: 'tool event',
      event: {
        threadId: 'gui-thread-1',
        tool: {
          itemId: 'tool-existing',
          summary: 'Previous tool',
          status: 'success' as const
        }
      }
    },
    {
      name: 'runtime error',
      event: {
        threadId: 'gui-thread-1',
        runtimeError: {
          itemId: 'error-existing',
          message: 'previous failure'
        }
      }
    }
  ] satisfies Array<{ name: string; event: CodexThreadEventPayload }>)(
    'rematerializes a stored GUI thread when local $name history is non-empty',
    async ({ event }) => {
      const storageRoot = await tempRoot()
      const threadStore = new CodexThreadStore({ rootDir: storageRoot })
      await threadStore.upsert({
        guiThreadId: 'gui-thread-1',
        codexThreadId: 'codex-thread-old',
        workspace: '/tmp/workspace',
        title: 'Existing Codex'
      })
      await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', event)
      const client = controllableClient()
      vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
      vi.mocked(client.startTurn)
        .mockRejectedValueOnce(new Error('thread not found: codex-thread-old'))
        .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
      const service = new CodexRuntimeService({
        settings: async () => settings(),
        sink: { send: vi.fn() },
        storageRoot,
        createClient: () => client
      })

      await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
        ok: true,
        threadId: 'gui-thread-1',
        turnId: 'turn-1'
      })

      expect(client.startThread).toHaveBeenCalled()
      await expect(threadStore.get('gui-thread-1')).resolves.toMatchObject({
        guiThreadId: 'gui-thread-1',
        codexThreadId: 'codex-thread-new'
      })
    }
  )

  it('materializes a missing GUI thread mapping when local event history is non-empty', async () => {
    const storageRoot = await tempRoot()
    await new CodexEventStore({ rootDir: storageRoot }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      userMessage: {
        itemId: 'user-existing',
        turnId: 'turn-existing',
        createdAt: '2026-06-11T00:00:00.000Z',
        text: 'previous context'
      }
    })
    const client = controllableClient()
    vi.mocked(client.startThread).mockResolvedValue({ thread: { id: 'codex-thread-new', cwd: '/tmp/workspace' } })
    vi.mocked(client.startTurn)
      .mockRejectedValueOnce(new Error('thread not found: gui-thread-1'))
      .mockResolvedValueOnce({ turn: { id: 'turn-1', userMessageItemId: 'user-1' } })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'gui-thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'gui-thread-1',
      turnId: 'turn-1'
    })

    expect(client.startThread).toHaveBeenCalled()
    await expect(new CodexThreadStore({ rootDir: storageRoot }).get('gui-thread-1')).resolves.toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new'
    })
  })

  it('returns the app-server user message item id from Codex turn start', async () => {
    const client = controllableClient()
    vi.mocked(client.startTurn).mockResolvedValueOnce({
      turn: { id: 'turn-1', userMessageItemId: 'user-from-app-server' }
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      threadId: 'thread-1',
      turnId: 'turn-1',
      userMessageItemId: 'user-from-app-server'
    })
  })

  it('treats compact as an explicit no-op without starting app-server JSON-RPC', async () => {
    const createClient = vi.fn(() => controllableClient())
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient
    })

    await expect(service.compactThread('thread-1')).resolves.toEqual({ ok: true })

    expect(createClient).not.toHaveBeenCalled()
  })

  it('fails fork and resume closed with structured recoverable errors', async () => {
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => controllableClient()
    })

    await expect(service.forkThread('thread-1')).resolves.toEqual({
      ok: false,
      code: 'capability_unavailable',
      message: 'Codex thread fork is not supported yet.',
      recoverable: true
    })
    await expect(service.resumeSession('session-1')).resolves.toEqual({
      ok: false,
      code: 'not_implemented',
      message: 'Codex session resume is not supported yet.',
      recoverable: true
    })
  })

  it('interrupts then closes the app-server session when discard is requested', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    await expect(service.interruptTurn('thread-1', 'turn-1', { discard: true })).resolves.toEqual({ ok: true })

    expect(client.interruptTurn).toHaveBeenCalledWith({ threadId: 'thread-1', turnId: 'turn-1' })
    expect(client.stop).toHaveBeenCalled()
  })

  it('rejects stale Codex control targets before calling app-server', async () => {
    const client = controllableClient()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    vi.mocked(client.interruptTurn).mockClear()
    vi.mocked(client.steerTurn).mockClear()

    await expect(service.interruptTurn('thread-1', 'old-turn')).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'Codex turn old-turn is not the active turn for thread thread-1.',
      recoverable: true
    })
    await expect(service.steerTurn({
      threadId: 'thread-1',
      turnId: 'old-turn',
      text: 'continue'
    })).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'Codex turn old-turn is not the active turn for thread thread-1.',
      recoverable: true
    })

    expect(client.interruptTurn).not.toHaveBeenCalled()
    expect(client.steerTurn).not.toHaveBeenCalled()
  })

  it('clears the active Codex turn after a terminal runtime event', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })
    await vi.waitFor(() => {
      expect(sink.send).toHaveBeenCalledWith(CODEX_MAIN_IPC_CHANNELS.event, {
        event: { threadId: 'thread-1', turnId: 'turn-1', turnComplete: true }
      })
    })
    vi.mocked(queued.client.interruptTurn).mockClear()

    await expect(service.interruptTurn('thread-1', 'turn-1')).resolves.toEqual({
      ok: false,
      code: 'turn_not_running',
      message: 'No active Codex turn is running for thread thread-1.',
      recoverable: true
    })
    expect(queued.client.interruptTurn).not.toHaveBeenCalled()
    queued.close()
  })

  it('emits latency phase runtime status events around a Codex turn', async () => {
    const queued = clientWithQueuedEvents()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'hi' }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(() => {
      const phases = sink.send.mock.calls
        .map((call) => call[1]?.event?.runtimeStatus?.phase)
        .filter(Boolean)
      expect(phases).toEqual(expect.arrayContaining([
        'process_start',
        'initialize_start',
        'initialize_done',
        'turn_start_sent',
        'first_delta',
        'turn_done'
      ]))
    })
    const firstDelta = sink.send.mock.calls.find((call) => call[1]?.event?.runtimeStatus?.phase === 'first_delta')
    const turnDone = sink.send.mock.calls.find((call) => call[1]?.event?.runtimeStatus?.phase === 'turn_done')
    expect(firstDelta?.[1].event.runtimeStatus.latencyMs).toEqual(expect.any(Number))
    expect(turnDone?.[1].event.runtimeStatus.latencyMs).toEqual(expect.any(Number))
    queued.close()
  })

  it('records Codex token usage notifications for cache-aware usage summaries', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot: rootDir,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'thread/tokenUsage/updated',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          tokenUsage: {
            total: {
              inputTokens: 120,
              cachedInputTokens: 90,
              outputTokens: 20,
              reasoningOutputTokens: 5,
              totalTokens: 145
            },
            last: {
              inputTokens: 120,
              cachedInputTokens: 90,
              outputTokens: 20,
              reasoningOutputTokens: 5,
              totalTokens: 145
            },
            modelContextWindow: 128000
          }
        }
      }
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(async () => {
      await expect(service.usage({
        groupBy: 'thread',
        threadId: 'thread-1',
        timezone: 'UTC'
      })).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [{
          threadId: 'thread-1',
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedTokens: 90,
          cacheMissTokens: 30,
          totalTokens: 145,
          turns: 1,
          cacheHitRate: 0.75
        }]
      })
    })

    await expect(service.readThread('thread-1')).resolves.toMatchObject({
      ok: true,
      detail: {
        usage: {
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          totalTokens: 145,
          cacheReadTokens: 90,
          cacheWriteTokens: 30
        }
      }
    })
    queued.close()
  })

  it('records completed Codex turns as usage activity when token usage is unavailable', async () => {
    const queued = clientWithQueuedEvents()
    const rootDir = await tempRoot()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      storageRoot: rootDir,
      createClient: () => queued.client
    })

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'turn/completed',
        params: { threadId: 'thread-1', turnId: 'turn-1' }
      }
    })

    await vi.waitFor(async () => {
      await expect(service.usage({
        groupBy: 'thread',
        threadId: 'thread-1',
        timezone: 'UTC'
      })).resolves.toMatchObject({
        supported: true,
        groupBy: 'thread',
        buckets: [{
          threadId: 'thread-1',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          turns: 1
        }],
        totals: {
          totalTokens: 0,
          turns: 1,
          activeDays: 1
        }
      })
    })
    queued.close()
  })

  it('backfills usage activity from stored Codex turn events', async () => {
    const rootDir = await tempRoot()
    await new CodexThreadStore({ rootDir }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Stored Codex'
    })
    await new CodexEventStore({ rootDir }).append('gui-thread-1', {
      threadId: 'gui-thread-1',
      turnId: 'turn-1',
      turnComplete: true
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot: rootDir,
      createClient: () => controllableClient()
    })

    await expect(service.usage({
      groupBy: 'thread',
      threadId: 'gui-thread-1',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'gui-thread-1',
        totalTokens: 0,
        turns: 1
      }],
      totals: {
        totalTokens: 0,
        turns: 1,
        activeDays: 1
      }
    })
  })

  it('omits app-server startup status events when a Codex turn starts after prewarm', async () => {
    const client = controllableClient()
    const sink = { send: vi.fn() }
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink,
      createClient: () => client
    })

    await expect(service.connect()).resolves.toMatchObject({ ok: true })
    vi.mocked(client.connect).mockClear()
    sink.send.mockClear()

    await expect(service.startTurn({ threadId: 'thread-1', text: 'hello' })).resolves.toMatchObject({
      ok: true,
      turnId: 'turn-1'
    })

    expect(client.connect).not.toHaveBeenCalled()
    const phases = sink.send.mock.calls
      .map((call) => call[1]?.event?.runtimeStatus?.phase)
      .filter(Boolean)
    expect(phases).toEqual(['turn_start_sent'])
  })

  it('streams replayed and live Codex events through a neutral async iterable', async () => {
    const storageRoot = await tempRoot()
    const eventStore = new CodexEventStore({ rootDir: storageRoot })
    await eventStore.append('thread-1', {
      threadId: 'thread-1',
      deltas: [{ kind: 'agent_message', text: 'stored' }]
    })
    const queued = clientWithQueuedEvents()
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient: () => queued.client
    })
    const abort = new AbortController()
    const seen: CodexThreadEventPayload[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('thread-1', 0, abort.signal)) {
        seen.push(event)
        if (event.deltas?.some((delta) => delta.text === 'live')) abort.abort()
      }
    })()

    await service.connect()
    queued.push({
      type: 'event',
      channel: CODEX_MAIN_IPC_CHANNELS.event,
      payload: {
        method: 'item/agentMessage/delta',
        params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'live' }
      }
    })

    await vi.waitFor(() => {
      expect(seen.map((event) => event.deltas?.[0]?.text).filter(Boolean)).toEqual(['stored', 'live'])
    })
    await consume
    queued.close()
  })

  it('routes pending app-server requests from backend thread ids to GUI thread subscribers', async () => {
    const storageRoot = await tempRoot()
    await new CodexThreadStore({ rootDir: storageRoot }).upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-new',
      workspace: '/tmp/workspace',
      title: 'Rematerialized Codex'
    })
    let onPendingRequest: ((request: CodexAppServerPendingRequest) => void) | undefined
    const client = controllableClient()
    const createClient = vi.fn((options: CodexAppServerJsonRpcClientOptions) => {
      onPendingRequest = (
        options.pendingServerRequests as { onPendingRequest?: (request: CodexAppServerPendingRequest) => void }
      )?.onPendingRequest
      return client
    })
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      storageRoot,
      createClient
    })
    const abort = new AbortController()
    const seen: CodexThreadEventPayload[] = []

    const consume = (async () => {
      for await (const event of service.subscribeEvents('gui-thread-1', 0, abort.signal)) {
        seen.push(event)
        if (event.tool?.meta?.codexRequestId === 'approval-1') abort.abort()
      }
    })()

    await service.connect()
    expect(onPendingRequest).toEqual(expect.any(Function))
    onPendingRequest?.({
      requestId: 'approval-1',
      method: 'item/fileChange/requestApproval',
      kind: 'approval',
      threadId: 'codex-thread-new',
      turnId: 'turn-1',
      itemId: 'file-1',
      summary: 'File change approval requested',
      params: {}
    })

    await vi.waitFor(() => {
      expect(seen).toEqual([
        expect.objectContaining({
          threadId: 'gui-thread-1',
          turnId: 'turn-1',
          tool: expect.objectContaining({
            itemId: 'file-1',
            status: 'running',
            toolKind: 'file_change',
            meta: expect.objectContaining({
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval'
            })
          })
        })
      ])
    })
    await consume
  })

  it('exposes pending app-server requests and resolves approvals and user input by request id', async () => {
    const client = {
      ...controllableClient(),
      pendingServerRequests: vi.fn(() => [
        {
          requestId: 'approval-1',
          method: 'item/fileChange/requestApproval',
          kind: 'approval',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'file-1',
          summary: 'File change approval requested',
          params: {}
        },
        {
          requestId: 'input-1',
          method: 'item/tool/requestUserInput',
          kind: 'user_input',
          threadId: 'thread-1',
          turnId: 'turn-1',
          itemId: 'input-1',
          summary: 'User input requested',
          params: {}
        }
      ]),
      resolveApproval: vi.fn(),
      resolveUserInput: vi.fn()
    } as unknown as CodexAppServerJsonRpcClient
    const service = new CodexRuntimeService({
      settings: async () => settings(),
      sink: { send: vi.fn() },
      createClient: () => client
    })

    await service.connect()

    expect(service.pendingServerRequests()).toEqual([
      expect.objectContaining({ requestId: 'approval-1', kind: 'approval' }),
      expect.objectContaining({ requestId: 'input-1', kind: 'user_input' })
    ])
    await expect(service.resolveApproval({
      requestId: 'approval-1',
      decision: 'denied'
    })).resolves.toEqual({ ok: true })
    await expect(service.resolveUserInput({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })).resolves.toEqual({ ok: true })

    expect(client.resolveApproval).toHaveBeenCalledWith({
      requestId: 'approval-1',
      decision: 'denied'
    })
    expect(client.resolveUserInput).toHaveBeenCalledWith({
      requestId: 'input-1',
      answers: [{ id: 'q1', value: 'A' }]
    })
  })
})
