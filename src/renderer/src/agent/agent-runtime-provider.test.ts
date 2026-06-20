import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AgentRuntimeId,
  type AppSettingsV1
} from '@shared/app-settings'
import {
  createDefaultAgentRuntimeCapabilities,
  type AgentRuntimeCapabilities,
  type AgentRuntimeEvent
} from '@shared/agent-runtime-contract'
import { AgentRuntimeProvider } from './agent-runtime-provider'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

function settings(activeAgentRuntime: AgentRuntimeId): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime,
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function makeSink(): ThreadEventSink {
  return {
    onSeq: vi.fn(),
    onDeltas: vi.fn(),
    onUserMessage: vi.fn(),
    onTool: vi.fn(),
    onCompaction: vi.fn(),
    onReview: vi.fn(),
    onApproval: vi.fn(),
    onUserInput: vi.fn(),
    onUserInputStatus: vi.fn(),
    onRuntimeStatus: vi.fn(),
    onRuntimeError: vi.fn(),
    onGoal: vi.fn(),
    onTodos: vi.fn(),
    onTurnComplete: vi.fn(),
    onError: vi.fn(),
    onUsage: vi.fn()
  }
}

function capabilities(runtimeId: AgentRuntimeId): AgentRuntimeCapabilities {
  return {
    ...createDefaultAgentRuntimeCapabilities({
      runtimeId,
      transport: runtimeId === 'kun' ? 'http_sse' : runtimeId === 'claude' ? 'cli_process' : 'jsonrpc_stdio'
    }),
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'sse'
    },
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: runtimeId === 'kun' ? 'full_runtime_text' : 'summary',
      source: runtimeId === 'kun' ? 'model' : 'runtime_summary'
    },
    tools: {
      ...createDefaultAgentRuntimeCapabilities({
        runtimeId,
        transport: runtimeId === 'kun' ? 'http_sse' : runtimeId === 'claude' ? 'cli_process' : 'jsonrpc_stdio'
      }).tools,
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      diagnostics: { available: runtimeId === 'kun' }
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: runtimeId === 'kun' ? 'async' : 'fail_closed',
      userInput: runtimeId === 'kun' ? 'async' : 'fail_closed',
      compact: runtimeId === 'kun' ? 'native' : 'noop',
      fork: runtimeId === 'kun',
      review: runtimeId === 'kun',
      goals: runtimeId === 'kun',
      todos: runtimeId === 'kun',
      resumeSession: runtimeId === 'kun'
    },
    storage: {
      guiOwnedThreads: runtimeId === 'codex',
      backendThreadIdStable: runtimeId === 'kun',
      usage: true,
      attachments: { available: runtimeId === 'kun' },
      memory: { available: runtimeId === 'kun' }
    }
  }
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('AgentRuntimeProvider', () => {
  it('routes provider operations through neutral agentRuntime IPC with the active runtime id', async () => {
    const connect = vi.fn(async () => undefined)
    const listThreads = vi.fn(async () => [
      { id: 'thread-1', runtimeId: 'codex', title: 'One', updatedAt: '2026-06-11T00:00:00.000Z' }
    ])
    const startThread = vi.fn(async () => ({
      id: 'thread-2',
      runtimeId: 'codex',
      title: 'Two',
      updatedAt: '2026-06-11T00:01:00.000Z',
      workspace: '/tmp/workspace'
    }))
    const readThread = vi.fn(async () => ({
      id: 'thread-2',
      runtimeId: 'codex',
      title: 'Two',
      updatedAt: '2026-06-11T00:01:00.000Z',
      latestSeq: 3,
      latestTurnId: 'turn-1',
      items: [
        { id: 'user-1', kind: 'user_message', text: 'hello', createdAt: '2026-06-11T00:01:01.000Z' },
        { id: 'assistant-1', kind: 'assistant_message', text: 'hi', createdAt: '2026-06-11T00:01:02.000Z' }
      ]
    }))
    const startTurn = vi.fn(async () => ({ threadId: 'thread-2', turnId: 'turn-2', userMessageItemId: 'user-2' }))
    const interruptTurn = vi.fn(async () => undefined)
    const steerTurn = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const forkThread = vi.fn(async () => ({
      id: 'side-thread',
      runtimeId: 'codex',
      title: 'Side path',
      updatedAt: '2026-06-11T00:02:00.000Z',
      model: 'gpt-5',
      mode: 'agent'
    }))
    const resumeSession = vi.fn(async () => ({ threadId: 'resumed-thread', sessionId: 'session-1' }))
    const updateThreadRelation = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          connect,
          capabilities: vi.fn(async () => capabilities('codex')),
          listThreads,
          startThread,
          readThread,
          startTurn,
          interruptTurn,
          steerTurn,
          renameThread,
          deleteThread,
          compactThread,
          forkThread,
          resumeSession,
          updateThreadRelation
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.connect()).resolves.toBeUndefined()
    expect(provider.id).toBe('codex')
    await expect(provider.listThreads({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: 'thread-1', title: 'One', runtimeId: 'codex' })
    ])
    await expect(provider.createThread({ title: 'Two', workspace: '/tmp/workspace', mode: 'agent' })).resolves.toEqual(
      expect.objectContaining({ id: 'thread-2', title: 'Two', runtimeId: 'codex' })
    )
    await expect(provider.getThreadDetail('thread-2')).resolves.toMatchObject({
      latestSeq: 3,
      latestTurnId: 'turn-1',
      latestUserMessageId: 'user-1',
      blocks: [
        { kind: 'user', id: 'user-1', text: 'hello' },
        { kind: 'assistant', id: 'assistant-1', text: 'hi' }
      ]
    })
    await expect(provider.sendUserMessage('thread-2', 'hello', {
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello'
    })).resolves.toEqual({ threadId: 'thread-2', turnId: 'turn-2', userMessageItemId: 'user-2' })
    await expect(provider.interruptTurn('thread-2', 'turn-2', { discard: true })).resolves.toBeUndefined()
    await expect(provider.steerUserMessage?.('thread-2', 'turn-2', 'more')).resolves.toBeUndefined()
    await expect(provider.renameThread('thread-2', 'Renamed')).resolves.toBeUndefined()
    await expect(provider.compactThread?.('thread-2', 'manual')).resolves.toBeUndefined()
    await expect(provider.forkThread?.('thread-2', { relation: 'side', title: 'Side path' })).resolves.toEqual(
      expect.objectContaining({ id: 'side-thread', title: 'Side path', runtimeId: 'codex' })
    )
    await expect(provider.resumeSession?.('session-1', {
      model: 'gpt-5',
      mode: 'agent'
    })).resolves.toEqual({ threadId: 'resumed-thread', sessionId: 'session-1' })
    await expect(provider.updateThreadRelation?.('thread-2', 'primary')).resolves.toBeUndefined()
    await expect(provider.deleteThread('thread-2')).resolves.toBeUndefined()

    expect(connect).toHaveBeenCalledWith('codex')
    expect(listThreads).toHaveBeenCalledWith({ runtimeId: 'codex', limit: 1 })
    expect(startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      title: 'Two',
      workspace: '/tmp/workspace',
      mode: 'agent'
    })
    expect(readThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'thread-2' })
    expect(startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      text: 'hello',
      model: 'gpt-5',
      reasoningEffort: 'medium',
      displayText: 'hello'
    })
    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      discard: true
    })
    expect(steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      turnId: 'turn-2',
      text: 'more'
    })
    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      title: 'Renamed'
    })
    expect(deleteThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2'
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      reason: 'manual'
    })
    expect(forkThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      relation: 'side',
      title: 'Side path'
    })
    expect(resumeSession).toHaveBeenCalledWith({
      runtimeId: 'codex',
      sessionId: 'session-1',
      model: 'gpt-5',
      mode: 'agent'
    })
    expect(updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      relation: 'primary'
    })
  })

  it('preserves structured user input questions from persisted thread detail', async () => {
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-input',
            runtimeId: 'codex',
            title: 'Input thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Pick deployment target',
                status: 'pending',
                meta: {
                  requestId: 'request-1',
                  questions: [
                    {
                      id: 'target',
                      header: 'Target',
                      question: 'Where should this run?',
                      options: [
                        { label: 'Staging', description: 'Use staging account' },
                        { label: 'Production' }
                      ]
                    }
                  ]
                },
                createdAt: '2026-06-11T00:00:01.000Z'
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-input', 'codex')

    await expect(provider.getThreadDetail('thread-input')).resolves.toMatchObject({
      blocks: [
        {
          kind: 'user_input',
          requestId: 'request-1',
          questions: [
            {
              id: 'target',
              header: 'Target',
              question: 'Where should this run?',
              options: [
                { label: 'Staging', description: 'Use staging account' },
                { label: 'Production', description: '' }
              ]
            }
          ]
        }
      ]
    })
  })

  it('settles stale running tool items from terminal thread snapshots', async () => {
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-completed-tool',
            runtimeId: 'codex',
            title: 'Completed tool thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            status: 'completed',
            latestSeq: 5,
            latestTurnId: 'turn-1',
            turns: [{
              id: 'turn-1',
              threadId: 'thread-completed-tool',
              status: 'completed',
              items: [
                {
                  id: 'user-1',
                  kind: 'user_message',
                  text: 'hello',
                  createdAt: '2026-06-11T00:00:01.000Z'
                },
                {
                  id: 'tool-call-1',
                  kind: 'tool',
                  summary: 'Read file',
                  status: 'running',
                  toolKind: 'command_execution',
                  meta: { callId: 'call-1', toolName: 'local_shell' },
                  createdAt: '2026-06-11T00:00:02.000Z'
                },
                {
                  id: 'tool-result-1',
                  kind: 'tool',
                  summary: 'Read file',
                  status: 'success',
                  toolKind: 'command_execution',
                  meta: { callId: 'call-1', toolName: 'local_shell' },
                  createdAt: '2026-06-11T00:00:03.000Z'
                },
                {
                  id: 'assistant-1',
                  kind: 'assistant_message',
                  text: 'done',
                  createdAt: '2026-06-11T00:00:04.000Z'
                }
              ]
            }]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-completed-tool', 'codex')

    const detail = await provider.getThreadDetail('thread-completed-tool')

    expect(detail.blocks).toEqual([
      expect.objectContaining({ kind: 'user', id: 'user-1' }),
      expect.objectContaining({ kind: 'tool', id: 'tool-result-1', status: 'success' }),
      expect.objectContaining({ kind: 'assistant', id: 'assistant-1', text: 'done' })
    ])
    expect(detail.blocks.some((block) => block.kind === 'tool' && block.status === 'running')).toBe(false)
  })

  it('settles stale pending blocks from idle snapshots', async () => {
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-idle',
            runtimeId: 'codex',
            title: 'Idle thread',
            updatedAt: '2026-06-11T00:00:00.000Z',
            status: 'idle',
            latestSeq: 3,
            items: [
              {
                id: 'tool-running',
                kind: 'tool',
                summary: 'Old command',
                status: 'running',
                toolKind: 'command_execution',
                createdAt: '2026-06-11T00:00:01.000Z'
              },
              {
                id: 'input-pending',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-1' },
                createdAt: '2026-06-11T00:00:02.000Z'
              }
            ]
          }))
        },
        forbiddenDirectCall: vi.fn(),
      }
    })
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-idle', 'codex')

    const detail = await provider.getThreadDetail('thread-idle')

    expect(detail.blocks).toEqual([
      expect.objectContaining({ kind: 'tool', id: 'tool-running', status: 'success' }),
      expect.objectContaining({ kind: 'user_input', id: 'input-pending', status: 'cancelled' })
    ])
    expect(detail.blocks.some((block) => block.kind === 'tool' && block.status === 'running')).toBe(false)
    expect(detail.blocks.some((block) => block.kind === 'user_input' && block.status === 'pending')).toBe(false)
  })

  it('routes thread-bound mutations through the runtime remembered for the thread', async () => {
    let activeRuntime: AgentRuntimeId = 'codex'
    const readThread = vi.fn(async () => ({
      id: 'codex-thread',
      runtimeId: 'codex',
      title: 'Codex thread',
      updatedAt: '2026-06-11T00:01:00.000Z',
      latestSeq: 1,
      items: [{
        id: 'input-item',
        kind: 'user_input',
        summary: 'Choose one',
        status: 'pending',
        meta: { requestId: 'input-codex' }
      }]
    }))
    const startTurn = vi.fn(async () => ({
      threadId: 'codex-thread',
      turnId: 'turn-next',
      userMessageItemId: 'user-next'
    }))
    const interruptTurn = vi.fn(async () => undefined)
    const steerTurn = vi.fn(async () => undefined)
    const renameThread = vi.fn(async () => undefined)
    const deleteThread = vi.fn(async () => undefined)
    const compactThread = vi.fn(async () => undefined)
    const updateThreadRelation = vi.fn(async () => undefined)
    const auxiliary = vi.fn(async (input) => {
      if (input.operation === 'reviewThread') {
        return { threadId: input.payload.threadId, turnId: 'review-turn' }
      }
      if (input.operation === 'setThreadGoal') {
        return {
          threadId: input.payload.threadId,
          objective: 'ship it',
          status: 'active',
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: '2026-06-11T00:00:00.000Z',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
      if (input.operation === 'clearThreadGoal') return true
      if (input.operation === 'getThreadTodos') return null
      if (input.operation === 'archiveThread') return undefined
      if (input.operation === 'cancelUserInput') return undefined
      return undefined
    })
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings(activeRuntime)),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread,
          startTurn,
          interruptTurn,
          steerTurn,
          renameThread,
          deleteThread,
          compactThread,
          updateThreadRelation,
          auxiliary
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.getThreadDetail('codex-thread')

    activeRuntime = 'kun'
    rendererRuntimeClient.invalidateSettings()

    await provider.sendUserMessage('codex-thread', 'follow up')
    await provider.interruptTurn('codex-thread', 'turn-next')
    await provider.steerUserMessage?.('codex-thread', 'turn-next', 'more')
    await provider.renameThread('codex-thread', 'Renamed')
    await provider.compactThread?.('codex-thread', 'manual')
    await provider.reviewThread?.('codex-thread', { kind: 'uncommittedChanges' })
    await provider.setThreadGoal?.('codex-thread', { objective: 'ship it', status: 'active' })
    await provider.clearThreadGoal?.('codex-thread')
    await provider.getThreadTodos?.('codex-thread')
    await provider.archiveThread?.('codex-thread', true)
    await provider.cancelUserInput?.('input-codex')
    await provider.updateThreadRelation?.('codex-thread', 'primary')
    await provider.deleteThread('codex-thread')

    expect(startTurn).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'codex-thread', text: 'follow up' })
    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-next'
    })
    expect(steerTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      turnId: 'turn-next',
      text: 'more'
    })
    expect(renameThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      title: 'Renamed'
    })
    expect(compactThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      reason: 'manual'
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'reviewThread',
      payload: {
        threadId: 'codex-thread',
        target: { kind: 'uncommittedChanges' },
        model: undefined
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'setThreadGoal',
      payload: {
        threadId: 'codex-thread',
        patch: { objective: 'ship it', status: 'active' }
      }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'clearThreadGoal',
      payload: { threadId: 'codex-thread' }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'getThreadTodos',
      payload: { threadId: 'codex-thread' }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'archiveThread',
      payload: { threadId: 'codex-thread', archived: true }
    })
    expect(auxiliary).toHaveBeenCalledWith({
      runtimeId: 'codex',
      operation: 'cancelUserInput',
      payload: { threadId: 'codex-thread', requestId: 'input-codex' }
    })
    expect(updateThreadRelation).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      relation: 'primary'
    })
    expect(deleteThread).toHaveBeenCalledWith({ runtimeId: 'codex', threadId: 'codex-thread' })
  })

  it('derives legacy UI capabilities from neutral runtime capabilities', async () => {
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: vi.fn(async () => capabilities('codex'))
        },
      }
    })

    const provider = new AgentRuntimeProvider()
    await provider.refreshCapabilities()

    expect(provider.getCapabilities()).toEqual({
      interrupt: true,
      stream: true,
      approvals: false,
      attachFiles: false,
      review: false,
      compact: false,
      fork: false,
      goals: false,
      todos: false,
      skills: false,
      sideConversations: false
    })
  })

  it('forwards neutral turn model hints to Codex adapter calls', async () => {
    const startTurn = vi.fn(async () => ({
      threadId: 'codex-thread',
      turnId: 'turn-codex'
    }))
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          capabilities: vi.fn(async () => capabilities('codex')),
          startTurn
        },
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.sendUserMessage('codex-thread', 'hello', {
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      displayText: 'hello'
    })

    expect(startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: 'hello',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      displayText: 'hello'
    })
  })

  it('does not fall back unknown thread-bound operations to the active runtime', async () => {
    const startTurn = vi.fn(async () => ({
      threadId: 'codex-thread',
      turnId: 'turn-codex'
    }))
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('kun')),
        setSettings: vi.fn(),
        agentRuntime: {
          startTurn
        },
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.sendUserMessage('codex-thread', 'hello')).rejects.toThrow(/thread runtime/i)
    expect(startTurn).not.toHaveBeenCalled()
  })

  it('does not fall back cancelUserInput without a remembered request mapping to the active runtime', async () => {
    const auxiliary = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('kun')),
        setSettings: vi.fn(),
        agentRuntime: {
          auxiliary
        },
      }
    })

    const provider = new AgentRuntimeProvider()

    await expect(provider.cancelUserInput?.('missing-input')).rejects.toThrow(/user input/i)
    expect(auxiliary).not.toHaveBeenCalled()
  })

  it('dispatches subscribed neutral runtime events into the thread sink', async () => {
    const listeners: Array<(payload: { streamId: string; event: AgentRuntimeEvent }) => void> = []
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('kun')),
        setSettings: vi.fn(),
        agentRuntime: {
          subscribeEvents: vi.fn(async () => ({ streamId: 'stream-1' })),
          stopEvents: vi.fn(async () => true),
          onEvent: vi.fn((handler) => {
            listeners.push(handler)
            return vi.fn()
          }),
          onEnd: vi.fn(() => vi.fn()),
          onError: vi.fn(() => vi.fn())
        },
      }
    })
    const sink = makeSink()
    const ac = new AbortController()
    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-1', 'kun')
    const subscription = provider.subscribeThreadEvents('thread-1', 0, sink, ac.signal)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    listeners[0]?.({
      streamId: 'stream-1',
      event: { kind: 'assistant_delta', threadId: 'thread-1', itemId: 'assistant-1', text: 'hi', seq: 1 }
    })
    ac.abort()
    await subscription

    expect(sink.onDeltas).toHaveBeenCalledWith([{ kind: 'agent_message', text: 'hi', seq: 1 }])
  })

  it('resolves approval and user input requests through neutral IPC after reading thread detail', async () => {
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'thread-2',
            runtimeId: 'codex',
            title: 'Two',
            updatedAt: '2026-06-11T00:01:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'approval-item',
                kind: 'approval',
                summary: 'Run command?',
                status: 'pending',
                meta: { approvalId: 'approval-1' }
              },
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-1' }
              }
            ]
          })),
          resolveApproval,
          resolveUserInput
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-2', 'codex')
    await provider.getThreadDetail('thread-2')
    await expect(provider.submitApprovalDecision?.('approval-1', 'allow')).resolves.toBeUndefined()
    await expect(provider.submitUserInputResponse?.('input-1', [
      { id: 'choice', label: 'Yes', value: 'yes' }
    ])).resolves.toBeUndefined()

    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      approvalId: 'approval-1',
      decision: 'allowed'
    })
    expect(resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      requestId: 'input-1',
      answers: [{ id: 'choice', label: 'Yes', value: 'yes' }]
    })
  })

  it('resolves interaction requests through the runtime that produced them', async () => {
    let activeRuntime: AgentRuntimeId = 'codex'
    const resolveApproval = vi.fn(async () => undefined)
    const resolveUserInput = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings(activeRuntime)),
        setSettings: vi.fn(),
        agentRuntime: {
          readThread: vi.fn(async () => ({
            id: 'codex-thread',
            runtimeId: 'codex',
            title: 'Codex thread',
            updatedAt: '2026-06-11T00:01:00.000Z',
            latestSeq: 4,
            items: [
              {
                id: 'approval-item',
                kind: 'approval',
                summary: 'Run command?',
                status: 'pending',
                meta: { approvalId: 'approval-codex' }
              },
              {
                id: 'input-item',
                kind: 'user_input',
                summary: 'Choose one',
                status: 'pending',
                meta: { requestId: 'input-codex' }
              }
            ]
          })),
          resolveApproval,
          resolveUserInput
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('codex-thread', 'codex')
    await provider.getThreadDetail('codex-thread')
    activeRuntime = 'kun'
    rendererRuntimeClient.invalidateSettings()
    await expect(provider.submitApprovalDecision?.('approval-codex', 'deny')).resolves.toBeUndefined()
    await expect(provider.submitUserInputResponse?.('input-codex', [
      { id: 'choice', label: 'No', value: 'no' }
    ])).resolves.toBeUndefined()

    expect(resolveApproval).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      approvalId: 'approval-codex',
      decision: 'denied'
    })
    expect(resolveUserInput).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      requestId: 'input-codex',
      answers: [{ id: 'choice', label: 'No', value: 'no' }]
    })
  })

  it('pins event subscriptions to the active runtime at subscription start', async () => {
    const subscribeEvents = vi.fn(async () => ({ streamId: 'stream-1' }))
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => settings('codex')),
        setSettings: vi.fn(),
        agentRuntime: {
          subscribeEvents,
          stopEvents: vi.fn(async () => true),
          onEvent: vi.fn(() => vi.fn()),
          onEnd: vi.fn(() => vi.fn()),
          onError: vi.fn(() => vi.fn())
        },
        forbiddenDirectCall: vi.fn(),
      }
    })

    const provider = new AgentRuntimeProvider()
    provider.rememberThreadRuntime('thread-2', 'codex')
    const ac = new AbortController()
    const subscription = provider.subscribeThreadEvents('thread-2', 7, makeSink(), ac.signal)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    ac.abort()
    await subscription

    expect(subscribeEvents).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-2',
      sinceSeq: 7,
      streamId: expect.stringMatching(/^agent-runtime-/u)
    })
  })
})
