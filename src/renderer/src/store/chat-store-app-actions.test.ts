import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppSettingsV1, ClawImChannelV1 } from '@shared/app-settings'
import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { createAppActions } from './chat-store-app-actions'

afterEach(() => {
  vi.unstubAllGlobals()
})

function channel(id: string): ClawImChannelV1 {
  return {
    id,
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
    threadId: 'kun-thread',
    runtimeId: 'codex',
    agentThreadIds: {
      codex: 'codex-thread'
    },
    workspaceRoot: '/workspace/deepseek-gui',
    agentProfile: {
      name: 'discord bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [{
      id: 'discord-channel::support-room',
      chatId: 'support-room',
      remoteThreadId: '',
      latestMessageId: 'discord-message-1',
      senderId: 'user-1',
      senderName: 'Alice',
      localThreadId: '',
      runtimeId: 'codex',
      agentThreadIds: {
        codex: 'codex-thread'
      },
      workspaceRoot: '/workspace/deepseek-gui',
      createdAt: '2026-06-13T00:00:00.000Z',
      updatedAt: '2026-06-13T00:00:00.000Z'
    }],
    recentMessages: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z'
  }
}

function buildHarness(initialState: Partial<ChatState> = {}): {
  actions: ReturnType<typeof createAppActions>
  state: ChatState
} {
  const state = {
    route: 'chat',
    activeThreadId: 'desktop-thread',
    activeClawChannelId: '',
    activeRemoteChannelId: null,
    clawChannels: [channel('discord-channel')],
    refreshClawChannels: vi.fn(async () => undefined),
    refreshThreads: vi.fn(async () => undefined),
    loadComposerModels: vi.fn(async () => undefined),
    applyI18nFromSettings: vi.fn(async () => undefined),
    composerModel: '',
    composerPickList: [],
    composerModelGroups: []
  } as unknown as ChatState
  Object.assign(state, initialState)
  const set: ChatStoreSet = (partial) => {
    const update = typeof partial === 'function' ? partial(state) : partial
    Object.assign(state, update)
  }
  const get: ChatStoreGet = () => state
  const actions = createAppActions({
    set,
    get,
    i18n: { changeLanguage: vi.fn(async () => undefined) } as never,
    persistComposerModel: vi.fn(),
    readStoredComposerModel: vi.fn(() => ''),
    mergeComposerPickList: vi.fn(() => []),
    getComposerModelLoadPromise: vi.fn(() => null),
    setComposerModelLoadPromise: vi.fn(),
    applyTheme: vi.fn(),
    applyUiFontScale: vi.fn(),
    applyDocumentLocale: vi.fn(),
    workspaceLabelFromPath: vi.fn((workspaceRoot: string) => workspaceRoot),
    normalizeWorkspaceRoot: vi.fn((workspaceRoot?: string | null) => workspaceRoot?.trim() ?? '')
  })
  return { actions, state }
}

describe('chat-store app actions', () => {
  it('opens a remote guard entry without selecting its mapped local thread', () => {
    const { actions, state } = buildHarness()

    actions.selectRemoteGuardChannel('discord-channel')

    expect(state.route).toBe('chat')
    expect(state.activeRemoteChannelId).toBe('discord-channel')
    expect(state.activeClawChannelId).toBe('discord-channel')
    expect(state.activeThreadId).toBe('desktop-thread')
  })

  it('ignores missing remote guard entries without clearing the current detail', () => {
    const { actions, state } = buildHarness({
      activeRemoteChannelId: 'discord-channel',
      activeClawChannelId: 'discord-channel',
      activeThreadId: 'desktop-thread'
    })

    actions.selectRemoteGuardChannel('missing-channel')

    expect(state.route).toBe('chat')
    expect(state.activeRemoteChannelId).toBe('discord-channel')
    expect(state.activeClawChannelId).toBe('discord-channel')
    expect(state.activeThreadId).toBe('desktop-thread')
  })

  it('clears the remote guard detail when leaving chat', () => {
    const { actions, state } = buildHarness({
      activeRemoteChannelId: 'discord-channel'
    })

    actions.openSchedule()

    expect(state.route).toBe('schedule')
    expect(state.activeRemoteChannelId).toBeNull()
  })

  it('keeps remote bindings stable across refresh and app section navigation', async () => {
    const { actions, state } = buildHarness({
      activeRemoteChannelId: 'discord-channel',
      activeClawChannelId: 'discord-channel',
      activeThreadId: 'codex-thread',
      runtimeConnection: 'ready'
    })
    const bindingBefore = JSON.parse(JSON.stringify(state.clawChannels))
    vi.stubGlobal('window', {
      dsGui: {
        getSettings: vi.fn(async () => ({
          workspaceRoot: '/workspace/deepseek-gui',
          theme: 'system',
          uiFontScale: 'small',
          locale: 'en',
          claw: { channels: bindingBefore }
        }) as AppSettingsV1),
        fetchUpstreamModels: vi.fn(async () => ({ ok: true, modelIds: [], modelGroups: [] }))
      }
    })
    state.refreshClawChannels = vi.fn(async () => {
      state.clawChannels = JSON.parse(JSON.stringify(bindingBefore))
    })

    await actions.reloadUiSettings()
    await actions.openWrite()
    actions.openSettings('general')
    actions.openClaw()
    actions.selectRemoteGuardChannel('discord-channel')
    actions.setRoute('chat')

    expect(state.clawChannels).toEqual(bindingBefore)
    expect(state.clawChannels[0]).toMatchObject({
      threadId: 'kun-thread',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'codex-thread' },
      workspaceRoot: '/workspace/deepseek-gui',
      conversations: [expect.objectContaining({
        chatId: 'support-room',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'codex-thread' },
        workspaceRoot: '/workspace/deepseek-gui'
      })]
    })
    expect(state.activeThreadId).toBe('codex-thread')
    expect(state.refreshClawChannels).toHaveBeenCalledTimes(1)
  })
})
