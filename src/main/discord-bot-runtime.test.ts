import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ClawImChannelV1
} from '../shared/app-settings'
import { createDiscordBotRuntime } from './discord-bot-runtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

function settings(channel: ClawImChannelV1): AppSettingsV1 {
  return {
    version: 1,
    installationId: 'dsgui-local',
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'kun',
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 2 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: {
      ...defaultClawSettings(),
      enabled: true,
      im: {
        ...defaultClawSettings().im,
        enabled: true,
        provider: 'discord'
      },
      channels: [channel]
    },
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function discordChannel(): ClawImChannelV1 {
  return {
    id: 'discord-bot-1-guild-1-channel-1',
    provider: 'discord',
    label: '#support',
    enabled: true,
    model: 'auto',
    threadId: '',
    runtimeId: 'kun',
    agentThreadIds: {},
    workspaceRoot: '/tmp/support',
    agentProfile: {
      name: 'Support bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'discord',
      applicationId: 'client-1',
      botId: 'bot-1',
      botUsername: 'DeepSeek',
      guildId: 'guild-1',
      guildName: 'Support server',
      channelId: 'channel-1',
      channelName: 'support',
      installationId: 'dsgui-other',
      guardOwnerInstallationId: 'dsgui-other',
      guardOwnerUpdatedAt: '2026-06-13T00:00:00.000Z',
      createdAt: '2026-06-13T00:00:00.000Z'
    },
    conversations: [],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z'
  }
}

describe('DiscordBotRuntime guard ownership', () => {
  it('defaults newly bound channels to the app workspace', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-workspace-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))

    try {
      let current: AppSettingsV1 = {
        ...settings(discordChannel()),
        workspaceRoot: '/repo/current',
        claw: {
          ...settings(discordChannel()).claw,
          channels: []
        }
      }
      const store = {
        load: vi.fn(async () => current),
        patch: vi.fn(async (patch: Partial<AppSettingsV1>) => {
          current = {
            ...current,
            ...patch,
            claw: {
              ...current.claw,
              ...patch.claw,
              im: {
                ...current.claw.im,
                ...(patch.claw?.im ?? {})
              },
              channels: (patch.claw?.channels as ClawImChannelV1[] | undefined) ?? current.claw.channels
            }
          }
          return current
        })
      }
      const runtime = createDiscordBotRuntime({
        store: store as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.bindChannel({
        guildId: 'guild-1',
        guildName: 'Support server',
        channelId: 'channel-1',
        channelName: 'support',
        enabled: false
      })).resolves.toMatchObject({ ok: true })
      expect(current.claw.channels[0].workspaceRoot).toBe('/repo/current')
      expect(current.claw.channels[0].guardMode).toBe('all_messages')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('reports another installation guarding the same bot/channel and supports force takeover', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))

    try {
      let current = settings(discordChannel())
      const store = {
        load: vi.fn(async () => current),
        patch: vi.fn(async (patch: Partial<AppSettingsV1>) => {
          current = {
            ...current,
            ...patch,
            claw: {
              ...current.claw,
              ...patch.claw,
              im: {
                ...current.claw.im,
                ...(patch.claw?.im ?? {})
              },
              channels: (patch.claw?.channels as ClawImChannelV1[] | undefined) ?? current.claw.channels
            }
          }
          return current
        })
      }
      const runtime = createDiscordBotRuntime({
        store: store as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      const initial = await runtime.status()
      expect(initial.conflict).toMatchObject({
        channelConfigId: 'discord-bot-1-guild-1-channel-1',
        ownerInstallationId: 'dsgui-other',
        currentInstallationId: 'dsgui-local'
      })

      await expect(
        runtime.setGuard(true, { channelConfigId: 'discord-bot-1-guild-1-channel-1' })
      ).resolves.toMatchObject({
        ok: false,
        conflict: {
          ownerInstallationId: 'dsgui-other'
        }
      })

      await expect(
        runtime.setGuard(true, {
          channelConfigId: 'discord-bot-1-guild-1-channel-1',
          forceTakeover: true
        })
      ).resolves.toMatchObject({ ok: true })
      expect(current.claw.channels[0].platformCredential).toMatchObject({
        guardOwnerInstallationId: 'dsgui-local'
      })
      expect(current.claw.channels[0].guardMode).toBe('all_messages')
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('reports an access error when the connected bot cannot see the bound channel', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-access-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const sockets: Array<{
      readyState: number
      onmessage: ((event: { data?: unknown }) => void) | null
      onerror: ((event: unknown) => void) | null
      onclose: (() => void) | null
      onopen: (() => void) | null
      send: (data: string) => void
      close: () => void
    }> = []
    class FakeWebSocket {
      readyState = 1
      onmessage: ((event: { data?: unknown }) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onclose: (() => void) | null = null
      onopen: (() => void) | null = null
      send = vi.fn()
      close = vi.fn()

      constructor(_url: string) {
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/channels/channel-1')) {
        return new Response(JSON.stringify({ message: 'Unknown Channel', code: 10003 }), {
          status: 404,
          statusText: 'Not Found'
        })
      }
      return new Response(JSON.stringify({ id: 'channel-1', name: 'support', type: 0 }))
    }))

    try {
      const channel = discordChannel()
      channel.platformCredential = {
        ...channel.platformCredential as Extract<ClawImChannelV1['platformCredential'], { kind: 'discord' }>,
        installationId: 'dsgui-local',
        guardOwnerInstallationId: 'dsgui-local'
      }
      const current = settings(channel)
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      runtime.sync(current)
      for (let i = 0; (!sockets[0] || !sockets[0].onmessage) && i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(sockets[0]).toBeDefined()
      sockets[0].onmessage?.({
        data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })
      })
      sockets[0].onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 1,
          t: 'READY',
          d: { session_id: 'session-1', user: { id: 'bot-1' }, guilds: [{ id: 'guild-1' }] }
        })
      })

      await expect(runtime.status()).resolves.toMatchObject({
        connected: true,
        enabled: false,
        channels: [
          {
            connected: false,
            accessError: expect.stringContaining('cannot see this Discord channel')
          }
        ]
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('handles Discord slash /new interactions through the shared IM command path', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-interaction-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      botToken: 'token-1',
      clientId: 'client-1',
      bot: {
        applicationId: 'client-1',
        botId: 'bot-1',
        botUsername: 'DeepSeek',
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=client-1'
      },
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const sockets: Array<{
      readyState: number
      onmessage: ((event: { data?: unknown }) => void) | null
      onerror: ((event: unknown) => void) | null
      onclose: (() => void) | null
      onopen: (() => void) | null
      send: (data: string) => void
      close: () => void
    }> = []
    class FakeWebSocket {
      readyState = 1
      onmessage: ((event: { data?: unknown }) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      onclose: (() => void) | null = null
      onopen: (() => void) | null = null
      send = vi.fn()
      close = vi.fn()

      constructor(_url: string) {
        sockets.push(this)
      }
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true }))
    )
    vi.stubGlobal('fetch', fetchMock)

    try {
      const channel = discordChannel()
      channel.platformCredential = {
        ...channel.platformCredential as Extract<ClawImChannelV1['platformCredential'], { kind: 'discord' }>,
        installationId: 'dsgui-local',
        guardOwnerInstallationId: 'dsgui-local'
      }
      const current = settings(channel)
      const handleIncomingMessage = vi.fn(async () => ({
        ok: true as const,
        reply: 'Started a new topic. The next message will create a fresh local conversation.',
        message: 'Started a new topic.'
      }))
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => current), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage,
        logError: vi.fn()
      })

      runtime.sync(current)
      for (let i = 0; (!sockets[0] || !sockets[0].onmessage) && i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(sockets[0]).toBeDefined()
      sockets[0].onmessage?.({
        data: JSON.stringify({ op: 10, d: { heartbeat_interval: 60_000 } })
      })
      sockets[0].onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 1,
          t: 'READY',
          d: { session_id: 'session-1', user: { id: 'bot-1' }, guilds: [{ id: 'guild-1' }] }
        })
      })
      sockets[0].onmessage?.({
        data: JSON.stringify({
          op: 0,
          s: 2,
          t: 'INTERACTION_CREATE',
          d: {
            id: 'interaction-1',
            token: 'interaction-token',
            application_id: 'client-1',
            type: 2,
            guild_id: 'guild-1',
            channel_id: 'channel-1',
            data: { name: 'new', type: 1 },
            member: {
              user: { id: 'user-1', username: 'Alice', global_name: 'Alice' }
            }
          }
        })
      })

      for (let i = 0; fetchMock.mock.calls.length === 0 && i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      expect(handleIncomingMessage).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'discord',
        channelId: 'discord-bot-1-guild-1-channel-1',
        text: '/new',
        sender: 'Alice',
        remoteSession: expect.objectContaining({
          chatId: 'channel-1',
          messageId: 'interaction-1',
          senderId: 'user-1',
          senderName: 'Alice'
        })
      }))
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('/interactions/interaction-1/interaction-token/callback')
      expect(JSON.parse(String(init?.body))).toMatchObject({
        type: 4,
        data: {
          content: expect.stringContaining('Started a new topic'),
          allowed_mentions: { parse: [] }
        }
      })
      runtime.stop()
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})

