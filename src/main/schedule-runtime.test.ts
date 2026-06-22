import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  mergeScheduleSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduledTaskV1
} from '../shared/app-settings'
import { ScheduleRuntime, computeScheduleNextRunAt, scheduledThreadTitle } from './schedule-runtime'

function makeTask(patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  const schedule = {
    kind: 'manual' as const,
    everyMinutes: 60,
    timeOfDay: '09:00',
    atTime: '',
    ...patch.schedule
  }
  return {
    id: 'task-1',
    title: 'Task 1',
    enabled: true,
    prompt: 'Run the task',
    workspaceRoot: '/tmp/workspace',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    ...patch,
    schedule
  }
}

function settingsWith(
  tasks: ScheduledTaskV1[] = [],
  schedulePatch: AppSettingsPatch['schedule'] = {}
): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'test-key'
      }
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: mergeScheduleSettings(defaultScheduleSettings(), {
      enabled: true,
      tasks,
      ...schedulePatch
    }),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function createStore(initial: AppSettingsV1) {
  let current = initial
  return {
    load: vi.fn(async () => current),
    patch: vi.fn(async (partial: AppSettingsPatch) => {
      current = {
        ...current,
        schedule: mergeScheduleSettings(current.schedule, partial.schedule),
        claw: current.claw
      }
      return current
    }),
    read: () => current
  }
}

function createRuntime(initial: AppSettingsV1, forbiddenDirectCall = vi.fn(), agentRuntime?: unknown) {
  const store = createStore(initial)
  const runtime = new ScheduleRuntime({
    store: store as never,
    ...(agentRuntime ? { agentRuntime: agentRuntime as never } : {}),
    logError: vi.fn()
  })
  return { runtime, store, forbiddenDirectCall, agentRuntime }
}

