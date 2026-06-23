import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  WORKSPACE_FILE_RESOURCE_URI_TEMPLATE,
  WORKSPACE_TREE_RESOURCE_URI,
  workspaceFileResourceUri
} from './contract.js'
import { createWorkspaceIntelMcpServer } from './mcp-server.js'
import { createWorkspaceIntelService } from './service.js'

test('serves structured workspace tool results and resource reads over MCP', async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'workspace-intel-mcp-'))
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(workspaceRoot, { recursive: true })
  await writeFile(join(workspaceRoot, 'notes.txt'), 'hello from MCP\n', 'utf8')
  await writeFile(join(tempRoot, 'outside.txt'), 'outside\n', 'utf8')

  const service = createWorkspaceIntelService({ workspaceRoot })
  const server = createWorkspaceIntelMcpServer(service)
  const client = new Client({ name: 'workspace-intel-test', version: '0.1.0' })
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
  assert.ok(tools.tools.some((tool) => tool.name === 'gui_workspace_read'))

  const read = await client.callTool({
    name: 'gui_workspace_read',
    arguments: { path: 'notes.txt' }
  })
  const structuredRead = asRecord(read.structuredContent)
  assert.equal(structuredRead.ok, true)
  assert.equal(structuredRead.relativePath, 'notes.txt')
  assert.match(String(structuredRead.content), /hello from MCP/)

  const failure = await client.callTool({
    name: 'gui_workspace_read',
    arguments: { path: '../outside.txt' }
  })
  assert.equal(failure.isError, true)
  const structuredFailure = asRecord(failure.structuredContent)
  assert.equal(structuredFailure.ok, false)
  assert.equal(asRecord(structuredFailure.error).code, 'path_outside_workspace')

  const resources = await client.listResources()
  assert.ok(resources.resources.some((resource) => resource.uri === WORKSPACE_TREE_RESOURCE_URI))
  const templates = await client.listResourceTemplates()
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === WORKSPACE_FILE_RESOURCE_URI_TEMPLATE))

  const treeResource = await client.readResource({ uri: WORKSPACE_TREE_RESOURCE_URI })
  const tree = JSON.parse(String(treeResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(tree.ok, true)

  const fileResource = await client.readResource({ uri: workspaceFileResourceUri('notes.txt') })
  const file = JSON.parse(String(fileResource.contents[0]?.text)) as Record<string, unknown>
  assert.equal(file.ok, true)
  assert.match(String(file.content), /hello from MCP/)
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
