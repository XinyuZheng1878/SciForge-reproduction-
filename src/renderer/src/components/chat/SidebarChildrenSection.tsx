import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileText,
  Loader2,
  X
} from 'lucide-react'
import type {
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscript,
  AgentRuntimeChildTranscriptEntry
} from '@shared/agent-runtime-contract'
import type { NormalizedThread } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { openSafeExternalUrl } from '../../lib/open-external'
import {
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'

type TFunction = (k: string, opts?: Record<string, unknown>) => string

export type SidebarChildTranscriptState =
  | { status: 'idle' }
  | { status: 'loading'; childId: string }
  | { status: 'loaded'; childId: string; transcript: AgentRuntimeChildTranscript }
  | { status: 'error'; childId: string; message: string }

type SidebarChildrenSectionProps = {
  activeThreadId: string | null
  activeThread: NormalizedThread | null
  runtimeReady: boolean
  busy: boolean
  onSelectThread: (id: string) => void
  t: TFunction
}

type SidebarChildrenSectionViewProps = {
  activeThreadId: string | null
  activeRuntimeId?: string
  children: AgentRuntimeChild[]
  selectedChildId: string | null
  loading: boolean
  error: string | null
  transcriptState: SidebarChildTranscriptState
  onSelectChild: (childId: string) => void
  onCloseDetail: () => void
  onShowTranscript: (child: AgentRuntimeChild) => void
  onOpenThread: (child: AgentRuntimeChild) => void
  t: TFunction
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function sidebarChildShortName(child: AgentRuntimeChild): string {
  return child.name?.trim() || child.label?.trim() || child.id.trim() || 'child'
}

export function filterDirectSidebarChildren(
  children: readonly AgentRuntimeChild[],
  activeThreadId: string | null,
  activeRuntimeId?: string
): AgentRuntimeChild[] {
  const threadId = activeThreadId?.trim()
  if (!threadId) return []
  return children
    .filter((child) => child.parentThreadId === threadId)
    .filter((child) => !activeRuntimeId || child.runtimeId === activeRuntimeId)
    .map((child) => ({ ...child }))
}

function childStatusOrder(status: AgentRuntimeChildStatus): number {
  switch (status) {
    case 'running':
      return 0
    case 'queued':
      return 1
    case 'failed':
    case 'aborted':
      return 2
    case 'completed':
      return 3
    case 'unknown':
    default:
      return 4
  }
}

function sortSidebarChildren(children: readonly AgentRuntimeChild[]): AgentRuntimeChild[] {
  return [...children].sort((a, b) => {
    const byStatus = childStatusOrder(a.status) - childStatusOrder(b.status)
    if (byStatus !== 0) return byStatus
    const aTime = Date.parse(a.updatedAt ?? a.startedAt ?? a.createdAt ?? '')
    const bTime = Date.parse(b.updatedAt ?? b.startedAt ?? b.createdAt ?? '')
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime
    return sidebarChildShortName(a).localeCompare(sidebarChildShortName(b))
  })
}

function childStatusLabel(status: AgentRuntimeChildStatus, t: TFunction): string {
  switch (status) {
    case 'queued':
      return t('sidebarChildrenStatusQueued')
    case 'running':
      return t('sidebarChildrenStatusRunning')
    case 'completed':
      return t('sidebarChildrenStatusCompleted')
    case 'failed':
      return t('sidebarChildrenStatusFailed')
    case 'aborted':
      return t('sidebarChildrenStatusAborted')
    case 'unknown':
    default:
      return t('sidebarChildrenStatusUnknown')
  }
}

function childStatusTone(status: AgentRuntimeChildStatus): string {
  switch (status) {
    case 'running':
      return 'border-emerald-400/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    case 'queued':
      return 'border-amber-400/35 bg-amber-500/14 text-amber-800 dark:text-amber-200'
    case 'completed':
      return 'border-ds-border-muted bg-ds-subtle text-ds-faint'
    case 'failed':
    case 'aborted':
      return 'border-red-400/35 bg-red-500/12 text-red-700 dark:text-red-300'
    case 'unknown':
    default:
      return 'border-ds-border-muted bg-ds-subtle text-ds-faint'
  }
}

function ChildStatusIcon({
  status,
  className = 'h-3.5 w-3.5'
}: {
  status: AgentRuntimeChildStatus
  className?: string
}): ReactElement {
  if (status === 'running') return <Loader2 className={`${className} animate-spin`} strokeWidth={2} />
  if (status === 'queued') return <Clock3 className={className} strokeWidth={1.9} />
  if (status === 'completed') return <CheckCircle2 className={className} strokeWidth={1.9} />
  if (status === 'failed' || status === 'aborted') return <CircleAlert className={className} strokeWidth={1.9} />
  return <CircleHelp className={className} strokeWidth={1.9} />
}

function ChildStatusBadge({
  status,
  t
}: {
  status: AgentRuntimeChildStatus
  t: TFunction
}): ReactElement {
  return (
    <span
      className={`inline-flex min-h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[10.5px] font-semibold leading-none ${childStatusTone(status)}`}
      title={childStatusLabel(status, t)}
    >
      <ChildStatusIcon status={status} className="h-3 w-3" />
      <span className="truncate">{childStatusLabel(status, t)}</span>
    </span>
  )
}

function childKindLabel(child: AgentRuntimeChild, t: TFunction): string {
  switch (child.kind) {
    case 'workflow':
      return t('sidebarChildrenKindWorkflow')
    case 'thread':
      return t('sidebarChildrenKindThread')
    case 'remote':
      return t('sidebarChildrenKindRemote')
    case 'agent':
    default:
      return t('sidebarChildrenKindAgent')
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatChildUsage(child: AgentRuntimeChild, t: TFunction): string {
  const usage = child.usage
  if (!usage) return t('sidebarChildrenUsageUnavailable')
  const pieces: string[] = []
  if (typeof usage.totalTokens === 'number') pieces.push(t('sidebarChildrenUsageTotal', { count: formatNumber(usage.totalTokens) }))
  if (typeof usage.inputTokens === 'number') pieces.push(t('sidebarChildrenUsageInput', { count: formatNumber(usage.inputTokens) }))
  if (typeof usage.outputTokens === 'number') pieces.push(t('sidebarChildrenUsageOutput', { count: formatNumber(usage.outputTokens) }))
  if (typeof usage.reasoningTokens === 'number') pieces.push(t('sidebarChildrenUsageReasoning', { count: formatNumber(usage.reasoningTokens) }))
  if (typeof usage.costUsd === 'number') pieces.push(t('sidebarChildrenUsageCost', { cost: `$${usage.costUsd.toFixed(4)}` }))
  return pieces.length > 0 ? pieces.join(' · ') : t('sidebarChildrenUsageUnavailable')
}

function childDetailText(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

function childHasTranscriptAction(child: AgentRuntimeChild): boolean {
  return Boolean(child.transcriptRef)
}

function childHasOpenThreadAction(child: AgentRuntimeChild): boolean {
  return Boolean(child.openAsThreadRef)
}

function recordString(value: unknown, key: string): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const field = record[key]
  return typeof field === 'string' ? field.trim() : ''
}

function transcriptEntries(transcript: AgentRuntimeChildTranscript): AgentRuntimeChildTranscriptEntry[] {
  const entries = (transcript as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return []
  return entries.filter((entry): entry is AgentRuntimeChildTranscriptEntry =>
    Boolean(entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
  )
}

function transcriptEntryText(entry: AgentRuntimeChildTranscriptEntry): string {
  return entry.text?.trim() || entry.summary?.trim() || entry.status?.trim() || ''
}

function SidebarChildTranscriptPreview({
  child,
  state,
  t
}: {
  child: AgentRuntimeChild
  state: SidebarChildTranscriptState
  t: TFunction
}): ReactElement | null {
  if (state.status === 'idle' || state.childId !== child.id) return null
  if (state.status === 'loading') {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle/55 px-2.5 py-2 text-[12px] text-ds-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        {t('sidebarChildrenTranscriptLoading')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="mt-3 rounded-lg border border-red-400/25 bg-red-500/8 px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">
        {t('sidebarChildrenTranscriptError')}: {state.message}
      </div>
    )
  }

  const entries = transcriptEntries(state.transcript)
  return (
    <div className="mt-3 rounded-lg border border-ds-border-muted bg-ds-subtle/45 p-2">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-ds-muted">
        <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('sidebarChildrenTranscriptTitle')}
      </div>
      {entries.length === 0 ? (
        <div className="text-[12px] leading-5 text-ds-faint">
          {state.transcript.summary?.trim() || state.transcript.reason?.trim() || t('sidebarChildrenTranscriptEmpty')}
        </div>
      ) : (
        <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
          {entries.slice(0, 12).map((entry) => {
            const text = transcriptEntryText(entry)
            return (
              <div key={entry.id} className="rounded-md bg-ds-card/65 px-2 py-1.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ds-faint">
                  {entry.kind.replaceAll('_', ' ')}
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-ds-muted">
                  {text || t('sidebarChildrenTranscriptEmpty')}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SidebarChildDetail({
  child,
  transcriptState,
  onClose,
  onShowTranscript,
  onOpenThread,
  t
}: {
  child: AgentRuntimeChild
  transcriptState: SidebarChildTranscriptState
  onClose: () => void
  onShowTranscript: (child: AgentRuntimeChild) => void
  onOpenThread: (child: AgentRuntimeChild) => void
  t: TFunction
}): ReactElement {
  const name = sidebarChildShortName(child)
  const loadingTranscript = transcriptState.status === 'loading' && transcriptState.childId === child.id

  return (
    <div
      className="mx-0.5 mt-2 rounded-lg border border-ds-border-muted bg-ds-card/72 p-3 shadow-[0_8px_26px_rgba(15,23,42,0.08)]"
      role="region"
      aria-label={`${name} ${t('sidebarChildrenDetail')}`}
    >
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-faint">
          <Bot className="h-3.5 w-3.5" strokeWidth={1.85} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ds-ink">{name}</span>
            <ChildStatusBadge status={child.status} t={t} />
          </div>
          <div className="mt-1 text-[11.5px] text-ds-faint">{childKindLabel(child, t)}</div>
        </div>
        <SidebarIconButton
          title={t('sidebarChildrenCloseDetail')}
          ariaLabel={t('sidebarChildrenCloseDetail')}
          onClick={onClose}
          className="h-6 w-6"
          stopPropagation
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.9} />
        </SidebarIconButton>
      </div>

      <dl className="mt-3 space-y-2 text-[12px] leading-5">
        <div>
          <dt className="font-semibold text-ds-faint">{t('sidebarChildrenStatus')}</dt>
          <dd className="text-ds-muted">{childStatusLabel(child.status, t)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ds-faint">{t('sidebarChildrenPrompt')}</dt>
          <dd className="whitespace-pre-wrap text-ds-muted">
            {childDetailText(child.prompt, t('sidebarChildrenPromptEmpty'))}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ds-faint">{t('sidebarChildrenSummary')}</dt>
          <dd className="whitespace-pre-wrap text-ds-muted">
            {childDetailText(child.summary, t('sidebarChildrenSummaryEmpty'))}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ds-faint">{t('sidebarChildrenUsage')}</dt>
          <dd className="text-ds-muted">{formatChildUsage(child, t)}</dd>
        </div>
      </dl>

      {childHasTranscriptAction(child) || childHasOpenThreadAction(child) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {childHasTranscriptAction(child) ? (
            <button
              type="button"
              disabled={loadingTranscript}
              onClick={() => onShowTranscript(child)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-subtle px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-wait disabled:opacity-60"
            >
              {loadingTranscript ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <FileText className="h-3.5 w-3.5" strokeWidth={1.85} />
              )}
              {t('sidebarChildrenOpenTranscript')}
            </button>
          ) : null}
          {childHasOpenThreadAction(child) ? (
            <button
              type="button"
              onClick={() => onOpenThread(child)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-subtle px-2.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.85} />
              {t('sidebarChildrenOpenThread')}
            </button>
          ) : null}
        </div>
      ) : null}

      <SidebarChildTranscriptPreview child={child} state={transcriptState} t={t} />
    </div>
  )
}

export function SidebarChildrenSectionView({
  activeThreadId,
  activeRuntimeId,
  children,
  selectedChildId,
  loading,
  error,
  transcriptState,
  onSelectChild,
  onCloseDetail,
  onShowTranscript,
  onOpenThread,
  t
}: SidebarChildrenSectionViewProps): ReactElement | null {
  const directChildren = sortSidebarChildren(filterDirectSidebarChildren(children, activeThreadId, activeRuntimeId))
  const selectedChild = directChildren.find((child) => child.id === selectedChildId) ?? null
  if (!activeThreadId || (!loading && !error && directChildren.length === 0)) return null

  return (
    <div className="ds-no-drag mb-2 px-1">
      <SidebarSectionHeader
        label={t('sidebarChildren')}
        actions={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ds-faint" strokeWidth={2} /> : null}
      />
      <div className="space-y-[3px] px-0.5">
        {directChildren.map((child) => {
          const name = sidebarChildShortName(child)
          const secondary = child.summary?.trim() || child.prompt?.trim() || childKindLabel(child, t)
          const active = selectedChild?.id === child.id
          return (
            <SidebarTreeRow
              key={child.id}
              active={active}
              activeVariant="outline"
              title={`${name}\n${childStatusLabel(child.status, t)}\n${secondary}`}
              ariaLabel={`${name} - ${childStatusLabel(child.status, t)} - ${secondary}`}
              onClick={() => onSelectChild(child.id)}
              buttonClassName="items-center gap-2 px-2.5 py-1.5"
            >
              <span className={`shrink-0 ${active ? 'text-accent' : 'text-ds-faint'}`}>
                <ChildStatusIcon status={child.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ds-ink">{name}</span>
                  <ChildStatusBadge status={child.status} t={t} />
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ds-faint">{secondary}</span>
              </span>
            </SidebarTreeRow>
          )
        })}
        {directChildren.length === 0 && loading ? (
          <div className="px-2.5 py-1.5 text-[12.5px] leading-5 text-ds-faint">
            {t('sidebarChildrenLoading')}
          </div>
        ) : null}
        {error ? (
          <div className="px-2.5 py-1.5 text-[12.5px] leading-5 text-ds-faint">
            {t('sidebarChildrenLoadError')}: {error}
          </div>
        ) : null}
      </div>
      {selectedChild ? (
        <SidebarChildDetail
          child={selectedChild}
          transcriptState={transcriptState}
          onClose={onCloseDetail}
          onShowTranscript={onShowTranscript}
          onOpenThread={onOpenThread}
          t={t}
        />
      ) : null}
    </div>
  )
}

export function SidebarChildrenSection({
  activeThreadId,
  activeThread,
  runtimeReady,
  busy,
  onSelectThread,
  t
}: SidebarChildrenSectionProps): ReactElement | null {
  const [children, setChildren] = useState<AgentRuntimeChild[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcriptState, setTranscriptState] = useState<SidebarChildTranscriptState>({ status: 'idle' })
  const activeRuntimeId = activeThread?.runtimeId

  useEffect(() => {
    setSelectedChildId(null)
    setTranscriptState({ status: 'idle' })
  }, [activeThreadId])

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof window.setInterval> | null = null

    if (!activeThreadId || !runtimeReady) {
      setChildren([])
      setLoading(false)
      setError(null)
      return undefined
    }

    const provider = getProvider()
    provider.rememberThreadRuntime?.(activeThreadId, activeRuntimeId)

    const refresh = async (showLoading: boolean): Promise<void> => {
      if (typeof provider.listThreadChildren !== 'function') {
        if (!cancelled) {
          setChildren([])
          setError(null)
          setLoading(false)
        }
        return
      }
      if (showLoading) setLoading(true)
      try {
        const response = await provider.listThreadChildren(activeThreadId, { limit: 80 })
        if (cancelled) return
        const directChildren = filterDirectSidebarChildren(response.children ?? [], activeThreadId, activeRuntimeId)
        setChildren(directChildren)
        setSelectedChildId((current) =>
          current && directChildren.some((child) => child.id === current) ? current : null
        )
        setError(response.degraded && response.reason ? response.reason : null)
      } catch (err) {
        if (!cancelled) setError(messageFromError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void refresh(true)
    if (busy) interval = window.setInterval(() => void refresh(false), 2500)

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [activeThreadId, activeRuntimeId, busy, runtimeReady])

  const handleOpenThread = (child: AgentRuntimeChild): void => {
    const ref = child.openAsThreadRef
    if (!ref) return
    const threadId = typeof ref.threadId === 'string' ? ref.threadId.trim() : ''
    const runtimeId = ref.runtimeId ?? child.runtimeId
    if (threadId) {
      getProvider().rememberThreadRuntime?.(threadId, runtimeId)
      onSelectThread(threadId)
      return
    }
    const url = recordString(ref, 'url')
    void openSafeExternalUrl(url).catch(() => undefined)
  }

  const handleShowTranscript = (child: AgentRuntimeChild): void => {
    if (!activeThreadId || !child.transcriptRef) return
    const provider = getProvider()
    if (typeof provider.readChildTranscript !== 'function') {
      setTranscriptState({
        status: 'error',
        childId: child.id,
        message: t('sidebarChildrenTranscriptUnavailable')
      })
      return
    }
    provider.rememberThreadRuntime?.(activeThreadId, child.runtimeId)
    setTranscriptState({ status: 'loading', childId: child.id })
    void provider.readChildTranscript({
      runtimeId: child.runtimeId,
      parentThreadId: activeThreadId,
      ...(child.parentTurnId ? { parentTurnId: child.parentTurnId } : {}),
      childId: child.id,
      transcriptRef: child.transcriptRef,
      limit: 120
    }).then((response) => {
      setTranscriptState({ status: 'loaded', childId: child.id, transcript: response.transcript })
    }).catch((err: unknown) => {
      setTranscriptState({ status: 'error', childId: child.id, message: messageFromError(err) })
    })
  }

  return (
    <SidebarChildrenSectionView
      activeThreadId={activeThreadId}
      activeRuntimeId={activeRuntimeId}
      children={children}
      selectedChildId={selectedChildId}
      loading={loading}
      error={error}
      transcriptState={transcriptState}
      onSelectChild={(childId) => setSelectedChildId(childId)}
      onCloseDetail={() => {
        setSelectedChildId(null)
        setTranscriptState({ status: 'idle' })
      }}
      onShowTranscript={handleShowTranscript}
      onOpenThread={handleOpenThread}
      t={t}
    />
  )
}