describe('ScheduleRuntime', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('computes nextRunAt for supported schedule kinds', () => {
    const from = new Date('2026-06-02T00:00:00.000Z')

    expect(computeScheduleNextRunAt(makeTask(), from)).toBe('')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: { kind: 'interval', everyMinutes: 15, timeOfDay: '09:00', atTime: '' }
    }), from)).toBe('2026-06-02T00:15:00.000Z')
    expect(computeScheduleNextRunAt(makeTask({
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2026-06-03T09:00:00.000+08:00'
      }
    }), from)).toBe('2026-06-03T09:00:00.000+08:00')
  })

  it('builds compact Scheduled task thread titles from task names', () => {
    expect(scheduledThreadTitle('每日A股行情盘')).toBe('[Scheduled task] 每日A股')
    expect(scheduledThreadTitle('Task 1')).toBe('[Scheduled task] Task')
    expect(scheduledThreadTitle('   ')).toBe('[Scheduled task]')
  })

  it('creates detected reminder requests into top-level schedule settings', async () => {
    const future = '2099-06-03T09:00:00.000Z'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        output_text: JSON.stringify({
          shouldCreateTask: true,
          scheduleAt: future,
          reminderBody: 'ship the review',
          taskName: 'Ship review'
        })
      })
    })))
    const { runtime, store } = createRuntime(settingsWith())
    vi.spyOn(runtime, 'sync').mockImplementation(() => undefined)

    const result = await runtime.createScheduledTaskFromText('Remind me tomorrow to ship the review.', {
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-flash',
      mode: 'plan'
    })

    expect(result).toMatchObject({
      kind: 'created',
      title: 'Ship review reminder',
      scheduleAt: future
    })
    expect(store.read().schedule.enabled).toBe(true)
    expect(store.read().schedule.tasks[0]).toMatchObject({
      title: 'Ship review reminder',
      workspaceRoot: '/tmp/schedule',
      model: 'deepseek-v4-flash',
      mode: 'plan',
      schedule: { kind: 'at', atTime: future }
    })
    expect(store.read().claw.tasks).toEqual([])
  })

  it('starts a Kun thread through agentRuntime with a Schedule title and records running status', async () => {
    const task = makeTask({ reasoningEffort: 'max' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'kun',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_1' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'thr_1',
      turnId: 'turn_1'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith({
      runtimeId: 'kun',
      title: '[Scheduled task] Task',
      workspace: '/tmp/workspace',
      model: 'auto',
      mode: 'agent'
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith({
      runtimeId: 'kun',
      threadId: 'thr_1',
      text: expect.stringContaining('Run the task'),
      workspace: '/tmp/workspace',
      mode: 'agent',
      model: 'auto',
      reasoningEffort: 'max',
      governanceProfile: 'remote_guard'
    })
    expect(store.read().schedule.tasks[0]).toMatchObject({
      lastStatus: 'running',
      lastThreadId: 'thr_1',
      lastMessage: 'Started'
    })
  })

  it('runs Codex scheduled tasks through agentRuntime and saves the Codex thread id', async () => {
    const task = makeTask({
      runtimeId: 'codex',
      lastThreadId: 'kun-thread',
      agentThreadIds: { kun: 'kun-thread' }
    })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'codex-thread', turnId: 'codex-turn' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'codex-thread',
      turnId: 'codex-turn'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Scheduled task] Task',
      mode: 'agent',
      model: 'auto'
    })
    expect(agentRuntime.startTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: expect.stringContaining('Run the task'),
      workspace: '/tmp/workspace',
      mode: 'agent',
      model: 'auto',
      reasoningEffort: 'medium',
      governanceProfile: 'remote_guard'
    })
    expect(store.read().schedule.tasks[0]).toMatchObject({
      runtimeId: 'codex',
      lastStatus: 'running',
      lastThreadId: 'kun-thread',
      lastMessage: 'Started',
      agentThreadIds: {
        kun: 'kun-thread',
        codex: 'codex-thread'
      }
    })
  })

  it('runs Kun scheduled tasks through agentRuntime when the host is available', async () => {
    const task = makeTask({ runtimeId: 'kun' })
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'kun-host-thread',
        runtimeId: 'kun',
        title: '[Scheduled task] Task',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'kun-host-thread', turnId: 'kun-host-turn' })),
      readThread: vi.fn()
    }
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)
    ;(runtime as unknown as { monitorTaskTurn: () => void }).monitorTaskTurn = vi.fn()

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: true,
      threadId: 'kun-host-thread',
      turnId: 'kun-host-turn'
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'kun',
      workspace: '/tmp/workspace',
      title: '[Scheduled task] Task'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'kun',
      threadId: 'kun-host-thread',
      text: expect.stringContaining('Run the task')
    }))
    expect(store.read().schedule.tasks[0]).toMatchObject({
      runtimeId: 'kun',
      lastStatus: 'running',
      lastThreadId: 'kun-host-thread',
      agentThreadIds: {
        kun: 'kun-host-thread'
      }
    })
  })

  it('fails closed for scheduled runs when agentRuntime is unavailable', async () => {
    const task = makeTask({ runtimeId: 'kun' })
    const forbiddenDirectCall = vi.fn()
    const { runtime, store } = createRuntime(settingsWith([task]), forbiddenDirectCall)

    await expect(runtime.runTask(task.id)).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('unsupported_runtime_request')
    })

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(store.read().schedule.tasks[0]).toMatchObject({
      lastStatus: 'error',
      lastMessage: expect.stringContaining('unsupported_runtime_request')
    })
  })

  it('reads assistant text from the agentRuntime thread detail shape', async () => {
    const task = makeTask()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'kun',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_1' })),
      readThread: vi.fn(async () => ({
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_1',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'scheduled task completed' }]
          }
        ]
      }))
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })

    expect(result).toMatchObject({ ok: true, text: 'scheduled task completed' })
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
    expect(agentRuntime.readThread).toHaveBeenCalledWith({ runtimeId: 'kun', threadId: 'thr_1' })
  })

  it('waits for the current scheduled turn to complete before returning final text', async () => {
    const task = makeTask()
    let getCount = 0
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'kun',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_current' })),
      readThread: vi.fn(async () => {
        getCount += 1
        return getCount === 1
          ? {
              id: 'thr_1',
              status: 'running',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                },
                {
                  id: 'turn_current',
                  status: 'running',
                  items: [{ kind: 'assistant_text', text: 'intermediate scheduled reply' }]
                }
              ]
            }
          : {
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_previous',
                  status: 'completed',
                  items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
                },
                {
                  id: 'turn_current',
                  status: 'completed',
                  items: [
                    { kind: 'assistant_text', text: 'intermediate scheduled reply' },
                    { kind: 'assistant_text', text: 'final scheduled reply' }
                  ]
                }
              ]
            }
      })
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_500
    })

    expect(result).toMatchObject({ ok: true, text: 'final scheduled reply' })
    expect(getCount).toBe(2)
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('does not return historical scheduled text when the current turn fails', async () => {
    const task = makeTask()
    const forbiddenDirectCall = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thr_1',
        runtimeId: 'kun',
        title: 'demo',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({ threadId: 'thr_1', turnId: 'turn_current' })),
      readThread: vi.fn(async () => ({
        id: 'thr_1',
        status: 'idle',
        turns: [
          {
            id: 'turn_previous',
            status: 'completed',
            items: [{ kind: 'assistant_text', text: 'previous scheduled reply' }]
          },
          {
            id: 'turn_current',
            status: 'failed',
            items: []
          }
        ]
      }))
    }
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall, agentRuntime)

    await expect((runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          reasoningEffort: ScheduledTaskV1['reasoningEffort']
          mode: ScheduledTaskV1['mode']
          waitForResult: boolean
          responseTimeoutMs: number
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settingsWith([task]), {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000
    })).rejects.toThrow('Agent turn failed.')
    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('disables one-time tasks after monitored completion', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: {
        kind: 'at',
        everyMinutes: 60,
        timeOfDay: '09:00',
        atTime: '2099-06-03T09:00:00.000Z'
      }
    })
    const { runtime, store } = createRuntime(settingsWith([task]))
    ;(runtime as unknown as {
      waitForAssistantText: () => Promise<string>
    }).waitForAssistantText = vi.fn(async () => 'done')

    await (runtime as unknown as {
      monitorTaskTurn: (taskId: string, threadId: string, turnId: string) => Promise<void>
    }).monitorTaskTurn(task.id, 'thr_1', 'turn_1')

    expect(store.read().schedule.tasks[0]).toMatchObject({
      enabled: false,
      nextRunAt: '',
      lastStatus: 'success',
      lastMessage: 'done',
      lastThreadId: 'thr_1'
    })
  })

  it('does not auto-run manual tasks during tick', async () => {
    const task = makeTask({
      schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
      nextRunAt: '2026-06-02T00:00:00.000Z'
    })
    const forbiddenDirectCall = vi.fn()
    const { runtime } = createRuntime(settingsWith([task]), forbiddenDirectCall)

    await (runtime as unknown as { tick: () => Promise<void> }).tick()

    expect(forbiddenDirectCall).not.toHaveBeenCalled()
  })

  it('marks interrupted running tasks as errors during next-run recovery', async () => {
    const task = makeTask({
      lastStatus: 'running',
      schedule: { kind: 'interval', everyMinutes: 10, timeOfDay: '09:00', atTime: '' }
    })
    const initial = settingsWith([task])
    const { runtime, store } = createRuntime(initial)

    await (runtime as unknown as {
      ensureNextRuns: (settings: AppSettingsV1) => Promise<void>
    }).ensureNextRuns(initial)

    expect(store.read().schedule.tasks[0].lastStatus).toBe('error')
    expect(store.read().schedule.tasks[0].lastMessage).toBe('Task was interrupted before completion.')
    expect(Date.parse(store.read().schedule.tasks[0].nextRunAt)).toBeGreaterThan(0)
  })

  it('uses the power save blocker only for enabled automatic schedules', () => {
    const started = new Set<number>()
    const powerSaveBlocker = {
      start: vi.fn(() => {
        started.add(1)
        return 1
      }),
      stop: vi.fn((id: number) => {
        started.delete(id)
      }),
      isStarted: vi.fn((id: number) => started.has(id))
    }
    const runtime = new ScheduleRuntime({
      store: createStore(settingsWith()) as never,
      logError: vi.fn(),
      powerSaveBlocker
    })
    const scheduled = settingsWith([
      makeTask({ schedule: { kind: 'daily', everyMinutes: 60, timeOfDay: '09:00', atTime: '' } })
    ], { keepAwake: true })

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker(scheduled)
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension')

    ;(runtime as unknown as { syncPowerSaveBlocker: (settings: AppSettingsV1) => void })
      .syncPowerSaveBlocker({ ...scheduled, schedule: { ...scheduled.schedule, keepAwake: false } })
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(1)
  })
})
