import { describe, expect, it, vi } from 'vitest'
import type { MultiAgentRuntime } from '@sciforge/multi-agent'
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
  it('injects child runtime guardrails into delegate_task prompts', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_task')

    await tool?.execute({ label: 'qa', prompt: 'Read the figure and report quality.' }, fakeContext())

    const prompt = runChild.mock.calls[0]?.[0].prompt
    expect(prompt).toContain('Child-agent runtime guardrails:')
    expect(prompt).toContain('SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY')
    expect(prompt).toContain('MODEL_ROUTER_BASE_URL')
    expect(prompt).toContain('Never read app settings')
    expect(prompt).toContain('read-before-edit guard')
    expect(prompt).toContain('Read the figure and report quality.')
  })

  it('injects guardrails into every delegate_tasks prompt without duplicating existing guardrails', async () => {
    const { runtime, runChild } = fakeRuntime()
    const tool = buildDelegationToolProviders(runtime)[0]?.tools.find((candidate) => candidate.name === 'delegate_tasks')
    const guarded = withChildRuntimeGuardrails('Already guarded task.')

    await tool?.execute({
      tasks: [
        { label: 'one', prompt: 'Plain task.' },
        { label: 'two', prompt: guarded }
      ]
    }, fakeContext())

    const prompts = runChild.mock.calls.map((call) => String(call[0].prompt))
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('Child-agent runtime guardrails:')
    expect(prompts[0]).toContain('Plain task.')
    expect(prompts[1].match(/Child-agent runtime guardrails:/g)).toHaveLength(1)
    expect(prompts[1]).toContain('Already guarded task.')
  })
})
