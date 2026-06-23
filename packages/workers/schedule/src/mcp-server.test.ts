import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import {
  SCHEDULE_STATUS_RESOURCE_URI,
  SCHEDULE_TOOL_SIDE_EFFECTS,
  SCHEDULE_TASKS_RESOURCE_URI,
  scheduleTaskResourceUri,
  type ScheduledTask
} from './contract.js'
import { confirmationValueFor } from './service.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const clients: Client[] = []

after(async () => {
  await Promise.all(clients.map((client) => client.close().catch(() => undefined)))
})

test('schedule MCP stdio server lists tools, resources, and structured results', async () => {
  const task = sampleTask({ id: 'task-stdio', title: 'Stdio task' })
  const fakeServer = await listenFakeServer(async (req, res) => {
    const url = req.url ?? ''
    await readJsonBody(req)
    if (url === '/schedule/internal/list') {
      writeJson(res, 200, { ok: true, tasks: [task] })
      return
    }
    if (url === '/schedule/internal/status') {
      writeJson(res, 200, {
        internalServerRunning: true,
        internalUrl: fakeServer.baseUrl,
        runningTaskIds: ['task-stdio'],
        powerSaveBlockerActive: true
      })
      return
    }
    writeJson(res, 404, { ok: false, message: `No route ${url}` })
  })

  try {
    const client = new Client({ name: 'schedule-worker-test', version: '0.1.0' })
    clients.push(client)
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts', '--quiet', '--base-url', fakeServer.baseUrl],
      cwd: packageRoot,
      stderr: 'pipe'
    }), { timeout: 20_000 })

    const listedTools = await client.listTools(undefined, { timeout: 20_000 })
    const toolNames = listedTools.tools.map((tool) => tool.name).sort()
    assert.deepEqual(toolNames, [
      'gui_schedule_create',
      'gui_schedule_delete',
      'gui_schedule_detect_from_text',
      'gui_schedule_list',
      'gui_schedule_run',
      'gui_schedule_status',
      'gui_schedule_update'
    ])
    const toolsByName = new Map(listedTools.tools.map((tool) => [tool.name, tool]))
    assert.equal(asRecord(toolsByName.get('gui_schedule_list')?.annotations).readOnlyHint, true)
    assert.equal(asRecord(toolsByName.get('gui_schedule_create')?.annotations).destructiveHint, false)
    assert.equal(asRecord(toolsByName.get('gui_schedule_delete')?.annotations).destructiveHint, true)
    assert.equal(asRecord(toolsByName.get('gui_schedule_run')?.annotations).destructiveHint, true)
    assert.equal(SCHEDULE_TOOL_SIDE_EFFECTS.gui_schedule_run.effect, 'destructive')

    const listResult = await client.callTool({
      name: 'gui_schedule_list',
      arguments: {}
    }, undefined, { timeout: 20_000 })
    assert.equal(listResult.isError, undefined)
    assert.equal(asRecord(listResult.structuredContent).count, 1)

    const listedResources = await client.listResources(undefined, { timeout: 20_000 })
    const resourceUris = listedResources.resources.map((resource) => resource.uri).sort()
    assert.deepEqual(resourceUris, [
      SCHEDULE_STATUS_RESOURCE_URI,
      scheduleTaskResourceUri('task-stdio'),
      SCHEDULE_TASKS_RESOURCE_URI
    ].sort())

    const templates = await client.listResourceTemplates(undefined, { timeout: 20_000 })
    assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === 'schedule://task/{id}'))

    const taskResource = await client.readResource({
      uri: scheduleTaskResourceUri('task-stdio')
    }, { timeout: 20_000 })
    const taskJson = JSON.parse(asRecord(taskResource.contents[0]).text as string) as Record<string, unknown>
    assert.equal(asRecord(taskJson.task).id, 'task-stdio')

    const statusResource = await client.readResource({
      uri: SCHEDULE_STATUS_RESOURCE_URI
    }, { timeout: 20_000 })
    const statusJson = JSON.parse(asRecord(statusResource.contents[0]).text as string) as Record<string, unknown>
    assert.equal(asRecord(statusJson.status).powerSaveBlockerActive, true)
  } finally {
    await fakeServer.close()
  }
})

