import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse,
  AgentRuntimeThread
} from '../../../shared/agent-runtime-contract'
import type { CodexRuntimeService } from '../codex'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'
import { createAgentRuntimeHost } from './host'
import { createCodexAgentRuntimeAdapter } from '../codex/codex-agent-runtime-adapter'
import { createKunAgentRuntimeAdapter } from '../kun-agent-runtime-adapter'

function settings(activeAgentRuntime: AppSettingsV1['activeAgentRuntime'] = 'codex'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
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

function capabilities(runtimeId: 'kun' | 'codex'): AgentRuntimeCapabilities {
  return {
    contractVersion: 1,
    runtimeId,
    transport: runtimeId === 'kun' ? 'http_sse' : 'jsonrpc_stdio',
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: runtimeId === 'kun' ? 'sse' : 'ipc'
    },
    threadMaterialization: runtimeId === 'kun' ? 'immediate' : 'after_first_user_message',
    latency: {
      phaseEvents: false,
      firstTokenMetric: false,
      turnDurationMetric: false
    },
    reasoning: {
      available: false,
      streaming: false,
      visibility: 'none',
      source: 'unknown'
    },
    model: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: false
    },
    tools: {
      toolCalling: false,
      commandExecution: { available: false },
      fileChange: { available: false },
      mcp: { available: false },
      web: { available: false },
      skills: { available: false },
      subagents: { available: false },
      diagnostics: { available: false }
    },
    controls: {
      interrupt: false,
      steer: false,
      approval: 'unsupported',
      userInput: 'unsupported',
      compact: 'unsupported',
      fork: false,
      review: false,
      goals: false,
      todos: false,
      resumeSession: false
    },
    storage: {
      guiOwnedThreads: false,
      backendThreadIdStable: false,
      usage: false,
      attachments: { available: false },
      memory: { available: false }
    }
  }
}

function fakeAdapter(id: 'kun' | 'codex', thread: AgentRuntimeThread): AgentRuntimeAdapter {
  return {
    id,
    transport: id === 'kun' ? 'http_sse' : 'jsonrpc_stdio',
    connect: vi.fn(async () => undefined),
    capabilities: vi.fn(async () => capabilities(id)),
    listThreads: vi.fn(async () => [thread]),
    startThread: vi.fn(async () => thread),
    readThread: vi.fn(async () => ({ ...thread, latestSeq: 0, items: [] })),
    usage: vi.fn(async (_ctx, input) => ({
      supported: true,
      groupBy: input.groupBy,
      buckets: [],
      totals: { totalTokens: 0 }
    }) satisfies AgentRuntimeUsageResponse),
    startTurn: vi.fn(async (_ctx, input) => ({ threadId: input.threadId, turnId: `${id}-turn` })),
    interruptTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
    renameThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    updateThreadRelation: vi.fn(async () => undefined),
    subscribeEvents: vi.fn(async function* (_ctx: AgentRuntimeAdapterContext, input) {
      yield {
        kind: 'heartbeat',
        threadId: input.threadId,
        runtimeId: id,
        seq: input.sinceSeq
      } satisfies AgentRuntimeEvent
    })
  }
}

function json(body: unknown, status = 200): { ok: boolean; status: number; body: string } {
  return { ok: status >= 200 && status < 300, status, body: JSON.stringify(body) }
}

