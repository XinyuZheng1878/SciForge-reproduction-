import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Options as ClaudeAgentSdkOptions,
  Query as ClaudeAgentSdkQuery,
  SDKMessage
} from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import {
  ClaudeCodeRuntimeService,
  type ClaudeAgentSdk
} from './claude-code-service'
import {
  COMPUTER_USE_DEFAULT_AGENT_ID_ENV,
  COMPUTER_USE_DEFAULT_SESSION_ID_ENV,
  COMPUTER_USE_DEFAULT_THREAD_ID_ENV,
  COMPUTER_USE_DEFAULT_TURN_ID_ENV
} from '../../computer-use-mcp-config'

type QueryCall = {
  prompt: string | AsyncIterable<unknown>
  options?: ClaudeAgentSdkOptions
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/sciforge-workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function fakeSdk(
  handler: (call: QueryCall) => SDKMessage[] | Promise<SDKMessage[]>
): { sdk: ClaudeAgentSdk; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  return {
    calls,
    sdk: {
      query: vi.fn((call: QueryCall) => {
        calls.push(call)
        return queryFromMessages(async () => handler(call))
      })
    }
  }
}

function queryFromMessages(
  messages: () => SDKMessage[] | Promise<SDKMessage[]>
): ClaudeAgentSdkQuery {
  return {
    close: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const message of await messages()) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        yield message
      }
    }
  } as unknown as ClaudeAgentSdkQuery
}

function sdkMessage(value: Record<string, unknown>): SDKMessage {
  return value as SDKMessage
}

function assistantText(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'assistant',
    session_id: sessionId,
    uuid: randomTestId('assistant'),
    parent_tool_use_id: null,
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 3, output_tokens: 4 }
    }
  })
}

function result(text: string, sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: sessionId,
    uuid: randomTestId('result'),
    usage: { input_tokens: 3, output_tokens: 4 }
  })
}

function init(sessionId: string): SDKMessage {
  return sdkMessage({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    uuid: randomTestId('init'),
    apiKeySource: 'ANTHROPIC_API_KEY',
    claude_code_version: '2.1.185',
    cwd: '/tmp/workspace',
    tools: ['Read', 'Edit'],
    mcp_servers: [],
    model: 'sonnet',
    permissionMode: 'acceptEdits',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: []
  })
}

async function serviceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-claude-runtime-'))
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code test condition.')
}

