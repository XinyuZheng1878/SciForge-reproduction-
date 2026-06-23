import { createServer, type AddressInfo } from 'node:net'
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
  mergeWorkflowSettings,
  type AppSettingsPatch,
  type AppSettingsV1,
  type WorkflowV1
} from '../shared/app-settings'
import { WorkflowRuntime } from './workflow-runtime'

const now = '2026-06-23T00:00:00.000Z'

function makeWorkflow(patch: Partial<WorkflowV1> = {}): WorkflowV1 {
  return {
    id: 'workflow-1',
    name: 'Callable workflow',
    enabled: true,
    callableByAgent: true,
    env: [{ key: 'SECRET_TOKEN', value: 'super-secret', type: 'secret' }],
    nodes: [{
      id: 'trigger-1',
      type: 'manual-trigger',
      name: 'Manual',
      position: { x: 0, y: 0 },
      disabled: false,
      onError: 'fail',
      retries: 0,
      retryDelayMs: 1000,
      config: {
        inputSchema: [{
          key: 'topic',
          label: 'Topic',
          type: 'text',
          required: true,
          options: [],
          defaultValue: '',
          description: 'Topic to process'
        }]
      }
    }],
    connections: [],
    createdAt: now,
    updatedAt: now,
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    runs: [{
      id: 'run-1',
      trigger: 'manual',
      status: 'success',
      startedAt: now,
      finishedAt: now,
      message: 'Done',
      nodeResults: []
    }],
    ...patch
  }
}

function settingsWith(workflows: WorkflowV1[], port: number, secret = 'workflow-secret'): AppSettingsV1 {
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
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: mergeWorkflowSettings(defaultWorkflowSettings(), {
      enabled: true,
      webhookPort: port,
      webhookSecret: secret,
      workflows
    }),
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
        workflow: mergeWorkflowSettings(current.workflow, partial.workflow)
      }
      return current
    }),
    read: () => current
  }
}

async function findAvailablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  const port = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function requestInternal(
  port: number,
  path: string,
  body?: Record<string, unknown>,
  secret = 'workflow-secret'
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {}
  if (secret) headers.Authorization = `Bearer ${secret}`
  const init: RequestInit = { method: body ? 'POST' : 'GET', headers }
  if (body) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  return {
    status: response.status,
    json: await response.json() as Record<string, unknown>
  }
}

describe('WorkflowRuntime internal HTTP facade', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('serves list, status, stop, export, and import through the authenticated internal API', async () => {
    const port = await findAvailablePort()
    const workflow = makeWorkflow()
    const store = createStore(settingsWith([workflow], port))
    const runtime = new WorkflowRuntime({
      store: store as never,
      logError: vi.fn()
    })
    runtime.sync(store.read())

    try {
      await expect(requestInternal(port, '/workflow/internal/list', undefined, '')).resolves.toMatchObject({
        status: 401,
        json: { ok: false, message: 'Unauthorized.' }
      })

      await expect(requestInternal(port, '/workflow/internal/list')).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflows: [{
            id: 'workflow-1',
            name: 'Callable workflow',
            inputs: [{ key: 'topic', type: 'text', required: true, description: 'Topic to process' }]
          }]
        }
      })

      await expect(requestInternal(port, '/workflow/internal/status', { runId: 'run-1' })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          runId: 'run-1',
          workflowId: 'workflow-1',
          status: 'success',
          runtime: { runningWorkflowIds: [] },
          run: { id: 'run-1', status: 'success' }
        }
      })

      await expect(requestInternal(port, '/workflow/internal/stop', { workflowId: 'workflow-1' })).resolves.toMatchObject({
        status: 400,
        json: {
          ok: false,
          workflowId: 'workflow-1',
          message: 'Workflow is not running.'
        }
      })

      const exported = await requestInternal(port, '/workflow/internal/export', { workflowId: 'workflow-1' })
      expect(exported).toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflowId: 'workflow-1',
          workflow: {
            id: 'workflow-1',
            enabled: false,
            callableByAgent: false,
            env: [{ key: 'SECRET_TOKEN', value: '', type: 'secret' }],
            runs: []
          }
        }
      })

      await expect(requestInternal(port, '/workflow/internal/import', {
        workflow: {
          ...(exported.json.workflow as Record<string, unknown>),
          id: 'workflow-1',
          name: 'Callable workflow'
        }
      })).resolves.toMatchObject({
        status: 200,
        json: {
          ok: true,
          workflowId: 'workflow-1-2',
          workflow: {
            id: 'workflow-1-2',
            name: 'Callable workflow (2)',
            enabled: false,
            callableByAgent: false,
            runs: []
          },
          message: 'Workflow imported.'
        }
      })
    } finally {
      runtime.stop()
    }
  })
})
