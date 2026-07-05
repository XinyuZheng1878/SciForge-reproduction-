import type { ReactElement } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  Loader2,
  PanelRightClose
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscript,
  AgentRuntimeChildTranscriptEntry
} from '@shared/agent-runtime-contract'
import type { AgentRuntimeId } from '@shared/app-settings'
import type {
  AgentProviderCapabilities,
  ChatBlock,
  NormalizedThread,
  RuntimeConnectionStatus,
  ToolBlock
} from '../../agent/types'
import type { ModelProviderModelGroup } from '@shared/sciforge-api'
import type { ComposerReasoningEffort } from './FloatingComposerModelPicker'
import type { SideConversation } from '../../store/chat-store-types'
import { getProvider } from '../../agent/registry'
import { useChatStore } from '../../store/chat-store'
import { AssistantMarkdown } from './AssistantMarkdown'
import { FloatingComposer } from './FloatingComposer'
import { MessageTimeline } from './MessageTimeline'
import { ProcessSectionRow, groupProcessSections } from './message-timeline-process'

type TFunction = (k: string, opts?: Record<string, unknown>) => string

export type ChildAgentTranscriptState =
  | { status: 'idle' }
  | { status: 'loading'; childId: string }
  | { status: 'loaded'; childId: string; transcript: AgentRuntimeChildTranscript }
  | { status: 'error'; childId: string; message: string }

export type ThreadChildrenState = {
  children: AgentRuntimeChild[]
  loading: boolean
  error: string | null
}

type UseThreadChildrenInput = {
  activeThreadId: string | null
  activeRuntimeId?: AgentRuntimeId
  childRefreshKey: number
  runtimeReady: boolean
  busy: boolean
}

export type ChildAgentsPanelProps = {
  activeThreadId: string | null
  activeThread: NormalizedThread | null
  children: AgentRuntimeChild[]
  loading: boolean
  error: string | null
  focusChildId?: string | null
  focusChildRequestKey?: number
  onCollapse: () => void
  className?: string
}

export type ChildAgentsPanelViewProps = {
  activeThreadId: string | null
  activeRuntimeId?: AgentRuntimeId
  children: AgentRuntimeChild[]
  selectedChildId: string | null
  loading: boolean
  error: string | null
  selectedSide: SideConversation | null
  sideLoading: boolean
  runtimeConnection: RuntimeConnectionStatus
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
  transcriptState: ChildAgentTranscriptState
  onSelectChild: (childId: string) => void
  onSideInputChange: (threadId: string, value: string) => void
  onSideSend: (threadId: string, text: string) => void
  onSideInterrupt: (threadId: string) => void
  onSideModelChange: (threadId: string, model: string) => void
  onSideReasoningEffortChange: (threadId: string, effort: ComposerReasoningEffort) => void
  onCollapse: () => void
  className?: string
  t: TFunction
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function childAgentShortName(child: AgentRuntimeChild): string {
  return child.name?.trim() || child.label?.trim() || child.id.trim() || 'child'
}

export function filterDirectChildAgents(
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
    case 'unknown':
    case 'failed':
    case 'aborted':
    case 'completed':
    default:
      return 2
  }
}

export function sortChildAgents(children: readonly AgentRuntimeChild[]): AgentRuntimeChild[] {
  return [...children].sort((a, b) => {
    const byStatus = childStatusOrder(a.status) - childStatusOrder(b.status)
    if (byStatus !== 0) return byStatus
    const parsedATime = Date.parse(a.updatedAt ?? a.startedAt ?? a.createdAt ?? '')
    const parsedBTime = Date.parse(b.updatedAt ?? b.startedAt ?? b.createdAt ?? '')
    const aTime = Number.isFinite(parsedATime) ? parsedATime : 0
    const bTime = Number.isFinite(parsedBTime) ? parsedBTime : 0
    if (aTime !== bTime) return bTime - aTime
    return childAgentShortName(a).localeCompare(childAgentShortName(b))
  })
}

export function preferredChildAgentId(
  children: readonly AgentRuntimeChild[],
  currentId: string | null
): string | null {
  const sorted = sortChildAgents(children)
  if (currentId && sorted.some((child) => child.id === currentId)) return currentId
  return sorted[0]?.id ?? null
}