test('schedule MCP destructive tools support preview and structured confirmation_required errors', async () => {
  const requests: string[] = []
  const fakeServer = await listenFakeServer(async (req, res) => {
    const url = req.url ?? ''
    await readJsonBody(req)
    requests.push(url)
    if (url === '/schedule/internal/run') {
      writeJson(res, 200, { ok: true, threadId: 'thread-mcp', turnId: 'turn-mcp', message: 'Started' })
      return
    }
    writeJson(res, 404, { ok: false, message: `No route ${url}` })
  })

  try {
    const client = new Client({ name: 'schedule-worker-safety-test', version: '0.1.0' })
    clients.push(client)
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts', '--quiet', '--base-url', fakeServer.baseUrl],
      cwd: packageRoot,
      stderr: 'pipe'
    }), { timeout: 20_000 })

    const preview = await client.callTool({
      name: 'gui_schedule_run',
      arguments: { task_id: 'task-mcp', dry_run: true }
    }, undefined, { timeout: 20_000 })
    const previewStructured = asRecord(preview.structuredContent)
    assert.equal(preview.isError, undefined)
    assert.equal(previewStructured.dryRun, true)
    assert.equal(previewStructured.effect, 'destructive')
    assert.equal(asRecord(previewStructured.confirmation).value, confirmationValueFor('run', 'task-mcp'))
    assert.deepEqual(requests, [])

    const missingConfirmation = await client.callTool({
      name: 'gui_schedule_delete',
      arguments: { task_id: 'task-mcp' }
    }, undefined, { timeout: 20_000 })
    const missingStructured = asRecord(missingConfirmation.structuredContent)
    assert.equal(missingConfirmation.isError, true)
    assert.equal(missingStructured.code, 'confirmation_required')
    assert.equal(asRecord(missingStructured.error).code, 'confirmation_required')
    assert.equal(asRecord(missingStructured.confirmationRequired).code, 'confirmation_required')
    assert.deepEqual(requests, [])

    const runResult = await client.callTool({
      name: 'gui_schedule_run',
      arguments: {
        task_id: 'task-mcp',
        confirmation: confirmationValueFor('run', 'task-mcp')
      }
    }, undefined, { timeout: 20_000 })
    assert.equal(runResult.isError, undefined)
    assert.equal(asRecord(runResult.structuredContent).ok, true)
    assert.deepEqual(requests, ['/schedule/internal/run'])
  } finally {
    await fakeServer.close()
  }
})

test('schedule MCP tool errors expose model-readable error fields', async () => {
  const fakeServer = await listenFakeServer(async (_req, res) => {
    writeJson(res, 500, { ok: false, message: 'Schedule runtime unavailable.' })
  })

  try {
    const client = new Client({ name: 'schedule-worker-error-test', version: '0.1.0' })
    clients.push(client)
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/cli.ts', '--quiet', '--base-url', fakeServer.baseUrl],
      cwd: packageRoot,
      stderr: 'pipe'
    }), { timeout: 20_000 })

    const result = await client.callTool({
      name: 'gui_schedule_list',
      arguments: {}
    }, undefined, { timeout: 20_000 })
    const structured = asRecord(result.structuredContent)
    assert.equal(result.isError, true)
    assert.equal(typeof structured.code, 'string')
    assert.equal(typeof structured.reason, 'string')
    assert.equal(typeof structured.retryable, 'boolean')
    assert.equal(typeof structured.suggestion, 'string')
  } finally {
    await fakeServer.close()
  }
})

function sampleTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task',
    title: 'Task',
    enabled: true,
    prompt: 'Do work.',
    workspaceRoot: '/tmp',
    model: 'auto',
    reasoningEffort: 'medium',
    mode: 'agent',
    schedule: {
      kind: 'interval',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: ''
    },
    createdAt: '2026-06-23T00:00:00.000Z',
    updatedAt: '2026-06-23T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    agentThreadIds: {},
    ...overrides
  }
}

async function listenFakeServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void Promise.resolve(handler(req, res)).catch((error) => {
      writeJson(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text ? JSON.parse(text) : {}
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
