import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ChevronDown, FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ExpertInfo } from '@shared/ds-gui-api'

type ExpertStatus = {
  ok: boolean
  configured?: boolean
  providerReachable?: boolean
  device?: string
  experts: ExpertInfo[]
  checkedAt?: string
}

const POLL_INTERVAL_MS = 30_000

export function ExpertStatusPanel(): ReactElement | null {
  const { t } = useTranslation('common')
  const [status, setStatus] = useState<ExpertStatus | null>(null)
  const [open, setOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchStatus = async (): Promise<void> => {
    try {
      const result = await window.dsGui.getExpertStatus()
      setStatus(result as ExpertStatus)
    } catch {
      // ignore — graceful degradation
    }
  }

  // Fetch on mount
  useEffect(() => {
    void fetchStatus()
  }, [])

  // Poll every 30s while mounted
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void fetchStatus()
    }, POLL_INTERVAL_MS)
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current)
    }
  }, [])

  // Re-fetch on expand
  const handleToggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) void fetchStatus()
  }

  // If not yet loaded, render nothing
  if (status === null) return null

  // If the service is not configured, render nothing (keep UI clean)
  if (status.configured === false) return null

  const experts = status.experts ?? []
  const onlineCount = experts.filter((e) => e.online).length
  const total = experts.length

  return (
    <div className="mb-1 w-full">
      {/* Collapsed trigger pill */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-1.5 text-left text-xs text-ds-muted transition-colors hover:bg-ds-hover"
        aria-expanded={open}
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className="flex-1 font-medium">
          {t('expertsPanelTitle')}
        </span>
        {status.providerReachable === false ? (
          <span className="text-ds-muted opacity-70">{t('expertsPanelProviderUnreachable')}</span>
        ) : (
          <span className="tabular-nums">
            {t('expertsPanelOnline', { count: onlineCount })}/{total}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Expanded list */}
      {open && (
        <div className="mt-1 rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2">
          {experts.length === 0 ? (
            <p className="text-xs text-ds-muted">{t('expertsPanelProviderUnreachable')}</p>
          ) : (
            <ul className="space-y-1">
              {experts.map((expert) => (
                <li key={expert.modality} className="flex items-center gap-2 text-xs">
                  {/* Status dot */}
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${expert.online ? 'bg-green-500' : 'bg-ds-muted opacity-40'}`}
                    aria-label={expert.online ? 'online' : t('expertsPanelOffline')}
                  />
                  <span className="capitalize text-ds-text">{expert.modality}</span>
                  <span className="text-ds-muted opacity-70">·</span>
                  <span className="font-mono text-ds-muted opacity-80">{expert.model}</span>
                  {!expert.online && (
                    <span className="ml-auto text-ds-muted opacity-50">{t('expertsPanelOffline')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {status.device && (
            <p className="mt-1.5 text-xs text-ds-muted opacity-50">{status.device}</p>
          )}
        </div>
      )}
    </div>
  )
}
