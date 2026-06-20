import type { AgentRuntimeGitCheckpoint } from '@shared/agent-runtime-contract'
import {
  AlertTriangle,
  FileText,
  Loader2,
  PanelRightClose,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../agent/registry'
import { DiffView } from './DiffView'

type GitCheckpointPreview = {
  stagedPatch: string
  unstagedPatch: string
  untrackedFiles: string[]
}

type Props = {
  threadId: string | null
  runtimeId?: AgentRuntimeGitCheckpoint['runtimeId']
  workspaceRoot: string
  className?: string
  onCollapse: () => void
  onRestored?: () => void | Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function resultFailure(value: unknown): string | null {
  const payload = record(value)
  if (payload.ok !== false) return null
  return String(payload.message ?? payload.reason ?? 'Operation failed.')
}

function previewFromResult(value: unknown): GitCheckpointPreview {
  const payload = record(value)
  const resolved = record(payload.value ?? value)
  const untrackedFiles = Array.isArray(resolved.untrackedFiles)
    ? resolved.untrackedFiles.filter((item): item is string => typeof item === 'string')
    : []
  return {
    stagedPatch: typeof resolved.stagedPatch === 'string' ? resolved.stagedPatch : '',
    unstagedPatch: typeof resolved.unstagedPatch === 'string' ? resolved.unstagedPatch : '',
    untrackedFiles
  }
}

function checkpointTime(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Date(time).toLocaleString()
}

function checkpointStatusTone(status: AgentRuntimeGitCheckpoint['status']): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'restored') return 'border-blue-400/30 bg-blue-500/10 text-blue-700 dark:text-blue-200'
  if (status === 'blocked') return 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

export function GitCheckpointPanel({
  threadId,
  runtimeId,
  workspaceRoot,
  className = '',
  onCollapse,
  onRestored
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [checkpoints, setCheckpoints] = useState<AgentRuntimeGitCheckpoint[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<GitCheckpointPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [forceRestore, setForceRestore] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(null)

  const selected = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.checkpointId === selectedId) ?? null,
    [checkpoints, selectedId]
  )

  const loadCheckpoints = useCallback(async (): Promise<void> => {
    const provider = getProvider()
    if (typeof provider.listGitCheckpoints !== 'function') {
      setNotice({ tone: 'error', message: t('gitCheckpointUnavailable') })
      return
    }
    setLoading(true)
    setNotice(null)
    try {
      const next = await provider.listGitCheckpoints({
        ...(runtimeId ? { runtimeId } : {}),
        ...(threadId ? { threadId } : {}),
        ...(workspaceRoot.trim() ? { workspaceRoot } : {})
      })
      setCheckpoints(next)
      setSelectedId((current) => current && next.some((checkpoint) => checkpoint.checkpointId === current)
        ? current
        : next[0]?.checkpointId ?? null)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setLoading(false)
    }
  }, [runtimeId, threadId, t, workspaceRoot])

  useEffect(() => {
    void loadCheckpoints()
  }, [loadCheckpoints])

  useEffect(() => {
    if (!selectedId) {
      setPreview(null)
      return
    }
    const provider = getProvider()
    if (typeof provider.previewGitCheckpoint !== 'function') return
    let cancelled = false
    setPreviewLoading(true)
    setNotice(null)
    void provider.previewGitCheckpoint(selectedId)
      .then((result) => {
        if (cancelled) return
        const failure = resultFailure(result)
        if (failure) {
          setPreview(null)
          setNotice({ tone: 'error', message: failure })
          return
        }
        setPreview(previewFromResult(result))
      })
      .catch((error) => {
        if (!cancelled) setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const restoreSelected = async (): Promise<void> => {
    if (!selected) return
    const provider = getProvider()
    if (typeof provider.restoreGitCheckpoint !== 'function') {
      setNotice({ tone: 'error', message: t('gitCheckpointUnavailable') })
      return
    }
    const confirmed = window.confirm(
      forceRestore
        ? t('gitCheckpointForceRestoreConfirm')
        : t('gitCheckpointRestoreConfirm')
    )
    if (!confirmed) return
    setRestoring(true)
    setNotice(null)
    try {
      const result = await provider.restoreGitCheckpoint(selected.checkpointId, { force: forceRestore })
      const failure = resultFailure(result)
      if (failure) {
        setNotice({ tone: 'error', message: failure })
        return
      }
      setNotice({ tone: 'success', message: t('gitCheckpointRestored') })
      await onRestored?.()
      await loadCheckpoints()
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setRestoring(false)
    }
  }

  const noticeTone = notice?.tone === 'success'
    ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : notice?.tone === 'info'
      ? 'border-sky-400/25 bg-sky-500/10 text-sky-700 dark:text-sky-200'
      : 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'

  return (
    <aside className={`flex min-h-0 min-w-0 flex-col border-l border-ds-border bg-ds-sidebar ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ds-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-ds-ink">
            <RotateCcw className="h-4 w-4 text-ds-muted" strokeWidth={1.8} />
            <span>{t('gitCheckpointPanelTitle')}</span>
          </div>
          <div className="mt-1 truncate text-[11.5px] text-ds-faint">
            {threadId || t('gitCheckpointNoThread')}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void loadCheckpoints()}
            disabled={loading}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('gitCheckpointRefresh')}
            title={t('gitCheckpointRefresh')}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onCollapse}
            className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('rightPanelCollapse')}
            title={t('rightPanelCollapse')}
          >
            <PanelRightClose className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {notice ? (
          <div className={`rounded-lg border px-3 py-2 text-[12px] ${noticeTone}`}>
            {notice.message}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-ds-muted">
            {t('gitCheckpointCount', { count: checkpoints.length })}
          </span>
          <label className="inline-flex items-center gap-2 text-[12px] text-ds-muted">
            <input
              type="checkbox"
              checked={forceRestore}
              onChange={(event) => setForceRestore(event.target.checked)}
              className="h-4 w-4 rounded border-ds-border text-accent focus:ring-accent/30"
            />
            {t('gitCheckpointForceRestore')}
          </label>
        </div>

        {!threadId ? (
          <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-faint">
            {t('gitCheckpointNoThread')}
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            {t('loading')}
          </div>
        ) : checkpoints.length === 0 ? (
          <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-faint">
            {t('gitCheckpointEmpty')}
          </div>
        ) : (
          <div className="grid gap-2">
            {checkpoints.map((checkpoint) => {
              const active = checkpoint.checkpointId === selectedId
              return (
                <button
                  key={checkpoint.checkpointId}
                  type="button"
                  onClick={() => setSelectedId(checkpoint.checkpointId)}
                  className={`min-w-0 rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-ds-border-strong bg-ds-card text-ds-ink'
                      : 'border-ds-border-muted bg-ds-main/45 text-ds-muted hover:border-ds-border hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold">{checkpoint.turnId ?? checkpoint.threadId}</span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${checkpointStatusTone(checkpoint.status)}`}>
                      {checkpoint.status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                    <span className="font-mono">{checkpoint.runtimeId}</span>
                    {checkpoint.branch ? <span>{checkpoint.branch}</span> : null}
                    <span>{checkpointTime(checkpoint.createdAt)}</span>
                  </div>
                  {checkpoint.diffStat ? (
                    <pre className="mt-2 max-h-12 overflow-hidden whitespace-pre-wrap font-mono text-[10.5px] leading-4 text-ds-faint">
                      {checkpoint.diffStat}
                    </pre>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}

        {selected ? (
          <div className="flex shrink-0 flex-col gap-2 border-t border-ds-border pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ds-ink">
                <FileText className="h-4 w-4 text-ds-muted" strokeWidth={1.75} />
                <span className="truncate">{t('gitCheckpointPreview')}</span>
              </div>
              <button
                type="button"
                onClick={() => void restoreSelected()}
                disabled={restoring}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-[12px] font-semibold text-amber-800 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-200"
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} /> : <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />}
                {t('gitCheckpointRestore')}
              </button>
            </div>

            {forceRestore ? (
              <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span>{t('gitCheckpointForceRestoreWarning')}</span>
              </div>
            ) : null}

            {previewLoading ? (
              <div className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-muted">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                {t('loading')}
              </div>
            ) : preview && (preview.stagedPatch || preview.unstagedPatch || preview.untrackedFiles.length) ? (
              <div className="grid gap-2">
                {preview.untrackedFiles.length ? (
                  <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2">
                    <div className="text-[11.5px] font-semibold text-ds-muted">{t('gitCheckpointUntrackedFiles')}</div>
                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-ds-faint">
                      {preview.untrackedFiles.slice(0, 80).join('\n')}
                    </pre>
                  </div>
                ) : null}
                {preview.stagedPatch ? (
                  <DiffView patch={preview.stagedPatch} maxHeight={240} />
                ) : null}
                {preview.unstagedPatch ? (
                  <DiffView patch={preview.unstagedPatch} maxHeight={300} />
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-ds-border-muted bg-ds-card px-3 py-3 text-[13px] text-ds-faint">
                {t('gitCheckpointPreviewEmpty')}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  )
}
