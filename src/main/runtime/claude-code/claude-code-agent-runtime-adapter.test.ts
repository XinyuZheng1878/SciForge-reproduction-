import { describe, expect, it } from 'vitest'
import type { AgentRuntimeAdapterContext } from '../agent-runtime/adapter'
import type { ClaudeCodeRuntimeService } from './claude-code-service'
import { createClaudeCodeAgentRuntimeAdapter } from './claude-code-agent-runtime-adapter'

describe('createClaudeCodeAgentRuntimeAdapter', () => {
  it('reports memory as unavailable without failing listMemories diagnostics', async () => {
    const adapter = createClaudeCodeAgentRuntimeAdapter({
      runtimeInfo: async () => ({
        command: 'claude',
        model: 'deepseek-gui-router'
      })
    } as unknown as ClaudeCodeRuntimeService)
    const ctx = { settings: {} } as AgentRuntimeAdapterContext

    await expect(adapter.capabilities(ctx)).resolves.toMatchObject({
      runtimeId: 'claude',
      storage: {
        memory: { available: false }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'getRuntimeInfo'
    })).resolves.toMatchObject({
      host: 'claude-code',
      command: 'claude',
      model: 'deepseek-gui-router',
      capabilities: {
        attachments: { available: false },
        web: {
          fetch: { available: false },
          search: { available: false }
        },
        memory: { available: false }
      }
    })
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'listMemories',
      payload: { options: { workspace: '/tmp/project', includeDeleted: false } }
    })).resolves.toEqual([])
    await expect(adapter.auxiliary?.(ctx, {
      operation: 'updateMemory',
      payload: { memoryId: 'mem_1', patch: { disabled: true } }
    })).rejects.toThrow(/does not support memory operations/)
  })
})
