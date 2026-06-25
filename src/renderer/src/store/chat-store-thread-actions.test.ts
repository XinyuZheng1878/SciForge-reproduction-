import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeFileReference,
  AgentRuntimeWorkspaceReference
} from '@shared/agent-runtime-contract'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet, GuiPlanMessageContext } from './chat-store-types'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))
const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))
vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    getSettings: runtimeClientMock.getSettings
  }
}))

import { createThreadActions, publishActiveClawThreadContext } from './chat-store-thread-actions'
import { clearPendingClawFeishuMirrors, takePendingClawFeishuMirror } from './chat-store-runtime'
import { composerReferenceFromWorkspaceReference } from '../lib/workspace-reference-composer'

function thread(id: string): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-06-09T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/sciforge',
    status: 'running'
  }
}

function buildHarness(): {
  actions: ReturnType<typeof createThreadActions>
  state: ChatState
} {
  let state: ChatState
  state = {
    activeThreadId: 'thr_existing',
    activeAgentRuntime: 'sciforge',
    blocks: [],
    busy: true,
    activeThreadContextState: null,
    clawChannels: [],
    codeWorkspaceRoots: [],
    composerModel: '',
    currentTurnId: null,
    currentTurnUserId: null,
    error: 'previous error',
    lastSeq: 0,
    liveAssistant: '',
    liveReasoning: '',
    queuedMessages: [],
    recoverActiveTurn: vi.fn(async () => true),
    refreshThreads: vi.fn(async () => undefined),
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [thread('thr_existing')],
    turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {},
    turnReasoningLastAtByUserId: {},
    turnStartedAtByUserId: {}
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createThreadActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  state.sendMessage = actions.sendMessage
  return { actions, state }
}

describe('chat-store-thread-actions queued messages', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    registryMock.getProvider.mockReturnValue({})
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.getSettings.mockResolvedValue({ codePromptPrefix: '' })
    clearPendingClawFeishuMirrors()
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined)
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('does not queue GUI plan messages while another turn is active', async () => {
    const { actions, state } = buildHarness()
    const guiPlan: GuiPlanMessageContext = {
      operation: 'draft',
      workspaceRoot: '/workspace/sciforge',
      relativePath: '.sciforge/plan/feature.md',
      planId: 'plan-1',
      sourceRequest: 'feature'
    }

    await expect(actions.sendMessage('prompt one', 'plan', {
      displayText: 'Generate implementation plan',
      guiPlan
    })).resolves.toBe(false)

    expect(state.queuedMessages).toHaveLength(0)
    expect(state.error).toBeTruthy()
  })

  it('queues running text by default while the active turn is still running', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('use the current output')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).not.toHaveBeenCalled()
    expect(provider.steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_existing',
        text: 'use the current output',
        targetThreadId: 'thr_existing'
      })
    ])
    expect(state.error).toBeNull()
  })

  it('steers running text when the user explicitly prefixes it with /steer', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]

    await expect(actions.sendMessage('/steer use the current output')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'codex')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn-running',
      'use the current output'
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
  })

  it('queues running text when the runtime capability says steering is unsupported', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: false
      })),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'

    await expect(actions.sendMessage('continue after this')).resolves.toBe(true)

    expect(provider.steerUserMessage).not.toHaveBeenCalled()
    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        threadId: 'thr_existing',
        text: 'continue after this',
        targetThreadId: 'thr_existing'
      })
    ])
  })

  it('steers a queued text message when the user clicks the queued item action', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getCapabilities: vi.fn(() => ({
        interrupt: true,
        stream: true,
        approvals: true,
        attachFiles: true,
        steer: true
      })),
      rememberThreadRuntime: vi.fn(),
      steerUserMessage: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'turn-running'
    state.threads = [{ ...thread('thr_existing'), runtimeId: 'codex' }]
    state.queuedMessages = [{
      id: 'q-1',
      threadId: 'thr_existing',
      text: 'steer this queued follow-up'
    }]

    await expect(actions.steerQueuedMessage('q-1')).resolves.toBe(true)

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('thr_existing', 'codex')
    expect(provider.steerUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'turn-running',
      'steer this queued follow-up'
    )
    expect(state.queuedMessages).toEqual([])
    expect(state.error).toBeNull()
  })

  it('forces a new runtime thread instead of reusing the active empty thread', async () => {
    const { actions, state } = buildHarness()
    const createdThread = {
      ...thread('thr_created'),
      workspace: '/workspace/sciforge',
      status: 'idle'
    }
    const provider = {
      createThread: vi.fn(async () => createdThread)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.blocks = []
    state.error = 'previous error'
    state.selectThread = vi.fn(async (id: string) => {
      state.activeThreadId = id
    }) as unknown as ChatState['selectThread']

    await actions.createThread({ workspaceRoot: '/workspace/sciforge', forceNew: true })

    expect(provider.createThread).toHaveBeenCalledWith({
      workspace: '/workspace/sciforge',
      title: expect.any(String),
      mode: 'agent'
    })
    expect(state.selectThread).toHaveBeenCalledWith('thr_created')
    expect(state.activeThreadId).toBe('thr_created')
    expect(state.threads[0]?.id).toBe('thr_created')
  })

  it('removes stale queued GUI plan messages before draining normal queued messages', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [
      {
        id: 'q-plan',
        text: 'internal plan prompt',
        mode: 'plan',
        guiPlan: {
          operation: 'draft',
          workspaceRoot: '/workspace/sciforge',
          relativePath: '.sciforge/plan/one.md',
          planId: 'plan-1'
        }
      },
      {
        id: 'q-user',
        text: 'normal follow-up',
        mode: 'agent'
      }
    ]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).toHaveBeenCalledWith('normal follow-up', 'agent', {
      queued: expect.objectContaining({ id: 'q-user' })
    })
  })

  it('drops queued messages whose original thread no longer matches the active thread', async () => {
    const { actions, state } = buildHarness()
    const sendMessage = vi.fn(async (_text, _mode, overrides) => {
      state.queuedMessages = state.queuedMessages.filter((message) => message.id !== overrides?.queued?.id)
      return true
    })
    state.busy = false
    state.activeThreadId = 'thr_other'
    state.sendMessage = sendMessage as unknown as ChatState['sendMessage']
    state.queuedMessages = [{
      id: 'q-stale',
      text: 'send to the old thread',
      mode: 'agent',
      threadId: 'thr_existing',
      runtimeId: 'sciforge'
    }]

    await actions.drainQueuedMessages()

    expect(state.queuedMessages).toEqual([])
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('loads shared context state when selecting a thread', async () => {
    const { actions, state } = buildHarness()
    const contextState = {
      runtimeId: 'codex' as const,
      threadId: 'thr_existing',
      rawHistoryItems: 10,
      effectiveHistoryItems: 4,
      summarySource: 'heuristic' as const,
      updatedAt: '2026-06-20T00:00:00.000Z',
      goalResume: {
        status: 'blocked' as const,
        resumeCount: 1,
        lastFailureReason: 'no progress',
        updatedAt: '2026-06-20T00:00:01.000Z'
      }
    }
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 2,
        threadStatus: 'idle'
      })),
      getContextState: vi.fn(async () => contextState),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null

    await actions.selectThread('thr_existing')

    expect(provider.getContextState).toHaveBeenCalledWith('thr_existing')
    expect(state.activeThreadContextState).toEqual(contextState)
  })

  it('does not let stale turn recovery restore a thread after the user switches away', async () => {
    const { actions, state } = buildHarness()
    let resolveDetail: (value: {
      blocks: []
      latestSeq: number
      threadStatus: string
    }) => void = () => {
      throw new Error('getThreadDetail promise was not created')
    }
    const provider = {
      getThreadDetail: vi.fn(() => new Promise((resolve) => {
        resolveDetail = resolve
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.error = null
    state.threads = [thread('thr_existing'), thread('thr_other')]
    state.drainQueuedMessages = vi.fn(async () => undefined)

    const recovering = actions.recoverActiveTurn()
    await Promise.resolve()
    state.activeThreadId = 'thr_other'
    state.blocks = [{ kind: 'assistant', id: 'other-block', text: 'current thread' }]
    resolveDetail({ blocks: [], latestSeq: 8, threadStatus: 'idle' })

    await expect(recovering).resolves.toBe(false)

    expect(state.activeThreadId).toBe('thr_other')
    expect(state.blocks).toEqual([{ kind: 'assistant', id: 'other-block', text: 'current thread' }])
    expect(provider.subscribeThreadEvents).not.toHaveBeenCalled()
    expect(state.drainQueuedMessages).not.toHaveBeenCalled()
  })

  it('does not keep an empty thread busy just because the runtime reports a running thread status', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [],
        latestSeq: 1,
        threadStatus: 'running'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'stale-turn'
    state.currentTurnUserId = 'stale-user'
    state.error = null

    await expect(actions.recoverActiveTurn()).resolves.toBe(false)

    expect(state.busy).toBe(false)
    expect(state.currentTurnId).toBeNull()
    expect(state.currentTurnUserId).toBeNull()
    expect(state.error).toBeNull()
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      1,
      expect.any(Object),
      expect.any(AbortSignal)
    )
  })

  it('settles stale pending blocks when recovery finds an idle runtime thread', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      getThreadDetail: vi.fn(async () => ({
        blocks: [
          {
            kind: 'tool',
            id: 'tool-stale',
            createdAt: '2026-06-09T00:00:00.000Z',
            summary: 'stale tool',
            status: 'running'
          }
        ],
        latestSeq: 12,
        threadStatus: 'idle'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = true
    state.currentTurnId = 'stale-turn'
    state.queuedMessages = [{
      id: 'q-follow-up',
      text: 'new follow up',
      mode: 'agent',
      threadId: 'thr_existing',
      targetThreadId: 'thr_existing'
    }]
    state.drainQueuedMessages = vi.fn(async () => undefined) as unknown as ChatState['drainQueuedMessages']

    await expect(actions.recoverActiveTurn()).resolves.toBe(false)

    expect(state.busy).toBe(false)
    expect(state.blocks).toEqual([
      expect.objectContaining({
        id: 'tool-stale',
        status: 'success'
      })
    ])
    expect(state.drainQueuedMessages).toHaveBeenCalledTimes(1)
  })

  it('reconciles the optimistic user block with the runtime user message id', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    state.composerModel = 'gpt-5.4'

    await expect(actions.sendMessage('hello from UI')).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith('thr_existing', 'hello from UI', {
      mode: undefined,
      workspace: '/workspace/sciforge',
      title: 'thr_existing',
      model: 'gpt-5.4',
      displayText: 'hello from UI'
    })
    expect(state.blocks).toEqual([
      expect.objectContaining({
        kind: 'user',
        id: 'runtime-user-1',
        text: 'hello from UI',
        modelLabel: 'gpt-5.4'
      })
    ])
    expect(state.currentTurnUserId).toBe('runtime-user-1')
    expect(Object.keys(state.turnStartedAtByUserId)).toEqual(['runtime-user-1'])
  })

  it('keeps the active conversation stable when sending after switching runtime', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      rememberThreadRuntime: vi.fn(),
      sendUserMessage: vi.fn(async () => ({
        threadId: 'thr_existing',
        turnId: 'turn-codex',
        userMessageItemId: 'runtime-user-codex'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.activeAgentRuntime = 'codex'
    state.lastSeq = 12
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'sciforge'
    }]

    await expect(actions.sendMessage('continue with codex')).resolves.toBe(true)

    expect(state.activeThreadId).toBe('thr_existing')
    expect(state.threads.find((item) => item.id === 'thr_existing')?.runtimeId).toBe('codex')
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'continue with codex',
      expect.objectContaining({
        workspace: '/workspace/sciforge',
        title: 'thr_existing'
      })
    )
    expect(provider.subscribeThreadEvents).toHaveBeenCalledWith(
      'thr_existing',
      0,
      expect.any(Object),
      expect.any(AbortSignal)
    )
    expect(provider.rememberThreadRuntime).toHaveBeenLastCalledWith('thr_existing', 'codex')
  })

  it('sends only workspace-relative file references to the runtime provider', async () => {
    const { actions, state } = buildHarness()
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-files',
        userMessageItemId: 'runtime-user-files'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.error = null
    const previewReferences: AgentRuntimeWorkspaceReference[] = [
      {
        workspaceRoot: '/workspace/sciforge',
        relativePath: 'docs',
        name: 'docs',
        kind: 'directory'
      },
      {
        workspaceRoot: '/workspace/sciforge',
        relativePath: 'docs/guide.md',
        name: 'guide.md',
        kind: 'text',
        mimeType: 'text/plain; charset=utf-8'
      }
    ]
    const composerReferences = previewReferences.map(composerReferenceFromWorkspaceReference)
    const rendererOnlyRootReference: AgentRuntimeFileReference & { workspaceRoot: string } = {
      path: '/workspace/sciforge/data/raw.pdf',
      relativePath: 'data/raw.pdf',
      name: 'raw.pdf',
      mimeType: 'application/pdf',
      modelRouterObject: true,
      workspaceRoot: '/workspace/sciforge'
    }

    await expect(actions.sendMessage('use these files', 'agent', {
      fileReferences: [
        ...composerReferences,
        rendererOnlyRootReference,
        {
          path: 'reports/clean.pdf',
          relativePath: '/workspace/sciforge/reports/clean.pdf',
          name: '',
          modelRouterObject: true
        },
        {
          path: '../escape.txt',
          relativePath: '../escape.txt',
          name: 'escape.txt'
        },
        {
          path: 'deepseek-file://open?path=/tmp/secret.txt',
          relativePath: '',
          name: 'secret.txt'
        }
      ]
    })).resolves.toBe(true)

    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'thr_existing',
      'use these files',
      expect.objectContaining({
        fileReferences: [
          {
            path: 'docs',
            relativePath: 'docs',
            name: 'docs',
            kind: 'directory',
            delivery: 'inline_context'
          },
          {
            path: 'docs/guide.md',
            relativePath: 'docs/guide.md',
            name: 'guide.md',
            kind: 'text',
            mimeType: 'text/plain; charset=utf-8',
            delivery: 'inline_context'
          },
          {
            path: 'data/raw.pdf',
            relativePath: 'data/raw.pdf',
            name: 'raw.pdf',
            mimeType: 'application/pdf',
            modelRouterObject: true,
            delivery: 'model_router_object'
          },
          {
            path: 'reports/clean.pdf',
            relativePath: 'reports/clean.pdf',
            name: 'clean.pdf',
            modelRouterObject: true,
            delivery: 'model_router_object'
          }
        ]
      })
    )
  })

  it('mirrors desktop Code route messages when the active thread is bound to an IM channel', async () => {
    const { actions, state } = buildHarness()
    const mirrorClawChannelMessage = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', {
      sciforge: {
        logError: vi.fn(async () => undefined),
        mirrorClawChannelMessage
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-1',
        userMessageItemId: 'runtime-user-1'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.busy = false
    state.route = 'chat'
    state.threads = [{
      ...thread('thr_existing'),
      runtimeId: 'codex' as const,
      title: 'Desktop work'
    }]
    state.clawChannels = [{
      id: 'channel-1',
      enabled: true,
      provider: 'weixin',
      label: 'WeChat',
      model: 'auto',
      threadId: '',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'thr_existing' },
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'sciforge',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z'
    }]

    await expect(actions.sendMessage('hello from desktop')).resolves.toBe(true)

    expect(mirrorClawChannelMessage).toHaveBeenCalledWith(
      'thr_existing',
      'hello from desktop',
      'user'
    )
    expect(takePendingClawFeishuMirror('turn-1')).toEqual({
      threadId: 'thr_existing',
      userBlockId: 'runtime-user-1',
      userText: 'hello from desktop'
    })
  })
})