describe('DiscordBotRuntime token setup errors', () => {
  it('saves a Discord-only HTTP proxy URL in status', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-proxy-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureProxy(' http://127.0.0.1:7890 ')).resolves.toMatchObject({
        ok: true,
        status: {
          proxyUrl: 'http://127.0.0.1:7890/'
        }
      })
      await expect(runtime.status()).resolves.toMatchObject({
        proxyUrl: 'http://127.0.0.1:7890/'
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('uses the configured proxy for Discord token setup requests', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-proxy-fetch-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(join(userDataPath, 'discord-bot.json'), JSON.stringify({
      clientId: 'client-1',
      proxyUrl: 'http://127.0.0.1:7890/',
      updatedAt: '2026-06-13T00:00:00.000Z'
    }))
    const proxyFetch = vi.fn(async (url: string, _proxyUrl: string, _init?: RequestInit) => {
      if (url.endsWith('/users/@me')) {
        return new Response(JSON.stringify({
          id: 'bot-1',
          username: 'DeepSeek',
          bot: true
        }))
      }
      if (url.endsWith('/oauth2/applications/@me')) {
        return new Response(JSON.stringify({ id: 'client-1' }))
      }
      return new Response(JSON.stringify({ message: 'not found' }), {
        status: 404,
        statusText: 'Not Found'
      })
    })

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn(),
        proxyFetch
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: true,
        status: {
          tokenConfigured: true,
          proxyUrl: 'http://127.0.0.1:7890/'
        }
      })
      expect(proxyFetch).toHaveBeenCalledTimes(2)
      expect(proxyFetch.mock.calls.map((call) => call[1])).toEqual([
        'http://127.0.0.1:7890/',
        'http://127.0.0.1:7890/'
      ])
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('returns an actionable network message when Discord API cannot be reached', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-network-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    }))

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining('Timed out connecting to Discord API')
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })

  it('explains rejected tokens instead of surfacing raw Discord REST errors', async () => {
    const userDataPath = join(tmpdir(), `deepseek-gui-discord-token-${Date.now()}-${Math.random()}`)
    mkdirSync(userDataPath, { recursive: true })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ message: '401: Unauthorized', code: 0 }), {
        status: 401,
        statusText: 'Unauthorized'
      })
    ))

    try {
      const runtime = createDiscordBotRuntime({
        store: { load: vi.fn(async () => settings(discordChannel())), patch: vi.fn() } as never,
        userDataPath,
        handleIncomingMessage: vi.fn(),
        logError: vi.fn()
      })

      await expect(runtime.configureToken('token-1', 'client-1')).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining('Discord rejected this Bot Token')
      })
    } finally {
      rmSync(userDataPath, { recursive: true, force: true })
    }
  })
})
