import {
  getActiveAgentRuntime,
  normalizeAgentRuntimeId,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeGovernanceProfile,
  AgentRuntimeId,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../../shared/agent-runtime-contract'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext,
  AgentRuntimeApprovalResolveInput,
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeSessionResumeHandle,
  AgentRuntimeSessionResumeInput,
  AgentRuntimeThreadCompactInput,
  AgentRuntimeThreadDeleteInput,
  AgentRuntimeThreadForkInput,
  AgentRuntimeThreadRelationInput,
  AgentRuntimeThreadRenameInput,
  AgentRuntimeUserInputResolveInput
} from './adapter'
import { RuntimeGovernanceSupervisor, runtimeGuardSettings } from './governance'

export type AgentRuntimeHostSettingsProvider = () => AppSettingsV1 | Promise<AppSettingsV1>

export type AgentRuntimeHostOptions = {
  settings: AgentRuntimeHostSettingsProvider
  adapters:
    | AgentRuntimeAdapter[]
    | Partial<Record<AgentRuntimeId, AgentRuntimeAdapter>>
}

export function createAgentRuntimeHost(options: AgentRuntimeHostOptions): AgentRuntimeHost {
  return new AgentRuntimeHost(options)
}

const THREAD_TURN_QUEUE_POLL_MS = 1_000
const THREAD_TURN_QUEUE_TIMEOUT_MS = 10 * 60_000

export class AgentRuntimeHost {
  private readonly adapters: Map<AgentRuntimeId, AgentRuntimeAdapter>
  private readonly turnQueues = new Map<string, Promise<unknown>>()
  private readonly turnGovernanceProfiles = new Map<string, AgentRuntimeGovernanceProfile>()
  private readonly governance = new RuntimeGovernanceSupervisor()

  constructor(private readonly options: AgentRuntimeHostOptions) {
    this.adapters = normalizeAdapters(options.adapters)
  }

  async connect(runtimeId?: AgentRuntimeId): Promise<void> {
    const { adapter, context } = await this.resolve(runtimeId)
    await adapter.connect(context)
  }

  async capabilities(runtimeId?: AgentRuntimeId): Promise<AgentRuntimeCapabilities> {
    const { adapter, context } = await this.resolve(runtimeId)
    return adapter.capabilities(context)
  }