describe('publishActiveClawThreadContext', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      sciforge: {
        updateClawActiveThreadContext: vi.fn(async () => undefined)
      }
    })
  })

  it('publishes the active desktop thread context for IM auto-attach', () => {
    const state = {
      activeThreadId: 'desktop-thread',
      workspaceRoot: '/workspace/fallback',
      threads: [{
        ...thread('desktop-thread'),
        runtimeId: 'codex' as const,
        workspace: '/workspace/desktop'
      }],
      clawChannels: []
    } as unknown as ChatState

    publishActiveClawThreadContext(state, 'desktop-thread')

    expect(window.sciforge.updateClawActiveThreadContext).toHaveBeenCalledWith({
      threadId: 'desktop-thread',
      runtimeId: 'codex',
      workspaceRoot: '/workspace/desktop'
    })
  })

  it('clears the active context instead of publishing a Claw-managed thread', () => {
    const state = {
      activeThreadId: 'claw-thread',
      workspaceRoot: '/workspace/fallback',
      threads: [{
        ...thread('claw-thread'),
        title: '[Claw IM:WeChat] Alice',
        workspace: '/workspace/claw'
      }],
      clawChannels: [{
        id: 'channel-1',
        enabled: true,
        provider: 'weixin',
        label: 'WeChat',
        threadId: 'claw-thread',
        agentThreadIds: { sciforge: 'claw-thread' },
        conversations: [],
        model: 'auto',
        workspaceRoot: '',
        agentProfile: {
          name: 'sciforge',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        createdAt: '2026-06-09T00:00:00.000Z',
        updatedAt: '2026-06-09T00:00:00.000Z'
      }]
    } as unknown as ChatState

    publishActiveClawThreadContext(state, 'claw-thread')

    expect(window.sciforge.updateClawActiveThreadContext).toHaveBeenCalledWith(null)
  })
})
