import {
  DEFAULT_CLAW_MODEL,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  type ClawImChannelV1,
  type ClawImConversationV1,
  type ClawImRecentMessageV1,
  type ClawImSettingsV1,
  type ClawImProvider,
  type ClawSettingsPatchV1,
  type ClawSettingsV1,
  type ClawTaskV1
} from './app-settings-types'
import {
  normalizeClawImAgentProfile,
  normalizeClawImLastFailure,
  normalizeClawImConversation,
  normalizeClawImPlatformCredential,
  normalizeClawImRemoteSession,
  normalizeAgentThreadIds,
  normalizeSettingsRuntimeId,
  readLegacyAgentThreadId
} from './app-settings-prompts'
import { normalizeScheduledTask } from './app-settings-schedule'
import {
  compactStrings,
  normalizeBoolean,
  normalizeClawImChannelGuardMode,
  normalizeClawModel,
  normalizeImProvider,
  normalizePathSegment,
  normalizePositiveInteger,
  normalizeRunMode
} from './app-settings-normalizers'

type LegacyClawImSettingsPatch = Partial<ClawImSettingsV1> & {
  openClawGatewayUrl?: unknown
}

function defaultClawChannelLabel(provider: ClawImProvider): string {
  if (provider === 'discord') return 'discord bot'
  return provider === 'weixin' ? 'weixin agent' : 'feishu agent'
}

function normalizeLegacyDefaultClawChannelName(provider: ClawImProvider, value: string): string {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (provider === 'weixin') {
    return lower === 'weixin agent' || lower === 'wechat agent' || lower === 'wechat'
      ? 'weixin agent'
      : trimmed
  }
  if (provider === 'discord') {
    return lower === 'discord' || lower === 'discord agent' || lower === 'discord bot'
      ? 'discord bot'
      : trimmed
  }
  if (lower === 'feishu agent' || lower === 'feishu / lark') return 'feishu agent'
  if (lower === 'lark agent') return 'lark agent'
  return trimmed
}

function normalizeClawChannelLabel(provider: ClawImProvider, value: string): string {
  const normalized = normalizeLegacyDefaultClawChannelName(provider, value)
  return normalized || defaultClawChannelLabel(provider)
}

function normalizeIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback
}

function normalizeClawImRecentMessage(input: unknown, fallbackProvider: ClawImProvider): ClawImRecentMessageV1 | null {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : ''
  const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  if (!messageId || !channelId || !chatId) return null
  const now = new Date().toISOString()
  return {
    provider: normalizeImProvider(raw.provider ?? fallbackProvider),
    channelId,
    chatId,
    remoteThreadId: typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim() : '',
    messageId,
    ...(typeof raw.senderName === 'string' && raw.senderName.trim()
      ? { senderName: raw.senderName.trim().slice(0, 512) }
      : {}),
    ...(typeof raw.text === 'string' && raw.text.trim()
      ? { text: raw.text.trim().slice(0, 2_000) }
      : {}),
    receivedAt: normalizeIsoDate(raw.receivedAt, now)
  }
}

export function defaultClawSettings(): ClawSettingsV1 {
  return {
    enabled: false,
    skills: {
      defaultNames: [],
      extraDirs: [],
      promptPrefix: ''
    },
    im: {
      enabled: false,
      provider: 'feishu',
      port: 8787,
      path: '/claw/im',
      secret: '',
      weixinBridgeUrl: DEFAULT_WEIXIN_BRIDGE_RPC_URL,
      workspaceRoot: '',
      model: DEFAULT_CLAW_MODEL,
      mode: 'agent',
      responseTimeoutMs: 120_000
    },
    channels: [],
    tasks: []
  }
}

