import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeId } from '@shared/app-settings'
import type { NormalizedThread } from '../agent/types'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { rememberProviderThreadRuntime } from './chat-store-runtime-helpers'

const registryMock = vi.hoisted(() => ({
  getProvider: vi.fn()
}))
const runtimeClientMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  setSettings: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: registryMock.getProvider
}))
vi.mock('../agent/runtime-client', () => ({
  rendererRuntimeClient: {
    getSettings: runtimeClientMock.getSettings,
    setSettings: runtimeClientMock.setSettings
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
    workspace: '/workspace/sciforge',
    status: 'idle'
  }
}

function buildHarness(options: {
  activeRuntime: AgentRuntimeId
  activeThread: NormalizedThread
  listedThreads: NormalizedThread[]
  blocks?: ChatState['blocks']
  detailBlocks?: ChatState['blocks']
}): {
  refreshThreads: ReturnType<typeof createNavigationActions>['refreshThreads']
  state: ChatState
} {
  let state: ChatState
  const storedBlocks = options.detailBlocks ?? [{ kind: 'user' as const, id: 'stored-user', text: 'stored' }]
  const provider = {
    listThreads: vi.fn(async () => options.listedThreads),
    getThreadDetail: vi.fn(async () => ({ blocks: storedBlocks }))
  }
  registryMock.getProvider.mockReturnValue(provider)
  runtimeClientMock.getSettings.mockResolvedValue({ activeAgentRuntime: options.activeRuntime })

  state = {
    activeThreadId: options.activeThread.id,
    blocks: options.blocks ?? [],
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
    runtimeClientMock.setSettings.mockReset()
    currentSddRegistryJson = null
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === 'sciforge.sdd.threadRegistry.v1'
            ? currentSddRegistryJson
            : null
        ),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
  })

  it('preserves the active thread when refreshing after a runtime switch', async () => {
    const codexThread = thread('codex-thread', 'codex')
    const sciforgeThread = thread('sciforge-thread', 'sciforge')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread: sciforgeThread,
      listedThreads: [codexThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([sciforgeThread, codexThread])
    expect(state.activeThreadId).toBe('sciforge-thread')
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

  it('preserves a legacy local runtime pending active thread without a runtime id when SciForge is active', async () => {
    const legacyLocalRuntimeThread = thread('legacy-local-runtime-thread')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread: legacyLocalRuntimeThread,
      listedThreads: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([legacyLocalRuntimeThread])
    expect(state.activeThreadId).toBe('legacy-local-runtime-thread')
  })

  it('preserves a hidden SDD active thread when refreshing after a runtime switch', async () => {
    currentSddRegistryJson = JSON.stringify({
      version: 1,
      drafts: {
        draft: {
          draftId: 'draft',
          threadId: 'sdd-codex-thread',
          threadIds: ['sdd-codex-thread'],
          publicThreadIds: [],
          workspaceRoot: '/workspace/sciforge',
          updatedAt: '2026-06-11T00:00:00.000Z'
        }
      }
    })
    const sciforgeThread = thread('sciforge-thread', 'sciforge')
    const sddThread = thread('sdd-codex-thread', 'codex')
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'sciforge',
      activeThread: sddThread,
      listedThreads: [sciforgeThread]
    })

    await refreshThreads()

    expect(state.threads).toEqual([sddThread, sciforgeThread])
    expect(state.activeThreadId).toBe('sdd-codex-thread')
  })

  it('keeps the active thread selected when sidebar filtering sees an empty detail during send', async () => {
    const activeThread = {
      ...thread('12345678abcdef', 'codex'),
      title: '12345678'
    }
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [activeThread],
      detailBlocks: [],
      blocks: [{ kind: 'user', id: 'optimistic-user', text: 'continue this thread' }]
    })

    await refreshThreads()

    expect(state.threads).toEqual([activeThread])
    expect(state.activeThreadId).toBe('12345678abcdef')
    expect(state.blocks).toEqual([{ kind: 'user', id: 'optimistic-user', text: 'continue this thread' }])
  })

  it('still clears an empty active fallback-title thread that sidebar filtering hides', async () => {
    const activeThread = {
      ...thread('87654321abcdef', 'codex'),
      title: '87654321'
    }
    const { refreshThreads, state } = buildHarness({
      activeRuntime: 'codex',
      activeThread,
      listedThreads: [activeThread],
      detailBlocks: [],
      blocks: []
    })

    await refreshThreads()

    expect(state.threads).toEqual([])
    expect(state.activeThreadId).toBeNull()
    expect(state.blocks).toEqual([])
  })
})

