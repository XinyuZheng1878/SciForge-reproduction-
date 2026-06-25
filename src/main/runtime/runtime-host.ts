import {
  getActiveAgentRuntime,
  type AgentRuntimeId,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { CodexRuntimeService } from './codex'

export type RuntimeHostEventPayload = Record<string, unknown>

export type RuntimeHostOptions = {
  ensureLocalRuntime: (settings: AppSettingsV1) => Promise<void>
}

export type RuntimeHostEventsOptions = RuntimeHostOptions & {
  codexRuntime: () => CodexRuntimeService
  localRuntimeEvents: (
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
  runtimeId?: AgentRuntimeId
): AsyncIterable<RuntimeHostEventPayload> {
  const targetRuntimeId = runtimeId ?? getActiveAgentRuntime(settings)
  if (!isRuntimeHostRuntimeId(targetRuntimeId)) {
    throw new Error(`Legacy runtime SSE is not available for runtime: ${String(targetRuntimeId)}.`)
  }
  if (targetRuntimeId === 'sciforge') {
    await options.ensureLocalRuntime(settings)
    yield* options.localRuntimeEvents(settings, threadId, sinceSeq, signal)
    return
  }

  if (targetRuntimeId !== 'codex') {
    throw new Error('Legacy runtime SSE is only available for SciForge and Codex. Use agentRuntime IPC for Claude Code.')
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

function isRuntimeHostRuntimeId(value: unknown): value is AgentRuntimeId {
  return value === 'sciforge' || value === 'codex' || value === 'claude'
}
