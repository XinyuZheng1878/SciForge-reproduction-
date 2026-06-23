import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rememberProviderThreadRuntime } from './chat-store-runtime-helpers'

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

import { createNavigationActions, syncClawChannelActivityToStore } from './chat-store-navigation-actions'

function thread(id: string, runtimeId?: AgentRuntimeId): NormalizedThread {
  return {
    id,
    runtimeId,
    title: id,
    updatedAt: '2026-06-11T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace/deepseek-gui',
    status: 'idle'
  }
}

function buildHarness(options: {
  activeRuntime: AgentRuntimeId
  activeThread: NormalizedThread
  listedThreads: NormalizedThread[]
}): {
  refreshThreads: ReturnType<typeof createNavigationActions>['refreshThreads']
  state: ChatState
} {
  let state: ChatState
  const provider = {
    listThreads: vi.fn(async () => options.listedThreads)
  }
  registryMock.getProvider.mockReturnValue(provider)
  runtimeClientMock.getSettings.mockResolvedValue({ activeAgentRuntime: options.activeRuntime })

  state = {
    activeThreadId: options.activeThread.id,
    blocks: [],
    busy: false,
    clawChannels: [],
    codeWorkspaceRoots: [],
    error: null,
    route: 'chat',
    runtimeConnection: 'ready',
    threads: [options.activeThread],
    unreadThreadIds: {},
    watchTurnCompletion: {}
  } as unknown as ChatState

  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createNavigationActions({
    set,
    get,
    sseAbortRef: { current: null }
  })
  return { refreshThreads: actions.refreshThreads, state }
}

describe('chat-store-navigation-actions refreshThreads', () => {
  let currentSddRegistryJson: string | null = null

  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    currentSddRegistryJson = null
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === 'deepseekgui.sdd.threadRegistry.v1'
            ? currentSddRegistryJson
            : null
        ),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('drops the active thread when it belongs to the previous runtime', async () => {
    const codexThread = thread('codex-thread', 'codex')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: thread('kun-thread', 'kun'),
      listedThreads: [codexThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([codexThread])
    expect(state.activeThreadId).toBeNull()
  })

  it('preserves an unlisted active thread when it belongs to the active runtime', async () => {
    const pendingCodexThread = thread('pending-codex-thread', 'codex')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: pendingCodexThread,
      listedThreads: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([pendingCodexThread])
    expect(state.activeThreadId).toBe('pending-codex-thread')
  })

  it('preserves a legacy Kun pending active thread without a runtime id when Kun is active', async () => {
    const legacyKunThread = thread('legacy-kun-thread')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'kun',
      activeThread: legacyKunThread,
      listedThreads: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([legacyKunThread])
    expect(state.activeThreadId).toBe('legacy-kun-thread')
  })

  it('does not preserve a hidden SDD active thread from the previous runtime', async () => {
    currentSddRegistryJson = JSON.stringify({
      version: 1,
      drafts: {
        draft: {
          draftId: 'draft',
          threadId: 'sdd-codex-thread',
          threadIds: ['sdd-codex-thread'],
          publicThreadIds: [],
          workspaceRoot: '/workspace/deepseek-gui',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
    })
    const kunThread = thread('kun-thread', 'kun')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'kun',
      activeThread: thread('sdd-codex-thread', 'codex'),
      listedThreads: [kunThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([kunThread])
    expect(state.activeThreadId).toBeNull()
  })
})

describe('chat-store-runtime helper defaults', () => {
  it('remembers legacy threads without a runtime id as Kun threads', () => {
    const provider = {
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }

    rememberProviderThreadRuntime(provider, 'legacy-thread', [thread('legacy-thread')])

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('legacy-thread', 'kun')
  })
})

describe('chat-store-navigation-actions deleteWorkspace', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('removes the workspace from the project list without deleting its threads', async () => {
    const provider = {
      deleteThread: vi.fn(async () => undefined),
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }
    registryMock.getProvider.mockReturnValue(provider)

    const staleThread = thread('stale-thread', 'codex')
    const healthyThread = thread('healthy-thread', 'codex')
    const otherThread = {
      ...thread('other-thread', 'kun'),
      workspace: '/workspace/other'
    }
    const state = {
      activeThreadId: 'other-thread',
      blocks: [],
      busy: false,
      clawChannels: [],
      codeWorkspaceRoots: ['/workspace/deepseek-gui', '/workspace/other'],
      hiddenCodeWorkspaceRoots: [],
      error: 'previous error',
      refreshThreads: vi.fn(async () => undefined),
      route: 'chat',
      runtimeConnection: 'idle',
      threads: [staleThread, healthyThread, otherThread],
      unreadThreadIds: { 'stale-thread': true },
      watchTurnCompletion: { 'healthy-thread': true },
      workspaceRoot: '/workspace/other'
    } as unknown as ChatState
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })

    await actions.deleteWorkspace('/workspace/deepseek-gui')

    expect(provider.deleteThread).not.toHaveBeenCalled()
    expect(state.threads.map((item) => item.id)).toEqual([
      'stale-thread',
      'healthy-thread',
      'other-thread'
    ])
    expect(state.codeWorkspaceRoots).toEqual(['/workspace/other'])
    expect(state.hiddenCodeWorkspaceRoots).toEqual(['/workspace/deepseek-gui'])
    expect(state.unreadThreadIds).toEqual({})
    expect(state.watchTurnCompletion).toEqual({})
    expect(state.error).toBeNull()
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
  })
})