describe('chat-store-navigation-actions chooseWorkspace', () => {
  beforeEach(() => {
    registryMock.getProvider.mockReset()
    runtimeClientMock.getSettings.mockReset()
    runtimeClientMock.setSettings.mockReset()
  })

  function buildChooseWorkspaceHarness(): {
    chooseWorkspace: ReturnType<typeof createNavigationActions>['chooseWorkspace']
    state: ChatState
  } {
    registryMock.getProvider.mockReturnValue({})
    runtimeClientMock.setSettings.mockImplementation(async (patch: { workspaceRoot?: string }) => ({
      activeAgentRuntime: 'codex',
      workspaceRoot: patch.workspaceRoot ?? '/workspace/new',
      remoteChannel: { channels: [] }
    }))
    const state = {
      activeThreadId: 'old-thread',
      activeRemoteChannelId: null,
      blocks: [],
      busy: false,
      clawChannels: [],
      codeWorkspaceRoots: ['/workspace/old'],
      hiddenCodeWorkspaceRoots: [],
      error: null,
      route: 'chat',
      runtimeConnection: 'ready',
      threads: [thread('old-thread', 'codex')],
      unreadThreadIds: {},
      watchTurnCompletion: {},
      workspaceRoot: '/workspace/old',
      createThread: vi.fn(async () => undefined),
      refreshThreads: vi.fn(async () => undefined),
      selectThread: vi.fn(async (threadId: string) => {
        state.activeThreadId = threadId
      })
    } as unknown as ChatState
    vi.stubGlobal('window', {
      sciforge: {
        pickWorkspaceDirectory: vi.fn(async () => ({ canceled: false, path: '/workspace/new' }))
      },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn()
      }
    })
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }
    const actions = createNavigationActions({
      set,
      get: () => state,
      sseAbortRef: { current: null }
    })
    return { chooseWorkspace: actions.chooseWorkspace, state }
  }

  it('does not create an empty thread when selecting an empty workspace', async () => {
    const { chooseWorkspace, state } = buildChooseWorkspaceHarness()

    await expect(chooseWorkspace()).resolves.toBe('/workspace/new')

    expect(runtimeClientMock.setSettings).toHaveBeenCalledWith({ workspaceRoot: '/workspace/new' })
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.createThread).not.toHaveBeenCalled()
    expect(state.selectThread).not.toHaveBeenCalled()
    expect(state.activeThreadId).toBeNull()
    expect(state.workspaceRoot).toBe('/workspace/new')
  })

  it('creates a draft only when workspace selection explicitly asks for it', async () => {
    const { chooseWorkspace, state } = buildChooseWorkspaceHarness()

    await expect(chooseWorkspace({ createThreadAfter: true })).resolves.toBe('/workspace/new')

    expect(state.createThread).toHaveBeenCalledWith({ workspaceRoot: '/workspace/new' })
    expect(state.activeThreadId).toBe('old-thread')
  })
})

describe('chat-store-runtime helper defaults', () => {
  it('does not remember legacy threads without a runtime id as SciForge threads', () => {
    const provider = {
      rememberThreadRuntime: vi.fn<(threadId: string, runtimeId?: AgentRuntimeId) => void>()
    }

    rememberProviderThreadRuntime(provider, 'legacy-thread', [thread('legacy-thread')])

    expect(provider.rememberThreadRuntime).not.toHaveBeenCalled()
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
      ...thread('other-thread', 'sciforge'),
      workspace: '/workspace/other'
    }
    const state = {
      activeThreadId: 'other-thread',
      blocks: [],
      busy: false,
      clawChannels: [],
      codeWorkspaceRoots: ['/workspace/sciforge', '/workspace/other'],
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

    await actions.deleteWorkspace('/workspace/sciforge')

    expect(provider.deleteThread).not.toHaveBeenCalled()
    expect(state.threads.map((item) => item.id)).toEqual([
      'stale-thread',
      'healthy-thread',
      'other-thread'
    ])
    expect(state.codeWorkspaceRoots).toEqual(['/workspace/other'])
    expect(state.hiddenCodeWorkspaceRoots).toEqual(['/workspace/sciforge'])
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
      remoteChannel: {
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
      connectPhonePanelOpen: false,
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

  it('follows phone activity while the Connect phone panel is open', async () => {
    const { state } = buildActivityHarness({ connectPhonePanelOpen: true })
    const set: ChatStoreSet = (partial) => {
      const update = typeof partial === 'function' ? partial(state) : partial
      Object.assign(state, update)
    }

    await syncClawChannelActivityToStore(set, () => state, {
      channelId: 'channel-1',
      threadId: 'remote-thread',
      runtimeId: 'codex'
    })

    expect(state.activeClawChannelId).toBe('channel-1')
    expect(state.selectClawConversation).toHaveBeenCalledWith('channel-1', 'remote-thread')
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.unreadThreadIds['remote-thread']).toBeUndefined()
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
