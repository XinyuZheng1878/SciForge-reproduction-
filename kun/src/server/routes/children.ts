import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listThreadChildren(
  runtime: ServerRuntime,
  threadId: string,
  request: Request
): Promise<JsonResponse> {
  const query = parseChildrenQuery(request)
  if (!runtime.delegationRuntime) {
    return jsonResponse({
      threadId,
      ...(query.turnId ? { turnId: query.turnId } : {}),
      children: [],
      degraded: true,
      reason: 'Kun subagents are disabled or unavailable.'
    })
  }
  const diagnostics = await runtime.delegationRuntime.diagnostics(threadId)
  const filtered = diagnostics.childRuns
    .filter((child) => !query.turnId || child.parentTurnId === query.turnId)
    .filter((child) => !query.activeOnly || child.status === 'queued' || child.status === 'running')
  const start = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? filtered.length
  const children = filtered.slice(start, start + limit)
  const nextOffset = start + children.length
  return jsonResponse({
    threadId,
    ...(query.turnId ? { turnId: query.turnId } : {}),
    children,
    ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    metadata: {
      enabled: diagnostics.enabled,
      active: diagnostics.active,
      aggregates: diagnostics.aggregates
    }
  })
}

export function readChildTranscript(
  _runtime: ServerRuntime,
  threadId: string,
  childId: string
): JsonResponse {
  const reason = 'Kun child agent transcripts are not persisted by the runtime yet.'
  return jsonResponse({
    transcript: {
      runtimeId: 'kun',
      threadId,
      parentThreadId: threadId,
      childId,
      format: 'unknown',
      entries: [],
      degraded: true,
      reason
    }
  })
}

function parseChildrenQuery(request: Request): {
  turnId?: string
  activeOnly: boolean
  cursor?: string
  limit?: number
} {
  const url = new URL(request.url)
  const turnId = stringQuery(url, 'turn_id') ?? stringQuery(url, 'turnId') ?? stringQuery(url, 'parent_turn_id')
  const activeOnly = booleanQuery(url, 'active_only') ?? booleanQuery(url, 'activeOnly') ?? false
  const cursor = cursorQuery(url)
  const limit = positiveIntegerQuery(url, 'limit')
  return {
    ...(turnId ? { turnId } : {}),
    activeOnly,
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {})
  }
}

function stringQuery(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim()
  return value || undefined
}

function booleanQuery(url: URL, key: string): boolean | undefined {
  const value = url.searchParams.get(key)
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return undefined
}

function cursorQuery(url: URL): string | undefined {
  const value = stringQuery(url, 'cursor')
  if (!value) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return undefined
  return String(number)
}

function positiveIntegerQuery(url: URL, key: string): number | undefined {
  const value = url.searchParams.get(key)
  if (!value) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) return undefined
  return number
}
