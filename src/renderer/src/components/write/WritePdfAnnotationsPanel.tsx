import { useMemo, useState, type ReactElement } from 'react'
import {
  CheckCircle2,
  Circle,
  Download,
  EyeOff,
  Filter,
  Hash,
  Layers3,
  LocateFixed,
  MessageSquareText,
  Pencil,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  PdfAnnotationKind,
  PdfAnnotationSidecar,
  PdfAnnotationThreadStatus
} from '@shared/pdf-annotations'
import {
  PDF_ANNOTATION_KIND_VALUES,
  PDF_ANNOTATION_STATUS_VALUES,
  getPdfAnnotationThreadSummaries,
  type PdfAnnotationThreadSort,
  type PdfAnnotationThreadSummary
} from '../../write/pdf-annotations'

export type WritePdfAnnotationDisplayMode = 'hidden' | 'current' | 'all'

export type WritePdfAnnotationsPanelProps = {
  sidecar: PdfAnnotationSidecar | null
  selectedThreadId?: string | null
  annotationDisplayMode?: WritePdfAnnotationDisplayMode
  initialKind?: PdfAnnotationKind | 'all'
  initialStatus?: PdfAnnotationThreadStatus | 'all'
  initialPage?: number | null
  sort?: PdfAnnotationThreadSort
  className?: string
  exportingPackage?: boolean
  importingPackage?: boolean
  reloadingSidecar?: boolean
  onSelectThread?: (threadId: string, summary: PdfAnnotationThreadSummary) => void
  onHoverThread?: (threadId: string | null, summary?: PdfAnnotationThreadSummary) => void
  onAnnotationDisplayModeChange?: (mode: WritePdfAnnotationDisplayMode) => void
  onResolveThread?: (threadId: string, summary: PdfAnnotationThreadSummary) => void
  onReopenThread?: (threadId: string, summary: PdfAnnotationThreadSummary) => void
  onDeleteThread?: (threadId: string, summary: PdfAnnotationThreadSummary) => void
  onEditAnnotation?: (annotationId: string, body: string, summary: PdfAnnotationThreadSummary) => void
  onExportPackage?: () => void
  onImportPackage?: () => void
  onReloadSidecar?: () => void
  onCollapse?: () => void
}

function kindAccent(kind: PdfAnnotationKind): string {
  if (kind === 'highlight') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (kind === 'translation') return 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
  if (kind === 'question') return 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
  if (kind === 'answer') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (kind === 'note') return 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
  return 'bg-ds-surface-subtle text-ds-muted dark:bg-white/8'
}

function formatPageRange(summary: PdfAnnotationThreadSummary, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (summary.pageStart == null || summary.pageEnd == null) return ''
  if (summary.pageStart === summary.pageEnd) {
    return t('writePdfAnnotationsPage', { page: summary.pageStart })
  }
  return t('writePdfAnnotationsPages', { start: summary.pageStart, end: summary.pageEnd })
}

function annotationKindLabel(kind: PdfAnnotationKind, t: (key: string) => string): string {
  return t(`writePdfAnnotationKind_${kind}`)
}

function annotationStatusLabel(status: PdfAnnotationThreadStatus, t: (key: string) => string): string {
  return t(`writePdfAnnotationStatus_${status}`)
}

