import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import {
  PAPER_RADAR_MCP_TOOL_CONTRACTS,
  PAPER_RADAR_STATS_RESOURCE_URI,
  PAPER_RADAR_SYNC_STATE_RESOURCE_URI,
  paperRadarMcpToolContractSchema,
  paperRadarPaperResourceUri,
  paperRadarProfileResourceUri
} from './contract.js'
import { createPaperRadarMcpServer } from './mcp-server.js'
import { createPaperRadarFixtureFetch, createPaperRadarService } from './service.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

test('Paper Radar MCP server exposes structured tools and JSON resources', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'paper-radar-mcp-'))
  const service = createPaperRadarService({
    dbPath: join(tempDir, 'paper-radar.sqlite'),
    profilesPath: join(tempDir, 'profiles.json'),
    fetchImpl: createPaperRadarFixtureFetch(fixturesDir),
    now: () => new Date('2026-06-17T00:00:00.000Z')
  })
  const server = createPaperRadarMcpServer(service)
  const client = new Client({ name: 'paper-radar-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
    service.close()
    await rm(tempDir, { recursive: true, force: true })
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'gui_paper_digest',
    'gui_paper_profile_list',
    'gui_paper_profile_save',
    'gui_paper_profile_sync',
    'gui_paper_rank',
    'gui_paper_search'
  ])
  for (const tool of tools.tools) {
    const contract = toolContract(tool.name)
    paperRadarMcpToolContractSchema.parse(contract)
    assert.deepEqual(tool.annotations, contract.annotations)
    assert.equal(contract.annotations.readOnlyHint, contract.sideEffect === 'read_only')
    assert.equal(contract.annotations.destructiveHint, contract.sideEffect === 'destructive')
  }

  const savePreview = await client.callTool({
    name: 'gui_paper_profile_save',
    arguments: {
      name: 'protein focus',
      keywords: ['protein design', 'diffusion', 'single-cell'],
      exclude_keywords: [],
      arxiv_categories: ['cs.LG', 'q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      dry_run: true
    }
  })
  assert.equal(asRecord(savePreview.structuredContent).saved, false)
  assert.equal(asRecord(savePreview.structuredContent).preview, true)
  assert.match(String(asRecord(savePreview.structuredContent).auditId), /^pr_audit_\d{6}$/)

  const saveBlocked = await client.callTool({
    name: 'gui_paper_profile_save',
    arguments: {
      name: 'protein focus',
      keywords: ['protein design', 'diffusion', 'single-cell'],
      exclude_keywords: [],
      arxiv_categories: ['cs.LG', 'q-bio'],
      biorxiv_subjects: ['bioinformatics']
    }
  })
  assert.equal(saveBlocked.isError, true)
  assert.equal(asRecord(saveBlocked.structuredContent).code, 'confirmation_required')
  assert.equal(asRecord(asRecord(saveBlocked.structuredContent).confirmationRequired).required, true)
  assert.equal(asRecord(asRecord(saveBlocked.structuredContent).confirmationRequired).tool, 'gui_paper_profile_save')
  assert.match(String(asRecord(saveBlocked.structuredContent).auditId), /^pr_audit_\d{6}$/)

  await client.callTool({
    name: 'gui_paper_profile_save',
    arguments: {
      name: 'protein focus',
      keywords: ['protein design', 'diffusion', 'single-cell'],
      exclude_keywords: [],
      arxiv_categories: ['cs.LG', 'q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      confirmed: true,
      confirmation_id: 'save-ok'
    }
  })

  const syncPreview = await client.callTool({
    name: 'gui_paper_profile_sync',
    arguments: {
      profile: 'protein_focus',
      from: '2026-06-16',
      to: '2026-06-17',
      max_records: 10,
      preview: true
    }
  })
  assert.equal(asRecord(syncPreview.structuredContent).dryRun, false)
  assert.equal(asRecord(syncPreview.structuredContent).preview, true)

  const syncBlocked = await client.callTool({
    name: 'gui_paper_profile_sync',
    arguments: {
      profile: 'protein_focus',
      from: '2026-06-16',
      to: '2026-06-17',
      max_records: 10
    }
  })
  assert.equal(syncBlocked.isError, true)
  assert.equal(asRecord(syncBlocked.structuredContent).code, 'confirmation_required')
  assert.equal(asRecord(asRecord(syncBlocked.structuredContent).confirmationRequired).required, true)
  assert.equal(asRecord(asRecord(syncBlocked.structuredContent).confirmationRequired).tool, 'gui_paper_profile_sync')
  assert.match(String(asRecord(syncBlocked.structuredContent).auditId), /^pr_audit_\d{6}$/)

  const sync = await client.callTool({
    name: 'gui_paper_profile_sync',
    arguments: {
      profile: 'protein_focus',
      from: '2026-06-16',
      to: '2026-06-17',
      max_records: 10,
      confirmed: true,
      confirmation_id: 'sync-ok'
    }
  })
  assert.equal(asRecord(sync.structuredContent).upserted, 2)
  assert.match(String(asRecord(sync.structuredContent).auditId), /^pr_audit_\d{6}$/)

  const search = await client.callTool({
    name: 'gui_paper_search',
    arguments: { query: 'protein diffusion', sources: ['arxiv'], top_k: 5 }
  })
  assert.equal(asRecord(search.structuredContent).count, 1)

  const missing = await client.callTool({
    name: 'gui_paper_rank',
    arguments: { profile: 'missing_profile' }
  })
  assert.equal(missing.isError, true)
  assert.equal(asRecord(missing.structuredContent).code, 'not_found')

  const resources = await client.listResources()
  const resourceUris = resources.resources.map((resource) => resource.uri)
  assert.ok(resourceUris.includes(PAPER_RADAR_STATS_RESOURCE_URI))
  assert.ok(resourceUris.includes(PAPER_RADAR_SYNC_STATE_RESOURCE_URI))
  assert.ok(resourceUris.includes(paperRadarProfileResourceUri('protein_focus')))
  assert.ok(resourceUris.includes(paperRadarPaperResourceUri('arxiv:2606.12345')))

  const templates = await client.listResourceTemplates()
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === 'paper-radar://paper/{id}'))
  assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === 'paper-radar://profile/{name}'))

  const statsResource = await client.readResource({ uri: PAPER_RADAR_STATS_RESOURCE_URI })
  const stats = JSON.parse(asRecord(statsResource.contents[0]).text as string) as Record<string, unknown>
  assert.equal(asRecord(stats.stats).papers, 2)

  const profileResource = await client.readResource({ uri: paperRadarProfileResourceUri('protein_focus') })
  const profile = JSON.parse(asRecord(profileResource.contents[0]).text as string) as Record<string, unknown>
  assert.equal(asRecord(profile.profile).name, 'protein_focus')

  const paperResource = await client.readResource({ uri: paperRadarPaperResourceUri('arxiv:2606.12345') })
  const paper = JSON.parse(asRecord(paperResource.contents[0]).text as string) as Record<string, unknown>
  assert.equal(asRecord(paper.paper).id, 'arxiv:2606.12345')
})