describe('AgentRuntimeHost', () => {
  it('selects the active adapter and allows explicit runtime overrides', async () => {
    const kunThread = {
      id: 'kun-thread',
      runtimeId: 'kun' as const,
      title: 'Kun',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const codexThread = {
      id: 'codex-thread',
      runtimeId: 'codex' as const,
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    }
    const kun = fakeAdapter('kun', kunThread)
    const codex = fakeAdapter('codex', codexThread)
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [kun, codex]
    })

    await expect(host.listThreads()).resolves.toEqual([codexThread])
    await expect(host.listThreads({ runtimeId: 'kun', limit: 2 })).resolves.toEqual([kunThread])
    await expect(host.capabilities('kun')).resolves.toMatchObject({ runtimeId: 'kun' })
    await host.renameThread({ runtimeId: 'kun', threadId: 'kun-thread', title: 'Renamed' })
    await host.updateThreadRelation({ runtimeId: 'kun', threadId: 'kun-thread', relation: 'primary' })

    expect(codex.listThreads).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      {}
    )
    expect(kun.listThreads).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'kun', limit: 2 }
    )
    expect(kun.renameThread).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'kun', threadId: 'kun-thread', title: 'Renamed' }
    )
    expect(kun.updateThreadRelation).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      { runtimeId: 'kun', threadId: 'kun-thread', relation: 'primary' }
    )
  })

  it('streams events through the selected adapter', async () => {
    const kun = fakeAdapter('kun', {
      id: 'kun-thread',
      runtimeId: 'kun',
      title: 'Kun',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [kun, codex]
    })
    const events: AgentRuntimeEvent[] = []

    for await (const event of host.subscribeEvents({
      runtimeId: 'kun',
      threadId: 'kun-thread',
      sinceSeq: 4
    })) {
      events.push(event)
    }

    expect(events).toEqual([{ kind: 'heartbeat', threadId: 'kun-thread', runtimeId: 'kun', seq: 4 }])
    expect(kun.subscribeEvents).toHaveBeenCalled()
  })

  it('routes neutral usage queries through the selected adapter', async () => {
    const kun = fakeAdapter('kun', {
      id: 'kun-thread',
      runtimeId: 'kun',
      title: 'Kun',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const codex = fakeAdapter('codex', {
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex',
      updatedAt: '2026-06-10T00:00:00.000Z'
    })
    const host = createAgentRuntimeHost({
      settings: async () => settings('codex'),
      adapters: [kun, codex]
    })
    const query: AgentRuntimeUsageQuery = {
      runtimeId: 'kun',
      groupBy: 'thread',
      threadId: 'thr-kun'
    }

    await expect(host.usage(query)).resolves.toEqual({
      supported: true,
      groupBy: 'thread',
      buckets: [],
      totals: { totalTokens: 0 }
    })
    expect(kun.usage).toHaveBeenCalledWith(
      { settings: expect.objectContaining({ activeAgentRuntime: 'codex' }) },
      query
    )
  })
})

