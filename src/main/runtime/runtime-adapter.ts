import type { AgentRuntimeId, AppSettingsV1 } from '../../shared/app-settings'

export type ManagedRuntimeRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export type ManagedRuntimeRequestResult = {
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
    init: ManagedRuntimeRequestInit
  ): Promise<ManagedRuntimeRequestResult>
  startEvents?(
    settings: AppSettingsV1,
    threadId: string,
    sinceSeq: number
  ): AsyncIterable<unknown>
}