  async listThreads(input: AgentRuntimeThreadListInput = {}): Promise<AgentRuntimeThread[]> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.listThreads(context, input)
  }

  async startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.startThread(context, input)
  }

  async readThread(input: AgentRuntimeThreadReadInput): Promise<AgentRuntimeThreadDetail> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return adapter.readThread(context, input)
  }

  async startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    return this.enqueueThreadTurnStart(adapter, context, input)
  }

  async interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.interruptTurn(context, input)
  }

  async steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.steerTurn(context, input)
  }

  async renameThread(input: AgentRuntimeThreadRenameInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.renameThread(context, input)
  }

  async deleteThread(input: AgentRuntimeThreadDeleteInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    await adapter.deleteThread(context, input)
  }

  async *subscribeEvents(input: AgentRuntimeEventSubscribeInput): AsyncIterable<AgentRuntimeEvent> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    const capabilities = await adapter.capabilities(context)
    const guardSettings = runtimeGuardSettings(context)
    for await (const event of adapter.subscribeEvents(context, input)) {
      this.governance.observe(event, capabilities, guardSettings, {
        governanceProfile: this.governanceProfileForEvent(capabilities.runtimeId, event),
        steerTurn: (payload) => this.steerTurn(payload),
        interruptTurn: (payload) => this.interruptTurn(payload),
        publishSyntheticEvent: (payload) => this.publishSyntheticEvent(adapter, context, payload)
      })
      yield event
    }
  }

  async resolveApproval(input: AgentRuntimeApprovalResolveInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resolveApproval) throw unsupported(adapter.id, 'approval')
    await adapter.resolveApproval(context, input)
  }

  async resolveUserInput(input: AgentRuntimeUserInputResolveInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resolveUserInput) throw unsupported(adapter.id, 'user input')
    await adapter.resolveUserInput(context, input)
  }

  async compactThread(input: AgentRuntimeThreadCompactInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.compactThread) throw unsupported(adapter.id, 'compact')
    await adapter.compactThread(context, input)
  }

  async forkThread(input: AgentRuntimeThreadForkInput): Promise<AgentRuntimeThread> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.forkThread) throw unsupported(adapter.id, 'fork')
    return adapter.forkThread(context, input)
  }

  async resumeSession(input: AgentRuntimeSessionResumeInput): Promise<AgentRuntimeSessionResumeHandle> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.resumeSession) throw unsupported(adapter.id, 'resume session')
    return adapter.resumeSession(context, input)
  }

  async updateThreadRelation(input: AgentRuntimeThreadRelationInput): Promise<void> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.updateThreadRelation) throw unsupported(adapter.id, 'thread relation')
    await adapter.updateThreadRelation(context, input)
  }

  async usage(input: AgentRuntimeUsageQuery): Promise<AgentRuntimeUsageResponse> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.usage) {
      return {
        supported: false,
        reason: `${adapter.id} AgentRuntimeAdapter does not support usage.`,
        groupBy: input.groupBy,
        buckets: [],
        totals: {}
      }
    }
    return adapter.usage(context, input)
  }

  async auxiliary(input: AgentRuntimeAuxiliaryInput): Promise<unknown> {
    const { adapter, context } = await this.resolve(input.runtimeId)
    if (!adapter.auxiliary) throw unsupported(adapter.id, input.operation)
    return adapter.auxiliary(context, input)
  }

  private async resolve(runtimeId?: AgentRuntimeId): Promise<{
    adapter: AgentRuntimeAdapter
    context: AgentRuntimeAdapterContext
  }> {
    const settings = await this.options.settings()
    const selected = runtimeId
      ? normalizeAgentRuntimeId(runtimeId)
      : getActiveAgentRuntime(settings)
    const adapter = this.adapters.get(selected)
    if (!adapter) throw new Error(`No AgentRuntimeAdapter registered for runtime: ${selected}`)
    return { adapter, context: { settings } }
  }

  private enqueueThreadTurnStart(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    input: AgentRuntimeTurnStartInput
  ): Promise<AgentRuntimeTurnHandle> {
    const key = `${adapter.id}:${input.threadId.trim()}`
    if (!input.threadId.trim()) {
      return adapter.startTurn(context, input).then((handle) => {
        this.rememberTurnGovernanceProfile(adapter.id, input, handle)
        return handle
      })
    }
    const previous = this.turnQueues.get(key) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        await waitForThreadIdle(adapter, context, input)
        const handle = await adapter.startTurn(context, input)
        this.rememberTurnGovernanceProfile(adapter.id, input, handle)
        return handle
      })
    this.turnQueues.set(key, task)
    void task
      .finally(() => {
        if (this.turnQueues.get(key) === task) this.turnQueues.delete(key)
      })
      .catch(() => undefined)
    return task
  }

  private async publishSyntheticEvent(
    adapter: AgentRuntimeAdapter,
    context: AgentRuntimeAdapterContext,
    event: AgentRuntimeEvent
  ): Promise<AgentRuntimeEvent | null> {
    if (!adapter.publishSyntheticEvent) return null
    return adapter.publishSyntheticEvent(context, event)
  }

  private rememberTurnGovernanceProfile(
    runtimeId: AgentRuntimeId,
    input: AgentRuntimeTurnStartInput,
    handle: AgentRuntimeTurnHandle
  ): void {
    const profile = input.governanceProfile
    const threadId = (handle.threadId || input.threadId).trim()
    const turnId = handle.turnId.trim()
    if (!profile || !threadId || !turnId) return
    this.turnGovernanceProfiles.set(turnGovernanceKey(runtimeId, threadId, turnId), profile)
  }

  private governanceProfileForEvent(
    runtimeId: AgentRuntimeId,
    event: AgentRuntimeEvent
  ): AgentRuntimeGovernanceProfile | undefined {
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return undefined
    return this.turnGovernanceProfiles.get(turnGovernanceKey(runtimeId, threadId, turnId))
  }
}

async function waitForThreadIdle(
  adapter: AgentRuntimeAdapter,
  context: AgentRuntimeAdapterContext,
  input: AgentRuntimeTurnStartInput
): Promise<void> {
  const deadline = Date.now() + THREAD_TURN_QUEUE_TIMEOUT_MS
  while (Date.now() < deadline) {
    let active = false
    try {
      const detail = await adapter.readThread(context, {
        runtimeId: input.runtimeId,
        threadId: input.threadId
      })
      active = threadHasActiveTurn(detail)
    } catch {
      return
    }
    if (!active) return
    await sleep(THREAD_TURN_QUEUE_POLL_MS)
  }
  throw new Error(`Timed out waiting for active turn to finish for thread ${input.threadId}.`)
}

function threadHasActiveTurn(detail: { turns?: Array<{ status?: string }> }): boolean {
  const turns = Array.isArray(detail.turns) ? detail.turns : []
  return turns.some((turn) => isActiveTurnStatus(turn.status))
}

function isActiveTurnStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'in_progress' || status === 'started' || status === 'running'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeAdapters(
  adapters: AgentRuntimeHostOptions['adapters']
): Map<AgentRuntimeId, AgentRuntimeAdapter> {
  const entries = Array.isArray(adapters)
    ? adapters.map((adapter) => [adapter.id, adapter] as const)
    : Object.entries(adapters) as Array<[AgentRuntimeId, AgentRuntimeAdapter]>
  return new Map(entries)
}

function unsupported(runtimeId: AgentRuntimeId, control: string): Error {
  return new Error(`${runtimeId} AgentRuntimeAdapter does not support ${control}.`)
}

function turnGovernanceKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  return `${runtimeId}:${threadId}:${turnId}`
}
