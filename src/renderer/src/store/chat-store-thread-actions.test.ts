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
    workspace: '/workspace/deepseek-gui',
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
      dsGui: {
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
      workspaceRoot: '/workspace/deepseek-gui',
      relativePath: '.kunsdd/plan/feature.md',
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
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/one.md',
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
      runtimeId: 'kun'
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
        workspaceRoot: '/workspace/deepseek-gui',
        relativePath: 'docs',
        name: 'docs',
        kind: 'directory'
      },
      {
        workspaceRoot: '/workspace/deepseek-gui',
        relativePath: 'docs/guide.md',
        name: 'guide.md',
        kind: 'text',
        mimeType: 'text/plain; charset=utf-8'
      }
    ]
    const composerReferences = previewReferences.map(composerReferenceFromWorkspaceReference)
    const rendererOnlyRootReference: AgentRuntimeFileReference & { workspaceRoot: string } = {
      path: '/workspace/deepseek-gui/data/raw.pdf',
      relativePath: 'data/raw.pdf',
      name: 'raw.pdf',
      mimeType: 'application/pdf',
      modelRouterObject: true,
      workspaceRoot: '/workspace/deepseek-gui'
    }

    await expect(actions.sendMessage('use these files', 'agent', {
      fileReferences: [
        ...composerReferences,
        rendererOnlyRootReference,
        {
          path: 'reports/clean.pdf',
          relativePath: '/workspace/deepseek-gui/reports/clean.pdf',
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

  it('sends write route messages through the selected write workspace with write governance', async () => {
    const { actions, state } = buildHarness()
    const writeThread = {
      ...thread('write-thread'),
      title: 'Write Assistant',
      workspace: '/workspace/write-current'
    }
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-write',
        userMessageItemId: 'runtime-user-write'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.route = 'write'
    state.activeThreadId = 'old-write-thread'
    state.threads = [
      { ...thread('old-write-thread'), workspace: '/workspace/write-old' },
      writeThread
    ]
    state.busy = false
    state.composerModel = ''
    state.ensureWriteThreadForWorkspace = vi.fn(async (workspaceRoot?: string) => {
      state.activeThreadId = writeThread.id
      state.threads = [writeThread]
      return writeThread.id
    }) as unknown as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('writing runtime prompt', 'agent', {
      displayText: 'visible prompt',
      workspaceRoot: '/workspace/write-current',
      fileReferences: [
        {
          path: '/workspace/write-current/research/notes.md',
          relativePath: 'research/notes.md',
          name: 'notes.md',
          kind: 'text'
        }
      ]
    })).resolves.toBe(true)

    expect(state.ensureWriteThreadForWorkspace).toHaveBeenCalledWith('/workspace/write-current')
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'write-thread',
      'writing runtime prompt',
      expect.objectContaining({
        mode: 'agent',
        workspace: '/workspace/write-current',
        governanceProfile: 'write',
        displayText: 'visible prompt',
        fileReferences: [
          {
            path: 'research/notes.md',
            relativePath: 'research/notes.md',
            name: 'notes.md',
            kind: 'text',
            delivery: 'inline_context'
          }
        ]
      })
    )
  })

  it('keeps explicit write intent even if the visible route changed before send', async () => {
    const { actions, state } = buildHarness()
    const writeThread = {
      ...thread('write-thread'),
      title: 'Write Assistant',
      workspace: '/workspace/write-current'
    }
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-write-race',
        userMessageItemId: 'runtime-user-write-race'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.route = 'chat'
    state.activeThreadId = 'chat-thread'
    state.threads = [thread('chat-thread'), writeThread]
    state.busy = false
    state.composerModel = 'code-model'
    state.ensureWriteThreadForWorkspace = vi.fn(async (workspaceRoot?: string) => {
      state.route = 'write'
      state.activeThreadId = writeThread.id
      return writeThread.id
    }) as unknown as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('writing runtime prompt', 'agent', {
      displayText: 'visible prompt',
      sourceRoute: 'write',
      targetThreadId: 'write-thread',
      workspaceRoot: '/workspace/write-current',
      governanceProfile: 'write',
      model: 'write-model'
    })).resolves.toBe(true)

    expect(state.ensureWriteThreadForWorkspace).toHaveBeenCalledWith('/workspace/write-current')
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'write-thread',
      'writing runtime prompt',
      expect.objectContaining({
        mode: 'agent',
        model: 'write-model',
        workspace: '/workspace/write-current',
        governanceProfile: 'write',
        displayText: 'visible prompt'
      })
    )
    expect(provider.sendUserMessage).not.toHaveBeenCalledWith(
      'chat-thread',
      expect.any(String),
      expect.any(Object)
    )
  })

  it('keeps the selected write workspace when queued write messages drain later', async () => {
    const { actions, state } = buildHarness()
    const writeThread = {
      ...thread('write-thread'),
      title: 'Write Assistant',
      workspace: '/workspace/write-current'
    }
    const provider = {
      sendUserMessage: vi.fn(async () => ({
        turnId: 'turn-write-queued',
        userMessageItemId: 'runtime-user-write-queued'
      })),
      subscribeThreadEvents: vi.fn(async () => undefined),
      renameThread: vi.fn(async () => undefined)
    }
    registryMock.getProvider.mockReturnValue(provider)
    state.route = 'write'
    state.activeThreadId = writeThread.id
    state.threads = [writeThread]
    state.busy = true
    state.composerModel = ''
    state.ensureWriteThreadForWorkspace = vi.fn(async (workspaceRoot?: string) => {
      state.activeThreadId = writeThread.id
      return writeThread.id
    }) as unknown as ChatState['ensureWriteThreadForWorkspace']

    await expect(actions.sendMessage('queued write prompt', 'agent', {
      displayText: 'queued visible prompt',
      workspaceRoot: '/workspace/write-current'
    })).resolves.toBe(true)

    expect(state.queuedMessages).toEqual([
      expect.objectContaining({
        text: 'queued write prompt',
        displayText: 'queued visible prompt',
        workspaceRoot: '/workspace/write-current',
        threadId: writeThread.id
      })
    ])

    state.busy = false
    await actions.drainQueuedMessages()

    expect(state.ensureWriteThreadForWorkspace).toHaveBeenNthCalledWith(1, '/workspace/write-current')
    expect(state.ensureWriteThreadForWorkspace).toHaveBeenNthCalledWith(2, '/workspace/write-current')
    expect(provider.sendUserMessage).toHaveBeenCalledWith(
      'write-thread',
      'queued write prompt',
      expect.objectContaining({
        mode: 'agent',
        workspace: '/workspace/write-current',
        governanceProfile: 'write',
        displayText: 'queued visible prompt'
      })
    )
  })

  it('mirrors desktop Code route messages when the active thread is bound to an IM channel', async () => {
    const { actions, state } = buildHarness()
    const mirrorClawChannelMessage = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', {
      dsGui: {
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
        name: 'kun',
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
      dsGui: {
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

    expect(window.dsGui.updateClawActiveThreadContext).toHaveBeenCalledWith({
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
        agentThreadIds: { kun: 'claw-thread' },
        conversations: [],
        model: 'auto',
        workspaceRoot: '',
        agentProfile: {
          name: 'kun',
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

    expect(window.dsGui.updateClawActiveThreadContext).toHaveBeenCalledWith(null)
  })
})
