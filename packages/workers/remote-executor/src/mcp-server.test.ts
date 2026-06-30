import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { REMOTE_EXECUTOR_TOOL_NAMES } from './contract.js'
import { createRemoteExecutorMcpServer } from './mcp-server.js'
import { createRemoteExecutorService } from './service.js'

test('remote executor MCP lists tools and calls fake target operations', async (t) => {
  const service = createRemoteExecutorService({
    targets: [{
      id: 'mock-gpu',
      kind: 'mock',
      host: 'mock.local',
      user: 'tester',
      capabilities: {
        directRun: true,
        stdin: true,
        deploy: true,
        slurm: true
      }
    }],
    now: () => new Date('2026-06-30T00:00:00.000Z')
  })
  const server = createRemoteExecutorMcpServer(service)
  const client = new Client({ name: 'remote-executor-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const listedTools = await client.listTools()
  const toolNames = listedTools.tools.map((tool) => tool.name).sort()
  assert.deepEqual(toolNames, [...REMOTE_EXECUTOR_TOOL_NAMES].sort())

  const toolsByName = new Map(listedTools.tools.map((tool) => [tool.name, tool]))
  assert.equal(asRecord(toolsByName.get('remote_list_targets')?.annotations).readOnlyHint, true)
  assert.equal(asRecord(toolsByName.get('remote_stop')?.annotations).destructiveHint, true)
  assert.equal(asRecord(toolsByName.get('remote_cancel_job')?.annotations).destructiveHint, true)

  const targets = await client.callTool({
    name: 'remote_list_targets',
    arguments: {}
  })
  assert.equal(targets.isError, undefined)
  assert.equal(asRecord(targets.structuredContent).count, 1)
  const firstTarget = asRecord(asArray(asRecord(targets.structuredContent).targets)[0])
  assert.equal(firstTarget.id, 'mock-gpu')
  assert.equal('password' in firstTarget, false)

  const run = await client.callTool({
    name: 'remote_run',
    arguments: {
      target_id: 'mock-gpu',
      command: ['python', '--version'],
      stdin: 'hello'
    }
  })
  assert.equal(run.isError, undefined)
  const runId = String(asRecord(asRecord(run.structuredContent).run).runId)
  assert.match(runId, /^run_/)

  const poll = await client.callTool({
    name: 'remote_poll',
    arguments: { run_id: runId }
  })
  assert.equal(poll.isError, undefined)
  assert.equal(asRecord(asRecord(poll.structuredContent).run).status, 'succeeded')

  const missing = await client.callTool({
    name: 'remote_probe_target',
    arguments: { target_id: 'missing-target' }
  })
  assert.equal(missing.isError, true)
  assert.equal(asRecord(missing.structuredContent).code, 'target_not_found')
  assert.equal(asRecord(asRecord(missing.structuredContent).error).retryable, false)
})

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