describe('createKunAgentRuntimeAdapter', () => {
  it('uses Kun /v1 thread endpoints and maps thread snapshots to the neutral contract', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createKunAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        if (path.startsWith('/v1/threads?')) {
          return json({
            threads: [{
              id: 'thr-kun',
              title: 'Kun thread',
              workspace: '/tmp/workspace',
              model: 'deepseek-v4-pro',
              mode: 'agent',
              status: 'idle',
              createdAt: '2026-06-09T00:00:00.000Z',
              updatedAt: '2026-06-10T00:00:00.000Z'
            }]
          })
        }
        if (path === '/v1/threads/thr-kun' && init.method === 'GET') {
          return json({
            id: 'thr-kun',
            title: 'Kun thread',
            workspace: '/tmp/workspace',
            model: 'deepseek-v4-pro',
            mode: 'agent',
            status: 'idle',
            createdAt: '2026-06-09T00:00:00.000Z',
            updatedAt: '2026-06-10T00:00:00.000Z',
            latestSeq: 2,
            turns: [{
              id: 'turn-1',
              threadId: 'thr-kun',
              status: 'completed',
              createdAt: '2026-06-10T00:00:00.000Z',
              finishedAt: '2026-06-10T00:00:01.000Z',
              items: [
                {
                  id: 'user-1',
                  kind: 'user_message',
                  text: 'hello',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:00.000Z'
                },
                {
                  id: 'assistant-1',
                  kind: 'assistant_text',
                  text: 'hi',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:01.000Z'
                },
                {
                  id: 'tool-1',
                  kind: 'tool_result',
                  toolKind: 'command_execution',
                  toolName: 'bash',
                  output: 'ok',
                  status: 'completed',
                  createdAt: '2026-06-10T00:00:01.000Z'
                }
              ]
            }]
          })
        }
        if (path === '/v1/threads/thr-kun/turns' && init.method === 'POST') {
          return json({ threadId: 'thr-kun', turnId: 'turn-2', userMessageItemId: 'user-2' }, 202)
        }
        return json({ code: 'not_found', message: path }, 404)
      }
    })
    const ctx = { settings: settings('kun') }

    await expect(adapter.listThreads(ctx, { limit: 3, search: 'Kun' })).resolves.toEqual([expect.objectContaining({
      id: 'thr-kun',
      runtimeId: 'kun',
      title: 'Kun thread',
      backendThreadId: 'thr-kun'
    })])
    await expect(adapter.readThread(ctx, { threadId: 'thr-kun' })).resolves.toMatchObject({
      id: 'thr-kun',
      runtimeId: 'kun',
      latestSeq: 2,
      turns: [{
        id: 'turn-1',
        status: 'completed',
        items: [
          { id: 'user-1', kind: 'user_message', text: 'hello' },
          { id: 'assistant-1', kind: 'assistant_message', text: 'hi' },
          { id: 'tool-1', kind: 'tool', toolKind: 'command_execution', detail: 'ok' }
        ]
      }]
    })
    await expect(adapter.startTurn(ctx, {
      threadId: 'thr-kun',
      text: 'run',
      mode: 'agent',
      displayText: 'Run it',
      attachmentIds: ['att-1']
    })).resolves.toEqual({
      threadId: 'thr-kun',
      turnId: 'turn-2',
      userMessageItemId: 'user-2'
    })

    expect(seen.map((entry) => [entry.path, entry.init.method])).toEqual([
      ['/v1/threads?limit=3&search=Kun', 'GET'],
      ['/v1/threads/thr-kun', 'GET'],
      ['/v1/threads/thr-kun/turns', 'POST']
    ])
    expect(JSON.parse(seen[2].init.body ?? '{}')).toEqual({
      prompt: 'run',
      model: 'deepseek-gui-router',
      mode: 'agent',
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      displayText: 'Run it',
      attachmentIds: ['att-1']
    })
  })

  it('maps Kun runtime info capabilities without dropping tool diagnostics', async () => {
    const adapter = createKunAgentRuntimeAdapter({
      request: async (_settings, path) => {
        if (path !== '/v1/runtime/info') return json({}, 404)
        return json({
          capabilities: {
            contractVersion: 1,
            model: {
              id: 'deepseek-v4-pro',
              inputModalities: ['text', 'image'],
              outputModalities: ['text'],
              supportsToolCalling: true,
              contextWindowTokens: 64000,
              messageParts: ['text', 'image_url']
            },
            cli: {
              serve: { status: 'available', enabled: true, available: true },
              run: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' },
              chat: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' },
              exec: { status: 'disabled', enabled: false, available: false, reason: 'not implemented' }
            },
            mcp: {
              status: 'available',
              enabled: true,
              available: true,
              configuredServers: 2,
              connectedServers: 1,
              toolCount: 7,
              search: {
                enabled: true,
                mode: 'auto',
                active: true,
                indexedToolCount: 7,
                advertisedToolCount: 4
              }
            },
            web: {
              status: 'available',
              enabled: true,
              available: true,
              fetch: { status: 'available', enabled: true, available: true },
              search: { status: 'unavailable', enabled: true, available: false, reason: 'search provider missing' },
              provider: 'test-web'
            },
            skills: {
              status: 'available',
              enabled: true,
              available: true,
              configuredRoots: 1,
              discoveredSkills: 3
            },
            subagents: {
              status: 'available',
              enabled: true,
              available: true,
              maxParallel: 2,
              maxChildRuns: 5
            },
            attachments: {
              status: 'available',
              enabled: true,
              available: true,
              maxImageBytes: 10,
              maxImageDimension: 10,
              allowedMimeTypes: ['image/png'],
              textFallbackMaxBase64Bytes: 10,
              textFallbackMaxImageDimension: 10,
              textFallbackPreferredMimeType: 'image/webp'
            },
            memory: {
              status: 'unavailable',
              enabled: true,
              available: false,
              reason: 'memory store missing',
              scopes: ['user'],
              maxInjectedRecords: 4
            }
          }
        })
      }
    })

    await expect(adapter.capabilities({ settings: settings('kun') })).resolves.toMatchObject({
      runtimeId: 'kun',
      transport: 'http_sse',
      model: {
        id: 'deepseek-v4-pro',
        inputModalities: ['text', 'image'],
        supportsToolCalling: true,
        contextWindowTokens: 64000
      },
      tools: {
        toolCalling: true,
        mcp: { available: true, toolCount: 7, search: { available: true } },
        web: { available: true, fetch: { available: true }, search: { available: false } },
        skills: { available: true },
        subagents: { available: true, maxParallel: 2, maxChildren: 5 },
        diagnostics: { available: true }
      },
      storage: {
        attachments: { available: true },
        memory: { available: false, reason: 'memory store missing' }
      }
    })
  })

  it('keeps Kun usage endpoints behind the neutral adapter contract', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createKunAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        if (path.startsWith('/v1/usage?')) {
          return json({
            group_by: 'thread',
            buckets: [{
              thread_id: 'thr-kun',
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
              cached_tokens: 0,
              cache_hit_rate: null,
              cache_savings_usd: 0.003,
              token_economy_savings_tokens: 4096,
              token_economy_savings_usd: 0.0018,
              turns: 1
            }],
            totals: {
              total_tokens: 120,
              token_economy_savings_tokens: 4096,
              token_economy_savings_usd: 0.0018,
              turns: 1
            }
          })
        }
        if (path === '/v1/threads/thr-kun') {
          return json({
            turns: [{
              usage: {
                prompt_cache_hit_tokens: 80,
                prompt_cache_miss_tokens: 20
              }
            }]
          })
        }
        return json({}, 404)
      }
    })

    await expect(adapter.usage({ settings: settings('kun') }, {
      groupBy: 'thread',
      threadId: 'thr-kun'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'thr-kun',
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        cachedTokens: 80,
        cacheMissTokens: 20,
        cacheHitRate: 0.8,
        tokenEconomySavingsTokens: 4096,
        tokenEconomySavingsUsd: 0.0018,
        turns: 1
      }],
      totals: {
        totalTokens: 120,
        tokenEconomySavingsTokens: 4096,
        tokenEconomySavingsUsd: 0.0018,
        turns: 1
      }
    })
    expect(seen.map((entry) => [entry.path, entry.init.method])).toEqual([
      ['/v1/usage?group_by=thread', 'GET'],
      ['/v1/threads/thr-kun', 'GET']
    ])
  })

  it('updates Kun thread relation through the neutral adapter', async () => {
    const seen: Array<{ path: string; init: { method?: string; body?: string } }> = []
    const adapter = createKunAgentRuntimeAdapter({
      request: async (_settings, path, init) => {
        seen.push({ path, init })
        return json({})
      }
    })

    await expect(adapter.updateThreadRelation?.({ settings: settings('kun') }, {
      threadId: 'thr-side',
      relation: 'primary'
    })).resolves.toBeUndefined()

    expect(seen).toEqual([{
      path: '/v1/threads/thr-side',
      init: {
        method: 'PATCH',
        body: JSON.stringify({ relation: 'primary' })
      }
    }])
  })

  it('maps Kun SSE events to neutral lifecycle and delta events', async () => {
    const rawEvents = [
      {
        kind: 'turn_started',
        seq: 1,
        timestamp: '2026-06-12T04:41:37.972Z',
        threadId: 'thr-kun',
        turnId: 'turn-1'
      },
      {
        kind: 'item_created',
        seq: 2,
        timestamp: '2026-06-12T04:41:37.980Z',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        itemId: 'user-1',
        item: {
          id: 'user-1',
          kind: 'user_message',
          text: 'hello',
          status: 'completed',
          createdAt: '2026-06-12T04:41:37.980Z'
        }
      },
      {
        kind: 'assistant_text_delta',
        seq: 3,
        timestamp: '2026-06-12T04:41:39.999Z',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        item: {
          id: 'assistant-1',
          kind: 'assistant_text',
          text: 'hi',
          status: 'running'
        }
      },
      {
        kind: 'turn_completed',
        seq: 4,
        timestamp: '2026-06-12T04:41:40.021Z',
        threadId: 'thr-kun',
        turnId: 'turn-1'
      }
    ]
    const adapter = createKunAgentRuntimeAdapter({
      request: async () => json({}),
      events: async function* () {
        yield* rawEvents
      }
    })

    const events: AgentRuntimeEvent[] = []
    for await (const event of adapter.subscribeEvents!({ settings: settings('kun') }, {
      threadId: 'thr-kun',
      sinceSeq: 0
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      expect.objectContaining({
        kind: 'turn_lifecycle',
        runtimeId: 'kun',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        state: 'started',
        seq: 1,
        createdAt: '2026-06-12T04:41:37.972Z'
      }),
      expect.objectContaining({
        kind: 'item_snapshot',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        seq: 2,
        item: expect.objectContaining({ id: 'user-1', kind: 'user_message', text: 'hello' })
      }),
      expect.objectContaining({
        kind: 'assistant_delta',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        itemId: 'assistant-1',
        text: 'hi',
        seq: 3
      }),
      expect.objectContaining({
        kind: 'turn_lifecycle',
        runtimeId: 'kun',
        threadId: 'thr-kun',
        turnId: 'turn-1',
        state: 'completed',
        seq: 4,
        createdAt: '2026-06-12T04:41:40.021Z'
      })
    ])
  })
})

