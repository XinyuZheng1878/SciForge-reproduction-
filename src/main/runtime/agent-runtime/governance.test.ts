import { describe, expect, it, vi } from 'vitest'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent
} from '../../../shared/agent-runtime-contract'
import type { RuntimeGuardSettingsV1 } from '../../../shared/app-settings'
import { RuntimeGovernanceSupervisor } from './governance'

const baseCapabilities = {
  runtimeId: 'codex',
  guard: { toolStorm: 'observe' }
} as AgentRuntimeCapabilities

const strictBudgetSettings: RuntimeGuardSettingsV1 = {
  toolStorm: {
    enabled: true,
    windowSize: 8,
    softThreshold: 10,
    hardThreshold: 20
  },
  budgets: {
    defaultMaxToolEvents: 2,
    writeMaxToolEvents: 2,
    remoteGuardMaxToolEvents: 2
  }
}

describe('RuntimeGovernanceSupervisor', () => {
  it('steers local Codex turns when they exceed the total tool budget without interrupting', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.steerTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    }))
    expect(controls.interruptTurn).not.toHaveBeenCalled()
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'runtime_status',
      metadata: expect.objectContaining({
        guard: 'toolStorm',
        level: 'soft',
        family: 'tool-budget'
      })
    }))
  })

  it('keeps remote guard tool budget overruns as hard interrupts', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy('remote_guard')

    for (let index = 1; index <= 3; index += 1) {
      supervisor.observe(toolEvent(index), baseCapabilities, strictBudgetSettings, controls)
    }
    await Promise.resolve()

    expect(controls.interruptTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: false
    }))
    expect(controls.publishSyntheticEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      code: 'runtime_tool_storm_interrupted',
      message: expect.stringContaining('tool-budget')
    }))
  })
})

function controlsSpy(governanceProfile?: 'remote_guard') {
  return {
    governanceProfile,
    steerTurn: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    publishSyntheticEvent: vi.fn(async (event: AgentRuntimeEvent) => event)
  }
}

function toolEvent(index: number): AgentRuntimeEvent {
  return {
    kind: 'tool_event',
    runtimeId: 'codex',
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: `tool-${index}`,
    status: 'running',
    toolKind: 'tool_call',
    summary: `lookup-${index}`,
    meta: {
      toolName: `lookup-${index}`,
      callId: `call-${index}`,
      arguments: { query: `q${index}` }
    }
  }
}
