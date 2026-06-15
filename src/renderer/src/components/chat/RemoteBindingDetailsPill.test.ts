import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ClawThreadRemoteBinding } from '../../store/chat-store-helpers'
import {
  ActiveRemoteBindingDetails,
  remoteBindingGuardModeLabel
} from './RemoteBindingDetailsPill'

const labels: Record<string, string> = {
  remoteBindingDetails: 'Remote binding',
  remoteBindingProvider: 'Provider {{provider}}',
  remoteBindingChannel: 'Channel {{channel}}',
  remoteBindingWorkspace: 'Project {{workspace}}',
  remoteBindingDefaultWorkspace: 'Default project',
  remoteBindingThread: 'Thread {{thread}}',
  remoteBindingGuardMode: 'Guard {{mode}}',
  remoteBindingGuardOnlyMention: 'Mentions only',
  remoteBindingGuardAllMessages: 'All messages',
  remoteBindingGuardOff: 'Off',
  remoteBindingTarget: 'Remote {{target}}',
  remoteBindingFailure: 'Last failure {{reason}}',
  sidebarThreadBotWatched: 'Bot is watching',
  sidebarThreadBotBound: 'Remote bound',
  sidebarThreadBotRunning: 'Remote running',
  sidebarThreadBotQueued: 'Remote queued',
  sidebarThreadBotError: 'Remote error',
  sidebarThreadRemoteUnread: 'Remote unread'
}

function t(key: string, opts?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
}

function binding(overrides: Partial<ClawThreadRemoteBinding> = {}): ClawThreadRemoteBinding {
  return {
    threadId: 'desktop-thread-1234567890',
    provider: 'discord',
    providerLabel: 'Discord',
    channelId: 'channel-1',
    channelLabel: '#debug',
    channelEnabled: true,
    guardMode: 'all_messages',
    scope: 'conversation',
    runtimeId: 'codex',
    conversationId: 'conversation-1',
    chatId: 'chat-1',
    remoteThreadId: 'remote-thread-9',
    senderName: 'Alice',
    workspaceRoot: '/Users/zxy/SciForge',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides
  }
}

describe('ActiveRemoteBindingDetails', () => {
  it('renders the current remote binding details in the desktop thread top bar', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveRemoteBindingDetails, {
        binding: binding(),
        statusKind: 'watched',
        unread: true,
        t
      })
    )

    expect(html).toContain('Discord')
    expect(html).toContain('Bot is watching')
    expect(html).toContain('#debug')
    expect(html).toContain('SciForge')
    expect(html).toContain('codex:deskto...7890')
    expect(html).toContain('All messages')
    expect(html).toContain('Provider Discord')
    expect(html).toContain('Channel #debug')
    expect(html).toContain('Project SciForge')
    expect(html).toContain('Thread codex:desktop-thread-1234567890')
    expect(html).toContain('Guard All messages')
    expect(html).toContain('Remote Alice')
    expect(html).toContain('Remote unread')
  })

  it('labels missing guard mode and workspace with safe defaults', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveRemoteBindingDetails, {
        binding: binding({
          guardMode: 'only_mention',
          workspaceRoot: ''
        }),
        statusKind: 'bound',
        unread: false,
        t
      })
    )

    expect(remoteBindingGuardModeLabel(undefined, t)).toBe('Mentions only')
    expect(html).toContain('Default project')
    expect(html).toContain('Mentions only')
    expect(html).toContain('Remote bound')
  })

  it('includes the latest remote failure in the desktop binding details', () => {
    const html = renderToStaticMarkup(
      createElement(ActiveRemoteBindingDetails, {
        binding: binding({
          lastFailure: {
            provider: 'discord',
            message: 'Runtime offline',
            failureKind: 'runtime_offline',
            channelId: 'channel-1',
            chatId: 'chat-1',
            threadId: 'desktop-thread-1234567890',
            runtimeId: 'codex',
            occurredAt: '2026-06-13T00:03:00.000Z'
          }
        }),
        statusKind: 'error',
        unread: false,
        t
      })
    )

    expect(html).toContain('Remote error')
    expect(html).toContain('Last failure Runtime offline')
  })
})
