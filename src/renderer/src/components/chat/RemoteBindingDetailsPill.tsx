import type { ReactElement } from 'react'
import { Bot } from 'lucide-react'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import type {
  RemoteChannelThreadBinding,
  RemoteChannelThreadStatusKind
} from '../../store/chat-store-helpers'

type TranslationFn = (key: string, opts?: Record<string, unknown>) => string

export function remoteThreadStatusLabel(
  kind: RemoteChannelThreadStatusKind,
  t: TranslationFn
): string {
  switch (kind) {
    case 'bound':
      return t('sidebarThreadBotBound')
    case 'running':
      return t('sidebarThreadBotRunning')
    case 'queued':
      return t('sidebarThreadBotQueued')
    case 'error':
      return t('sidebarThreadBotError')
    case 'watched':
    default:
      return t('sidebarThreadBotWatched')
  }
}

export function remoteBindingGuardModeLabel(
  guardMode: RemoteChannelThreadBinding['guardMode'] | undefined,
  t: TranslationFn
): string {
  switch (guardMode) {
    case 'all_messages':
      return t('remoteBindingGuardAllMessages')
    case 'off':
      return t('remoteBindingGuardOff')
    case 'only_mention':
    default:
      return t('remoteBindingGuardOnlyMention')
  }
}

function shortRemoteBindingId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

function remoteBindingThreadLabel(binding: RemoteChannelThreadBinding, short: boolean): string {
  const threadId = short ? shortRemoteBindingId(binding.threadId) : binding.threadId
  return binding.runtimeId ? `${binding.runtimeId}:${threadId}` : threadId
}

function remoteBindingWorkspaceLabel(binding: RemoteChannelThreadBinding, t: TranslationFn): string {
  const workspaceRoot = binding.workspaceRoot?.trim() ?? ''
  return workspaceRoot ? workspaceLabelFromPath(workspaceRoot) : t('remoteBindingDefaultWorkspace')
}

function remoteBindingTargetLabel(binding: RemoteChannelThreadBinding): string {
  return binding.senderName?.trim() ||
    binding.remoteThreadId?.trim() ||
    binding.chatId?.trim() ||
    ''
}

export function ActiveRemoteBindingDetails({
  binding,
  statusKind,
  unread,
  t
}: {
  binding: RemoteChannelThreadBinding
  statusKind: RemoteChannelThreadStatusKind
  unread: boolean
  t: TranslationFn
}): ReactElement {
  const statusLabel = remoteThreadStatusLabel(statusKind, t)
  const channelLabel = binding.channelLabel.trim()
  const workspaceLabel = remoteBindingWorkspaceLabel(binding, t)
  const threadLabel = remoteBindingThreadLabel(binding, true)
  const fullThreadLabel = remoteBindingThreadLabel(binding, false)
  const guardModeLabel = remoteBindingGuardModeLabel(binding.guardMode, t)
  const remoteTarget = remoteBindingTargetLabel(binding)
  const failureMessage = binding.lastFailure?.message.trim() ?? ''
  const title = [
    t('remoteBindingDetails'),
    t('remoteBindingProvider', { provider: binding.providerLabel }),
    channelLabel ? t('remoteBindingChannel', { channel: channelLabel }) : '',
    t('remoteBindingWorkspace', { workspace: workspaceLabel }),
    binding.workspaceRoot?.trim() ? binding.workspaceRoot.trim() : '',
    t('remoteBindingThread', { thread: fullThreadLabel }),
    t('remoteBindingGuardMode', { mode: guardModeLabel }),
    `${binding.providerLabel} · ${statusLabel}`,
    remoteTarget ? t('remoteBindingTarget', { target: remoteTarget }) : '',
    failureMessage ? t('remoteBindingFailure', { reason: failureMessage }) : ''
  ].filter(Boolean).join('\n')
  const tone =
    statusKind === 'error'
      ? 'border-red-400/35 bg-red-500/10 text-red-700 dark:text-red-300'
      : statusKind === 'running'
        ? 'border-emerald-400/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : statusKind === 'queued'
          ? 'border-amber-400/35 bg-amber-500/12 text-amber-800 dark:text-amber-200'
          : statusKind === 'watched'
            ? 'border-accent/25 bg-accent/10 text-accent'
            : 'border-ds-border-muted bg-ds-subtle text-ds-muted'

  return (
    <div
      className={`hidden min-h-7 max-w-[min(58vw,720px)] shrink items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold leading-none sm:inline-flex ${tone}`}
      title={title}
      aria-label={title}
    >
      <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
      <span className="shrink-0">{binding.providerLabel}</span>
      <span className="text-ds-faint">·</span>
      <span className="shrink-0">{statusLabel}</span>
      {channelLabel ? (
        <>
          <span className="text-ds-faint">·</span>
          <span className="min-w-0 max-w-[140px] truncate text-ds-muted">{channelLabel}</span>
        </>
      ) : null}
      <span className="text-ds-faint">·</span>
      <span className="min-w-0 max-w-[150px] truncate text-ds-muted">{workspaceLabel}</span>
      <span className="text-ds-faint">·</span>
      <span className="shrink-0 text-ds-muted">{threadLabel}</span>
      <span className="text-ds-faint">·</span>
      <span className="shrink-0 text-ds-muted">{guardModeLabel}</span>
      {unread ? (
        <span className="ml-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" title={t('sidebarThreadRemoteUnread')} />
      ) : null}
    </div>
  )
}
