import type { AgentRuntimeId, AgentRuntimeThread } from '../../shared/agent-runtime-contract'

type RuntimeThreadWithTurns = AgentRuntimeThread & {
  turns?: Array<{ status?: string }>
}

export type WaitForRuntimeIdleOptions = {
  listThreads?: (input?: {
    runtimeId?: AgentRuntimeId
    limit?: number
    includeArchived?: boolean
  }) => Promise<RuntimeThreadWithTurns[]>
  sleepMs?: (ms: number) => Promise<void>
  timeoutMs?: number
  intervalMs?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const DEFAULT_IDLE_POLL_MS = 1_000

export function runtimeThreadsListHasActiveTurn(threads: readonly RuntimeThreadWithTurns[]): boolean {
  return threads.some((thread) => {
    if (isActiveStatus(thread.status) || isActiveStatus(thread.latestTurnStatus)) return true
    return (thread.turns ?? []).some((turn) => isActiveStatus(turn.status))
  })
}

export async function waitForRuntimeTurnsIdle(
  options: WaitForRuntimeIdleOptions
): Promise<'idle' | 'timeout' | 'unavailable'> {
  const listThreads = options.listThreads
  const sleepMs = options.sleepMs ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? DEFAULT_IDLE_POLL_MS
  const deadline = Date.now() + Math.max(0, timeoutMs)
  if (!listThreads) return 'unavailable'

  while (true) {
    let threads: RuntimeThreadWithTurns[]
    try {
      threads = await listThreads({ runtimeId: 'sciforge', limit: 500, includeArchived: true })
    } catch {
      return 'unavailable'
    }
    if (!runtimeThreadsListHasActiveTurn(threads)) return 'idle'
    if (Date.now() >= deadline) return 'timeout'
    await sleepMs(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
  }
}

function isActiveStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}
