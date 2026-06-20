import type { AgentRuntimeId } from './agent-runtime-contract'

export const EVIDENCE_DAG_SERVICE_URL_ENV = 'SCIFORGE_EVIDENCE_DAG_SERVICE_URL'
export const EVIDENCE_DAG_API_KEY_ENV = 'SCIFORGE_EVIDENCE_DAG_API_KEY'
export const EVIDENCE_DAG_TIMEOUT_MS_ENV = 'SCIFORGE_EVIDENCE_DAG_TIMEOUT_MS'
export const DEFAULT_EVIDENCE_DAG_SERVICE_URL = 'http://127.0.0.1:3897'
export const DEFAULT_EVIDENCE_DAG_TIMEOUT_MS = 600_000

export function evidenceDagThreadId(
  runtimeId: AgentRuntimeId | string | undefined,
  threadId: string
): string {
  const id = threadId.trim()
  const runtime = runtimeId?.trim()
  return runtime && id ? `${runtime}:${id}` : id
}

export function normalizeEvidenceDagServiceUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return ''
  }
}

export function evidenceDagServiceUrlFromEnv(env: Record<string, string | undefined>): string {
  return normalizeEvidenceDagServiceUrl(env[EVIDENCE_DAG_SERVICE_URL_ENV])
}

export function evidenceDagUiUrl(input: {
  runtimeId?: AgentRuntimeId | string
  threadId?: string | null
  serviceUrl?: string
}): string {
  const base = normalizeEvidenceDagServiceUrl(input.serviceUrl) || DEFAULT_EVIDENCE_DAG_SERVICE_URL
  const threadId = input.threadId?.trim()
  if (!threadId) return `${base}/`
  return `${base}/?thread=${encodeURIComponent(evidenceDagThreadId(input.runtimeId, threadId))}`
}
