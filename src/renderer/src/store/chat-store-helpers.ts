import type { ChatBlock, NormalizedThread } from '../agent/types'
import { DEFAULT_COMPOSER_MODEL_IDS } from '@shared/default-composer-models'
import {
  isAgentRuntimeActiveTurnState,
  normalizeAgentRuntimeTurnState
} from '@shared/agent-runtime-contract'
import {
  CLAW_MANAGED_INSTRUCTIONS_HEADING,
  CLAW_MODEL_IDS,
  type AgentRuntimeId,
  type ClawImAgentProfileV1,
  type ClawImChannelV1,
  type ClawImLastFailureV1,
  type ClawImPlatformCredentialV1,
  type ClawImProvider
} from '@shared/app-settings'
import type { ChatState } from './chat-store-types'
import {
  isClawWorkspacePath,
  isInternalSciForgeWorkspace,
  isInternalTemporaryWorkspace,
  normalizeWorkspaceRoot,
  workspaceRootIdentityKey
} from '../lib/workspace-path'
import { readBrowserStorageItem, writeBrowserStorageItem } from '../lib/browser-storage'

const COMPOSER_MODEL_STORAGE_KEY = 'sciforge.composerModel'
const TURN_MODEL_STORAGE_KEY = 'sciforge.turnModelLabel'
const CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'sciforge.codeWorkspaceRoots.v1'
const HIDDEN_CODE_WORKSPACE_ROOTS_STORAGE_KEY = 'sciforge.hiddenCodeWorkspaceRoots.v1'
export const MAX_CODE_WORKSPACE_ROOTS = 30
export const MAX_TURN_MODEL_LABELS = 500

export type ClawThreadRemoteStatusKind = 'bound' | 'watched' | 'running' | 'queued' | 'error'

export type ClawThreadRemoteBinding = {
  threadId: string
  provider: ClawImProvider
  providerLabel: string
  channelId: string
  channelLabel: string
  channelEnabled: boolean
  guardMode: NonNullable<ClawImChannelV1['guardMode']>
  scope: 'channel' | 'conversation'
  runtimeId?: AgentRuntimeId
  conversationId?: string
  chatId?: string
  remoteThreadId?: string
  senderName?: string
  workspaceRoot?: string
  lastFailure?: ClawImLastFailureV1
  updatedAt: string
}

export const CLAW_COMPOSER_MODEL_IDS = [...CLAW_MODEL_IDS]

export function readStoredComposerModel(allowedIds: readonly string[]): string {
  const raw = readBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY)
  if (raw === null) return ''
  if (raw === '') return ''
  if (allowedIds.includes(raw)) return raw
  return ''
}

export function persistComposerModel(model: string): void {
  writeBrowserStorageItem(COMPOSER_MODEL_STORAGE_KEY, model)
}

export function compactCodeWorkspaceRoots(workspaceRoots: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const workspaceRoot of workspaceRoots) {
    const normalized = normalizeWorkspaceRoot(workspaceRoot ?? '').replace(/[\\/]+$/, '')
    if (!normalized) continue
    if (isInternalTemporaryWorkspace(normalized)) continue
    if (isInternalSciForgeWorkspace(normalized)) continue
    if (isClawWorkspacePath(normalized)) continue
    const key = workspaceRootIdentityKey(normalized)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
  }
  return out.slice(0, MAX_CODE_WORKSPACE_ROOTS)
}

