import { describe, expect, it, vi } from 'vitest'
import {
  createCodexDynamicMcpToolBridge,
  dynamicToolResponseFromMcpResult,
  type CodexDynamicMcpClient
} from './codex-dynamic-mcp-tools'

describe('Codex dynamic MCP tool bridge', () => {
  it('advertises MCP tools as flat Codex dynamic tools', async () => {
    const client = fakeMcpClient({
      tools: [
        {
          name: 'research.search',
          description: 'Search scientific literature.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
        },
        {
          name: 'ignored_tool',
          description: 'Not enabled.'
        }
      ]
    })
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui.research',
        command: '/bin/research-mcp',
        enabledTools: ['research.search']
      }],
      clientFactory: async () => client
    })

    await expect(bridge.dynamicTools()).resolves.toEqual([
      {
        name: 'research_search',
        description: 'Search scientific literature.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
      }
    ])
  })

  it('disambiguates duplicate MCP tool names without relying on namespace exposure', async () => {
    const labACallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-a' }] }))
    const labBCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'lab-b' }] }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [
        { id: 'lab.a', command: '/bin/lab-a' },
        { id: 'lab.b', command: '/bin/lab-b' }
      ],
      clientFactory: async (server) => fakeMcpClient({
        tools: [{ name: 'lookup', description: `Lookup for ${server.id}.` }],
        callTool: server.id === 'lab.a' ? labACallTool : labBCallTool
      })
    })

    const tools = await bridge.dynamicTools()
    expect(tools.map((tool) => tool.name)).toEqual(['mcp_lab_a_lookup', 'mcp_lab_b_lookup'])

    await expect(bridge.callTool({
      requestId: 'call-request-flat',
      tool: 'mcp_lab_b_lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'lab-b' }],
      success: true
    })
    expect(labACallTool).not.toHaveBeenCalled()
    expect(labBCallTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('routes dynamic tool calls back to the original MCP tool name', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { rows: 1 }
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'tool.with.dot', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-1',
      namespace: 'mcp_server-1',
      tool: 'tool_with_dot',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [
        { type: 'inputText', text: 'ok' },
        { type: 'inputText', text: 'structuredContent:\n{\n  "rows": 1\n}' }
      ],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'tool.with.dot', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('routes dotted dynamic tool call names back to their MCP server namespace', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'lookup', description: 'Callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'call-request-dotted',
      tool: 'mcp_server-1.lookup',
      arguments: { value: 1 }
    })).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'ok' }],
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      { name: 'lookup', arguments: { value: 1 } },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('injects Codex computer-use context into dynamic MCP calls', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'bound' }],
      structuredContent: { ok: true }
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui_computer_use',
        command: '/bin/computer-use-mcp',
        enabledTools: ['computer_use']
      }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'computer_use', description: 'Shared host UI control.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    await expect(bridge.callTool({
      requestId: 'request-1',
      threadId: 'codex-thread-1',
      turnId: 'codex-turn-1',
      tool: 'computer_use',
      arguments: {
        action: 'bind_target',
        targetId: 'desktop:global',
        agentId: 'model-agent',
        threadId: 'model-thread',
        turnId: 'model-turn',
        computerUseSessionId: 'model-session'
      }
    })).resolves.toMatchObject({
      success: true
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'computer_use',
        arguments: {
          action: 'bind_target',
          targetId: 'desktop:global',
          agentId: 'codex:codex-thread-1',
          threadId: 'codex-thread-1',
          turnId: 'codex-turn-1',
          computerUseSessionId: 'codex:codex-thread-1'
        }
      },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeout: 30_000 })
    )
  })

  it('aborts in-flight MCP calls for an interrupted turn and records the reason', async () => {
    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const callTool: CodexDynamicMcpClient['callTool'] = vi.fn((_input, options) => new Promise((_, reject) => {
      resolveStarted()
      options?.signal?.addEventListener('abort', () => {
        reject(options.signal?.reason ?? new Error('aborted'))
      }, { once: true })
    }))
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{ id: 'server-1', command: '/bin/mcp' }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'slow_tool', description: 'Slow callable.' }],
        callTool
      })
    })

    await bridge.dynamicTools()
    const pending = bridge.callTool({
      requestId: 'request-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      tool: 'slow_tool',
      arguments: {}
    })
    await started
    expect(bridge.abortRequestsForTurn('thread-1', 'turn-1', 'user_stop')).toBe(1)
    await expect(pending).resolves.toMatchObject({ success: false })
    expect(bridge.lifecycleEvents()).toEqual([
      expect.objectContaining({
        event: 'request_aborted',
        reason: 'user_stop',
        requestId: 'request-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        toolName: 'slow_tool'
      })
    ])
  })

  it('releases tracked Codex computer-use sessions when closing the MCP bridge', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true }
    }))
    const close = vi.fn(async () => undefined)
    const bridge = createCodexDynamicMcpToolBridge({
      servers: [{
        id: 'gui_computer_use',
        command: '/bin/computer-use-mcp',
        enabledTools: ['computer_use']
      }],
      clientFactory: async () => fakeMcpClient({
        tools: [{ name: 'computer_use', description: 'Shared host UI control.' }],
        callTool,
        close
      })
    })

    await bridge.dynamicTools()
    await bridge.callTool({
      requestId: 'request-1',
      threadId: 'codex-thread-1',
      turnId: 'codex-turn-1',
      tool: 'computer_use',
      arguments: { action: 'bind_target', targetId: 'desktop:global' }
    })
    await bridge.close('user_stop')

    expect(callTool).toHaveBeenLastCalledWith(
      {
        name: 'computer_use',
        arguments: {
          action: 'release_target',
          computerUseSessionId: 'codex:codex-thread-1',
          reason: 'user_stop'
        }
      },
      { timeout: 5_000 }
    )
    expect(close).toHaveBeenCalled()
    expect(bridge.lifecycleEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'computer_use_release_requested',
        reason: 'user_stop',
        sessionId: 'codex:codex-thread-1'
      }),
      expect.objectContaining({
        event: 'server_closed',
        reason: 'user_stop'
      })
    ]))
  })

  it('converts MCP error results into failed dynamic tool responses', () => {
    expect(dynamicToolResponseFromMcpResult({
      content: [{ type: 'text', text: 'failed upstream' }],
      isError: true
    })).toEqual({
      contentItems: [{ type: 'inputText', text: 'failed upstream' }],
      success: false
    })
  })
})

function fakeMcpClient(options: {
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>
  callTool?: CodexDynamicMcpClient['callTool']
  close?: CodexDynamicMcpClient['close']
}): CodexDynamicMcpClient {
  return {
    listTools: vi.fn(async () => ({ tools: options.tools })),
    callTool: options.callTool ?? vi.fn(async () => ({ content: [] })),
    close: options.close ?? vi.fn(async () => undefined)
  }
}