describe('createCodexAgentRuntimeAdapter', () => {
  it('wraps CodexRuntimeService operations and exposes honest Codex capabilities', async () => {
    const userInputQuestions = [{
      id: 'choice',
      header: 'Choice',
      question: 'Pick one',
      options: [{ label: 'Yes', description: 'Continue' }]
    }]
    const service = {
      connect: vi.fn(async () => ({ ok: true as const, info: {} })),
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [{
          id: 'codex-thread',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent',
          latestTurnId: 'turn-1'
        }]
      })),
      startThread: vi.fn(async () => ({
        ok: true as const,
        thread: {
          id: 'codex-thread',
          title: 'Codex',
          updatedAt: '2026-06-10T00:00:00.000Z',
          model: 'gpt-5',
          mode: 'agent'
        }
      })),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 3,
          latestTurnId: 'turn-1',
          blocks: [
            { kind: 'user' as const, id: 'user-1', text: '[Claw managed instructions]\nhello', displayText: 'hello' },
            { kind: 'assistant' as const, id: 'assistant-1', text: 'hi' },
            { kind: 'reasoning' as const, id: 'reasoning-1', text: 'thinking' },
            {
              kind: 'tool' as const,
              id: 'tool-1',
              summary: 'Command',
              status: 'success' as const,
              toolKind: 'command_execution' as const,
              detail: 'ok'
            },
            {
              kind: 'tool' as const,
              id: 'approval-item',
              summary: 'File change approval requested',
              status: 'running' as const,
              toolKind: 'file_change' as const,
              meta: {
                codexRequestId: 'approval-1',
                codexRequestKind: 'approval',
                codexRequestMethod: 'item/fileChange/requestApproval'
              }
            },
            {
              kind: 'tool' as const,
              id: 'input-item',
              summary: 'User input requested',
              status: 'running' as const,
              meta: {
                codexRequestId: 'input-1',
                codexRequestKind: 'user_input',
                codexRequestMethod: 'item/tool/requestUserInput',
                questions: userInputQuestions
              }
            }
          ]
        }
      })),
      startTurn: vi.fn(async () => ({
        ok: true as const,
        threadId: 'codex-thread',
        turnId: 'turn-2',
        userMessageItemId: 'user-2'
      })),
      interruptTurn: vi.fn(async () => ({ ok: true as const })),
      steerTurn: vi.fn(async () => ({ ok: true as const })),
      renameThread: vi.fn(async () => ({ ok: true as const })),
      deleteThread: vi.fn(async () => ({ ok: true as const })),
      archiveThread: vi.fn(async () => ({ ok: true as const })),
      resolveApproval: vi.fn(async () => ({ ok: true as const })),
      resolveUserInput: vi.fn(async () => ({ ok: true as const })),
      readStoredEvents: vi.fn(async () => [
        {
          threadId: 'codex-thread',
          seq: 5,
          deltas: [{ kind: 'agent_message' as const, text: 'stored' }]
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 6,
          tool: {
            itemId: 'approval-item',
            summary: 'File change approval requested',
            status: 'running' as const,
            toolKind: 'file_change' as const,
            meta: {
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval',
              codexRequestMethod: 'item/fileChange/requestApproval'
            }
          }
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 7,
          tool: {
            itemId: 'input-item',
            summary: 'User input requested',
            status: 'running' as const,
            meta: {
              codexRequestId: 'input-1',
              codexRequestKind: 'user_input',
              codexRequestMethod: 'item/tool/requestUserInput',
              questions: userInputQuestions
            }
          }
        },
        {
          threadId: 'codex-thread',
          turnId: 'turn-1',
          seq: 8,
          runtimeStatus: {
            itemId: 'latency-first-delta',
            phase: 'first_delta',
            message: 'First Codex delta received',
            latencyMs: 42
          }
        }
      ])
    } as unknown as CodexRuntimeService
    const adapter = createCodexAgentRuntimeAdapter(service)
    const ctx = { settings: settings('codex') }

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio',
      threadMaterialization: 'after_first_user_message',
      controls: {
        interrupt: true,
        steer: true,
        approval: 'async',
        userInput: 'async',
        compact: 'noop',
        fork: false,
        review: false,
        goals: false,
        todos: false,
        resumeSession: false
      },
      storage: {
        guiOwnedThreads: true,
        backendThreadIdStable: false,
        usage: true,
        attachments: { available: false },
        memory: { available: false }
      }
    })
    await expect(adapter.usage(ctx, { groupBy: 'thread', threadId: 'codex-thread' })).resolves.toEqual({
      supported: false,
      reason: 'usage unsupported',
      groupBy: 'thread',
      buckets: [],
      totals: {}
    })
    await expect(adapter.listThreads(ctx, {
      includeArchived: true,
      search: 'Codex',
      limit: 25
    })).resolves.toEqual([expect.objectContaining({
      id: 'codex-thread',
      runtimeId: 'codex',
      backendThreadId: 'codex-thread'
    })])
    expect(service.listThreads).toHaveBeenCalledWith({
      includeArchived: true,
      search: 'Codex',
      limit: 25
    })
    await expect(adapter.readThread(ctx, { threadId: 'codex-thread' })).resolves.toMatchObject({
      id: 'codex-thread',
      runtimeId: 'codex',
      latestSeq: 3,
      turns: [{
        id: 'turn-1',
        items: [
          { id: 'user-1', kind: 'user_message', text: 'hello' },
          { id: 'assistant-1', kind: 'assistant_message', text: 'hi' },
          { id: 'reasoning-1', kind: 'reasoning', text: 'thinking' },
          { id: 'tool-1', kind: 'tool', toolKind: 'command_execution', detail: 'ok' },
          {
            id: 'approval-item',
            kind: 'approval',
            status: 'pending',
            summary: 'File change approval requested',
            toolKind: 'file_change',
            meta: expect.objectContaining({
              approvalId: 'approval-1',
              codexRequestId: 'approval-1',
              codexRequestKind: 'approval',
              codexRequestMethod: 'item/fileChange/requestApproval'
            })
          },
          {
            id: 'input-item',
            kind: 'user_input',
            status: 'pending',
            summary: 'User input requested',
            meta: expect.objectContaining({
              requestId: 'input-1',
              codexRequestId: 'input-1',
              codexRequestKind: 'user_input',
              codexRequestMethod: 'item/tool/requestUserInput',
              questions: userInputQuestions
            })
          }
        ]
      }]
    })
    vi.mocked(service.readThread).mockResolvedValueOnce({
      ok: true as const,
      detail: {
        latestSeq: 1,
        threadStatus: 'running',
        blocks: []
      }
    })
    const emptyDetail = await adapter.readThread(ctx, { threadId: 'empty-codex-thread' })
    expect(emptyDetail).toMatchObject({
      id: 'empty-codex-thread',
      runtimeId: 'codex',
      latestSeq: 1,
      turns: [],
      items: []
    })
    expect(emptyDetail.status).toBeUndefined()
    expect(emptyDetail.latestTurnId).toBeUndefined()
    await expect(adapter.startTurn(ctx, {
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it',
      model: 'gpt-5',
      reasoningEffort: 'high'
    })).resolves.toEqual({
      threadId: 'codex-thread',
      turnId: 'turn-2',
      userMessageItemId: 'user-2'
    })
    expect(service.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it'
    }))
    await expect(adapter.resolveApproval?.(ctx, {
      threadId: 'codex-thread',
      approvalId: 'server-request-1',
      decision: 'allowed',
      message: 'approved'
    })).resolves.toBeUndefined()
    await expect(adapter.resolveUserInput?.(ctx, {
      threadId: 'codex-thread',
      requestId: 'server-request-2',
      answers: [{ id: 'choice', value: 'yes' }]
    })).resolves.toBeUndefined()
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'archiveThread',
      payload: { threadId: 'codex-thread', archived: false }
    })).resolves.toBeUndefined()
    const events: AgentRuntimeEvent[] = []
    for await (const event of adapter.subscribeEvents(ctx, { threadId: 'codex-thread', sinceSeq: 4 })) {
      events.push(event)
    }

    expect(service.startTurn).toHaveBeenCalledWith({
      threadId: 'codex-thread',
      text: 'run',
      displayText: 'Run it',
      model: 'gpt-5',
      reasoningEffort: 'high',
      workspace: undefined
    })
    expect(service.resolveApproval).toHaveBeenCalledWith({
      requestId: 'server-request-1',
      decision: 'allowed',
      message: 'approved'
    })
    expect(service.resolveUserInput).toHaveBeenCalledWith({
      requestId: 'server-request-2',
      answers: [{ id: 'choice', value: 'yes' }]
    })
    expect(service.archiveThread).toHaveBeenCalledWith('codex-thread', false)
    expect(events).toEqual([
      {
        kind: 'assistant_delta',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        seq: 5,
        text: 'stored',
        itemId: 'codex-delta-5-0'
      },
      {
        kind: 'approval_requested',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 6,
        itemId: 'approval-item',
        approvalId: 'approval-1',
        summary: 'File change approval requested',
        toolName: 'file change',
        meta: expect.objectContaining({
          codexRequestId: 'approval-1',
          codexRequestKind: 'approval',
          codexRequestMethod: 'item/fileChange/requestApproval'
        })
      },
      {
        kind: 'user_input_requested',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 7,
        itemId: 'input-item',
        requestId: 'input-1',
        questions: userInputQuestions
      },
      {
        kind: 'runtime_status',
        threadId: 'codex-thread',
        runtimeId: 'codex',
        turnId: 'turn-1',
        seq: 8,
        itemId: 'latency-first-delta',
        phase: 'first_delta',
        message: 'First Codex delta received',
        latencyMs: 42
      }
    ])
  })
})
