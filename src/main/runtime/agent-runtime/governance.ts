import {
  normalizeRuntimeGuardSettings,
  type RuntimeGuardSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeGovernanceProfile,
  AgentRuntimeId,
  AgentRuntimeToolKind,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'

type RuntimeGovernanceControls = {
  governanceProfile?: AgentRuntimeGovernanceProfile
  steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void>
  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void>
  publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent | null>
}

type ToolStormState = {
  events: ToolFingerprint[]
  totals: Map<string, number>
  totalEvents: number
  steered: Set<string>
  interrupted: Set<string>
  observedRunningToolIds: Set<string>
}

type ToolFingerprint = {
  exact: string
  family: string
}

export class RuntimeGovernanceSupervisor {
  private readonly toolStormStates = new Map<string, ToolStormState>()

  observe(
    event: AgentRuntimeEvent,
    capabilities: AgentRuntimeCapabilities,
    settings: RuntimeGuardSettingsV1,
    controls: RuntimeGovernanceControls
  ): void {
    if (event.kind !== 'tool_event' || event.status !== 'running') return
    if (capabilities.guard.toolStorm !== 'observe') return
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return
    if (!settings.toolStorm.enabled) return
    const key = `${capabilities.runtimeId}:${threadId}:${turnId}`
    const state = this.toolStormStates.get(key) ?? {
      events: [],
      totals: new Map<string, number>(),
      totalEvents: 0,
      steered: new Set(),
      interrupted: new Set(),
      observedRunningToolIds: new Set()
    }
    const runningToolId = runningToolIdentity(event)
    if (runningToolId && state.observedRunningToolIds.has(runningToolId)) {
      this.toolStormStates.set(key, state)
      return
    }
    if (runningToolId) state.observedRunningToolIds.add(runningToolId)
    const fingerprint = toolFingerprint(event)
    state.totalEvents += 1
    state.events.push(fingerprint)
    state.events = state.events.slice(-settings.toolStorm.windowSize)
    state.totals.set(fingerprint.exact, (state.totals.get(fingerprint.exact) ?? 0) + 1)
    state.totals.set(fingerprint.family, (state.totals.get(fingerprint.family) ?? 0) + 1)
    this.toolStormStates.set(key, state)

    if (state.totalEvents > maxToolEventsForProfile(settings, controls.governanceProfile) && !state.interrupted.has('budget')) {
      state.interrupted.add('budget')
      void controls.interruptTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        discard: false
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'hard', 'tool-budget')
      return
    }

    const exactCount = countMatches(state.events, 'exact', fingerprint.exact)
    const familyCount = countMatches(state.events, 'family', fingerprint.family)
    const totalCount = Math.max(
      state.totals.get(fingerprint.exact) ?? 0,
      state.totals.get(fingerprint.family) ?? 0
    )
    const count = Math.max(exactCount, familyCount, totalCount)
    if (count >= settings.toolStorm.hardThreshold && !state.interrupted.has(fingerprint.family)) {
      state.interrupted.add(fingerprint.family)
      void controls.interruptTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        discard: false
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'hard', fingerprint.family)
      return
    }
    if (count >= settings.toolStorm.softThreshold && !state.steered.has(fingerprint.family)) {
      state.steered.add(fingerprint.family)
      void controls.steerTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        text: `Stop calling tools in the same ${fingerprint.family} family. Use the results already available and answer the user directly.`
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'soft', fingerprint.family)
    }
  }
}

export async function adapterCapabilities(
  adapter: AgentRuntimeAdapter,
  context: AgentRuntimeAdapterContext
): Promise<AgentRuntimeCapabilities> {
  return adapter.capabilities(context)
}

export function runtimeGuardSettings(context: AgentRuntimeAdapterContext): RuntimeGuardSettingsV1 {
  return normalizeRuntimeGuardSettings(context.settings.runtimeGuards)
}

