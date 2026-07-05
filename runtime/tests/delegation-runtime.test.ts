import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryEventBus } from '../src/adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../src/adapters/in-memory-session-store.js'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { buildDelegationToolProviders } from '../src/adapters/tool/delegation-tool-provider.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { LocalRuntimeCapabilitiesConfig } from '../src/contracts/capabilities.js'
import { FileMultiAgentStore, MultiAgentRuntime } from '@sciforge/multi-agent'
import { RuntimeEventRecorder } from '../src/services/runtime-event-recorder.js'

describe('MultiAgentRuntime delegation integration', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kun-delegation-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates child runs, persists records, and emits child event metadata', async () => {
    const sessionStore = new InMemorySessionStore()
    const externalUsage: unknown[] = []
    const runtime = createRuntime({ sessionStore, recordUsage: (_threadId, usage) => externalUsage.push(usage) })
    const result = await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'Research A',
      workspace: '/tmp/ws',
      signal: new AbortController().signal
    })

    expect(result).toMatchObject({ status: 'completed', summary: 'done: Research A' })
    expect(result.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'user_message', text: 'Research A' }),
      expect.objectContaining({ kind: 'assistant_message', text: 'done: Research A' })
    ]))
    expect((await runtime.diagnostics('thr_1')).childRuns).toHaveLength(1)
    await expect(runtime.child('thr_1', result.id)).resolves.toMatchObject({
      id: result.id,
      transcript: expect.arrayContaining([
        expect.objectContaining({ kind: 'assistant_message', text: 'done: Research A' })
      ])
    })
    const events = await sessionStore.loadEventsSince('thr_1', 0)
    expect(events.some((event) => event.child?.childId === result.id && event.child.childStatus === 'completed')).toBe(true)
    expect(externalUsage).toHaveLength(1)
    expect(externalUsage[0]).toMatchObject({ totalTokens: 3 })
  })

  it('denies disabled delegation and exhausted child budgets', async () => {
    const disabled = createRuntime({ enabled: false })
    await expect(disabled.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'x',
      signal: new AbortController().signal
    })).rejects.toThrow(/disabled/)

    const budgeted = createRuntime({ maxChildren: 1 })
    await budgeted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'first',
      signal: new AbortController().signal
    })
    await expect(budgeted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'second',
      signal: new AbortController().signal
    })).rejects.toThrow(/budget/)
  })

  it('executes delegate_task through the normal tool host', async () => {
    const runtime = createRuntime()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const result = await host.execute({
      callId: 'call_1',
      toolName: 'delegate_task',
      arguments: { label: 'A', prompt: 'Investigate A' }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        status: 'completed',
        summary: expect.stringContaining('Investigate A'),
        effective_timeout_ms: 120_000,
        usage: { totalTokens: 3 }
      })
    }
  })

  it('clamps excessive delegate_task timeouts', async () => {
    const runtime = createRuntime()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const result = await host.execute({
      callId: 'call_timeout',
      toolName: 'delegate_task',
      arguments: { prompt: 'Investigate timeout', timeout_ms: 9_999_999 }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        effective_timeout_ms: 600_000
      })
    }
  })

  it('executes delegate_tasks as a bounded parallel batch through the normal tool host', async () => {
    let active = 0
    let maxSeen = 0
    const runtime = createRuntime({
      maxParallel: 2,
      executor: async ({ prompt }) => {
        active += 1
        maxSeen = Math.max(maxSeen, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return {
          summary: `done: ${prompt}`,
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
        }
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const result = await host.execute({
      callId: 'call_batch',
      toolName: 'delegate_tasks',
      arguments: {
        tasks: [
          { label: 'A', prompt: 'Investigate A' },
          { label: 'B', prompt: 'Investigate B' },
          { label: 'C', prompt: 'Investigate C' }
        ]
      }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(maxSeen).toBe(2)
    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        total: 3,
        completed: 3,
        failed: 0,
        aborted: 0,
        concurrency: 2,
        effective_timeout_ms: 120_000
      })
      expect(result.item.output).toMatchObject({
        children: expect.arrayContaining([
          expect.objectContaining({
            label: 'A',
            status: 'completed',
            summary: expect.stringContaining('Investigate A'),
            effective_timeout_ms: 120_000
          }),
          expect.objectContaining({
            label: 'B',
            status: 'completed',
            summary: expect.stringContaining('Investigate B'),
            effective_timeout_ms: 120_000
          }),
          expect.objectContaining({
            label: 'C',
            status: 'completed',
            summary: expect.stringContaining('Investigate C'),
            effective_timeout_ms: 120_000
          })
        ])
      })
    }
  })

  it('reports per-child task timeout overrides in delegate_tasks output', async () => {
    const runtime = createRuntime({ maxParallel: 2 })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })

    const result = await host.execute({
      callId: 'call_batch_child_timeout',
      toolName: 'delegate_tasks',
      arguments: {
        timeout_ms: 30_000,
        tasks: [
          { label: 'A', prompt: 'short child', timeout_ms: 5_000 },
          { label: 'B', prompt: 'shared child' }
        ]
      }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        effective_timeout_ms: 30_000,
        children: expect.arrayContaining([
          expect.objectContaining({ label: 'A', effective_timeout_ms: 5_000 }),
          expect.objectContaining({ label: 'B', effective_timeout_ms: 30_000 })
        ])
      })
    }
  })

  it('returns per-child failures when a delegate_tasks child cannot be started', async () => {
    const runtime = createRuntime({ maxChildren: 1 })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const result = await host.execute({
      callId: 'call_batch_partial_failure',
      toolName: 'delegate_tasks',
      arguments: {
        tasks: [
          { label: 'A', prompt: 'first' },
          { label: 'B', prompt: 'second' }
        ]
      }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: true })
    if (result.item.kind === 'tool_result') {
      expect(result.item.output).toMatchObject({
        total: 2,
        completed: 1,
        failed: 1,
        aborted: 0
      })
      expect(result.item.output).toMatchObject({
        children: expect.arrayContaining([
          expect.objectContaining({ label: 'A', status: 'completed' }),
          expect.objectContaining({
            label: 'B',
            status: 'failed',
            effective_timeout_ms: 120_000
          })
        ])
      })
    }
  })

  it('resolves delegate auto models to the parent model alias', async () => {
    const seenModels: Array<string | undefined> = []
    const runtime = createRuntime({
      maxParallel: 2,
      executor: async ({ model, prompt }) => {
        seenModels.push(model)
        return {
          summary: `done: ${prompt}`,
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
        }
      }
    })
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })

    const result = await host.execute({
      callId: 'call_auto_model_batch',
      toolName: 'delegate_tasks',
      arguments: {
        model: 'auto',
        tasks: [
          { label: 'A', prompt: 'Investigate A', model: 'auto' },
          { label: 'B', prompt: 'Investigate B' }
        ]
      }
    }, {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      model: {
        id: 'sciforge-router',
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsToolCalling: true,
        messageParts: ['text']
      },
      approvalPolicy: 'auto',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow'
    })

    expect(result.item).toMatchObject({ kind: 'tool_result', isError: false })
    expect(seenModels).toEqual(['sciforge-router', 'sciforge-router'])
  })

  it('warns when delegate_task is spawned repeatedly in one parent thread', async () => {
    const runtime = createRuntime()
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })
    const context = {
      threadId: 'thr_1',
      turnId: 'turn_1',
      workspace: '/tmp/ws',
      approvalPolicy: 'auto' as const,
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const
    }
    await host.execute({
      callId: 'call_1',
      toolName: 'delegate_task',
      arguments: { prompt: 'first' }
    }, context)
    const second = await host.execute({
      callId: 'call_2',
      toolName: 'delegate_task',
      arguments: { prompt: 'second' }
    }, context)

    expect(second.item.kind === 'tool_result' ? second.item.output : {}).toMatchObject({
      warning: expect.stringContaining('spawn #2')
    })
  })

  it('aggregates child runs by label and model for dashboards', async () => {
    const runtime = createRuntime()
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'first',
      model: 'deepseek-v4-flash',
      signal: new AbortController().signal
    })
    await runtime.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      label: 'research',
      prompt: 'second',
      model: 'deepseek-v4-flash',
      signal: new AbortController().signal
    })

    const diagnostics = await runtime.diagnostics('thr_1')
    expect(diagnostics.aggregates[0]).toMatchObject({
      key: 'research:deepseek-v4-flash',
      runs: 2,
      completed: 2,
      totalTokens: 6,
      averageTotalTokens: 3
    })
  })

  it('records child failure and parent interruption states', async () => {
    const failed = createRuntime({
      executor: async () => {
        throw new Error('child failed')
      }
    })
    await expect(failed.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'fail',
      signal: new AbortController().signal
    })).resolves.toMatchObject({ status: 'failed', error: { message: 'child failed' } })

    const controller = new AbortController()
    controller.abort()
    const aborted = createRuntime({
      executor: async ({ signal }) => {
        if (signal.aborted) throw new Error('aborted')
        return { summary: 'unreachable' }
      }
    })
    await expect(aborted.runChild({
      parentThreadId: 'thr_1',
      parentTurnId: 'turn_1',
      prompt: 'abort',
      signal: controller.signal
    })).resolves.toMatchObject({ status: 'aborted' })
  })

  function createRuntime(options: {
    enabled?: boolean
    maxChildren?: number
    maxParallel?: number
    sessionStore?: InMemorySessionStore
    executor?: ConstructorParameters<typeof MultiAgentRuntime>[0]['executor']
    recordUsage?: ConstructorParameters<typeof MultiAgentRuntime>[0]['recordUsage']
  } = {}) {
    const sessionStore = options.sessionStore ?? new InMemorySessionStore()
    const bus = new InMemoryEventBus()
    const recorder = new RuntimeEventRecorder({
      eventBus: bus,
      sessionStore,
      allocateSeq: (threadId) => bus.allocateSeq(threadId),
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })
    const config = LocalRuntimeCapabilitiesConfig.parse({
      subagents: {
        enabled: options.enabled ?? true,
        maxParallel: options.maxParallel ?? 1,
        maxChildRuns: options.maxChildren ?? 3
      }
    }).subagents
    return new MultiAgentRuntime({
      config: {
        enabled: config.enabled,
        maxParallel: config.maxParallel,
        maxChildren: config.maxChildRuns
      },
      store: new FileMultiAgentStore(join(dir, 'children')),
      events: {
        onChildEvent: async (event) => {
          await recorder.record({
            kind: event.status === 'completed'
              ? 'turn_completed'
              : event.status === 'failed'
                ? 'turn_failed'
                : event.status === 'aborted'
                  ? 'turn_aborted'
                  : 'turn_started',
            threadId: event.parentThreadId,
            turnId: event.parentTurnId,
            status: event.status,
            text: event.summary ?? event.error?.message,
            child: {
              parentThreadId: event.parentThreadId,
              parentTurnId: event.parentTurnId,
              childId: event.childId,
              ...(event.label ? { childLabel: event.label } : {}),
              childStatus: event.status,
              childSeq: event.seq
            }
          })
        }
      },
      nowIso: () => '2026-06-03T00:00:00.000Z',
      idGenerator: () => `child_${Math.random().toString(36).slice(2, 8)}`,
      recordUsage: options.recordUsage,
      executor: options.executor ?? (async ({ prompt }) => ({
        summary: `done: ${prompt}`,
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
      }))
    })
  }
})