export function WritePdfAnnotationsPanel({
  sidecar,
  selectedThreadId = null,
  annotationDisplayMode = 'current',
  initialKind = 'all',
  initialStatus = 'all',
  initialPage = null,
  sort,
  className = '',
  exportingPackage = false,
  importingPackage = false,
  reloadingSidecar = false,
  onSelectThread,
  onHoverThread,
  onAnnotationDisplayModeChange,
  onResolveThread,
  onReopenThread,
  onDeleteThread,
  onEditAnnotation,
  onExportPackage,
  onImportPackage,
  onReloadSidecar,
  onCollapse
}: WritePdfAnnotationsPanelProps): ReactElement {
  const { t } = useTranslation('common')
  const [kind, setKind] = useState<PdfAnnotationKind | 'all'>(initialKind)
  const [status, setStatus] = useState<PdfAnnotationThreadStatus | 'all'>(initialStatus)
  const [pageValue, setPageValue] = useState(initialPage != null && initialPage > 0 ? String(initialPage) : '')
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false)
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [dismissedAutoEditThreadId, setDismissedAutoEditThreadId] = useState<string | null>(null)
  const page = pageValue.trim() ? Number(pageValue) : null
  const summaries = useMemo(() => {
    if (!sidecar) return []
    return getPdfAnnotationThreadSummaries(sidecar, {
      filter: {
        kind,
        status,
        page: page != null && Number.isFinite(page) && page > 0 ? page : null
      },
      sort
    })
  }, [kind, page, sidecar, sort, status])
  const totalThreadCount = sidecar?.threads.length ?? 0
  const totalAnnotationCount = sidecar?.annotations.length ?? 0
  const totalAnchorCount = sidecar?.anchors.length ?? 0
  const totalAuthorCount = sidecar?.authors.length ?? 0
  const sourcePdfName = sidecar?.manifest.sourcePdfName || sidecar?.pdfFingerprint.fileName || ''
  const hasFilter = kind !== 'all' || status !== 'all' || Boolean(pageValue.trim())
  const exportDisabled = !sidecar || !onExportPackage || exportingPackage
  const importDisabled = !onImportPackage || importingPackage
  const reloadDisabled = !onReloadSidecar || reloadingSidecar
  const displayModes: Array<{ mode: WritePdfAnnotationDisplayMode; label: string; title: string; icon: ReactElement }> = [
    {
      mode: 'hidden',
      label: t('writePdfAnnotationsDisplayHidden'),
      title: t('writePdfAnnotationsDisplayHiddenTitle'),
      icon: <EyeOff className="h-3.5 w-3.5" strokeWidth={1.9} />
    },
    {
      mode: 'current',
      label: t('writePdfAnnotationsDisplayCurrent'),
      title: t('writePdfAnnotationsDisplayCurrentTitle'),
      icon: <LocateFixed className="h-3.5 w-3.5" strokeWidth={1.9} />
    },
    {
      mode: 'all',
      label: t('writePdfAnnotationsDisplayAll'),
      title: t('writePdfAnnotationsDisplayAllTitle'),
      icon: <Layers3 className="h-3.5 w-3.5" strokeWidth={1.9} />
    }
  ]

  const startEditing = (summary: PdfAnnotationThreadSummary): void => {
    const firstAnnotation = summary.firstAnnotation
    if (!firstAnnotation) return
    setEditingAnnotationId(firstAnnotation.id)
    setEditingBody(firstAnnotation.body)
    setDismissedAutoEditThreadId(null)
  }

  const cancelEditing = (summary: PdfAnnotationThreadSummary): void => {
    setEditingAnnotationId(null)
    setEditingBody('')
    setDismissedAutoEditThreadId(summary.thread.id)
  }

  const saveEditing = (summary: PdfAnnotationThreadSummary): void => {
    const annotationId = editingAnnotationId ?? summary.firstAnnotation?.id
    if (!annotationId || !onEditAnnotation) return
    onEditAnnotation(annotationId, editingBody, summary)
    setEditingAnnotationId(null)
    setEditingBody('')
    setDismissedAutoEditThreadId(null)
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-white dark:bg-ds-canvas ${className}`}>
      <div className="shrink-0 border-b border-ds-border-muted bg-white/92 px-4 py-3 dark:bg-ds-card">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <StickyNote className="h-4 w-4" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[13px] font-semibold text-ds-ink">{t('writePdfAnnotations')}</h2>
            <p className="mt-0.5 text-[11.5px] text-ds-faint">
              {t('writePdfAnnotationsCount', { count: summaries.length, total: totalThreadCount })}
            </p>
          </div>
          {onCollapse ? (
            <button
              type="button"
              onClick={onCollapse}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
              aria-label={t('rightPanelCollapse')}
              title={t('rightPanelCollapse')}
            >
              <X className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ) : (
            <Filter className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.8} />
          )}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setExportPreviewOpen(true)}
            disabled={exportDisabled}
            className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:border-accent/40 hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6"
            aria-label={t('writePdfAnnotationsExportPackage')}
            title={t('writePdfAnnotationsExportPackage')}
          >
            <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="truncate">
              {exportingPackage ? t('writePdfAnnotationsExportingPackage') : t('writePdfAnnotationsExportPackage')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onImportPackage?.()}
            disabled={importDisabled}
            className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:border-accent/40 hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6"
            aria-label={t('writePdfAnnotationsImportPackage')}
            title={t('writePdfAnnotationsImportPackage')}
          >
            <Upload className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <span className="truncate">
              {importingPackage ? t('writePdfAnnotationsImportingPackage') : t('writePdfAnnotationsImportPackage')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onReloadSidecar?.()}
            disabled={reloadDisabled}
            className="flex min-w-0 items-center justify-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-[12px] font-semibold text-ds-ink transition hover:border-accent/40 hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6"
            aria-label={t('writePdfAnnotationsReloadSidecar')}
            title={t('writePdfAnnotationsReloadSidecar')}
          >
            <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${reloadingSidecar ? 'animate-spin' : ''}`} strokeWidth={1.9} />
            <span className="truncate">
              {reloadingSidecar ? t('writePdfAnnotationsReloadingSidecar') : t('writePdfAnnotationsReloadSidecar')}
            </span>
          </button>
        </div>

        {exportPreviewOpen && sidecar ? (
          <div className="mt-2 rounded-lg border border-accent/18 bg-accent/5 p-2 text-[11.5px] text-ds-muted">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1 font-semibold text-ds-ink">
                {t('writePdfAnnotationsExportPreviewTitle')}
              </div>
              <button
                type="button"
                onClick={() => setExportPreviewOpen(false)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('writePdfAnnotationsExportPreviewCancel')}
                title={t('writePdfAnnotationsExportPreviewCancel')}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt>{t('writePdfAnnotationsExportPreviewPdf')}</dt>
              <dd className="truncate text-right font-medium text-ds-ink">{sourcePdfName || '-'}</dd>
              <dt>{t('writePdfAnnotationsExportPreviewThreads')}</dt>
              <dd className="text-right font-medium text-ds-ink">{totalThreadCount}</dd>
              <dt>{t('writePdfAnnotationsExportPreviewAnnotations')}</dt>
              <dd className="text-right font-medium text-ds-ink">{totalAnnotationCount}</dd>
              <dt>{t('writePdfAnnotationsExportPreviewAuthors')}</dt>
              <dd className="text-right font-medium text-ds-ink">{totalAuthorCount}</dd>
              <dt>{t('writePdfAnnotationsExportPreviewAnchors')}</dt>
              <dd className="text-right font-medium text-ds-ink">{totalAnchorCount}</dd>
            </dl>
            <p className="mt-2 leading-5 text-ds-faint">
              {t('writePdfAnnotationsExportPreviewContribution')}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportPreviewOpen(false)}
                className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                {t('writePdfAnnotationsExportPreviewCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportPreviewOpen(false)
                  onExportPackage?.()
                }}
                disabled={exportDisabled}
                className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('writePdfAnnotationsExportPreviewConfirm')}
              </button>
            </div>
          </div>
        ) : null}

        <p className="mt-2 text-[11px] leading-5 text-ds-faint">
          {t('writePdfAnnotationsContributionHint')}
        </p>

        <div className="mt-3">
          <div className="mb-1.5 text-[11px] font-semibold text-ds-faint">
            {t('writePdfAnnotationsDisplayMode')}
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            {displayModes.map((item) => {
              const active = annotationDisplayMode === item.mode
              return (
                <button
                  key={item.mode}
                  type="button"
                  onClick={() => onAnnotationDisplayModeChange?.(item.mode)}
                  className={`inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-[11.5px] font-semibold transition ${
                    active
                      ? 'bg-white text-accent shadow-sm ring-1 ring-ds-border-muted dark:bg-white/10 dark:ring-white/10'
                      : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                  aria-pressed={active}
                  title={item.title}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_92px] gap-2">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as PdfAnnotationKind | 'all')}
            className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-[12px] font-medium text-ds-ink outline-none transition focus:border-accent/50 dark:bg-white/6"
            aria-label={t('writePdfAnnotationsTypeFilter')}
            title={t('writePdfAnnotationsTypeFilter')}
          >
            <option value="all">{t('writePdfAnnotationsAllTypes')}</option>
            {PDF_ANNOTATION_KIND_VALUES.map((item) => (
              <option key={item} value={item}>{annotationKindLabel(item, t)}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PdfAnnotationThreadStatus | 'all')}
            className="min-w-0 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-[12px] font-medium text-ds-ink outline-none transition focus:border-accent/50 dark:bg-white/6"
            aria-label={t('writePdfAnnotationsStatusFilter')}
            title={t('writePdfAnnotationsStatusFilter')}
          >
            <option value="all">{t('writePdfAnnotationsAllStatuses')}</option>
            {PDF_ANNOTATION_STATUS_VALUES.map((item) => (
              <option key={item} value={item}>{annotationStatusLabel(item, t)}</option>
            ))}
          </select>
          <div className="flex min-w-0 items-center rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1.5 text-ds-muted focus-within:border-accent/50 dark:bg-white/6">
            <Hash className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
            <input
              value={pageValue}
              onChange={(event) => setPageValue(event.target.value)}
              min={1}
              type="number"
              inputMode="numeric"
              placeholder={t('writePdfAnnotationsPageFilterShort')}
              className="min-w-0 flex-1 bg-transparent px-1 text-[12px] font-medium text-ds-ink outline-none placeholder:text-ds-faint"
              aria-label={t('writePdfAnnotationsPageFilter')}
              title={t('writePdfAnnotationsPageFilter')}
            />
            {pageValue ? (
              <button
                type="button"
                onClick={() => setPageValue('')}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
                aria-label={t('writePdfAnnotationsClearPageFilter')}
                title={t('writePdfAnnotationsClearPageFilter')}
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ds-main/45 p-3 dark:bg-transparent">
        {summaries.length > 0 ? (
          <ul className="grid gap-2">
            {summaries.map((summary) => {
              const selected = selectedThreadId === summary.thread.id
              const pageLabel = formatPageRange(summary, t)
              const firstAnnotation = summary.firstAnnotation
              const firstAnnotationId = firstAnnotation?.id
              const autoEditing =
                Boolean(selected && firstAnnotation && summary.kind === 'comment' && !firstAnnotation.body.trim()) &&
                dismissedAutoEditThreadId !== summary.thread.id
              const editing = Boolean(firstAnnotationId && (editingAnnotationId === firstAnnotationId || autoEditing))
              const editorBody = editingAnnotationId === firstAnnotationId ? editingBody : firstAnnotation?.body ?? ''
              return (
                <li
                  key={summary.thread.id}
                  className={`rounded-lg border bg-ds-card shadow-sm transition ${
                    selected ? 'border-accent/45 ring-1 ring-accent/20' : 'border-ds-border-muted hover:border-ds-border'
                  }`}
                  onPointerEnter={() => onHoverThread?.(summary.thread.id, summary)}
                  onPointerLeave={() => onHoverThread?.(null)}
                  onFocusCapture={() => onHoverThread?.(summary.thread.id, summary)}
                  onBlurCapture={(event) => {
                    const nextTarget = event.relatedTarget
                    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) onHoverThread?.(null)
                  }}
                >
                  <div className="flex min-w-0 items-start gap-2 p-2">
                    <button
                      type="button"
                      onClick={() => onSelectThread?.(summary.thread.id, summary)}
                      className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition hover:bg-ds-hover"
                      aria-label={t('writePdfAnnotationsSelect')}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`inline-flex h-6 max-w-[116px] shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold ${kindAccent(summary.kind)}`}>
                          <MessageSquareText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          <span className="truncate">{annotationKindLabel(summary.kind, t)}</span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-medium text-ds-faint">
                          {summary.status === 'resolved' ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" strokeWidth={1.9} />
                          ) : (
                            <Circle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          )}
                          <span className="truncate">{annotationStatusLabel(summary.status, t)}</span>
                        </span>
                        {pageLabel ? (
                          <span className="ml-auto shrink-0 text-[11px] font-semibold text-ds-muted">{pageLabel}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 min-w-0">
                        <div className="text-[13px] font-semibold text-ds-ink [overflow-wrap:anywhere]">{summary.title}</div>
                        <div className="mt-1 text-[12px] leading-5 text-ds-muted [overflow-wrap:anywhere]">
                          {summary.preview || summary.quote || t('writePdfAnnotationsNoPreview')}
                        </div>
                      </div>
                      <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px] text-ds-faint">
                        <span className="truncate">
                          {t('writePdfAnnotationsAnnotationCount', { count: summary.annotationCount })}
                        </span>
                        {summary.author ? <span className="truncate">{summary.author.name}</span> : null}
                      </div>
                    </button>

                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (summary.status === 'resolved') onReopenThread?.(summary.thread.id, summary)
                          else onResolveThread?.(summary.thread.id, summary)
                        }}
                        disabled={summary.status === 'resolved' ? !onReopenThread : !onResolveThread}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={summary.status === 'resolved' ? t('writePdfAnnotationsReopen') : t('writePdfAnnotationsResolve')}
                        title={summary.status === 'resolved' ? t('writePdfAnnotationsReopen') : t('writePdfAnnotationsResolve')}
                      >
                        {summary.status === 'resolved' ? (
                          <RotateCcw className="h-4 w-4" strokeWidth={1.9} />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" strokeWidth={1.9} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditing(summary)}
                        disabled={!onEditAnnotation || !firstAnnotationId}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t('writePdfAnnotationsEdit')}
                        title={t('writePdfAnnotationsEdit')}
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.9} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteThread?.(summary.thread.id, summary)}
                        disabled={!onDeleteThread}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-ds-muted transition hover:bg-rose-500/10 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={t('writePdfAnnotationsDelete')}
                        title={t('writePdfAnnotationsDelete')}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-ds-border-muted/70 px-3 py-2">
                    {selected && firstAnnotationId && editing ? (
                        <div className="grid gap-2">
                          <textarea
                            autoFocus
                            value={editorBody}
                            onChange={(event) => {
                              setEditingAnnotationId(firstAnnotationId)
                              setEditingBody(event.target.value)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') cancelEditing(summary)
                              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveEditing(summary)
                            }}
                            placeholder={t('writePdfAnnotationsEditPlaceholder')}
                            className="min-h-[82px] w-full resize-y rounded-lg border border-ds-border-muted bg-white px-3 py-2 text-[12.5px] leading-5 text-ds-ink outline-none transition placeholder:text-ds-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/10 dark:bg-white/7"
                            aria-label={t('writePdfAnnotationsEdit')}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => cancelEditing(summary)}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={2} />
                              {t('writePdfAnnotationsCancelEdit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => saveEditing(summary)}
                              disabled={!onEditAnnotation}
                              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11.5px] font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                              {t('writePdfAnnotationsSaveEdit')}
                            </button>
                          </div>
                        </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(summary)}
                          disabled={!onEditAnnotation || !firstAnnotationId}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-surface-subtle px-2 text-[11.5px] font-semibold text-ds-muted transition hover:border-accent/35 hover:bg-ds-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white/6"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
                          {t('writePdfAnnotationsEdit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteThread?.(summary.thread.id, summary)}
                          disabled={!onDeleteThread}
                          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-rose-500/20 bg-rose-500/5 px-2 text-[11.5px] font-semibold text-rose-600 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-45 dark:text-rose-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                          {t('writePdfAnnotationsDelete')}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex min-h-full items-center justify-center px-4 text-center text-[13px] leading-6 text-ds-muted">
            {sidecar && hasFilter ? t('writePdfAnnotationsNoMatches') : t('writePdfAnnotationsEmpty')}
          </div>
        )}
      </div>
    </aside>
  )
}