function toolFingerprint(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): ToolFingerprint {
  const meta = recordValue(event.meta)
  const toolName = stringValue(meta.toolName) || event.summary?.trim() || event.toolKind || 'tool'
  const args = meta.arguments ?? argumentLikeMeta(meta)
  const kind = event.toolKind ?? 'tool_call'
  const family = behaviorFamily(toolName, kind, meta, event.detail)
  return {
    exact: `${kind}:${toolName}:${canonicalJson(args)}`,
    family: `${kind}:${family}`
  }
}

function behaviorFamily(
  toolName: string,
  kind: AgentRuntimeToolKind,
  meta: Record<string, unknown>,
  detail?: string
): string {
  if (kind === 'file_change') return 'file-change'
  const command = stringValue(meta.command) || detail?.trim() || ''
  if (kind === 'command_execution') return commandFamily(command)
  const normalized = toolName.toLowerCase()
  if (/(search|grep|find|rg|query)/.test(normalized)) return 'search-read'
  if (/(read|open|cat|fetch|get|list)/.test(normalized)) return 'read'
  if (/(write|create|update|delete|patch|edit)/.test(normalized)) return 'write'
  return normalized || 'tool'
}

function commandFamily(command: string): string {
  const head = command.trim().split(/\s+/)[0]?.toLowerCase() || 'shell'
  if (head === 'date' || head === 'time') return 'shell/date'
  if (['cat', 'sed', 'head', 'tail', 'nl', 'less'].includes(head)) return 'shell/read-file'
  if (['rg', 'grep', 'find', 'fd'].includes(head)) return 'shell/search'
  if (['ls', 'pwd', 'stat'].includes(head)) return 'shell/list'
  if (['curl', 'wget'].includes(head)) return 'shell/fetch'
  return `shell/${head}`
}

async function publishToolStormEvent(
  controls: RuntimeGovernanceControls,
  source: AgentRuntimeEvent,
  runtimeId: AgentRuntimeId,
  level: 'soft' | 'hard',
  family: string
): Promise<void> {
  await controls.publishSyntheticEvent({
    kind: 'runtime_status',
    threadId: source.threadId,
    runtimeId,
    turnId: source.turnId,
    phase: 'tool_running',
    message: level === 'hard'
      ? `Runtime guard interrupted repeated ${family} tool activity.`
      : `Runtime guard steered repeated ${family} tool activity.`,
    metadata: {
      synthetic: true,
      guard: 'toolStorm',
      level,
      family
    }
  })
  if (level === 'hard') {
    await controls.publishSyntheticEvent({
      kind: 'error',
      threadId: source.threadId,
      runtimeId,
      turnId: source.turnId,
      itemId: `runtime-guard-tool-storm-${source.turnId || source.threadId}`,
      recoverable: true,
      severity: 'error',
      code: 'runtime_tool_storm_interrupted',
      message: `Runtime guard stopped this turn after repeated ${family} tool activity.`,
      detail: `The runtime interrupted the turn to prevent a repeated tool-call loop. Tool family: ${family}.`
    })
  }
}

function countMatches<T extends keyof ToolFingerprint>(
  events: ToolFingerprint[],
  key: T,
  value: ToolFingerprint[T]
): number {
  return events.filter((event) => event[key] === value).length
}

function maxToolEventsForProfile(
  settings: RuntimeGuardSettingsV1,
  profile: AgentRuntimeGovernanceProfile | undefined
): number {
  if (profile === 'remote_guard') return settings.budgets.remoteGuardMaxToolEvents
  if (profile === 'write') return settings.budgets.writeMaxToolEvents
  return settings.budgets.defaultMaxToolEvents
}

function runningToolIdentity(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): string {
  const meta = recordValue(event.meta)
  const callId = stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    stringValue(meta.call_id) ||
    stringValue(meta.tool_call_id)
  if (callId) return `call:${callId}`
  const itemId = event.itemId.trim()
  if (!itemId || itemId === 'codex-local-shell-call' || itemId === 'codex-tool-output') return ''
  return `item:${itemId}`
}

function argumentLikeMeta(meta: Record<string, unknown>): unknown {
  return {
    command: meta.command,
    cwd: meta.cwd,
    filePath: meta.filePath,
    path: meta.path,
    query: meta.query
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
