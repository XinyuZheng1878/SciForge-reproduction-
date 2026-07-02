import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultiAgentRuntimeError, createMultiAgentError, type MultiAgentRuntime } from '@sciforge/multi-agent'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDelegationToolProviders, withChildRuntimeGuardrails } from './delegation-tool-provider.js'

function fakeContext(): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/tmp/research-workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

function fakeRuntime() {
  const runChild = vi.fn(async (input: Record<string, unknown>) => ({
    id: 'child-1',
    label: typeof input.label === 'string' ? input.label : undefined,
    status: 'completed' as const,
    summary: 'done',
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  }))
  const diagnostics = vi.fn(async () => ({
    config: {
      enabled: true,
      maxParallel: 4,
      maxChildren: 16,
      childTimeoutMs: 0
    },
    active: 0,
    childRuns: [],
    aggregates: []
  }))
  return {
    runtime: { runChild, diagnostics } as unknown as MultiAgentRuntime,
    runChild
  }
}

describe('buildDelegationToolProviders', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('injects child runtime guardrails into delegate_task prompts', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_task')

    await tool?.execute({
      label: 'qa',
      prompt: 'Read the figure and report quality.',
      timeout_ms: 1_800_000
    }, fakeContext())

    const prompt = runChild.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('Child-agent runtime guardrails:')
    expect(prompt).toContain('SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY')
    expect(prompt).toContain('SCIFORGE_MODEL_ROUTER_BASE_URL')
    expect(prompt).not.toMatch(/(?:^|[^A-Z0-9_])KUN_MODEL_ROUTER_API_KEY(?:$|[^A-Z0-9_])/)
    expect(prompt).not.toMatch(/(?:^|[^A-Z0-9_])MODEL_ROUTER_API_KEY(?:$|[^A-Z0-9_])/)
    expect(prompt).toContain('Never read app settings')
    expect(prompt).toContain('bounded execution request')
    expect(prompt).toContain('Do not ask the parent or user what to do next')
    expect(prompt).toContain('verify requested files')
    expect(prompt).toContain('CHILD_AGENT_BLOCKED')
    expect(prompt).toContain('do not include CHILD_AGENT_BLOCKED anywhere in the final response')
    expect(prompt).toContain('read-before-edit guard')
    expect(prompt).toContain('Read the figure and report quality.')
    expect(runChild.mock.calls[0]?.[0].childTimeoutMs).toBe(1_200_000)
  })

  it('uses a research-friendly default timeout for delegated agents', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_task')

    await tool?.execute({
      label: 'literature',
      prompt: 'Verify literature and write a concise report.'
    }, fakeContext())

    expect(runChild.mock.calls[0]?.[0].childTimeoutMs).toBe(300_000)
  })

  it('injects guardrails into every delegate_tasks prompt without duplicating existing guardrails', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_tasks')
    const guarded = withChildRuntimeGuardrails('Already guarded task.')

    await tool?.execute({
      timeout_ms: 900_000,
      tasks: [
        { label: 'one', prompt: 'Plain task.' },
        { label: 'two', prompt: guarded, timeout_ms: 1_200_000 }
      ]
    }, fakeContext())

    const prompts = runChild.mock.calls.map((call) => String(call[0].prompt))
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Child-agent runtime guardrails:')
    expect(prompts[0]).toContain('Plain task.')
    expect(prompts[1].match(/Child-agent runtime guardrails:/g)).toHaveLength(1)
    expect(prompts[1]).toContain('Already guarded task.')
    expect(runChild.mock.calls.map((call) => call[0].childTimeoutMs)).toEqual([900_000, 1_200_000])
  })

  it('does not propagate derived active tool policy to child agents', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_task')
    const context = {
      ...fakeContext(),
      allowedToolNames: ['delegate_task']
    }

    await tool?.execute({
      label: 'tools',
      prompt: 'List available plotting tools.'
    }, context)

    expect(runChild.mock.calls[0]?.[0].allowedToolNames).toBeUndefined()
    expect(runChild.mock.calls[0]?.[0].strictAllowedToolNames).toBe(false)
  })

  it('propagates explicit per-turn tool limits to child agents', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_tasks')
    const context = {
      ...fakeContext(),
      allowedToolNames: ['delegate_tasks'],
      explicitAllowedToolNames: ['read', 'scientific_plotting_render'],
      explicitStrictAllowedToolNames: true
    }

    await tool?.execute({
      tasks: [
        { label: 'one', prompt: 'Render a figure.' },
        { label: 'two', prompt: 'Review a figure.' }
      ]
    }, context)

    expect(runChild.mock.calls.map((call) => call[0].allowedToolNames)).toEqual([
      ['read', 'scientific_plotting_render'],
      ['read', 'scientific_plotting_render']
    ])
    expect(runChild.mock.calls.map((call) => call[0].strictAllowedToolNames)).toEqual([true, true])
  })

  it('returns a failed delegate_task result when a child run does not resolve before timeout', async () => {
    vi.useFakeTimers()
    const runChild = vi.fn((_input: Record<string, unknown>) => new Promise(() => undefined))
    const runtime = {
      runChild,
      diagnostics: vi.fn(async () => ({
        config: { enabled: true, maxParallel: 4, maxChildren: 16, childTimeoutMs: 0 },
        active: 0,
        childRuns: [],
        aggregates: []
      }))
    } as unknown as MultiAgentRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_task')
    const resultPromise = tool?.execute({
      prompt: 'This child never returns.',
      timeout_ms: 25
    }, fakeContext())

    await vi.advanceTimersByTimeAsync(26)

    await expect(resultPromise).resolves.toMatchObject({
      isError: true,
      output: {
        status: 'failed',
        error: {
          code: 'child_failed',
          retryable: true
        }
      }
    })
    expect((runChild.mock.calls[0]?.[0].signal as AbortSignal).aborted).toBe(true)
  })

  it('returns partial children from delegate_tasks when one child run does not resolve before timeout', async () => {
    vi.useFakeTimers()
    const runChild = vi.fn(async (input: Record<string, unknown>) => {
      if (input.label === 'hang') return await new Promise(() => undefined)
      return {
        id: `child-${input.label}`,
        label: typeof input.label === 'string' ? input.label : undefined,
        status: 'completed' as const,
        summary: 'done',
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      }
    })
    const runtime = {
      runChild,
      diagnostics: vi.fn(async () => ({
        config: { enabled: true, maxParallel: 4, maxChildren: 16, childTimeoutMs: 0 },
        active: 0,
        childRuns: [],
        aggregates: []
      }))
    } as unknown as MultiAgentRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_tasks')
    const resultPromise = tool?.execute({
      timeout_ms: 25,
      tasks: [
        { label: 'ok', prompt: 'Return.' },
        { label: 'hang', prompt: 'Never return.' }
      ]
    }, fakeContext())

    await vi.advanceTimersByTimeAsync(26)

    await expect(resultPromise).resolves.toMatchObject({
      isError: false,
      output: {
        status: 'partial',
        total: 2,
        completed: 1,
        failed: 1,
        children: [
          { label: 'ok', status: 'completed' },
          {
            label: 'hang',
            status: 'failed',
            error: {
              code: 'child_failed',
              retryable: true
            }
          }
        ]
      }
    })
  })

  it('retries delegate_tasks children when the runtime parallel budget is transiently exhausted', async () => {
    vi.useFakeTimers()
    const attempts = new Map<string, number>()
    const runChild = vi.fn(async (input: Record<string, unknown>) => {
      const label = typeof input.label === 'string' ? input.label : 'unlabeled'
      const nextAttempt = (attempts.get(label) ?? 0) + 1
      attempts.set(label, nextAttempt)
      if (label === 'third' && nextAttempt === 1) {
        throw new MultiAgentRuntimeError(createMultiAgentError(
          'parallel_budget_exhausted',
          'multi-agent parallel budget exhausted: 2/2',
          { retryable: true }
        ))
      }
      return {
        id: `child-${label}-${nextAttempt}`,
        label,
        status: 'completed' as const,
        summary: `${label} done`,
        usage: {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0
        }
      }
    })
    const runtime = {
      runChild,
      diagnostics: vi.fn(async () => ({
        config: { enabled: true, maxParallel: 2, maxChildren: 16, childTimeoutMs: 0 },
        active: 0,
        childRuns: [],
        aggregates: []
      }))
    } as unknown as MultiAgentRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_tasks')
    const resultPromise = tool?.execute({
      timeout_ms: 5_000,
      tasks: [
        { label: 'first', prompt: 'Return first.' },
        { label: 'second', prompt: 'Return second.' },
        { label: 'third', prompt: 'Return third.' }
      ]
    }, fakeContext())

    await vi.advanceTimersByTimeAsync(251)

    await expect(resultPromise).resolves.toMatchObject({
      isError: false,
      output: {
        status: 'completed',
        total: 3,
        completed: 3,
        failed: 0,
        children: [
          { label: 'first', status: 'completed' },
          { label: 'second', status: 'completed' },
          { label: 'third', status: 'completed' }
        ],
        concurrency: 2,
        configured_concurrency: 2
      }
    })
    expect(attempts.get('third')).toBe(2)
  })
})
