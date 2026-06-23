import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  WORKFLOW_CALLABLE_RESOURCE_URI,
  WORKFLOW_TOOL_CONTRACTS
} from './contract.js'
import { createWorkflowMcpServer } from './mcp-server.js'
import { createWorkflowService, type WorkflowInternalHttpClient } from './service.js'

test('registers workflow MCP tools and resources', async () => {
  const service = createWorkflowService({
    client: new FakeWorkflowClient({
      '/workflow/internal/list': {
        ok: true,
        workflows: [{
          id: 'wf-1',
          name: 'Paper digest',
          description: 'Digest a topic',
          inputs: [{ key: 'topic', type: 'text', required: true }]
        }]
      },
      '/workflow/internal/status': {
        ok: true,
        runId: 'run-1',
        workflowId: 'wf-1',
        status: 'running',
        run: { id: 'run-1' }
      }
    })
  })
  const server = createWorkflowMcpServer(service)
  const client = new Client({ name: 'workflow-test-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = linkedTransports()

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const listedTools = await client.listTools()
    const toolNames = listedTools.tools.map((tool) => tool.name).sort()
    assert.deepEqual(toolNames, [
      'gui_workflow_export',
      'gui_workflow_import',
      'gui_workflow_list',
      'gui_workflow_run',
      'gui_workflow_status',
      'gui_workflow_stop',
      'gui_workflow_validate'
    ])
    const toolsByName = new Map(listedTools.tools.map((tool) => [tool.name, tool]))
    for (const [name, contract] of Object.entries(WORKFLOW_TOOL_CONTRACTS)) {
      const annotations = asRecord(toolsByName.get(name)?.annotations)
      assert.deepEqual({
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
        idempotentHint: annotations.idempotentHint,
        openWorldHint: annotations.openWorldHint
      }, contract.annotations)
    }
    const stopInputSchema = asRecord(toolsByName.get('gui_workflow_stop')?.inputSchema)
    assert.ok('confirmation' in asRecord(stopInputSchema.properties))

    const listedResources = await client.listResources()
    assert.ok(listedResources.resources.some((resource) => resource.uri === WORKFLOW_CALLABLE_RESOURCE_URI))

    const templates = await client.listResourceTemplates()
    assert.deepEqual(templates.resourceTemplates.map((template) => template.uriTemplate).sort(), [
      'workflow://run/{runId}',
      'workflow://schema/{workflowId}'
    ])

    const runPreview = await client.callTool({
      name: 'gui_workflow_run',
      arguments: {
        workflow_id: 'wf-1',
        input: { topic: 'biology' },
        dry_run: true
      }
    })
    assert.equal(runPreview.isError, undefined)
    assert.equal(asRecord(runPreview.structuredContent).wouldRun, true)

    const callable = await client.readResource({ uri: WORKFLOW_CALLABLE_RESOURCE_URI })
    const callableJson = JSON.parse(textContent(callable.contents[0]))
    assert.equal(callableJson.workflows[0].id, 'wf-1')

    const schema = await client.readResource({ uri: 'workflow://schema/wf-1' })
    const schemaJson = JSON.parse(textContent(schema.contents[0]))
    assert.equal(schemaJson.workflowId, 'wf-1')

    const run = await client.readResource({ uri: 'workflow://run/run-1' })
    const runJson = JSON.parse(textContent(run.contents[0]))
    assert.equal(runJson.runId, 'run-1')
  } finally {
    await client.close()
    await server.close()
  }
})

test('returns structured workflow error results from tools', async () => {
  const service = createWorkflowService({
    client: new FakeWorkflowClient({
      '/workflow/internal/list': { ok: false, message: 'runtime not ready' }
    })
  })
  const server = createWorkflowMcpServer(service)
  const client = new Client({ name: 'workflow-error-test-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = linkedTransports()

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const result = await client.callTool({ name: 'gui_workflow_list', arguments: {} })
    assert.equal(result.isError, true)
    const structured = asRecord(result.structuredContent)
    const error = asRecord(structured.error)
    assert.equal(structured.ok, false)
    assert.equal(typeof error.code, 'string')
    assert.equal(typeof error.reason, 'string')
    assert.equal(typeof error.retryable, 'boolean')
    assert.equal(typeof error.suggestion, 'string')
  } finally {
    await client.close()
    await server.close()
  }
})

test('returns structured confirmation_required for destructive stop without confirmation', async () => {
  const service = createWorkflowService({ client: new FakeWorkflowClient({}) })
  const server = createWorkflowMcpServer(service)
  const client = new Client({ name: 'workflow-confirmation-test-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = linkedTransports()

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const result = await client.callTool({
      name: 'gui_workflow_stop',
      arguments: { run_id: 'run-1' }
    })
    assert.equal(result.isError, true)
    const structured = asRecord(result.structuredContent)
    const error = asRecord(structured.error)
    assert.equal(structured.ok, false)
    assert.equal(error.code, 'confirmation_required')
    assert.match(textContent(result.content[0]), /confirmation_required/)
  } finally {
    await client.close()
    await server.close()
  }
})

class FakeWorkflowClient implements WorkflowInternalHttpClient {
  constructor(private readonly responses: Record<string, unknown>) {}

  async request(path: string): Promise<unknown> {
    return this.responses[path] ?? { ok: false, message: `No fake response for ${path}` }
  }
}

class MemoryTransport implements Transport {
  peer?: MemoryTransport
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  closed = false

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    queueMicrotask(() => {
      if (!this.closed) this.peer?.onmessage?.(message)
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }
}

function linkedTransports(): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport()
  const b = new MemoryTransport()
  a.peer = b
  b.peer = a
  return [a, b]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function textContent(value: unknown): string {
  const record = asRecord(value)
  return typeof record.text === 'string' ? record.text : ''
}
