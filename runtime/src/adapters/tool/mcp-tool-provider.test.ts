import { describe, expect, it, vi } from 'vitest'
import { McpCapabilityConfig } from '../../contracts/capabilities.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import {
  buildMcpToolProviders,
  normalizeMcpToolName,
  type McpClientLike
} from './mcp-tool-provider.js'

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

function config() {
  return McpCapabilityConfig.parse({
    enabled: true,
    servers: {
      gui_workspace_intel: {
        enabled: true,
        transport: 'stdio',
        command: 'mock-workspace-intel',
        trustScope: 'user',
        timeoutMs: 1000
      }
    }
  })
}

describe('buildMcpToolProviders workspace-intel arguments', () => {
  it('injects the thread workspaceRoot for gui_workspace tools when the model omits it', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const client: McpClientLike = {
      listTools: async () => ({
        tools: [{
          name: 'gui_workspace_tree',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              workspaceRoot: { type: 'string' }
            }
          }
        }]
      }),
      callTool,
      close: async () => undefined
    }
    const built = await buildMcpToolProviders(config(), {
      clientFactory: async () => client
    })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_tree')
    )

    await tool?.execute({ path: 'docs/research' }, fakeContext())

    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_workspace_tree',
        arguments: {
          path: 'docs/research',
          workspaceRoot: '/tmp/research-workspace'
        }
      },
      expect.objectContaining({ timeout: 1000 })
    )
  })

  it('preserves an explicit workspaceRoot for gui_workspace tools', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const client: McpClientLike = {
      listTools: async () => ({
        tools: [{
          name: 'gui_workspace_read',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              workspaceRoot: { type: 'string' }
            }
          }
        }]
      }),
      callTool,
      close: async () => undefined
    }
    const built = await buildMcpToolProviders(config(), {
      clientFactory: async () => client
    })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_read')
    )

    await tool?.execute({ path: 'PROJECT_research.md', workspaceRoot: '/tmp/explicit' }, fakeContext())

    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'gui_workspace_read',
        arguments: {
          path: 'PROJECT_research.md',
          workspaceRoot: '/tmp/explicit'
        }
      },
      expect.objectContaining({ timeout: 1000 })
    )
  })

  it('reconnects MCP clients that report Not connected', async () => {
    const firstClose = vi.fn(async () => undefined)
    const firstClient: McpClientLike = {
      listTools: async () => ({
        tools: [{ name: 'gui_workspace_read', inputSchema: { type: 'object' } }]
      }),
      callTool: vi.fn(async () => {
        throw new Error('Not connected')
      }),
      close: firstClose
    }
    const secondCallTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'reconnected' }] }))
    const secondClient: McpClientLike = {
      listTools: async () => ({ tools: [] }),
      callTool: secondCallTool,
      close: async () => undefined
    }
    let factoryCalls = 0
    const clientFactory = vi.fn(async () => factoryCalls++ === 0 ? firstClient : secondClient)
    const built = await buildMcpToolProviders(config(), { clientFactory })
    const tool = built.providers[0]?.tools.find((candidate) =>
      candidate.name === normalizeMcpToolName('gui_workspace_intel', 'gui_workspace_read')
    )

    const result = await tool?.execute({}, fakeContext())

    expect(result?.output).toEqual({
      serverId: 'gui_workspace_intel',
      toolName: 'gui_workspace_read',
      result: { content: [{ type: 'text', text: 'reconnected' }] }
    })
    expect(firstClose).toHaveBeenCalled()
    expect(secondCallTool).toHaveBeenCalled()
  })
})
