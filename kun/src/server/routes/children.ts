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
      reason: 'Local runtime subagents are disabled or unavailable.'
    })
  }
  const diagnostics = await runtime.delegationRuntime.diagnostics(threadId)
  const filtered = diagnostics.childRuns
    .filter((child) => !query.turnId || child.parentTurnId === query.turnId)
    .filter((child) => !query.activeOnly || child.status === 'queued' || child.status === 'running')
  const start = query.cursor ? Number(query.cursor) : 0
  const limit = query.limit ?? filtered.length
  const children = filtered
    .slice(start, start + limit)
    .map((child) => query.includeTranscript ? child : childListRecord(child))
  const nextOffset = start + children.length
  return jsonResponse({
    threadId,
    ...(query.turnId ? { turnId: query.turnId } : {}),
    children,
    ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    metadata: {
      enabled: diagnostics.config.enabled,
      active: diagnostics.active,
      statusCounts: diagnostics.statusCounts,
      aggregates: diagnostics.aggregates
    }
  })
}

export async function readChildTranscript(
  runtime: ServerRuntime,
  threadId: string,
  childId: string,
  request: Request
): Promise<JsonResponse> {
  const query = parseTranscriptQuery(request)
  if (!runtime.delegationRuntime) {
    return degradedChildTranscript(threadId, childId, 'Local runtime subagents are disabled or unavailable.')
  }
  const child = await runtime.delegationRuntime.child(threadId, childId)
  if (!child) {
    return degradedChildTranscript(threadId, childId, 'Local runtime child agent run was not found.')
  }
  return jsonResponse({
    transcript: {
      runtimeId: 'sciforge',
      threadId,
      parentThreadId: threadId,
      childId,
      parentTurnId: child.parentTurnId,
      child,
      transcriptRef: {
        id: child.id,
        kind: 'runtime',
        runtimeId: 'sciforge',
        childId: child.id,
        transcriptId: child.id,
        source: 'local-runtime-child-run',
        label: child.label || child.id
      },
      format: 'jsonl',
      entries: child.transcript.slice(query.start, query.start + query.limit),
      ...(query.start + query.limit < child.transcript.length ? { nextCursor: String(query.start + query.limit) } : {}),
      summary: child.summary,
      usage: child.usage,
      ...(child.error ? { reason: child.error.message } : {}),
      metadata: {
        source: 'local-runtime.child-runs',
        status: child.status,
        ...(child.error ? { error: child.error } : {})
      }
    }
  })
}

function degradedChildTranscript(
  threadId: string,
  childId: string,
  reason: string
): JsonResponse {
  return jsonResponse({
    transcript: {
      runtimeId: 'sciforge',
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
  includeTranscript: boolean
} {
  const url = new URL(request.url)
  const turnId = stringQuery(url, 'turn_id') ??
    stringQuery(url, 'turnId') ??
    stringQuery(url, 'parent_turn_id') ??
    stringQuery(url, 'parentTurnId')
  const activeOnly = booleanQuery(url, 'active_only') ?? booleanQuery(url, 'activeOnly') ?? false
  const cursor = cursorQuery(url)
  const limit = positiveIntegerQuery(url, 'limit')
  const includeTranscript = booleanQuery(url, 'include_transcript') ??
    booleanQuery(url, 'includeTranscript') ??
    false
  return {
    ...(turnId ? { turnId } : {}),
    activeOnly,
    ...(cursor ? { cursor } : {}),
    ...(limit ? { limit } : {}),
    includeTranscript
  }
}

function parseTranscriptQuery(request: Request): {
  start: number
  limit: number
} {
  const url = new URL(request.url)
  const cursor = cursorQuery(url)
  return {
    start: cursor ? Number(cursor) : 0,
    limit: positiveIntegerQuery(url, 'limit') ?? 100
  }
}

function childListRecord<T extends { transcript?: unknown }>(child: T): Omit<T, 'transcript'> {
  const { transcript: _transcript, ...rest } = child
  return rest
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