export function readCodeWorkspaceRoots(): string[] {
  try {
    const raw = readBrowserStorageItem(CODE_WORKSPACE_ROOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return compactCodeWorkspaceRoots(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return []
  }
}

export function readHiddenCodeWorkspaceRoots(): string[] {
  try {
    const raw = readBrowserStorageItem(HIDDEN_CODE_WORKSPACE_ROOTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return compactCodeWorkspaceRoots(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return []
  }
}

export function saveCodeWorkspaceRoots(workspaceRoots: readonly string[]): void {
  writeBrowserStorageItem(
    CODE_WORKSPACE_ROOTS_STORAGE_KEY,
    JSON.stringify(compactCodeWorkspaceRoots(workspaceRoots))
  )
}

function saveHiddenCodeWorkspaceRoots(workspaceRoots: readonly string[]): void {
  writeBrowserStorageItem(
    HIDDEN_CODE_WORKSPACE_ROOTS_STORAGE_KEY,
    JSON.stringify(compactCodeWorkspaceRoots(workspaceRoots))
  )
}

export function isHiddenCodeWorkspaceRoot(
  workspaceRoot: string | undefined | null,
  hiddenWorkspaceRoots: readonly string[]
): boolean {
  const normalized = normalizeWorkspaceRoot(workspaceRoot ?? '')
  if (!normalized) return false
  const key = workspaceRootIdentityKey(normalized)
  return hiddenWorkspaceRoots.some((root) => workspaceRootIdentityKey(normalizeWorkspaceRoot(root)) === key)
}

export function filterHiddenCodeWorkspaceRoots(
  workspaceRoots: readonly (string | undefined | null)[],
  hiddenWorkspaceRoots: readonly string[]
): string[] {
  return compactCodeWorkspaceRoots(
    workspaceRoots.filter((root) => !isHiddenCodeWorkspaceRoot(root, hiddenWorkspaceRoots))
  )
}

export function rememberCodeWorkspaceRoots(
  currentRoots: readonly string[],
  workspaceRoots: readonly (string | undefined | null)[]
): string[] {
  const next = compactCodeWorkspaceRoots([...workspaceRoots, ...currentRoots])
  saveCodeWorkspaceRoots(next)
  return next
}

export function hideCodeWorkspaceRoot(
  currentHiddenRoots: readonly string[],
  workspaceRoot: string
): string[] {
  const next = compactCodeWorkspaceRoots([workspaceRoot, ...currentHiddenRoots])
  saveHiddenCodeWorkspaceRoots(next)
  return next
}

export function restoreHiddenCodeWorkspaceRoots(
  currentHiddenRoots: readonly string[],
  workspaceRoots: readonly (string | undefined | null)[]
): string[] {
  const restoreKeys = new Set(
    compactCodeWorkspaceRoots(workspaceRoots).map((root) => workspaceRootIdentityKey(root))
  )
  const next = compactCodeWorkspaceRoots(
    currentHiddenRoots.filter((root) => !restoreKeys.has(workspaceRootIdentityKey(normalizeWorkspaceRoot(root))))
  )
  saveHiddenCodeWorkspaceRoots(next)
  return next
}

export function forgetCodeWorkspaceRoot(
  currentRoots: readonly string[],
  workspaceRoot: string
): string[] {
  const normalized = normalizeWorkspaceRoot(workspaceRoot)
  const key = workspaceRootIdentityKey(normalized)
  const next = compactCodeWorkspaceRoots(
    currentRoots.filter((root) => workspaceRootIdentityKey(normalizeWorkspaceRoot(root)) !== key)
  )
  saveCodeWorkspaceRoots(next)
  return next
}

export function mergeComposerPickList(upstreamOk: boolean, upstreamIds: string[]): string[] {
  const ordered = new Set<string>()
  ordered.add('auto')
  for (const id of DEFAULT_COMPOSER_MODEL_IDS) {
    if (id !== 'auto') ordered.add(id)
  }
  if (upstreamOk) {
    for (const id of upstreamIds) {
      if (id.trim()) ordered.add(id.trim())
    }
  }
  const tail = [...ordered].filter((id) => id !== 'auto').sort((a, b) => a.localeCompare(b))
  return ['auto', ...tail]
}

export function newClawChannel(
  provider: ClawImProvider,
  agentProfile?: Partial<ClawImAgentProfileV1>,
  platformCredential?: ClawImPlatformCredentialV1
): ClawImChannelV1 {
  const now = new Date().toISOString()
  const fallbackId = `im-${provider}-${Date.now()}`
  const defaultName = defaultClawProviderLabel(provider)
  const profileName = agentProfile?.name?.trim() || defaultName
  return {
    id: globalThis.crypto?.randomUUID?.() ?? fallbackId,
    provider,
    label: profileName,
    enabled: true,
    model: 'auto',
    runtimeId: 'sciforge',
    agentThreadIds: {},
    workspaceRoot: '',
    conversations: [],
    recentMessages: [],
    agentProfile: {
      name: profileName,
      description: agentProfile?.description?.trim() ?? '',
      identity: agentProfile?.identity ?? '',
      personality: agentProfile?.personality ?? '',
      userContext: agentProfile?.userContext ?? '',
      replyRules: agentProfile?.replyRules ?? ''
    },
    ...(platformCredential ? { platformCredential } : {}),
    createdAt: now,
    updatedAt: now
  }
}

export function normalizeClawComposerModel(raw: string): string {
  const trimmed = raw.trim()
  return trimmed || 'auto'
}

export function activeClawChannel(
  state: Pick<ChatState, 'clawChannels' | 'activeClawChannelId'>
): ClawImChannelV1 | null {
  return state.clawChannels.find((channel) => channel.id === state.activeClawChannelId) ?? null
}

function addClawThreadId(ids: Set<string>, threadId: string | undefined): void {
  const id = threadId?.trim() ?? ''
  if (id) ids.add(id)
}

function addClawAgentThreadIds(ids: Set<string>, agentThreadIds: Partial<Record<AgentRuntimeId, string>> | undefined): void {
  for (const threadId of Object.values(agentThreadIds ?? {})) {
    addClawThreadId(ids, threadId)
  }
}

export function clawThreadIdsFromChannels(
  channels: ClawImChannelV1[]
): Set<string> {
  const ids = new Set<string>()
  for (const channel of channels) {
    addClawAgentThreadIds(ids, channel.agentThreadIds)
    for (const conversation of channel.conversations) {
      addClawAgentThreadIds(ids, conversation.agentThreadIds)
    }
  }
  return ids
}

export function watchedClawThreadIdsFromChannels(
  channels: ClawImChannelV1[]
): Set<string> {
  const ids = new Set<string>()
  for (const channel of channels) {
    if (!channel.enabled) continue
    addClawAgentThreadIds(ids, channel.agentThreadIds)
    for (const conversation of channel.conversations) {
      addClawAgentThreadIds(ids, conversation.agentThreadIds)
    }
  }
  return ids
}

export function clawImProviderDisplayLabel(provider: ClawImProvider): string {
  if (provider === 'discord') return 'Discord'
  if (provider === 'weixin') return 'WeChat'
  return 'Feishu / Lark'
}

export function clawThreadRemoteBindingsFromChannels(
  channels: ClawImChannelV1[]
): Map<string, ClawThreadRemoteBinding> {
  const bindings = new Map<string, ClawThreadRemoteBinding>()
  for (const channel of channels) {
    const channelBinding: Omit<ClawThreadRemoteBinding, 'threadId'> = {
      provider: channel.provider,
      providerLabel: clawImProviderDisplayLabel(channel.provider),
      channelId: channel.id,
      channelLabel: clawRemoteChannelLabel(channel),
      channelEnabled: channel.enabled,
      guardMode: channel.guardMode ?? 'only_mention',
      scope: 'channel',
      runtimeId: channel.runtimeId,
      chatId: channel.remoteSession?.chatId,
      remoteThreadId: channel.remoteSession?.threadId,
      senderName: channel.remoteSession?.senderName,
      workspaceRoot: channel.workspaceRoot,
      lastFailure: channel.lastFailure,
      updatedAt: channel.remoteSession?.updatedAt ?? channel.updatedAt
    }
    addClawThreadBindings(
      bindings,
      clawThreadMappingIds(channel.agentThreadIds),
      channelBinding
    )

    for (const conversation of channel.conversations) {
      const conversationBinding: Omit<ClawThreadRemoteBinding, 'threadId'> = {
        provider: channel.provider,
        providerLabel: clawImProviderDisplayLabel(channel.provider),
        channelId: channel.id,
        channelLabel: clawRemoteChannelLabel(channel),
        channelEnabled: channel.enabled,
        guardMode: channel.guardMode ?? 'only_mention',
        scope: 'conversation',
        runtimeId: conversation.runtimeId ?? channel.runtimeId,
        conversationId: conversation.id,
        chatId: conversation.chatId,
        remoteThreadId: conversation.remoteThreadId,
        senderName: conversation.senderName,
        workspaceRoot: conversation.workspaceRoot || channel.workspaceRoot,
        lastFailure: conversation.lastFailure ?? channel.lastFailure,
        updatedAt: conversation.updatedAt || channel.updatedAt
      }
      addClawThreadBindings(
        bindings,
        clawThreadMappingIds(conversation.agentThreadIds),
        conversationBinding
      )
    }
  }
  return bindings
}

function clawRemoteChannelLabel(channel: ClawImChannelV1): string {
  if (channel.platformCredential?.kind === 'discord') {
    const channelName = channel.platformCredential.channelName.trim() ||
      channel.platformCredential.channelId.trim()
    if (channelName) return `#${channelName}`
  }
  return channel.label.trim() || channel.agentProfile.name.trim() || clawImProviderDisplayLabel(channel.provider)
}

export function deriveClawThreadRemoteStatusKind(options: {
  binding?: ClawThreadRemoteBinding | null
  running?: boolean
  queued?: boolean
  status?: string
  latestTurnStatus?: string
}): ClawThreadRemoteStatusKind | null {
  const status = options.status?.trim().toLowerCase() ?? ''
  const latestTurnStatus = options.latestTurnStatus?.trim().toLowerCase() ?? ''
  if (clawStatusLooksError(status) || clawStatusLooksError(latestTurnStatus)) return 'error'
  if (options.running || clawStatusLooksRunning(status) || clawStatusLooksRunning(latestTurnStatus)) return 'running'
  if (options.queued || clawStatusLooksQueued(status) || clawStatusLooksQueued(latestTurnStatus)) return 'queued'
  if (options.binding?.lastFailure) return 'error'
  if (!options.binding) return null
  return options.binding.channelEnabled ? 'watched' : 'bound'
}

function clawThreadMappingIds(
  agentThreadIds: Partial<Record<AgentRuntimeId, string>> | undefined
): string[] {
  const ids = new Set<string>()
  addClawAgentThreadIds(ids, agentThreadIds)
  return [...ids]
}

function addClawThreadBindings(
  bindings: Map<string, ClawThreadRemoteBinding>,
  threadIds: string[],
  binding: Omit<ClawThreadRemoteBinding, 'threadId'>
): void {
  for (const threadId of threadIds) {
    const normalizedThreadId = threadId.trim()
    if (!normalizedThreadId) continue
    const next = { ...binding, threadId: normalizedThreadId }
    const current = bindings.get(normalizedThreadId)
    if (!current || shouldReplaceClawThreadBinding(current, next)) {
      bindings.set(normalizedThreadId, next)
    }
  }
}

function shouldReplaceClawThreadBinding(
  current: ClawThreadRemoteBinding,
  next: ClawThreadRemoteBinding
): boolean {
  if (current.scope !== next.scope) return next.scope === 'conversation'
  return Date.parse(next.updatedAt) >= Date.parse(current.updatedAt)
}

function clawStatusLooksError(status: string): boolean {
  const normalized = normalizeAgentRuntimeTurnState(status)
  return normalized === 'failed' ||
    normalized === 'aborted' ||
    normalized === 'cancelled' ||
    status === 'failure' ||
    status === 'error'
}

function clawStatusLooksRunning(status: string): boolean {
  return isAgentRuntimeActiveTurnState(status) && !clawStatusLooksQueued(status)
}

function clawStatusLooksQueued(status: string): boolean {
  return status === 'queued' || status === 'pending'
}

export function clawThreadTitleLooksManaged(title: string | undefined): boolean {
  const trimmed = title?.trim() ?? ''
  return trimmed.startsWith(CLAW_MANAGED_INSTRUCTIONS_HEADING) ||
    trimmed.startsWith('[Remote channel:') ||
    trimmed.startsWith('[Remote channel]') ||
    trimmed.startsWith('[Claw:') ||
    trimmed.startsWith('[Claw IM:') ||
    trimmed.startsWith('[Claw]')
}

export function isClawThread(
  thread: Pick<NormalizedThread, 'id' | 'title'>,
  _channels: ClawImChannelV1[] = []
): boolean {
  return clawThreadTitleLooksManaged(thread.title)
}

export function optimisticUserModelLabel(
  composerModel: string,
  threadModel: string | undefined
): string | undefined {
  const composer = composerModel.trim()
  if (composer) return composer.toLowerCase() === 'auto' ? 'auto' : composer
  const model = threadModel?.trim()
  return model || undefined
}

export function rememberTurnModel(threadId: string, itemId: string, model: string): void {
  const thread = threadId.trim()
  const item = itemId.trim()
  const label = model.trim()
  if (!thread || !item || !label) return
  const key = `${thread}|${item}`
  const map = loadTurnModelMap()
  delete map[key]
  map[key] = label
  saveTurnModelMap(map)
}

export function hydrateBlockModelLabels(threadId: string, blocks: ChatBlock[]): ChatBlock[] {
  const map = loadTurnModelMap()
  let changed = false
  const next = blocks.map((block) => {
    if (block.kind !== 'user') return block
    if (block.modelLabel) return block
    const label = map[`${threadId}|${block.id}`]
    if (!label) return block
    changed = true
    return { ...block, modelLabel: label }
  })
  return changed ? next : blocks
}

function defaultClawProviderLabel(provider: ClawImProvider): string {
  if (provider === 'discord') return 'discord bot'
  if (provider === 'weixin') return 'weixin agent'
  return 'feishu agent'
}

function loadTurnModelMap(): Record<string, string> {
  try {
    const raw = readBrowserStorageItem(TURN_MODEL_STORAGE_KEY)
    if (!raw) return {}
    return normalizeTurnModelMap(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function normalizeTurnModelMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const entries: Array<[string, string]> = []
  for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const key = rawKey.trim()
    const value = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!key || !key.includes('|') || !value) continue
    entries.push([key, value])
  }
  const recent = entries.slice(-MAX_TURN_MODEL_LABELS)
  return Object.fromEntries(recent)
}

function saveTurnModelMap(map: Record<string, string>): void {
  writeBrowserStorageItem(TURN_MODEL_STORAGE_KEY, JSON.stringify(normalizeTurnModelMap(map)))
}
