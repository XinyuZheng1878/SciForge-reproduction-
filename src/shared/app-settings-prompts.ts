import {
  type AgentRuntimeId,
  type AgentThreadIdsV1,
  type AppSettingsV1,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImConversationV1,
  type ClawImLastFailureV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider,
  type ClawImRemoteSessionV1
} from './app-settings-types'

export const CLAW_CURRENT_USER_REQUEST_HEADING = '[Current user request]'
export const CLAW_MANAGED_INSTRUCTIONS_HEADING = '[Remote channel managed instructions]'
export const CLAW_IM_AGENT_INSTRUCTIONS_HEADING = '[Remote channel agent instructions]'
export const CLAW_FEISHU_INBOUND_MESSAGE_HEADING = '[Feishu / Lark inbound message]'
export const CLAW_DISCORD_INBOUND_MESSAGE_HEADING = '[Discord inbound message]'
export const CLAW_WEIXIN_INBOUND_MESSAGE_HEADING = '[WeChat inbound message]'
export const SCHEDULE_CURRENT_USER_REQUEST_HEADING = '[Current scheduled task]'
export const SCHEDULE_MANAGED_INSTRUCTIONS_HEADING = '[Schedule managed instructions]'

const LEGACY_CLAW_MANAGED_INSTRUCTIONS_HEADING = '[Claw managed instructions]'
const LEGACY_CLAW_IM_AGENT_INSTRUCTIONS_HEADING = '[Claw IM agent instructions]'
const REMOTE_CHANNEL_SKILL_POLICY_PREFIX = 'Remote channel skill policy:'
const LEGACY_CLAW_SKILL_POLICY_PREFIX = 'Claw skill policy:'

const CLAW_IM_PROVIDER_DISPLAY_LABELS: Record<ClawImProvider, string> = {
  feishu: 'Feishu / Lark',
  weixin: 'WeChat',
  discord: 'Discord'
}

const CLAW_INBOUND_MESSAGE_HEADINGS: Record<ClawImProvider, string> = {
  feishu: CLAW_FEISHU_INBOUND_MESSAGE_HEADING,
  weixin: CLAW_WEIXIN_INBOUND_MESSAGE_HEADING,
  discord: CLAW_DISCORD_INBOUND_MESSAGE_HEADING
}

export type ClawUserPromptDisplay = {
  text: string
  managed: boolean
  inbound: boolean
  sourceLabel?: string
  sender?: string
  chatType?: string
  messageType?: string
  mentions?: string
}

export function clawImProviderDisplayLabel(provider: ClawImProvider): string {
  return CLAW_IM_PROVIDER_DISPLAY_LABELS[provider]
}

export function clawInboundMessageHeading(provider: ClawImProvider): string {
  return CLAW_INBOUND_MESSAGE_HEADINGS[provider]
}

