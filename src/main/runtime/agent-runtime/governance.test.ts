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
    threshold: 2
  }
}

describe('RuntimeGovernanceSupervisor', () => {
  it('steers repeated tool calls at the configured threshold', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

    for (let index = 1; index <= 2; index += 1) {
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
        family: 'tool_call:lookup'
      })
    }))
  })

  it('interrupts repeated tool calls after one extra repeat', async () => {
    const supervisor = new RuntimeGovernanceSupervisor()
    const controls = controlsSpy()

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
      message: expect.stringContaining('tool_call:lookup')
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
    summary: 'lookup',
    meta: {
      toolName: 'lookup',
      callId: `call-${index}`,
      arguments: { query: 'q' }
    }
  }
}
