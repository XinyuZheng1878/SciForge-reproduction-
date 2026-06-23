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

  it('reports shared computer-use MCP diagnostics when Codex managed config includes it', async () => {
    const adapter = createCodexAgentRuntimeAdapter({
      isMcpConfigured: () => true,
      isResearchMcpConfigured: () => false,
      isComputerUseMcpConfigured: () => true
    } as never)

    const caps = await adapter.capabilities({ settings: {} as never })
    expect(caps.tools.mcp).toMatchObject({
      available: true,
      degraded: true,
      toolCount: 1
    })
    expect(caps.tools.computerUse).toMatchObject({
      available: true,
      server: 'mcp',
      toolName: 'computer_use',
      backend: 'browser-cdp',
      inputIsolation: 'agent-isolated',
      affectsUserInput: false,
      requiresHostFocus: false,
      usesHostClipboard: false
    })
    expect(caps.tools.research).toMatchObject({
      available: false
    })

    await expect(adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'getToolDiagnostics'
    })).resolves.toMatchObject({
      mcpServers: [{
        id: 'gui_computer_use',
        status: 'configured',
        toolCount: 1,
        tools: ['computer_use']
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

  it('maps stored Codex child events and lists direct children for the requested thread only', async () => {
    const childStarted = {
      id: 'collab-1',
      runtimeId: 'codex' as const,
      parentThreadId: 'parent-thread',
      parentTurnId: 'turn-1',
      kind: 'agent' as const,
      status: 'running' as const,
      name: 'Reviewer',
      prompt: 'Review the diff',
      openAsThreadRef: {
        runtimeId: 'codex' as const,
        threadId: 'child-thread',
        relation: 'side' as const
      }
    }
    const childCompleted = {
      ...childStarted,
      status: 'completed' as const,
      summary: 'Found one issue.'
    }
    const service = {
      readStoredEvents: vi.fn(async (threadId: string) => threadId === 'parent-thread'
        ? [
            { threadId, turnId: 'turn-1', seq: 1, child: childStarted },
            { threadId, turnId: 'turn-1', seq: 2, child: childCompleted },
            {
              threadId,
              turnId: 'turn-1',
              seq: 3,
              child: {
                ...childCompleted,
                id: 'other-child',
                parentThreadId: 'other-thread'
              }
            }
          ]
        : []),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 2,
          blocks: [
            { kind: 'user' as const, id: 'child-user', text: 'Review the diff' },
            { kind: 'assistant' as const, id: 'child-assistant', text: 'Found one issue.' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const events = []
    for await (const event of adapter.subscribeEvents({ settings: {} as never }, {
      runtimeId: 'codex',
      threadId: 'parent-thread'
    })) {
      events.push(event)
    }
    expect(events.filter((event) => event.kind === 'child_event').map((event) => event.child.id)).toContain('collab-1')

    const listed = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread' }
    })

    expect(listed).toMatchObject({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      children: [{
        id: 'collab-1',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        status: 'completed',
        prompt: 'Review the diff',
        summary: 'Found one issue.',
        openAsThreadRef: {
          runtimeId: 'codex',
          threadId: 'child-thread',
          relation: 'side'
        }
      }]
    })
    expect((listed as { children: Array<{ id: string }> }).children.map((child) => child.id)).toEqual(['collab-1'])

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', childId: 'collab-1' }
    })

    expect(service.readThread).toHaveBeenCalledWith('child-thread')
    expect(transcript).toMatchObject({
      transcript: {
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        childId: 'collab-1',
        entries: [
          { id: 'child-user', kind: 'user_message', text: 'Review the diff' },
          { id: 'child-assistant', kind: 'assistant_message', text: 'Found one issue.' }
        ],
        metadata: {
          source: 'openAsThreadRef',
          threadId: 'child-thread'
        }
      }
    })
  })

  it('lists native Codex subagent threads for the active parent thread', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => []),
      listThreads: vi.fn(async () => ({
        ok: true as const,
        threads: [
          {
            id: 'native-child',
            title: 'Reviewer',
            updatedAt: '2026-06-21T00:00:01.000Z',
            model: 'gpt-5',
            mode: 'agent',
            status: 'running',
            preview: 'Reviewing the patch',
            latestTurnStatus: 'running',
            parentThreadId: 'parent-thread',
            parentTurnId: 'turn-1',
            relation: 'side' as const,
            threadSource: 'subagent',
            agentNickname: 'Reviewer',
            agentRole: 'code reviewer'
          },
          {
            id: 'other-native-child',
            title: 'Other',
            updatedAt: '2026-06-21T00:00:02.000Z',
            model: 'gpt-5',
            mode: 'agent',
            status: 'running',
            parentThreadId: 'other-thread',
            threadSource: 'subagent'
          }
        ]
      })),
      readThread: vi.fn(async () => ({
        ok: true as const,
        detail: {
          latestSeq: 1,
          blocks: [
            { kind: 'assistant' as const, id: 'native-assistant', text: 'Native child transcript.' }
          ]
        }
      }))
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const listed = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'listThreadChildren',
      payload: { threadId: 'parent-thread', parentTurnId: 'turn-1' }
    })

    expect(service.listThreads).toHaveBeenCalledWith({ includeArchived: true })
    expect(listed).toMatchObject({
      runtimeId: 'codex',
      threadId: 'parent-thread',
      parentTurnId: 'turn-1',
      children: [{
        id: 'native-child',
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        kind: 'thread',
        status: 'running',
        name: 'Reviewer',
        label: 'code reviewer',
        summary: 'Reviewing the patch',
        openAsThreadRef: {
          runtimeId: 'codex',
          threadId: 'native-child',
          relation: 'side',
          title: 'Reviewer'
        },
        transcriptRef: {
          runtimeId: 'codex',
          childId: 'native-child',
          transcriptId: 'native-child',
          source: 'codex-thread'
        }
      }]
    })

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', parentTurnId: 'turn-1', childId: 'native-child' }
    })

    expect(service.readThread).toHaveBeenCalledWith('native-child')
    expect(transcript).toMatchObject({
      transcript: {
        runtimeId: 'codex',
        parentThreadId: 'parent-thread',
        parentTurnId: 'turn-1',
        childId: 'native-child',
        entries: [
          { id: 'native-assistant', kind: 'assistant_message', text: 'Native child transcript.' }
        ],
        metadata: {
          source: 'openAsThreadRef',
          threadId: 'native-child'
        }
      }
    })
  })

  it('returns a degraded child transcript when Codex exposes no real child thread', async () => {
    const service = {
      readStoredEvents: vi.fn(async () => [{
        threadId: 'parent-thread',
        turnId: 'turn-1',
        seq: 1,
        child: {
          id: 'summary-only',
          runtimeId: 'codex' as const,
          parentThreadId: 'parent-thread',
          parentTurnId: 'turn-1',
          kind: 'agent' as const,
          status: 'completed' as const,
          prompt: 'Summarize the logs',
          summary: 'No transcript was exposed.'
        }
      }]),
      readThread: vi.fn()
    }
    const adapter = createCodexAgentRuntimeAdapter(service as never)

    const transcript = await adapter.auxiliary!({ settings: {} as never }, {
      runtimeId: 'codex',
      operation: 'readChildTranscript',
      payload: { parentThreadId: 'parent-thread', childId: 'summary-only' }
    })

    expect(service.readThread).not.toHaveBeenCalled()
    expect(transcript).toMatchObject({
      transcript: {
        childId: 'summary-only',
        degraded: true,
        reason: 'Codex app-server did not expose a real child thread transcript.',
        entries: [
          { kind: 'user_message', text: 'Summarize the logs' },
          { kind: 'assistant_message', text: 'No transcript was exposed.' }
        ]
      }
    })
  })
})
