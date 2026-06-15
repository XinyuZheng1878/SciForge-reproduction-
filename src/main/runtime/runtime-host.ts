import {
  getActiveAgentRuntime,
  normalizeAgentRuntimeId,
  type AgentRuntimeId,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { CodexRuntimeService } from './codex'

export type RuntimeHostEventPayload = Record<string, unknown>

export type RuntimeHostOptions = {
  ensureKunRuntime: (settings: AppSettingsV1) => Promise<void>
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

  if (targetRuntimeId !== 'codex') {
    throw new Error('Legacy runtime SSE is only available for Kun and Codex. Use agentRuntime IPC for Claude Code.')
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