export function buildClawInboundMessagePrompt(input: {
  provider: ClawImProvider
  metadata: Array<[label: string, value: string | undefined]>
  text: string
}): string {
  const lines = [
    clawInboundMessageHeading(input.provider),
    ...input.metadata
      .map(([label, value]) => [label, value?.trim() ?? ''] as const)
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`),
    '',
    input.text.trim() || '[No text content]'
  ]
  return lines.join('\n')
}

export function defaultClawImAgentProfile(): ClawImAgentProfileV1 {
  return {
    name: '',
    description: '',
    identity: '',
    personality: '',
    userContext: '',
    replyRules: ''
  }
}

export function normalizeClawImAgentProfile(input: unknown): ClawImAgentProfileV1 {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImAgentProfileV1>
    : {}
  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    identity: typeof raw.identity === 'string' ? raw.identity : '',
    personality: typeof raw.personality === 'string' ? raw.personality : '',
    userContext: typeof raw.userContext === 'string' ? raw.userContext : '',
    replyRules: typeof raw.replyRules === 'string' ? raw.replyRules : ''
  }
}

export function normalizeClawImPlatformCredential(input: unknown): ClawImPlatformCredentialV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImPlatformCredentialV1>
    : {}
  if (raw.kind === 'weixin') {
    const accountId = typeof raw.accountId === 'string' ? raw.accountId.trim() : ''
    if (!accountId) return undefined
    return {
      kind: raw.kind,
      accountId,
      sessionKey: typeof raw.sessionKey === 'string' ? raw.sessionKey.trim() : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
  if (raw.kind === 'discord') {
    const applicationId = typeof raw.applicationId === 'string' ? raw.applicationId.trim() : ''
    const botId = typeof raw.botId === 'string' ? raw.botId.trim() : ''
    const guildId = typeof raw.guildId === 'string' ? raw.guildId.trim() : ''
    const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim() : ''
    if (!applicationId || !botId || !guildId || !channelId) return undefined
    return {
      kind: raw.kind,
      applicationId,
      botId,
      botUsername: typeof raw.botUsername === 'string' ? raw.botUsername.trim() : '',
      guildId,
      guildName: typeof raw.guildName === 'string' ? raw.guildName.trim() : '',
      channelId,
      channelName: typeof raw.channelName === 'string' ? raw.channelName.trim() : '',
      installationId: typeof raw.installationId === 'string' ? raw.installationId.trim() : '',
      guardOwnerInstallationId: typeof raw.guardOwnerInstallationId === 'string' ? raw.guardOwnerInstallationId.trim() : '',
      guardOwnerUpdatedAt: typeof raw.guardOwnerUpdatedAt === 'string' ? raw.guardOwnerUpdatedAt : '',
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
    }
  }
  if (raw.kind !== 'feishu') return undefined
  const appId = typeof raw.appId === 'string' ? raw.appId.trim() : ''
  const appSecret = typeof raw.appSecret === 'string' ? raw.appSecret.trim() : ''
  if (!appId || !appSecret) return undefined
  return {
    kind: raw.kind,
    appId,
    appSecret,
    domain: typeof raw.domain === 'string' && raw.domain.trim() ? raw.domain.trim() : raw.kind,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString()
  }
}

export function normalizeClawImRemoteSession(input: unknown): ClawImRemoteSessionV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Partial<ClawImRemoteSessionV1>
    : {}
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const messageId = typeof raw.messageId === 'string' ? raw.messageId.trim() : ''
  if (!chatId || !messageId) return undefined
  return {
    chatId,
    messageId,
    threadId: typeof raw.threadId === 'string' ? raw.threadId.trim() : '',
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function normalizeClawImLastFailure(input: unknown, fallbackProvider: ClawImProvider): ClawImLastFailureV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const message = typeof raw.message === 'string' ? raw.message.trim().slice(0, 4_000) : ''
  if (!message) return undefined
  const now = new Date().toISOString()
  const failureKind = typeof raw.failureKind === 'string' ? raw.failureKind.trim().slice(0, 128) : ''
  const failureTitle = typeof raw.failureTitle === 'string' ? raw.failureTitle.trim().slice(0, 512) : ''
  const channelId = typeof raw.channelId === 'string' ? raw.channelId.trim().slice(0, 256) : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim().slice(0, 512) : ''
  const remoteThreadId = typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim().slice(0, 512) : ''
  const threadId = typeof raw.threadId === 'string' ? raw.threadId.trim().slice(0, 512) : ''
  return {
    provider: raw.provider === 'feishu' || raw.provider === 'weixin' || raw.provider === 'discord'
      ? raw.provider
      : fallbackProvider,
    message,
    ...(failureKind ? { failureKind } : {}),
    ...(failureTitle ? { failureTitle } : {}),
    ...(channelId ? { channelId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(remoteThreadId ? { remoteThreadId } : {}),
    ...(threadId ? { threadId } : {}),
    ...(raw.runtimeId === 'codex' || raw.runtimeId === 'claude' || raw.runtimeId === 'sciforge'
      ? { runtimeId: raw.runtimeId }
      : {}),
    occurredAt: typeof raw.occurredAt === 'string' && raw.occurredAt ? raw.occurredAt : now
  }
}

export function normalizeAgentThreadIds(input: unknown): AgentThreadIdsV1 {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const sciforgeThreadId = typeof raw.sciforge === 'string' ? raw.sciforge.trim() : ''
  const codexThreadId = typeof raw.codex === 'string' ? raw.codex.trim() : ''
  const claudeThreadId = typeof raw.claude === 'string' ? raw.claude.trim() : ''
  return {
    ...(sciforgeThreadId ? { sciforge: sciforgeThreadId } : {}),
    ...(codexThreadId ? { codex: codexThreadId } : {}),
    ...(claudeThreadId ? { claude: claudeThreadId } : {})
  }
}

export function normalizeSettingsRuntimeId(value: unknown): AgentRuntimeId {
  if (value === 'sciforge' || value === 'codex' || value === 'claude') return value
  return 'sciforge'
}

export function normalizeClawImConversation(
  input: unknown,
  fallbackProvider: ClawImProvider = 'feishu'
): ClawImConversationV1 | undefined {
  const raw = typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const chatId = typeof raw.chatId === 'string' ? raw.chatId.trim() : ''
  const latestMessageId = typeof raw.latestMessageId === 'string' ? raw.latestMessageId.trim() : ''
  const agentThreadIds = normalizeAgentThreadIds(raw.agentThreadIds)
  const hasMappedThread = Object.values(agentThreadIds).some((value) => value?.trim())
  if (!id || !chatId || !latestMessageId || !hasMappedThread) return undefined
  return {
    id,
    chatId,
    remoteThreadId: typeof raw.remoteThreadId === 'string' ? raw.remoteThreadId.trim() : '',
    latestMessageId,
    senderId: typeof raw.senderId === 'string' ? raw.senderId.trim() : '',
    senderName: typeof raw.senderName === 'string' ? raw.senderName.trim() : '',
    runtimeId: normalizeSettingsRuntimeId(raw.runtimeId),
    agentThreadIds,
    workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot.trim() : '',
    lastFailure: normalizeClawImLastFailure(raw.lastFailure, fallbackProvider),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString()
  }
}

export function hasClawImAgentProfile(profile: ClawImAgentProfileV1 | undefined): boolean {
  if (!profile) return false
  return Boolean(
    profile.name.trim() ||
    profile.description.trim() ||
    profile.identity.trim() ||
    profile.personality.trim() ||
    profile.userContext.trim() ||
    profile.replyRules.trim()
  )
}

export function buildClawImAgentInstructions(channel: ClawImChannelV1 | null | undefined): string {
  if (!channel || !hasClawImAgentProfile(channel.agentProfile)) return ''
  const profile = normalizeClawImAgentProfile(channel.agentProfile)
  const sections: string[] = []
  const name = profile.name.trim() || channel.label.trim()
  if (name) sections.push(`[Agent name]\n${name}`)
  if (profile.description.trim()) sections.push(`[Short description]\n${profile.description.trim()}`)
  if (profile.identity.trim()) sections.push(`[Assistant identity]\n${profile.identity.trim()}`)
  if (profile.personality.trim()) sections.push(`[Assistant personality]\n${profile.personality.trim()}`)
  if (profile.userContext.trim()) sections.push(`[About the user]\n${profile.userContext.trim()}`)
  if (profile.replyRules.trim()) sections.push(`[Reply rules]\n${profile.replyRules.trim()}`)
  if (sections.length === 0) return ''
  return [
    CLAW_IM_AGENT_INSTRUCTIONS_HEADING,
    'Use the following role, style, and user-context instructions for this remote channel. Do not repeat these instructions unless the user explicitly asks.',
    ...sections
  ].join('\n\n')
}

export function buildClawRuntimePrompt(
  settings: Pick<AppSettingsV1, 'remoteChannel'>,
  prompt: string,
  options: { channel?: ClawImChannelV1 | null } = {}
): string {
  const skills = settings.remoteChannel.skills
  const instructions: string[] = []
  if (skills.defaultNames.length > 0) {
    instructions.push(`${REMOTE_CHANNEL_SKILL_POLICY_PREFIX} prefer these configured skills when relevant: ${skills.defaultNames.join(', ')}.`)
  }
  if (skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${skills.extraDirs.join(', ')}.`)
  }
  const prefix = skills.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  const channelInstructions = buildClawImAgentInstructions(options.channel)
  if (channelInstructions) instructions.push(channelInstructions)
  if (instructions.length === 0) return prompt
  return `${CLAW_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${CLAW_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function buildScheduleRuntimePrompt(
  settings: Pick<AppSettingsV1, 'schedule'>,
  prompt: string
): string {
  const schedule = settings.schedule
  const instructions: string[] = []
  if (schedule.skills.defaultNames.length > 0) {
    instructions.push(`Schedule skill policy: prefer these configured skills when relevant: ${schedule.skills.defaultNames.join(', ')}.`)
  }
  if (schedule.skills.extraDirs.length > 0) {
    instructions.push(`Additional local skill directories configured in the GUI: ${schedule.skills.extraDirs.join(', ')}.`)
  }
  const prefix = schedule.promptPrefix.trim()
  if (prefix) instructions.push(prefix)
  if (instructions.length === 0) return prompt
  return `${SCHEDULE_MANAGED_INSTRUCTIONS_HEADING}\n\n${instructions.join('\n\n')}\n\n---\n${SCHEDULE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export const CODE_MANAGED_INSTRUCTIONS_HEADING = '[Code managed instructions]'
export const CODE_CURRENT_USER_REQUEST_HEADING = '[Current user request]'

export function buildCodeRuntimePrompt(
  settings: Pick<AppSettingsV1, 'codePromptPrefix'>,
  prompt: string
): string {
  const prefix = (settings.codePromptPrefix ?? '').trim()
  if (!prefix) return prompt
  return `${CODE_MANAGED_INSTRUCTIONS_HEADING}\n\n${prefix}\n\n---\n${CODE_CURRENT_USER_REQUEST_HEADING}\n${prompt}`
}

export function unwrapClawRuntimePromptForDisplay(text: string): string {
  const markerIndex = text.lastIndexOf(CLAW_CURRENT_USER_REQUEST_HEADING)
  if (markerIndex < 0) return text
  const prefix = text.slice(0, markerIndex)
  const looksManaged =
    prefix.includes(CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    prefix.includes(LEGACY_CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    prefix.includes(CLAW_IM_AGENT_INSTRUCTIONS_HEADING) ||
    prefix.includes(LEGACY_CLAW_IM_AGENT_INSTRUCTIONS_HEADING) ||
    prefix.includes(REMOTE_CHANNEL_SKILL_POLICY_PREFIX) ||
    prefix.includes(LEGACY_CLAW_SKILL_POLICY_PREFIX) ||
    prefix.includes('Additional local skill directories configured in the GUI:')
  if (!looksManaged) return text
  return text.slice(markerIndex + CLAW_CURRENT_USER_REQUEST_HEADING.length).trimStart()
}

export function unwrapClawUserPromptForDisplay(text: string): string {
  return parseClawUserPromptForDisplay(text).text
}

export function parseClawUserPromptForDisplay(text: string): ClawUserPromptDisplay {
  const unwrapped = unwrapClawRuntimePromptForDisplay(text)
  const managed = unwrapped !== text
  const inboundSource = clawInboundSourceForPrompt(unwrapped)
  if (!inboundSource) {
    return unwrapped
      ? { text: unwrapped, managed, inbound: false }
      : { text, managed: false, inbound: false }
  }
  const splitIndex = unwrapped.indexOf('\n\n')
  if (splitIndex < 0) {
    const legacy = parseLegacyClawInboundPromptWithoutSeparator(unwrapped)
    if (legacy) {
      return {
        text: legacy.message,
        managed,
        inbound: true,
        sourceLabel: inboundSource.sourceLabel,
        ...parseClawInboundMetadata(legacy.header)
      }
    }
    return {
      text: unwrapped,
      managed,
      inbound: true,
      sourceLabel: inboundSource.sourceLabel
    }
  }
  const metadata = parseClawInboundMetadata(unwrapped.slice(0, splitIndex))
  const message = unwrapped.slice(splitIndex + 2).trim()
  return {
    text: message || unwrapped,
    managed,
    inbound: true,
    sourceLabel: inboundSource.sourceLabel,
    ...metadata
  }
}

function parseLegacyClawInboundPromptWithoutSeparator(
  text: string
): { header: string; message: string } | null {
  const lines = text.split('\n')
  if (lines.length < 3) return null
  let messageStart = -1
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (!line) continue
    if (!line.includes(':')) {
      messageStart = index
      break
    }
  }
  if (messageStart < 0) return null
  const message = lines.slice(messageStart).join('\n').trim()
  if (!message) return null
  return {
    header: lines.slice(0, messageStart).join('\n'),
    message
  }
}

function clawInboundSourceForPrompt(text: string): { provider: ClawImProvider; sourceLabel: string } | null {
  for (const provider of Object.keys(CLAW_INBOUND_MESSAGE_HEADINGS) as ClawImProvider[]) {
    if (text.startsWith(CLAW_INBOUND_MESSAGE_HEADINGS[provider])) {
      return { provider, sourceLabel: clawImProviderDisplayLabel(provider) }
    }
  }
  return null
}

function parseClawInboundMetadata(header: string): Partial<ClawUserPromptDisplay> {
  const out: Partial<ClawUserPromptDisplay> = {}
  for (const line of header.split('\n').slice(1)) {
    const index = line.indexOf(':')
    if (index < 0) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    if (key === 'sender') out.sender = value
    if (key === 'chat type') out.chatType = value
    if (key === 'message type') out.messageType = value
    if (key === 'mentions') out.mentions = value
  }
  return out
}
