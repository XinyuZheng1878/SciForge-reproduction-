import type {
  AgentRuntimeId,
  AgentRuntimeItem,
  AgentRuntimeThreadDetail
} from '../../shared/agent-runtime-contract'
import {
  DEFAULT_EVIDENCE_DAG_TIMEOUT_MS,
  EVIDENCE_DAG_API_KEY_ENV,
  EVIDENCE_DAG_TIMEOUT_MS_ENV,
  evidenceDagServiceUrlFromEnv,
  evidenceDagThreadId
} from '../../shared/evidence-dag'

type EngineTraceItem = Record<string, unknown>

type FeedOptions = {
  runtimeId: AgentRuntimeId | string
  threadId: string
  items: readonly AgentRuntimeItem[]
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function itemContent(item: AgentRuntimeItem): string {
  return item.text?.trim() || item.detail?.trim() || item.summary?.trim() || stringifyOutput(item.meta)
}

function toolName(item: AgentRuntimeItem): string {
  const meta = item.meta ?? {}
  const name = meta.toolName ?? meta.name ?? meta.tool_name ?? item.toolKind
  return typeof name === 'string' && name.trim() ? name.trim() : 'tool'
}

export function isEvidenceDagFeedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(evidenceDagServiceUrlFromEnv(env))
}

export function toEvidenceDagTraceItems(items: readonly AgentRuntimeItem[]): EngineTraceItem[] {
  const out: EngineTraceItem[] = []
  for (const item of items) {
    switch (item.kind) {
      case 'user_message': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'user', content })
        break
      }
      case 'assistant_message': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'assistant', content })
        break
      }
      case 'reasoning': {
        const content = itemContent(item)
        if (content) out.push({ id: item.id, type: 'message', role: 'assistant', content })
        break
      }
      case 'tool': {
        if (item.status === 'error' || item.status === 'failed' || item.status === 'aborted') break
        const content = itemContent(item)
        if (content) {
          out.push({ id: item.id, type: 'tool_result', tool_name: toolName(item), content })
        }
        break
      }
      default:
        break
    }
  }
  return out
}

export function completedTurnItems(
  detail: AgentRuntimeThreadDetail,
  turnId: string
): AgentRuntimeItem[] {
  const turn = detail.turns?.find((candidate) => candidate.id === turnId)
  if (turn?.items?.length) return turn.items
  return (detail.items ?? []).filter((item) => item.turnId === turnId)
}

export async function feedEvidenceDag(options: FeedOptions): Promise<void> {
  const env = options.env ?? process.env
  const base = evidenceDagServiceUrlFromEnv(env)
  if (!base) return

  const trace = toEvidenceDagTraceItems(options.items)
  if (trace.length === 0) return

  const apiKey = (env[EVIDENCE_DAG_API_KEY_ENV] ?? '').trim()
  const timeoutMs = Number(env[EVIDENCE_DAG_TIMEOUT_MS_ENV] ?? DEFAULT_EVIDENCE_DAG_TIMEOUT_MS)
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_EVIDENCE_DAG_TIMEOUT_MS
  )
  try {
    const engineThreadId = evidenceDagThreadId(options.runtimeId, options.threadId)
    await (options.fetchImpl ?? fetch)(`${base}/threads/${encodeURIComponent(engineThreadId)}/ingest-trace`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({ trace, merge: true }),
      signal: controller.signal
    })
  } catch {
    // fail-open: the DAG is best-effort; never break the runtime turn.
  } finally {
    clearTimeout(timer)
  }
}
