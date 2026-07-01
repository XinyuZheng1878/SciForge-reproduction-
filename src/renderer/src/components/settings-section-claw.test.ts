import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { ClawSettingsSection, discordGuardOwnerPatch } from './settings-section-claw'

const labels: Record<string, string> = {
  clawRuntime: 'Phone connection',
  clawEnabled: 'Enable phone connection',
  clawEnabledDesc: 'Enable phone connection description',
  clawDefaultWorkspace: 'Default phone workspace',
  clawDefaultWorkspaceDesc: 'Default phone workspace description',
  clawDefaultWorkspacePlaceholder: 'Inherit {{path}}',
  clawDefaultWorkspaceReset: 'Use GUI default',
  browse: 'Browse',
  clawManageAgents: 'Connected phone agents',
  clawManageAgentsEmpty: 'No phone agents',
  clawManageAgentMeta: '{{provider}} {{model}} {{workspace}}',
  clawDiscordChannelMeta: '{{server}} {{channel}}',
  clawDiscordLocalOnlineGuard: 'Guards this channel only while this computer is online.',
  clawDiscordGuardConflictState: 'Conflict',
  clawDiscordGuardConflictTitle: 'This Bot is being guarded by another device',
  clawDiscordGuardConflictDesc: 'Owner installation: {{owner}}.',
  clawDiscordGuardTakeover: 'Take over manually',
  clawManageAgentEnabled: 'Enabled',
  clawManageAgentDisabled: 'Disabled',
  clawManageAgentName: 'Agent name',
  clawManageAgentNamePlaceholder: 'Agent name placeholder',
  clawModel: 'Model',
  clawWorkspaceOverride: 'Workspace override',
  clawWorkspaceInherit: 'Use default workspace: {{path}}',
  clawManageAgentDescription: 'Short description',
  clawManageAgentDescriptionPlaceholder: 'Short description placeholder',
  clawManageAgentIdentity: 'Role definition',
  clawManageAgentIdentityPlaceholder: 'Role definition placeholder',
  clawManageAgentPersonality: 'Personality',
  clawManageAgentPersonalityPlaceholder: 'Personality placeholder',
  clawManageAgentUserContext: 'User context',
  clawManageAgentUserContextPlaceholder: 'User context placeholder',
  clawManageAgentReplyRules: 'Reply rules',
  clawManageAgentReplyRulesPlaceholder: 'Reply rules placeholder'
}

function t(key: string, values?: Record<string, unknown>): string {
  let label = labels[key] ?? key
  for (const [name, value] of Object.entries(values ?? {})) {
    label = label.replace(`{{${name}}}`, String(value))
  }
  return label
}

function buildSettings(): AppSettingsV1 {
  const settings: AppSettingsV1 = {
    version: 1,
    installationId: 'dsgui-local',
    locale: 'en',
    theme: 'system',
    uiFontScale: 'medium',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: { sciforge: defaultLocalRuntimeSettings() },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
  settings.remoteChannel.enabled = true
  settings.remoteChannel.im.workspaceRoot = '/tmp/claw'
  settings.remoteChannel.channels = [
    {
      id: 'channel_1',
      provider: 'feishu',
      label: 'Team helper',
      enabled: true,
      model: 'auto',
      agentThreadIds: { sciforge: 'thr_1' },
      workspaceRoot: '',
      agentProfile: {
        name: 'Team helper',
        description: 'Handles team chat requests',
        identity: 'You are the project assistant.',
        personality: 'Concise and practical.',
        userContext: 'The user coordinates product and engineering.',
        replyRules: 'Start with the conclusion.'
      },
      conversations: [],
      createdAt: '2026-06-03T00:00:00.000Z',
      updatedAt: '2026-06-03T00:00:00.000Z'
    }
  ]
  return settings
}

describe('ClawSettingsSection', () => {
  it('renders connected phone agent management fields', () => {
    const html = renderToStaticMarkup(
      createElement(ClawSettingsSection, {
        ctx: {
          t,
          form: buildSettings(),
          update: vi.fn(),
          selectControlClass: 'select-control',
          pickClawWorkspace: async () => undefined,
          resetClawWorkspaceToDefault: () => undefined,
          clawWorkspacePickerError: null
        }
      })
    )

    expect(html).toContain('Connected phone agents')
    expect(html).toContain('Team helper')
    expect(html).toContain('Role definition')
    expect(html).toContain('You are the project assistant.')
    expect(html).toContain('Personality')
    expect(html).toContain('Reply rules')
    expect(html).toContain('Start with the conclusion.')
    expect(html).toContain('<option value="deepseek-v4-pro"')
  })

  it('surfaces Discord local-online guard state and takeover placeholder', () => {
    const form = buildSettings()
    form.remoteChannel.channels = [
      {
        id: 'discord-1',
        provider: 'discord',
        label: '#support',
        enabled: true,
        model: 'deepseek-v4-flash',
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
          guardOwnerUpdatedAt: '2026-06-03T00:00:00.000Z',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]

    const html = renderToStaticMarkup(
      createElement(ClawSettingsSection, {
        ctx: {
          t,
          form,
          update: vi.fn(),
          selectControlClass: 'select-control',
          pickClawWorkspace: async () => undefined,
          resetClawWorkspaceToDefault: () => undefined,
          clawWorkspacePickerError: null
        }
      })
    )

    expect(html).toContain('Support server #support')
    expect(html).toContain('Guards this channel only while this computer is online.')
    expect(html).toContain('This Bot is being guarded by another device')
    expect(html).toContain('Take over manually')
  })

  it('enables all Discord channel messages when restoring local guard ownership', () => {
    const form = buildSettings()
    form.remoteChannel.channels = [
      {
        id: 'discord-1',
        provider: 'discord',
        label: '#support',
        enabled: false,
        guardMode: 'only_mention',
        model: 'deepseek-v4-flash',
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
          installationId: 'dsgui-local',
          createdAt: '2026-06-03T00:00:00.000Z'
        },
        conversations: [],
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]

    expect(discordGuardOwnerPatch(form, form.remoteChannel.channels[0], true)).toMatchObject({
      enabled: true,
      guardMode: 'all_messages',
      platformCredential: {
        guardOwnerInstallationId: 'dsgui-local'
      }
    })
  })
})
