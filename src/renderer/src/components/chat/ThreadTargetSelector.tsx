import type { ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  getRemoteExecutorSettings,
  isRemoteExecutorTargetTrustedForWorkspace,
  type AppSettingsV1,
  type RemoteExecutorTargetV1
} from '@shared/app-settings'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { SETTINGS_CHANGED_EVENT } from '../../lib/keyboard-shortcut-settings'
import { useChatStore } from '../../store/chat-store'

export function enabledRemoteTargets(settings: AppSettingsV1 | null): RemoteExecutorTargetV1[] {
  if (!settings) return []
  const remoteExecutor = getRemoteExecutorSettings(settings)
  if (!remoteExecutor.enabled) return []
  return remoteExecutor.targets.filter((target) => target.enabled)
}

export function remoteTargetTrustedForWorkspace(
  target: RemoteExecutorTargetV1 | undefined,
  workspaceRoot: string
): boolean {
  const workspace = workspaceRoot.trim()
  if (!target || !workspace) return false
  return isRemoteExecutorTargetTrustedForWorkspace(target, workspace, `settings-ui:${target.id}`)
}

function remoteTargetKindLabel(target: RemoteExecutorTargetV1, t: (key: string) => string): string {
  return target.kind === 'slurm' ? t('threadTargetKindSlurm') : t('threadTargetKindSsh')
}

export function ThreadTargetSelectorView({
  targets,
  selectedTargetId,
  workspaceRoot,
  onTargetChange,
  className = ''
}: {
  targets: RemoteExecutorTargetV1[]
  selectedTargetId: string | null
  workspaceRoot: string
  onTargetChange: (targetId: string | null) => void
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? null
  const selectedTrusted = remoteTargetTrustedForWorkspace(selectedTarget ?? undefined, workspaceRoot)
  const selectedKind = selectedTarget ? remoteTargetKindLabel(selectedTarget, t) : t('threadTargetKindLocal')
  const selectedTrust = selectedTarget
    ? selectedTrusted ? t('threadTargetTrusted') : t('threadTargetUntrusted')
    : t('threadTargetLocalBadge')

  return (
    <div className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <Server className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
      <select
        aria-label={t('threadTargetSelectorLabel')}
        title={t('threadTargetSelectorLabel')}
        className="min-h-8 max-w-[210px] rounded-lg border border-ds-border-muted bg-ds-card px-2 py-1 text-[12px] font-medium text-ds-muted outline-none transition hover:bg-ds-hover focus:border-accent/45 focus:ring-1 focus:ring-accent/20"
        value={selectedTarget?.id ?? ''}
        onChange={(event) => onTargetChange(event.target.value || null)}
      >
        <option value="">{t('threadTargetLocal')}</option>
        {targets.map((target) => {
          const trusted = remoteTargetTrustedForWorkspace(target, workspaceRoot)
          return (
            <option key={target.id} value={target.id}>
              {target.label || target.id} · {remoteTargetKindLabel(target, t)} · {trusted ? t('threadTargetTrusted') : t('threadTargetUntrusted')}
            </option>
          )
        })}
      </select>
      <span
        className="hidden shrink-0 rounded-md border border-ds-border-muted bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ds-faint sm:inline-flex"
        title={`${selectedKind} · ${selectedTrust}`}
      >
        {selectedKind}
      </span>
      <span
        className="hidden shrink-0 rounded-md border border-ds-border-muted bg-ds-subtle px-1.5 py-0.5 text-[10.5px] font-medium text-ds-faint md:inline-flex"
        title={selectedTrust}
      >
        {selectedTrust}
      </span>
    </div>
  )
}

export function ThreadTargetSelector({
  className = ''
}: {
  className?: string
}): ReactElement {
  const [settings, setSettings] = useState<AppSettingsV1 | null>(null)
  const selectedTargetId = useChatStore((s) => s.remoteTargetId)
  const setRemoteTargetId = useChatStore((s) => s.setRemoteTargetId)
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const threads = useChatStore((s) => s.threads)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads]
  )
  const activeWorkspaceRoot = activeThread?.workspace || workspaceRoot
  const targets = useMemo(() => enabledRemoteTargets(settings), [settings])

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((next) => {
        if (!cancelled) setSettings(next)
      })
      .catch(() => undefined)

    const onSettingsChanged = (event: Event): void => {
      setSettings((event as CustomEvent<AppSettingsV1>).detail)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged)
    }
  }, [])

  useEffect(() => {
    if (!selectedTargetId) return
    if (targets.some((target) => target.id === selectedTargetId)) return
    setRemoteTargetId(null)
  }, [selectedTargetId, setRemoteTargetId, targets])

  return (
    <ThreadTargetSelectorView
      targets={targets}
      selectedTargetId={selectedTargetId}
      workspaceRoot={activeWorkspaceRoot}
      onTargetChange={setRemoteTargetId}
      className={className}
    />
  )
}
