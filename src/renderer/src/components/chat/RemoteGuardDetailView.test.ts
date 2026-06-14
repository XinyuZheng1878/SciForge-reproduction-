import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ClawImChannelV1 } from '@shared/app-settings'
import {
  RemoteGuardDetailView,
  latestRemoteGuardMessages,
  remoteGuardChannelTitle,
  remoteGuardTargetThread
} from './RemoteGuardDetailView'

function discordChannel(overrides: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  const base: ClawImChannelV1 = {
    id: 'discord-channel',
    provider: 'discord',
    label: 'discord bot',
    enabled: true,
    model: 'auto',
    threadId: 'kun-thread',
    runtimeId: 'codex',
    agentThreadIds: {
      kun: 'kun-thread',
      codex: 'codex-thread'
    },
    workspaceRoot: '/Users/zxy/SciForge',
    agentProfile: {
      name: 'discord bot',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    platformCredential: {
      kind: 'discord',
      applicationId: 'app-1',
      botId: 'bot-1',
      botUsername: 'deepseek-bot',
      guildId: 'guild-1',
      guildName: 'gzy server',
      channelId: 'channel-1',
      channelName: 'debug',
      createdAt: '2026-06-13T00:00:00.000Z'
    },
    remoteSession: {
      chatId: 'channel-1',
      messageId: 'message-2',
      threadId: 'channel-1',
      senderId: 'user-1',
      senderName: 'Alice',
      updatedAt: '2026-06-13T00:02:00.000Z'
    },
    conversations: [],
    recentMessages: [
      {
        provider: 'discord',
        channelId: 'discord-channel',
        chatId: 'channel-1',
        remoteThreadId: '',
        messageId: 'message-1',
        senderName: 'Alice',
        text: 'Q1',
        receivedAt: '2026-06-13T00:01:00.000Z'
      },
      {
        provider: 'discord',
        channelId: 'discord-channel',
        chatId: 'channel-1',
        remoteThreadId: '',
        messageId: 'message-2',
        senderName: 'Alice',
        text: 'Q2',
        receivedAt: '2026-06-13T00:02:00.000Z'
      }
    ],
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:02:00.000Z'
  }
  return { ...base, ...overrides }
}

const labels: Record<string, string> = {
  remoteGuardStatusActive: 'Guarding',
  remoteGuardStatusPaused: 'Paused',
  remoteGuardSubtitle: 'Remote entry for supervised work.',
  remoteGuardManage: 'Manage',
  remoteGuardWorkspace: 'Workspace',
  remoteGuardDefaultWorkspace: 'App workspace',
  remoteGuardCurrentThread: 'Work thread',
  remoteGuardNoThread: 'No thread',
  remoteGuardRemoteUser: 'Remote user',
  remoteGuardNoRemoteUser: 'No user',
  remoteGuardOpenThread: 'Open work thread',
  remoteGuardNewHint: 'Send /new remotely to start a fresh topic.',
  remoteGuardRecentMessages: 'Recent remote messages',
  remoteGuardNoMessages: 'No messages yet',
  remoteGuardCommands: 'Remote commands',
  remoteGuardCommandWhere: 'Show current project and work thread.',
  remoteGuardCommandNew: 'Start a fresh local topic for this entry.',
  remoteGuardCommandSummary: 'Ask for a short summary of current work.',
  remoteGuardCommandAttach: 'Attach this entry to the current desktop thread.'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('RemoteGuardDetailView', () => {
  it('renders the remote endpoint as a guard entry rather than a chat transcript', () => {
    const channel = discordChannel()
    const html = renderToStaticMarkup(
      createElement(RemoteGuardDetailView, {
        channel,
        onOpenThread: vi.fn(),
        onOpenSettings: vi.fn(),
        t
      })
    )

    expect(html).toContain('#debug')
    expect(html).toContain('Discord')
    expect(html).toContain('Guarding')
    expect(html).toContain('SciForge')
    expect(html).toContain('codex:codex-...read')
    expect(html).toContain('Alice: Q2')
    expect(html).toContain('/new')
    expect(html).toContain('Open work thread')
  })

  it('resolves the preferred runtime thread mapping for the guard entry', () => {
    const channel = discordChannel()

    expect(remoteGuardChannelTitle(channel)).toBe('#debug')
    expect(remoteGuardTargetThread(channel)).toEqual({
      threadId: 'codex-thread',
      runtimeId: 'codex'
    })
    expect(latestRemoteGuardMessages(channel).map((message) => message.messageId)).toEqual([
      'message-2',
      'message-1'
    ])
  })
})