export function normalizeClawSettings(input: ClawSettingsPatchV1 | undefined): ClawSettingsV1 {
  const defaults = defaultClawSettings()
  const source = input ?? {}
  const skills = source.skills ?? defaults.skills
  const im = (source.im ?? defaults.im) as LegacyClawImSettingsPatch
  const weixinBridgeUrl = typeof im.weixinBridgeUrl === 'string' ? im.weixinBridgeUrl.trim() : ''
  const legacyOpenClawGatewayUrl =
    typeof im.openClawGatewayUrl === 'string' ? im.openClawGatewayUrl.trim() : ''
  const rawChannels = Array.isArray(source.channels)
    ? source.channels.filter((channel) => {
        const raw = channel as Partial<ClawImChannelV1>
        return (
          raw.provider === undefined ||
          raw.provider === null ||
          raw.provider === 'feishu' ||
          raw.provider === 'weixin' ||
          raw.provider === 'discord'
        )
      })
    : []
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    skills: {
      defaultNames: compactStrings(skills.defaultNames),
      extraDirs: compactStrings(skills.extraDirs),
      promptPrefix: typeof skills.promptPrefix === 'string' ? skills.promptPrefix : ''
    },
    im: {
      enabled: normalizeBoolean(im.enabled, defaults.im.enabled),
      provider: normalizeImProvider(im.provider),
      port: normalizePositiveInteger(im.port, defaults.im.port, 1024, 65_535),
      path: normalizePathSegment(im.path),
      secret: typeof im.secret === 'string' ? im.secret.trim() : '',
      weixinBridgeUrl: weixinBridgeUrl || legacyOpenClawGatewayUrl || defaults.im.weixinBridgeUrl,
      workspaceRoot: typeof im.workspaceRoot === 'string' ? im.workspaceRoot.trim() : '',
      model: typeof im.model === 'string' && im.model.trim() ? im.model.trim() : DEFAULT_CLAW_MODEL,
      mode: normalizeRunMode(im.mode),
      responseTimeoutMs: normalizePositiveInteger(im.responseTimeoutMs, defaults.im.responseTimeoutMs, 5_000, 600_000)
    },
    channels: rawChannels
      .map((channel, index): ClawImChannelV1 => {
          const raw = channel as Record<string, unknown>
          const provider = normalizeImProvider(raw.provider as ClawImProvider)
          const directThreadId = typeof raw.threadId === 'string' ? raw.threadId.trim() : ''
          const legacyAgentThreadId = readLegacyAgentThreadId(raw.agentThreadIds)
          const threadId = directThreadId || legacyAgentThreadId
          const agentThreadIds = normalizeAgentThreadIds(raw.agentThreadIds, threadId)
          const agentProfile = normalizeClawImAgentProfile(raw.agentProfile)
          const label = normalizeClawChannelLabel(provider, typeof raw.label === 'string' ? raw.label : '')
          const profileName = normalizeLegacyDefaultClawChannelName(provider, agentProfile.name)
          return {
            id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `im-${index + 1}`,
            provider,
            label,
            enabled: normalizeBoolean(raw.enabled, true),
            guardMode: normalizeClawImChannelGuardMode(raw.guardMode),
            model: normalizeClawModel(raw.model),
            threadId,
            runtimeId: normalizeSettingsRuntimeId(raw.runtimeId),
            agentThreadIds,
            workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
            agentProfile: {
              ...agentProfile,
              name: profileName || label
            },
            platformCredential: normalizeClawImPlatformCredential(raw.platformCredential),
            remoteSession: normalizeClawImRemoteSession(raw.remoteSession),
            conversations: Array.isArray(raw.conversations)
              ? raw.conversations
                  .map((conversation) => normalizeClawImConversation(conversation, provider))
                  .filter((conversation): conversation is ClawImConversationV1 => conversation != null)
              : [],
            recentMessages: Array.isArray(raw.recentMessages)
              ? raw.recentMessages
                  .map((message) => normalizeClawImRecentMessage(message, provider))
                  .filter((message): message is ClawImRecentMessageV1 => message != null)
                  .slice(-2_000)
              : [],
            lastFailure: normalizeClawImLastFailure(raw.lastFailure, provider),
            createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : now,
            updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : now
          }
        }),
    tasks: Array.isArray(source.tasks)
      ? source.tasks.map((task, index) => normalizeScheduledTask(task as Partial<ClawTaskV1>, index, now))
      : []
  }
}

export function mergeClawSettings(
  current: ClawSettingsV1,
  patch: ClawSettingsPatchV1 | undefined
): ClawSettingsV1 {
  if (!patch) return normalizeClawSettings(current)
  return normalizeClawSettings({
    ...current,
    ...patch,
    skills: {
      ...current.skills,
      ...(patch.skills ?? {})
    },
    im: {
      ...current.im,
      ...(patch.im ?? {})
    },
    channels: patch.channels ?? current.channels,
    tasks: patch.tasks ?? current.tasks
  })
}
