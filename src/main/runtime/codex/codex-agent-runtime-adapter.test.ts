import { describe, expect, it, vi } from 'vitest'
import { createCodexAgentRuntimeAdapter } from './codex-agent-runtime-adapter'

describe('createCodexAgentRuntimeAdapter', () => {
  it('reports shared research MCP capability when Codex managed config includes it', async () => {
    const adapter = createCodexAgentRuntimeAdapter({
      isResearchMcpConfigured: () => true
    } as never)

    const caps = await adapter.capabilities({ settings: {} as never })
    expect(caps.tools.research).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'research_search',
      sources: ['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns'],
      maxResults: 10
    })
    expect(caps.tools.mcp).toMatchObject({
      available: true,
      degraded: true,
      toolCount: 1
    })

    await expect(adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'getToolDiagnostics'
    })).resolves.toMatchObject({
      mcpServers: [{
        id: 'gui_research',
        status: 'configured',
        toolCount: 1,
        tools: ['research_search']
      }]
    })
  })

  it('keeps Codex thread blocks grouped by their source turn id', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 4,
          latestTurnId: 'turn-2',
          threadStatus: 'completed',
          blocks: [
            { kind: 'user' as const, id: 'user-1', turnId: 'turn-1', text: 'Q1' },
            { kind: 'assistant' as const, id: 'assistant-1', turnId: 'turn-1', text: 'R1' },
            { kind: 'user' as const, id: 'user-2', turnId: 'turn-2', text: 'Q2' },
            { kind: 'assistant' as const, id: 'assistant-2', turnId: 'turn-2', text: 'R2' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.latestTurnId).toBe('turn-2')
    expect(detail.turns?.map((turn) => turn.id)).toEqual(['turn-1', 'turn-2'])
    expect(detail.turns?.find((turn) => turn.id === 'turn-1')?.items?.map((item) => item.text)).toEqual(['Q1', 'R1'])
    expect(detail.turns?.find((turn) => turn.id === 'turn-2')?.items?.map((item) => item.text)).toEqual(['Q2', 'R2'])
  })

  it('maps interrupted Codex thread status to an aborted turn instead of inferring running', async () => {
    const service = {
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 1,
          latestTurnId: 'turn-1',
          threadStatus: 'interrupted',
          blocks: [
            { kind: 'user' as const, id: 'user-1', turnId: 'turn-1', text: 'Q1' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const detail = await adapter.readThread({ settings: {} as never }, { runtimeId: 'codex', threadId: 'thread-1' })

    expect(detail.turns?.[0]).toMatchObject({
      id: 'turn-1',
      status: 'aborted'
    })
  })
})
