import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

import { ResearchMemoryToolNames } from './contract.js'
import { createResearchMemoryMcpServer } from './mcp-server.js'
import { createResearchMemoryService } from './service.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('serves research-memory tools and artifact calls over MCP', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'research-memory-mcp-'))
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  const service = createResearchMemoryService({
    workspaceRoot,
    nowIso: () => '2026-06-25T12:00:00.000Z'
  })
  const server = createResearchMemoryMcpServer(service)
  const client = new Client({ name: 'research-memory-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [...ResearchMemoryToolNames].sort()
  )

  const upsert = await client.callTool({
    name: 'gui_research_memory_artifact_upsert',
    arguments: {
      artifact: {
        id: 'EXP-mcp-upsert',
        title: 'MCP upsert',
        summary: 'Artifact written through the MCP protocol.',
        evidence_level: 'observation',
        claim_scope: 'local-note',
        risk_level: 'low',
        references: [],
        tags: ['mcp']
      }
    }
  })
  assert.equal(upsert.isError, undefined)
  const structuredUpsert = asRecord(upsert.structuredContent)
  assert.equal(structuredUpsert.ok, true)
  assert.equal(structuredUpsert.wrote, true)
  assert.equal(asRecord(structuredUpsert.artifact).id, 'EXP-mcp-upsert')

  const list = await client.callTool({
    name: 'gui_research_memory_artifact_list',
    arguments: { tag: 'mcp' }
  })
  assert.equal(list.isError, undefined)
  const structuredList = asRecord(list.structuredContent)
  assert.equal(structuredList.ok, true)
  assert.equal(structuredList.count, 1)
  assert.equal(asRecord((structuredList.artifacts as unknown[])[0]).id, 'EXP-mcp-upsert')

  const indexText = await readFile(join(workspaceRoot, '.agent', 'artifacts.yml'), 'utf8')
  assert.match(indexText, /EXP-mcp-upsert/)
})

test('research-memory MCP stdio server starts from the package CLI', async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'research-memory-stdio-'))
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  const client = new Client({ name: 'research-memory-stdio-test', version: '0.1.0' })
  t.after(async () => {
    await client.close()
  })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/cli.ts', '--quiet', '--workspace-root', workspaceRoot],
    cwd: packageRoot,
    stderr: 'pipe'
  }), { timeout: 20_000 })

  const tools = await client.listTools(undefined, { timeout: 20_000 })
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [...ResearchMemoryToolNames].sort()
  )

  const status = await client.callTool({
    name: 'gui_research_memory_status',
    arguments: {}
  }, undefined, { timeout: 20_000 })
  assert.equal(status.isError, undefined)
  const structuredStatus = asRecord(status.structuredContent)
  assert.equal(structuredStatus.ok, true)
  assert.equal(structuredStatus.artifactCount, 0)
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