export function childAgentStatusLabel(status: AgentRuntimeChildStatus, t: TFunction): string {
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

export function ChildAgentStatusIcon({
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
      title={childAgentStatusLabel(status, t)}
    >
      <ChildAgentStatusIcon status={status} className="h-3 w-3" />
      <span className="truncate">{childAgentStatusLabel(status, t)}</span>
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

function childOpenThreadId(child: AgentRuntimeChild | null | undefined): string {
  const threadId = child?.openAsThreadRef?.threadId
  return typeof threadId === 'string' ? threadId.trim() : ''
}

function childOpenThreadRuntimeId(child: AgentRuntimeChild | null | undefined): AgentRuntimeId | undefined {
  return child?.openAsThreadRef?.runtimeId ?? child?.runtimeId
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

function stripChildRuntimeGuardrails(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('Child-agent runtime guardrails:')) return text
  const marker = 'Delegated task:'
  const markerIndex = trimmed.indexOf(marker)
  if (markerIndex < 0) return text
  return trimmed.slice(markerIndex + marker.length).trim() || marker
}

function isInternalToolCallMarkup(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) return false
  return /DSML/i.test(trimmed) && /tool_calls/i.test(trimmed) && /invoke\s+name=/i.test(trimmed)
}

function rewriteLegacyCollectedResultsFallback(text: string): string {
  return text
    .replace(
      /^Child agent gathered tool results, but the model kept emitting internal tool-call markup instead of a final answer\.\s*/i,
      'Collected research notes from available sources:\n\n'
    )
    .replace(
      /^子 agent 已经收集到资料，但模型在最终阶段继续输出内部 tool-call 标记，未能生成自然语言总结。\s*/i,
      '已收集到以下资料，供后续汇总使用：\n\n'
    )
    .replace(/^Usable collected results:\s*/im, 'Sources reviewed:\n')
    .replace(/^下面是这次运行已经拿到的可用结果\/来源：\s*/m, '主要来源：\n')
}

function visibleChildSummary(text: string | undefined): string {
  const trimmed = text?.trim() ?? ''
  if (!trimmed || isInternalToolCallMarkup(trimmed)) return ''
  return rewriteLegacyCollectedResultsFallback(trimmed)
}

function transcriptEntryDisplayText(entry: AgentRuntimeChildTranscriptEntry): string {
  const text = transcriptEntryText(entry)
  if (isInternalToolCallMarkup(text)) return ''
  if (entry.kind === 'user_message') return stripChildRuntimeGuardrails(text)
  return rewriteLegacyCollectedResultsFallback(text)
}

function transcriptEntryCallId(entry: AgentRuntimeChildTranscriptEntry): string {
  const callId = entry.metadata?.callId
  return typeof callId === 'string' ? callId.trim() : ''
}

function transcriptEntryPhase(entry: AgentRuntimeChildTranscriptEntry): string {
  const phase = entry.metadata?.phase
  return typeof phase === 'string' ? phase.trim() : ''
}

function normalizeVisibleTranscriptText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function transcriptEntriesForDisplay(
  transcript: AgentRuntimeChildTranscript
): AgentRuntimeChildTranscriptEntry[] {
  const entries = transcriptEntries(transcript)
  const resultCallIds = new Set(
    entries
      .filter((entry) => entry.kind === 'tool' && transcriptEntryPhase(entry) === 'result')
      .map(transcriptEntryCallId)
      .filter(Boolean)
  )
  const seenUserText = new Set<string>()
  return entries.filter((entry) => {
    if (entry.kind === 'assistant_message' && isInternalToolCallMarkup(transcriptEntryText(entry))) return false
    if (entry.kind === 'tool' && transcriptEntryPhase(entry) === 'call') {
      const callId = transcriptEntryCallId(entry)
      if (callId && resultCallIds.has(callId)) return false
    }
    if (entry.kind === 'user_message') {
      const key = normalizeVisibleTranscriptText(stripChildRuntimeGuardrails(transcriptEntryText(entry)))
      if (!key) return false
      if (seenUserText.has(key)) return false
      seenUserText.add(key)
    }
    return true
  })
}

function transcriptRefKey(ref: unknown): string {
  if (!ref) return ''
  try {
    return JSON.stringify(ref) ?? ''
  } catch {
    return String(ref)
  }
}

function transcriptMetadataString(
  entry: AgentRuntimeChildTranscriptEntry,
  keys: readonly string[]
): string {
  const metadata = entry.metadata
  if (!metadata) return ''
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function recordString(record: Record<string, unknown> | null | undefined, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function compactOneLine(text: string, max = 180): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

function compactToolPayloadText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed || isInternalToolCallMarkup(trimmed)) return ''
  const record = parseJsonRecord(trimmed)
  if (!record) return compactOneLine(trimmed, 220)

  const direct = [
    recordString(record, 'title'),
    recordString(record, 'url') || recordString(record, 'finalUrl'),
    recordString(record, 'query'),
    recordString(record, 'path') || recordString(record, 'file_path'),
    recordString(record, 'pattern'),
    recordString(record, 'error')
  ].filter(Boolean)
  if (direct.length > 0) return compactOneLine(direct.join(' · '), 220)

  const original = record.original
  if (original && typeof original === 'object' && !Array.isArray(original)) {
    const nested = compactToolPayloadText(JSON.stringify(original))
    if (nested) return nested
  }

  const result = record.result
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const content = (result as Record<string, unknown>).content
    if (Array.isArray(content)) {
      const textEntry = content
        .map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).text : undefined)
        .find((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      if (textEntry) return compactOneLine(textEntry, 220)
    }
  }

  return ''
}

function transcriptToolSummary(
  entry: AgentRuntimeChildTranscriptEntry,
  toolName: string,
  t: TFunction
): string {
  const rawSummary = entry.summary?.trim() || toolName || entry.status?.trim() || t('toolKindTool')
  const payload = compactToolPayloadText(entry.text?.trim() ?? '')
  if (!toolName || !payload) return rawSummary
  if (/^call\s+[a-z0-9_-]+$/i.test(rawSummary) || /^[a-z0-9_-]+\s+(?:result|failed)$/i.test(rawSummary)) {
    return `${toolName}: ${payload}`
  }
  return rawSummary
}

function transcriptToolDetail(entry: AgentRuntimeChildTranscriptEntry, summary: string): string | undefined {
  const text = entry.text?.trim() ?? ''
  if (!text || text === summary || isInternalToolCallMarkup(text)) return undefined
  if (transcriptEntryPhase(entry) === 'call') return undefined
  const compact = compactToolPayloadText(text)
  if (!compact || compact === summary) return undefined
  return compact
}

function transcriptToolStatus(status: string | undefined): ToolBlock['status'] {
  const normalized = status?.trim().toLowerCase()
  if (!normalized) return 'success'
  if (['running', 'pending', 'queued', 'in_progress', 'started'].includes(normalized)) return 'running'
  if (['failed', 'error', 'aborted', 'cancelled', 'canceled'].includes(normalized)) return 'error'
  return 'success'
}

function transcriptEntryToBlock(
  entry: AgentRuntimeChildTranscriptEntry,
  t: TFunction
): ChatBlock | null {
  const text = transcriptEntryDisplayText(entry)
  switch (entry.kind) {
    case 'user_message':
      return text ? { kind: 'user', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'assistant_message':
      return text ? { kind: 'assistant', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'reasoning':
      return text ? { kind: 'reasoning', id: entry.id, createdAt: entry.createdAt, text } : null
    case 'tool': {
      const toolName = transcriptMetadataString(entry, ['toolName', 'tool_name', 'name'])
      const summary = transcriptToolSummary(entry, toolName, t)
      const detail = transcriptToolDetail(entry, summary)
      return {
        kind: 'tool',
        id: entry.id,
        createdAt: entry.createdAt,
        summary,
        status: transcriptToolStatus(entry.status),
        detail,
        meta: {
          ...(entry.metadata ?? {}),
          ...(toolName ? { toolName } : {})
        }
      }
    }
    case 'system':
    case 'event':
      return text
        ? {
            kind: 'system',
            id: entry.id,
            createdAt: entry.createdAt,
            text,
            severity: transcriptToolStatus(entry.status) === 'error' ? 'error' : 'info'
          }
        : null
    default:
      return null
  }
}

function childTranscriptBlocks(
  child: AgentRuntimeChild,
  state: ChildAgentTranscriptState,
  t: TFunction
): ChatBlock[] {
  if (state.status === 'loaded' && state.childId === child.id) {
    const blocks = transcriptEntriesForDisplay(state.transcript)
      .map((entry) => transcriptEntryToBlock(entry, t))
      .filter((block): block is ChatBlock => Boolean(block))
    if (blocks.length > 0) return blocks
    const fallback = state.transcript.content?.trim() || state.transcript.summary?.trim() || state.transcript.reason?.trim()
    if (fallback) return [{ kind: 'assistant', id: `${child.id}-transcript-fallback`, text: fallback }]
  }

  const blocks: ChatBlock[] = []
  const prompt = child.prompt ? stripChildRuntimeGuardrails(child.prompt).trim() : ''
  const summary = visibleChildSummary(child.summary)
  if (prompt) blocks.push({ kind: 'user', id: `${child.id}-prompt`, text: prompt })
  if (summary) blocks.push({ kind: 'assistant', id: `${child.id}-summary`, text: summary })
  return blocks
}

function isConversationBlock(
  block: ChatBlock
): block is Extract<ChatBlock, { kind: 'user' | 'assistant' }> {
  return block.kind === 'user' || block.kind === 'assistant'
}

type ChildTranscriptSegment =
  | { kind: 'message'; block: Extract<ChatBlock, { kind: 'user' | 'assistant' }> }
  | { kind: 'process'; id: string; blocks: ChatBlock[] }

function childTranscriptSegments(blocks: ChatBlock[]): ChildTranscriptSegment[] {
  const segments: ChildTranscriptSegment[] = []
  let processBlocks: ChatBlock[] = []
  const flushProcess = (): void => {
    if (processBlocks.length === 0) return
    const first = processBlocks[0]
    segments.push({ kind: 'process', id: `process-${first.id}`, blocks: processBlocks })
    processBlocks = []
  }

  for (const block of blocks) {
    if (isConversationBlock(block)) {
      flushProcess()
      segments.push({ kind: 'message', block })
      continue
    }
    processBlocks.push(block)
  }
  flushProcess()
  return segments
}

function ChildAgentOverview({
  child,
  t
}: {
  child: AgentRuntimeChild
  t: TFunction
}): ReactElement {
  const name = childAgentShortName(child)

  return (
    <div
      className="rounded-lg border border-ds-border-muted bg-ds-card/68 p-3"
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
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">
            {childKindLabel(child, t)} · {formatChildUsage(child, t)}
          </div>
        </div>
      </div>

      {visibleChildSummary(child.summary) ? (
        <div className="mt-2 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-ds-muted">
          {childDetailText(visibleChildSummary(child.summary), t('sidebarChildrenSummaryEmpty'))}
        </div>
      ) : null}
    </div>
  )
}

function ChildTranscriptMessage({
  block
}: {
  block: Extract<ChatBlock, { kind: 'user' | 'assistant' }>
}): ReactElement {
  if (block.kind === 'user') {
    return (
      <div className="flex min-w-0 justify-end">
        <div className="ds-user-message-bubble min-w-0 max-w-[92%]">
          <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left">
            {block.text}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/message flex min-w-0 max-w-full flex-col">
      <div className="ds-markdown ds-chat-answer min-w-0 max-w-full text-ds-ink">
        <AssistantMarkdown text={block.text} streaming={false} />
      </div>
    </div>
  )
}

function ChildTranscriptProcessGroup({
  blocks,
  child,
  t
}: {
  blocks: ChatBlock[]
  child: AgentRuntimeChild
  t: TFunction
}): ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sections = useMemo(() => groupProcessSections(blocks), [blocks])
  const processing = child.status === 'running' || child.status === 'queued'

  return (
    <div ref={viewportRef} className="min-w-0 space-y-1">
      <div className="text-[12px] font-medium text-ds-muted">
        {t('processed')} · {t('processStepCount', { count: blocks.length })}
      </div>
      <div className="space-y-0.5">
        {sections.map((section) => (
          <ProcessSectionRow
            key={section.id}
            section={section}
            processing={processing}
            singleReasoningSection={sections.length === 1}
            viewportRef={viewportRef}
          />
        ))}
      </div>
    </div>
  )
}

function ChildAgentTranscriptTimeline({
  child,
  state,
  t
}: {
  child: AgentRuntimeChild
  state: ChildAgentTranscriptState
  t: TFunction
}): ReactElement {
  if (state.status === 'loading' && state.childId === child.id) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle/55 px-3 py-2 text-[12px] text-ds-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
        {t('sidebarChildrenTranscriptLoading')}
      </div>
    )
  }

  if (state.status === 'error' && state.childId === child.id) {
    return (
      <div className="rounded-lg border border-red-400/25 bg-red-500/8 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">
        {t('sidebarChildrenTranscriptError')}: {state.message}
      </div>
    )
  }

  const blocks = childTranscriptBlocks(child, state, t)
  if (blocks.length === 0) {
    return (
      <div className="rounded-lg border border-ds-border-muted bg-ds-subtle/45 px-3 py-3 text-[12.5px] leading-5 text-ds-faint">
        {child.transcriptRef ? t('sidebarChildrenTranscriptEmpty') : t('sidebarChildrenTranscriptUnavailable')}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-5">
      {childTranscriptSegments(blocks).map((segment) =>
        segment.kind === 'message' ? (
          <ChildTranscriptMessage key={segment.block.id} block={segment.block} />
        ) : (
          <ChildTranscriptProcessGroup key={segment.id} blocks={segment.blocks} child={child} t={t} />
        )
      )}
    </div>
  )
}

function childRuntimeCapabilities(
  capabilities: AgentProviderCapabilities | undefined
): AgentProviderCapabilities | undefined {
  if (!capabilities) return undefined
  return {
    ...capabilities,
    compact: false,
    fork: false,
    goals: false,
    review: false,
    sideConversations: false,
    steer: false
  }
}

function ChildAgentChatSurface({
  child,
  side,
  loading,
  runtimeConnection,
  composerPickList,
  composerModelGroups,
  activeAgentRuntime,
  runtimeCapabilities,
  onInputChange,
  onSend,
  onInterrupt,
  onModelChange,
  onReasoningEffortChange,
  t
}: {
  child: AgentRuntimeChild
  side: SideConversation | null
  loading: boolean
  runtimeConnection: RuntimeConnectionStatus
  composerPickList: string[]
  composerModelGroups?: ModelProviderModelGroup[]
  activeAgentRuntime?: AgentRuntimeId
  runtimeCapabilities?: AgentProviderCapabilities
  onInputChange: (threadId: string, value: string) => void
  onSend: (threadId: string, text: string) => void
  onInterrupt: (threadId: string) => void
  onModelChange: (threadId: string, model: string) => void
  onReasoningEffortChange: (threadId: string, effort: ComposerReasoningEffort) => void
  t: TFunction
}): ReactElement {
  const [mode, setMode] = useState<'plan' | 'agent'>('agent')
  const threadId = childOpenThreadId(child)
  const effectiveCapabilities = childRuntimeCapabilities(runtimeCapabilities)
  const effectivePickList = side?.model && !composerPickList.includes(side.model)
    ? [side.model, ...composerPickList]
    : composerPickList

  if (!threadId) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ChildAgentTranscriptTimeline child={child} state={{ status: 'idle' }} t={t} />
      </div>
    )
  }

  if (loading || !side) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-3 text-[12.5px] text-ds-faint">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          {t('sidebarChildrenTranscriptLoading')}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageTimeline
        blocks={side.blocks}
        liveReasoning={side.liveReasoning}
        live={side.liveAssistant}
        activeThreadId={side.threadId}
        runtimeConnection={runtimeConnection}
        runtimeError={side.error}
        onRetryConnection={() => undefined}
        onOpenSettings={() => undefined}
        autoScrollEnabled
        busyOverride={side.busy}
        currentTurnUserIdOverride={side.userItemId}
        turnStartedAtByUserIdOverride={{}}
        turnDurationByUserIdOverride={{}}
        turnReasoningFirstAtByUserIdOverride={{}}
        turnReasoningLastAtByUserIdOverride={{}}
      />
      {side.error ? (
        <div className="mx-3 mb-2 rounded-lg border border-red-400/25 bg-red-500/8 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300">
          {side.error}
        </div>
      ) : null}
      <div className="ds-no-drag flex shrink-0 justify-center border-t border-ds-border-muted bg-white/94 px-2 pb-3 pt-3 dark:bg-ds-canvas/94">
        <FloatingComposer
          threadIdOverride={side.threadId}
          disableThreadManagementCommands
          input={side.input}
          setInput={(value) => onInputChange(side.threadId, value)}
          mode={mode}
          setMode={setMode}
          busy={side.busy}
          runtimeReady={runtimeConnection === 'ready'}
          hasActiveThread
          composerModel={side.model}
          composerPickList={effectivePickList}
          composerModelGroups={composerModelGroups}
          activeAgentRuntime={activeAgentRuntime}
          composerReasoningEffort={side.reasoningEffort}
          onComposerModelChange={(model) => onModelChange(side.threadId, model)}
          onComposerReasoningEffortChange={(effort) => onReasoningEffortChange(side.threadId, effort)}
          queuedMessages={[]}
          onRemoveQueuedMessage={() => undefined}
          attachments={[]}
          fileReferenceEnabled={false}
          runtimeCapabilities={effectiveCapabilities}
          onSend={() => onSend(side.threadId, side.input)}
          onInterrupt={() => onInterrupt(side.threadId)}
          hideBtwCommand
        />
      </div>
    </div>
  )
}