function randomTestId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2)}`
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ClaudeCodeRuntimeService', () => {
  it('connects through the Claude Agent SDK wrapper without launching a probe process', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.connect()

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.info).toMatchObject({
        command: 'claude',
        sdk: '@anthropic-ai/claude-agent-sdk'
      })
    }
  })

  it('creates GUI-owned threads without starting an SDK query', async () => {
    const { sdk, calls } = fakeSdk(() => [])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const result = await service.startThread({ workspace: '/tmp/workspace', title: 'Draft' })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.thread.runtimeId).toBe('claude')
      expect(result.thread.title).toBe('Draft')
    }
  })

  it('starts turns with Model Router SDK env and resumes stored Claude sessions', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-secret')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-1'),
      assistantText('Hello from Claude.', 'claude-session-1'),
      result('Hello from Claude.', 'claude-session-1')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Resume me' })
    if (!thread.ok) throw new Error(thread.message)
    const firstTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'hello',
      workspace: '/tmp/workspace'
    })
    if (!firstTurn.ok) throw new Error(firstTurn.message)
    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok && detail.detail.backendThreadId === 'claude-session-1'
    })
    const secondTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'again',
      workspace: '/tmp/workspace'
    })
    if (!secondTurn.ok) throw new Error(secondTurn.message)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.prompt).toBe('hello')
    expect(calls[0]?.options?.cwd).toBe('/tmp/workspace')
    expect(calls[0]?.options?.model).toBe('sonnet')
    expect(calls[0]?.options?.permissionMode).toBe('acceptEdits')
    expect(calls[0]?.options?.forwardSubagentText).toBe(true)
    expect(calls[0]?.options?.agentProgressSummaries).toBe(true)
    expect(calls[0]?.options?.sessionStore).toBeTruthy()
    expect(calls[0]?.options?.sessionStoreFlush).toBe('eager')
    expect(calls[0]?.options?.extraArgs).toMatchObject({ allowedTools: 'Edit' })
    expect(calls[0]?.options?.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(calls[0]?.options?.env?.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(calls[0]?.options?.env?.ANTHROPIC_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.ANTHROPIC_SMALL_FAST_MODEL).toBe('sonnet')
    expect(calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe('/tmp/sciforge-claude-config')
    expect(calls[0]?.options?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(calls[1]?.options?.resume).toBe('claude-session-1')

    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok &&
        detail.detail.latestTurnStatus === 'completed' &&
        (detail.detail.items?.filter((item) =>
          item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
        ).length ?? 0) === 2
    })
    const detail = await service.readThread(thread.thread.id)
    if (!detail.ok) throw new Error(detail.message)
    expect(detail.detail.backendThreadId).toBe('claude-session-1')
    expect(detail.detail.items?.filter((item) =>
      item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
    )).toHaveLength(2)
  })

  it('passes per-turn computer-use defaults to the Claude MCP server', async () => {
    const { sdk, calls } = fakeSdk(() => [
      init('claude-session-computer-use'),
      result('Done.', 'claude-session-computer-use')
    ])
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      claudeAgentSdk: sdk,
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Computer use' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'use the screen',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)

    const mcpServers = calls[0]?.options?.mcpServers as Record<string, { env?: Record<string, string> }> | undefined
    expect(mcpServers?.gui_computer_use?.env).toMatchObject({
      [COMPUTER_USE_DEFAULT_AGENT_ID_ENV]: `claude:${thread.thread.id}`,
      [COMPUTER_USE_DEFAULT_THREAD_ID_ENV]: thread.thread.id,
      [COMPUTER_USE_DEFAULT_TURN_ID_ENV]: turn.turnId,
      [COMPUTER_USE_DEFAULT_SESSION_ID_ENV]: `claude:${thread.thread.id}`
    })
  })

  it('maps Agent and Workflow tool output and reads mirrored subagent transcripts', async () => {
    const { sdk } = fakeSdk(async (call) => {
      await call.options?.sessionStore?.append({
        projectKey: 'project-a',
        sessionId: 'claude-session-children',
        subpath: 'subagents/agent-agent-42'
      }, [{
        type: 'assistant',
        uuid: 'subagent-entry-1',
        timestamp: '2026-06-21T00:00:00.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Nested transcript line.' }]
        }
      }])
      return [
        init('claude-session-children'),
        sdkMessage({
          type: 'assistant',
          session_id: 'claude-session-children',
          uuid: 'assistant-tools',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: 'tool-agent',
              name: 'Agent',
              input: { prompt: 'Inspect auth', subagent_type: 'code-reviewer' }
            }, {
              type: 'tool_use',
              id: 'tool-workflow',
              name: 'Workflow',
              input: { taskId: 'task-1', workflowName: 'spec' }
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-agent-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-agent',
              content: JSON.stringify({
                agentId: 'agent-42',
                agentType: 'code-reviewer',
                prompt: 'Inspect auth',
                usage: { total_tokens: 42 },
                totalTokens: 42,
                status: 'completed',
                outputFile: '/tmp/agent-output.txt'
              })
            }]
          }
        }),
        sdkMessage({
          type: 'user',
          session_id: 'claude-session-children',
          uuid: 'user-workflow-result',
          parent_tool_use_id: null,
          message: {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: 'tool-workflow',
              content: JSON.stringify({
                taskId: 'task-1',
                runId: 'run-9',
                workflowName: 'spec',
                summary: 'Workflow finished.',
                transcriptDir: '/tmp/workflows/run-9',
                scriptPath: '/tmp/spec.workflow.md',
                status: 'completed'
              })
            }]
          }
        }),
        result('Done.', 'claude-session-children')
      ]
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      claudeAgentSdk: sdk
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Children' })
    if (!thread.ok) throw new Error(thread.message)
    const turn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'delegate',
      workspace: '/tmp/workspace'
    })
    if (!turn.ok) throw new Error(turn.message)
    await waitUntil(async () => {
      const children = await service.listThreadChildren({ threadId: thread.thread.id })
      return children.children.length === 2
    })

    const children = await service.listThreadChildren({ threadId: thread.thread.id })
    expect(children.children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'agent-42',
        kind: 'agent',
        status: 'completed',
        name: 'code-reviewer',
        prompt: 'Inspect auth',
        usage: expect.objectContaining({ totalTokens: 42 }),
        transcriptRef: expect.objectContaining({
          source: 'claude-agent-sdk.sessionStore',
          metadata: expect.objectContaining({
            sessionId: 'claude-session-children',
            subpath: 'subagents/agent-agent-42'
          })
        }),
        metadata: expect.objectContaining({
          agentId: 'agent-42',
          agentType: 'code-reviewer',
          outputFile: '/tmp/agent-output.txt'
        })
      }),
      expect.objectContaining({
        id: 'run-9',
        kind: 'workflow',
        status: 'completed',
        name: 'spec',
        summary: 'Workflow finished.',
        transcriptRef: expect.objectContaining({
          path: '/tmp/workflows/run-9'
        }),
        metadata: expect.objectContaining({
          taskId: 'task-1',
          runId: 'run-9',
          workflowName: 'spec',
          transcriptDir: '/tmp/workflows/run-9',
          scriptPath: '/tmp/spec.workflow.md'
        })
      })
    ]))

    const transcript = await service.readChildTranscript({
      parentThreadId: thread.thread.id,
      childId: 'agent-42'
    })
    expect(transcript.transcript.entries).toEqual([
      expect.objectContaining({
        id: 'subagent-entry-1',
        kind: 'assistant_message',
        text: 'Nested transcript line.'
      })
    ])
  })
})
