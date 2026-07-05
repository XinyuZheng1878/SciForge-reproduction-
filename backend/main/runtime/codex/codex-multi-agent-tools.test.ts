import { describe, expect, it, vi } from 'vitest'
import { InMemoryMultiAgentStore } from '../../../../workers/multi-agent/src'
import {
  CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
  createCodexMultiAgentToolBridge
} from './codex-multi-agent-tools'

describe('Codex multi-agent dynamic tools', () => {
  it('advertises the flat spawn tool expected by Codex app-server', () => {
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor: async () => ({ summary: 'unused' })
    })

    expect(bridge.dynamicTools()).toEqual([
      expect.objectContaining({
        type: 'function',
        name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
        inputSchema: expect.objectContaining({
          type: 'object',
          properties: expect.objectContaining({
            prompt: expect.objectContaining({ type: 'string' }),
            task: expect.objectContaining({ type: 'string' }),
            instructions: expect.objectContaining({ type: 'string' })
          })
        })
      })
    ])
  })

  it('handles flat and namespace spawn calls through the shared runtime', async () => {
    const executor = vi.fn(async ({ prompt }) => ({
      summary: `done: ${prompt}`,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }
    }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'flat',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A', prompt: 'first' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [expect.objectContaining({
        text: expect.stringContaining('"summary": "done: first"')
      })]
    })

    await expect(bridge.callTool({
      requestId: 'namespaced',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      namespace: 'multi_agent_v1',
      tool: 'spawn_agent',
      arguments: { name: 'B', task: 'second' }
    })).resolves.toMatchObject({
      success: true,
      contentItems: [expect.objectContaining({
        text: expect.stringContaining('"summary": "done: second"')
      })]
    })
    expect(executor).toHaveBeenCalledTimes(2)
  })

  it('rejects empty prompts without starting a child run', async () => {
    const executor = vi.fn(async () => ({ summary: 'unreachable' }))
    const bridge = createCodexMultiAgentToolBridge({
      store: new InMemoryMultiAgentStore(),
      executor
    })

    await expect(bridge.callTool({
      requestId: 'empty',
      threadId: 'parent-thread',
      turnId: 'parent-turn',
      tool: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      arguments: { label: 'A' }
    })).resolves.toEqual({
      success: false,
      contentItems: [{
        type: 'inputText',
        text: 'delegate_task requires a prompt, task, or instructions string.'
      }]
    })
    expect(executor).not.toHaveBeenCalled()
  })
})
