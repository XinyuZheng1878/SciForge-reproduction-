import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { GitMerge, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * One-click "export Project DAG" for the Workbench top bar.
 *
 * Flow: the button opens a small dialog holding the project goal (title +
 * purpose). "Compile & export" ensures that goal exists in the project-dag
 * service, kicks off a compile and opens the web report in the browser.
 * The dialog also auto-opens right after the user picks a NEW workspace
 * (the store dispatches `sciforge:project-dag-setup`), which is where the
 * user states the project's purpose.
 */

export const PROJECT_DAG_SETUP_EVENT = 'sciforge:project-dag-setup'

function storageKey(workspaceRoot: string): string {
  return `sciforge.projectDag.goal:${workspaceRoot || 'default'}`
}

function workspaceName(workspaceRoot: string): string {
  const parts = (workspaceRoot || '').split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

type SavedGoal = { title: string; description: string }

function loadSavedGoal(workspaceRoot: string): SavedGoal | null {
  try {
    const raw = localStorage.getItem(storageKey(workspaceRoot))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedGoal
    return typeof parsed.title === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function ProjectDagExportButton({
  workspaceRoot = ''
}: {
  workspaceRoot?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const openDialog = useCallback(
    (root: string) => {
      const saved = loadSavedGoal(root)
      setTitle(saved?.title || workspaceName(root))
      setDescription(saved?.description || '')
      setError('')
      setOpen(true)
    },
    [setTitle, setDescription, setError, setOpen]
  )

  // New workspace picked -> prompt for the project's purpose.
  useEffect(() => {
    const handler = (event: Event): void => {
      const root = (event as CustomEvent<{ workspaceRoot?: string }>).detail?.workspaceRoot ?? ''
      openDialog(root || workspaceRoot)
    }
    window.addEventListener(PROJECT_DAG_SETUP_EVENT, handler)
    return () => window.removeEventListener(PROJECT_DAG_SETUP_EVENT, handler)
  }, [openDialog, workspaceRoot])

  const runExport = useCallback(
    async (autocompile: boolean) => {
      if (typeof window.sciforge?.exportProjectDag !== 'function') {
        setError(t('projectDagUnavailable'))
        return
      }
      setBusy(true)
      setError('')
      try {
        localStorage.setItem(
          storageKey(workspaceRoot),
          JSON.stringify({ title: title.trim(), description: description.trim() })
        )
        await window.sciforge.exportProjectDag({
          ...(title.trim() ? { goalTitle: title.trim() } : {}),
          ...(description.trim() ? { goalDescription: description.trim() } : {}),
          autocompile
        })
        setOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [title, description, workspaceRoot, t]
  )

  return (
    <>
      <button
        type="button"
        onClick={() => openDialog(workspaceRoot)}
        className="rounded-full border border-transparent bg-white/38 px-2.5 py-1.5 text-ds-faint opacity-90 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:border-ds-border-muted hover:bg-white/55 hover:text-ds-ink hover:opacity-100 dark:bg-white/4 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] dark:hover:bg-white/8"
        aria-label={t('projectDagExport')}
        title={t('projectDagExport')}
      >
        <GitMerge className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30"
              onClick={() => (busy ? null : setOpen(false))}
            >
              <div
                className="w-[440px] max-w-[92vw] rounded-2xl border border-ds-border-strong bg-white p-5 shadow-2xl dark:bg-neutral-900"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-1 text-sm font-semibold text-ds-ink">
                  {t('projectDagDialogTitle')}
                </div>
                <div className="mb-4 text-xs text-ds-faint">{t('projectDagDialogHint')}</div>
                <label className="mb-1 block text-xs font-medium text-ds-faint">
                  {t('projectDagGoalTitle')}
                </label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={busy}
                  className="mb-3 w-full rounded-lg border border-ds-border-muted bg-transparent px-3 py-2 text-sm text-ds-ink outline-none focus:border-ds-border-strong"
                  placeholder={t('projectDagGoalTitlePlaceholder')}
                />
                <label className="mb-1 block text-xs font-medium text-ds-faint">
                  {t('projectDagGoalDescription')}
                </label>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  disabled={busy}
                  rows={3}
                  className="mb-3 w-full resize-none rounded-lg border border-ds-border-muted bg-transparent px-3 py-2 text-sm text-ds-ink outline-none focus:border-ds-border-strong"
                  placeholder={t('projectDagGoalDescriptionPlaceholder')}
                />
                {error ? <div className="mb-3 text-xs text-red-500">{error}</div> : null}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOpen(false)}
                    className="rounded-lg px-3 py-1.5 text-sm text-ds-faint hover:text-ds-ink"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void runExport(false)}
                    className="rounded-lg border border-ds-border-muted px-3 py-1.5 text-sm text-ds-ink hover:border-ds-border-strong"
                  >
                    {t('projectDagOpenOnly')}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !title.trim()}
                    onClick={() => void runExport(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-ds-ink px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t('projectDagCompileExport')}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