export function ChildAgentsPanelView({
  activeThreadId,
  activeRuntimeId,
  children,
  selectedChildId,
  loading,
  error,
  selectedSide,
  sideLoading,
  runtimeConnection,
  composerPickList,
  composerModelGroups,
  activeAgentRuntime,
  runtimeCapabilities,
  transcriptState,
  onSelectChild,
  onSideInputChange,
  onSideSend,
  onSideInterrupt,
  onSideModelChange,
  onSideReasoningEffortChange,
  onCollapse,
  className = '',
  t
}: ChildAgentsPanelViewProps): ReactElement {
  const directChildren = sortChildAgents(filterDirectChildAgents(children, activeThreadId, activeRuntimeId))
  const selectedChild = directChildren.find((child) => child.id === selectedChildId) ?? directChildren[0] ?? null
  const runningCount = directChildren.filter((child) => child.status === 'running' || child.status === 'queued').length
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptScrollKey = useMemo(() => {
    if (!selectedChild) return ''
    const pieces = [selectedChild.id, selectedChild.status, selectedChild.updatedAt ?? '']
    if (transcriptState.status === 'loaded' && transcriptState.childId === selectedChild.id) {
      const entries = transcriptEntries(transcriptState.transcript)
      const latest = entries[entries.length - 1]
      pieces.push(String(entries.length), latest?.id ?? '', latest?.createdAt ?? '')
    } else {
      pieces.push(transcriptState.status)
    }
    return pieces.join('\u0000')
  }, [selectedChild, transcriptState])

  useEffect(() => {
    const node = transcriptScrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [transcriptScrollKey])

  return (
    <aside
      className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}
    >
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 dark:bg-ds-card">
        <div className="flex h-12 min-w-0 items-center gap-2 px-4">
          <button
            type="button"
            onClick={onCollapse}
            className="ds-sidebar-toggle-button shrink-0"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.85} />
            <span className="truncate text-[13px] font-semibold text-ds-ink">
              {t('sidebarChildren')}
            </span>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-ds-faint" strokeWidth={2} /> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 pb-3">
          <ChildAgentStat label={t('sidebarChildren')} value={directChildren.length} />
          <ChildAgentStat label={t('sidebarChildrenActive')} value={runningCount} />
        </div>
        {directChildren.length > 0 ? (
          <div
            role="tablist"
            aria-label={t('sidebarChildren')}
            className="flex min-w-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {directChildren.map((child) => {
              const name = childAgentShortName(child)
              const active = selectedChild?.id === child.id
              return (
                <button
                  key={child.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  title={`${name}\n${childAgentStatusLabel(child.status, t)}`}
                  onClick={() => onSelectChild(child.id)}
                  className={`inline-flex h-9 max-w-44 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition ${
                    active
                      ? 'border-accent/45 bg-accent/10 text-ds-ink shadow-sm'
                      : 'border-ds-border-muted bg-ds-card/72 text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  <span className={active ? 'text-accent' : 'text-ds-faint'}>
                    <ChildAgentStatusIcon status={child.status} className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 truncate">{name}</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!activeThreadId ? (
          <div className="h-full px-3 py-3">
            <ChildAgentsEmpty icon={<Bot className="h-6 w-6" strokeWidth={1.6} />} title={t('sidebarChildrenNoThread')} />
          </div>
        ) : directChildren.length === 0 && loading ? (
          <div className="flex items-center gap-2 px-5 py-5 text-[12.5px] text-ds-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {t('sidebarChildrenLoading')}
          </div>
        ) : directChildren.length === 0 ? (
          <div className="h-full px-3 py-3">
            <ChildAgentsEmpty icon={<Bot className="h-6 w-6" strokeWidth={1.6} />} title={t('sidebarChildrenEmpty')} />
          </div>
        ) : selectedChild ? (
          childOpenThreadId(selectedChild) ? (
            <ChildAgentChatSurface
              child={selectedChild}
              side={selectedSide}
              loading={sideLoading}
              runtimeConnection={runtimeConnection}
              composerPickList={composerPickList}
              composerModelGroups={composerModelGroups}
              activeAgentRuntime={activeAgentRuntime}
              runtimeCapabilities={runtimeCapabilities}
              onInputChange={onSideInputChange}
              onSend={onSideSend}
              onInterrupt={onSideInterrupt}
              onModelChange={onSideModelChange}
              onReasoningEffortChange={onSideReasoningEffortChange}
              t={t}
            />
          ) : (
            <div ref={transcriptScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              <ChildAgentOverview child={selectedChild} t={t} />
              <ChildAgentTranscriptTimeline child={selectedChild} state={transcriptState} t={t} />
            </div>
          )
        ) : null}
        {error ? (
          <div className="mx-3 mt-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:text-amber-200">
            {t('sidebarChildrenLoadError')}: {error}
          </div>
        ) : null}
      </div>
    </aside>
  )
}

function ChildAgentStat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="rounded-lg bg-ds-surface-subtle px-2.5 py-2 dark:bg-white/6">
      <div className="text-[15px] font-semibold leading-none text-ds-ink">{value}</div>
      <div className="mt-1 truncate text-[10.5px] font-medium text-ds-faint">{label}</div>
    </div>
  )
}

function ChildAgentsEmpty({ icon, title }: { icon: ReactElement; title: string }): ReactElement {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-ds-surface-subtle p-3 text-ds-faint dark:bg-white/6">{icon}</div>
      <div className="max-w-64 text-[12.5px] font-medium leading-5 text-ds-muted">{title}</div>
    </div>
  )
}

export function useThreadChildren({
  activeThreadId,
  activeRuntimeId,
  childRefreshKey,
  runtimeReady,
  busy
}: UseThreadChildrenInput): ThreadChildrenState {
  const [children, setChildren] = useState<AgentRuntimeChild[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        setChildren(filterDirectChildAgents(response.children ?? [], activeThreadId, activeRuntimeId))
        setError(response.degraded && response.reason ? response.reason : null)
      } catch (err) {
        if (!cancelled) setError(messageFromError(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void refresh(true)
    interval = window.setInterval(() => void refresh(false), busy ? 2500 : 5000)

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [activeThreadId, activeRuntimeId, busy, childRefreshKey, runtimeReady])

  return { children, loading, error }
}

export function ChildAgentsPanel({
  activeThreadId,
  activeThread,
  children,
  loading,
  error,
  focusChildId = null,
  focusChildRequestKey = 0,
  onCollapse,
  className = ''
}: ChildAgentsPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const sideData = useChatStore(
    useShallow((s) => ({
      sideConversations: s.sideConversations,
      attachSideConversation: s.attachSideConversation,
      sendSideMessage: s.sendSideMessage,
      interruptSide: s.interruptSide,
      setSideInput: s.setSideInput,
      setSideModel: s.setSideModel,
      setSideReasoningEffort: s.setSideReasoningEffort,
      runtimeConnection: s.runtimeConnection,
      composerPickList: s.composerPickList,
      composerModelGroups: s.composerModelGroups,
      composerModel: s.composerModel,
      activeAgentRuntime: s.activeAgentRuntime
    }))
  )
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [transcriptState, setTranscriptState] = useState<ChildAgentTranscriptState>({ status: 'idle' })
  const [attachingThreadId, setAttachingThreadId] = useState<string | null>(null)
  const appliedFocusRequestKeyRef = useRef<number | null>(null)
  const activeRuntimeId = activeThread?.runtimeId
  const directChildren = useMemo(
    () => sortChildAgents(filterDirectChildAgents(children, activeThreadId, activeRuntimeId)),
    [activeRuntimeId, activeThreadId, children]
  )
  const selectedChild = directChildren.find((child) => child.id === selectedChildId) ?? directChildren[0] ?? null
  const selectedChildThreadId = childOpenThreadId(selectedChild)
  const selectedSide = selectedChildThreadId
    ? sideData.sideConversations[selectedChildThreadId] ?? null
    : null
  const runtimeCapabilities = sideData.runtimeConnection === 'ready'
    ? getProvider().getCapabilities()
    : undefined
  const selectedTranscriptKey = selectedChild
    ? `${activeThreadId ?? ''}:${selectedChild.runtimeId}:${selectedChild.id}:${selectedChild.parentTurnId ?? ''}:${selectedChild.updatedAt ?? ''}:${transcriptRefKey(selectedChild.transcriptRef)}`
    : ''

  useEffect(() => {
    setSelectedChildId(null)
    setTranscriptState({ status: 'idle' })
    appliedFocusRequestKeyRef.current = null
  }, [activeThreadId])

  useEffect(() => {
    setSelectedChildId((current) => preferredChildAgentId(directChildren, current))
  }, [directChildren])

  useEffect(() => {
    const nextFocusId = focusChildId?.trim() || null
    if (!nextFocusId) {
      appliedFocusRequestKeyRef.current = null
      return
    }
    if (appliedFocusRequestKeyRef.current === focusChildRequestKey) return
    if (!directChildren.some((child) => child.id === nextFocusId)) return
    appliedFocusRequestKeyRef.current = focusChildRequestKey
    setSelectedChildId(nextFocusId)
  }, [directChildren, focusChildId, focusChildRequestKey])

  useEffect(() => {
    let cancelled = false
    const child = selectedChild
    const threadId = selectedChildThreadId
    if (!activeThreadId || !child || !threadId) {
      setAttachingThreadId(null)
      return undefined
    }
    if (sideData.sideConversations[threadId]) {
      setAttachingThreadId(null)
      return undefined
    }
    setAttachingThreadId(threadId)
    void sideData.attachSideConversation({
      threadId,
      parentThreadId: activeThreadId,
      runtimeId: childOpenThreadRuntimeId(child),
      title: childAgentShortName(child),
      model: activeThread?.model ?? sideData.composerModel,
      source: 'child_agent'
    }).finally(() => {
      if (!cancelled) setAttachingThreadId(null)
    })
    return () => {
      cancelled = true
    }
  }, [
    activeThread?.model,
    activeThreadId,
    selectedChild,
    selectedChildThreadId,
    sideData
  ])

  useEffect(() => {
    let cancelled = false
    const child = selectedChild

    if (!activeThreadId || !child) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    if (childOpenThreadId(child)) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    if (!child.transcriptRef) {
      setTranscriptState({ status: 'idle' })
      return undefined
    }

    const provider = getProvider()
    if (typeof provider.readChildTranscript !== 'function') {
      setTranscriptState({
        status: 'error',
        childId: child.id,
        message: t('sidebarChildrenTranscriptUnavailable')
      })
      return undefined
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
      if (cancelled) return
      setTranscriptState({ status: 'loaded', childId: child.id, transcript: response.transcript })
    }).catch((err: unknown) => {
      if (cancelled) return
      setTranscriptState({ status: 'error', childId: child.id, message: messageFromError(err) })
    })

    return () => {
      cancelled = true
    }
  }, [activeThreadId, selectedTranscriptKey, t])

  return (
    <ChildAgentsPanelView
      activeThreadId={activeThreadId}
      activeRuntimeId={activeRuntimeId}
      children={children}
      selectedChildId={selectedChildId}
      loading={loading}
      error={error}
      selectedSide={selectedSide}
      sideLoading={Boolean(selectedChildThreadId && attachingThreadId === selectedChildThreadId && !selectedSide)}
      runtimeConnection={sideData.runtimeConnection}
      composerPickList={sideData.composerPickList}
      composerModelGroups={sideData.composerModelGroups}
      activeAgentRuntime={sideData.activeAgentRuntime}
      runtimeCapabilities={runtimeCapabilities}
      transcriptState={transcriptState}
      onSelectChild={(childId) => setSelectedChildId(childId)}
      onSideInputChange={(threadId, value) => sideData.setSideInput(threadId, value)}
      onSideSend={(threadId, text) => {
        void sideData.sendSideMessage(threadId, text)
      }}
      onSideInterrupt={(threadId) => {
        void sideData.interruptSide(threadId)
      }}
      onSideModelChange={(threadId, model) => sideData.setSideModel(threadId, model)}
      onSideReasoningEffortChange={(threadId, effort) => sideData.setSideReasoningEffort(threadId, effort)}
      onCollapse={onCollapse}
      className={className}
      t={t}
    />
  )
}
