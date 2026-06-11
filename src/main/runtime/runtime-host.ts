import {
  getActiveAgentRuntime,
  normalizeAgentRuntimeId,
  type AgentRuntimeId,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { CodexRuntimeService } from './codex'
import type { RuntimeRequestInit } from './kun-adapter'

export type RuntimeHostRequestResult = { ok: boolean; status: number; body: string }
export type RuntimeHostEventPayload = Record<string, unknown>

export type RuntimeHostOptions = {
  ensureKunRuntime: (settings: AppSettingsV1) => Promise<void>
  kunRequest: (
    settings: AppSettingsV1,
    pathAndQuery: string,
    init: RuntimeRequestInit,
    ensureRuntime: (settings: AppSettingsV1) => Promise<void>
  ) => Promise<RuntimeHostRequestResult>
}

export type RuntimeHostEventsOptions = RuntimeHostOptions & {
  codexRuntime: () => CodexRuntimeService
  kunEvents: (
    settings: AppSettingsV1,
    threadId: string,
    sinceSeq: number,
    signal: AbortSignal
  ) => AsyncIterable<RuntimeHostEventPayload>
}

export async function runtimeRequestViaRuntimeHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: RuntimeRequestInit,
  options: RuntimeHostOptions,
  runtimeId: AgentRuntimeId = getActiveAgentRuntime(settings)
): Promise<RuntimeHostRequestResult> {
  const targetRuntimeId = normalizeAgentRuntimeId(runtimeId)
  if (targetRuntimeId === 'kun') {
    return options.kunRequest(settings, pathAndQuery, init, options.ensureKunRuntime)
  }
  return failure(
    400,
    'Legacy runtime:request is Kun-only. Use agentRuntime IPC for Codex.',
    'unsupported_runtime_request'
  )
}

export async function* runtimeEventsViaRuntimeHost(
  settings: AppSettingsV1,
  threadId: string,
  sinceSeq: number,
  signal: AbortSignal,
  options: RuntimeHostEventsOptions,
  runtimeId: AgentRuntimeId = getActiveAgentRuntime(settings)
): AsyncIterable<RuntimeHostEventPayload> {
  const targetRuntimeId = normalizeAgentRuntimeId(runtimeId)
  if (targetRuntimeId === 'kun') {
    await options.ensureKunRuntime(settings)
    yield* options.kunEvents(settings, threadId, sinceSeq, signal)
    return
  }

  // Legacy SSE compatibility uses the same normalized Codex service stream as
  // AgentRuntimeHost: replay GUI-owned events, then continue with live events.
  const codexRuntime = options.codexRuntime()
  const events = typeof codexRuntime.subscribeEvents === 'function'
    ? codexRuntime.subscribeEvents(threadId, sinceSeq, signal)
    : await codexRuntime.readStoredEvents(threadId, sinceSeq)
  for await (const event of events) {
    if (signal.aborted) return
    yield event as RuntimeHostEventPayload
  }
}

function json(status: number, body: unknown): RuntimeHostRequestResult {
  return { ok: status >= 200 && status < 300, status, body: JSON.stringify(body) }
}

function failure(status: number, message: string, code?: string): RuntimeHostRequestResult {
  return json(status, { ok: false, message, ...(code ? { code } : {}) })
}