describe('syncClawChannelActivityToStore', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
  })

  function buildActivityHarness(options?: Partial<ChatState>): {
    state: ChatState
    provider: { rememberThreadRuntime: ReturnType<typeof vi.fn> }
  } {
    const provider = {
      rememberThreadRuntime: vi.fn()
    }
    registryMock.getProvider.mockReturnValue(provider)
    runtimeClientMock.getSettings.mockResolvedValue({
      claw: {
        channels: [{
          id: 'channel-1',
          enabled: true,
          provider: 'weixin',
          label: 'WeChat',
          threadId: '',
          conversations: []
        }]
      }
    })
    const state = {
      activeClawChannelId: '',
      activeThreadId: 'desktop-thread',
      clawChannels: [],
      recoverActiveTurn: vi.fn(async () => true),
      refreshThreads: vi.fn(async () => undefined),
      route: 'chat',
      selectClawConversation: vi.fn(async () => undefined),
      selectThread: vi.fn(async (threadId: string) => {
        state.activeThreadId = threadId
      }),
      unreadThreadIds: {},
      watchTurnCompletion: {},
      ...options
    } as unknown as ChatState
    return { state, provider }
  }

  it('recovers the current desktop thread when phone activity targets it outside IM route', async () => {
    const { state, provider } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncClawChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'desktop-thread',
      runtimeId: 'codex'
    })

    expect(provider.rememberThreadRuntime).toHaveBeenCalledWith('desktop-thread', 'codex')
    expect(state.recoverActiveTurn).toHaveBeenCalledTimes(1)
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.selectClawConversation).not.toHaveBeenCalled()
    expect(state.activeClawChannelId).toBe('channel-1')
  })

  it('marks a different phone-updated thread unread without switching the desktop selection', async () => {
    const { state } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncClawChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'remote-thread',
      runtimeId: 'codex'
    })

    expect(state.activeThreadId).toBe('desktop-thread')
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
    expect(state.selectClawConversation).not.toHaveBeenCalled()
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.unreadThreadIds['remote-thread']).toBe(true)
    expect(state.watchTurnCompletion['remote-thread']).toBe(true)
  })

  it('follows a replacement thread when phone activity replaces the current desktop thread', async () => {
    const { state } = buildActivityHarness()
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncClawChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'replacement-thread',
      previousThreadId: 'desktop-thread',
      runtimeId: 'codex'
    })

    expect(state.selectThread).toHaveBeenCalledWith('replacement-thread')
    expect(state.activeThreadId).toBe('replacement-thread')
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.unreadThreadIds['replacement-thread']).toBeUndefined()
  })
})