test('Paper Radar CLI stdio server can sync from fixtures without network', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'paper-radar-stdio-'))
  const client = new Client({ name: 'paper-radar-stdio-test', version: '0.1.0' })
  t.after(async () => {
    await client.close().catch(() => undefined)
    await rm(tempDir, { recursive: true, force: true })
  })

  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      'tsx',
      'src/cli.ts',
      '--quiet',
      '--db',
      join(tempDir, 'paper-radar.sqlite'),
      '--profiles',
      join(tempDir, 'profiles.json'),
      '--fixture-dir',
      fixturesDir
    ],
    cwd: packageRoot,
    stderr: 'pipe'
  }), { timeout: 20_000 })

  await client.callTool({
    name: 'gui_paper_profile_save',
    arguments: {
      name: 'protein_focus',
      keywords: ['protein design', 'diffusion', 'single-cell'],
      exclude_keywords: [],
      arxiv_categories: ['cs.LG', 'q-bio'],
      biorxiv_subjects: ['bioinformatics'],
      confirmed: true,
      confirmation_id: 'save-stdio-ok'
    }
  }, undefined, { timeout: 20_000 })

  const sync = await client.callTool({
    name: 'gui_paper_profile_sync',
    arguments: {
      profile: 'protein_focus',
      from: '2026-06-16',
      to: '2026-06-17',
      max_records: 10,
      confirmed: true,
      confirmation_id: 'sync-stdio-ok'
    }
  }, undefined, { timeout: 20_000 })
  assert.equal(asRecord(sync.structuredContent).upserted, 2)

  const digest = await client.callTool({
    name: 'gui_paper_digest',
    arguments: {
      profile: 'protein_focus',
      from: '2026-06-16',
      top_k: 10
    }
  }, undefined, { timeout: 20_000 })
  assert.equal(asRecord(digest.structuredContent).count, 2)

  const statsResource = await client.readResource({ uri: PAPER_RADAR_STATS_RESOURCE_URI }, { timeout: 20_000 })
  const stats = JSON.parse(asRecord(statsResource.contents[0]).text as string) as Record<string, unknown>
  assert.equal(asRecord(stats.stats).papers, 2)
})

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function toolContract(name: string): typeof PAPER_RADAR_MCP_TOOL_CONTRACTS[keyof typeof PAPER_RADAR_MCP_TOOL_CONTRACTS] {
  assert.ok(name in PAPER_RADAR_MCP_TOOL_CONTRACTS, `Missing Paper Radar tool contract for ${name}`)
  return PAPER_RADAR_MCP_TOOL_CONTRACTS[name as keyof typeof PAPER_RADAR_MCP_TOOL_CONTRACTS]
}
