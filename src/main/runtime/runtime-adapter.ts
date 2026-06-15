import type { AgentRuntimeId, AppSettingsV1 } from '../../shared/app-settings'

export type ManagedRuntimeHttpInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export type ManagedRuntimeHttpResult = {
  ok: boolean
  status: number
  body: string
}

export type ManagedRuntimeAdapter = {
  id: AgentRuntimeId
  ensureRunning(settings: AppSettingsV1): Promise<void>
  stopAndWait(): Promise<void>
  isChildRunning(): boolean
  request(
    settings: AppSettingsV1,
    pathAndQuery: string,
    init: ManagedRuntimeHttpInit
  ): Promise<ManagedRuntimeHttpResult>
  startEvents?(
    settings: AppSettingsV1,
    threadId: string,
    sinceSeq: number
  ): AsyncIterable<unknown>
}
