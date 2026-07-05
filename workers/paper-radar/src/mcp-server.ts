import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js'

import {
  PAPER_RADAR_MCP_SERVER_NAME,
  PAPER_RADAR_MCP_SERVER_VERSION,
  PAPER_RADAR_MCP_TOOL_CONTRACTS,
  PAPER_RADAR_PAPER_RESOURCE_URI_TEMPLATE,
  PAPER_RADAR_PROFILE_RESOURCE_URI_TEMPLATE,
  PAPER_RADAR_STATS_RESOURCE_URI,
  PAPER_RADAR_SYNC_STATE_RESOURCE_URI,
  PaperRadarWorkerError,
  paperDigestToolInputSchema,
  paperProfileListToolInputSchema,
  paperProfileSaveToolInputSchema,
  paperProfileSyncToolInputSchema,
  paperRadarErrorPayloadFromUnknown,
  paperRadarPaperResourceUri,
  paperRadarProfileResourceUri,
  paperRankToolInputSchema,
  paperSearchToolInputSchema,
  type PaperRadarErrorPayload
} from './contract.js'
import {
  createPaperRadarService,
  type PaperDigestResult,
  type PaperProfileListResult,
  type PaperProfileSaveResult,
  type PaperProfileSyncResult,
  type PaperRadarService,
  type PaperRankResult,
  type PaperSearchResult
} from './service.js'

type McpTextToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export interface StartPaperRadarMcpServerOptions {
  transport?: Transport
}

export function createPaperRadarMcpServer(
  service: PaperRadarService = createPaperRadarService()
): McpServer {
  const server = new McpServer(
    { name: PAPER_RADAR_MCP_SERVER_NAME, version: PAPER_RADAR_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_paper_profile_list', {
    description: 'List Paper Radar topic profiles from the shared SciForge Paper Radar profile store.',
    inputSchema: paperProfileListToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_profile_list.annotations
  }, async (args, extra) => {
    try {
      const input = paperProfileListToolInputSchema.parse(args)
      const result = service.listProfiles(input, { signal: extra.signal })
      return textAndStructured(renderProfiles(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to list Paper Radar profiles.')
    }
  })

  server.registerTool('gui_paper_profile_save', {
    description: 'Save a Paper Radar topic profile. Use dry_run or preview to inspect normalization without writing profiles.json; real writes require confirmed=true.',
    inputSchema: paperProfileSaveToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_profile_save.annotations
  }, async (args, extra) => {
    try {
      const input = paperProfileSaveToolInputSchema.parse(args)
      const result = service.saveProfile(input, { signal: extra.signal })
      return textAndStructured(renderProfileSave(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to save Paper Radar profile.')
    }
  })

  server.registerTool('gui_paper_profile_sync', {
    description: 'Sync arXiv and bioRxiv metadata for a Paper Radar profile into the local SQLite store. Use dry_run or preview to inspect source queries without fetching or writing; real syncs require confirmed=true.',
    inputSchema: paperProfileSyncToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_profile_sync.annotations
  }, async (args, extra) => {
    try {
      const input = paperProfileSyncToolInputSchema.parse(args)
      const result = await service.syncProfile(input, { signal: extra.signal })
      return textAndStructured(renderProfileSync(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to sync Paper Radar profile.')
    }
  })

  server.registerTool('gui_paper_search', {
    description: 'Search the local Paper Radar SQLite FTS index for papers. This reads local metadata only.',
    inputSchema: paperSearchToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_search.annotations
  }, async (args, extra) => {
    try {
      const input = paperSearchToolInputSchema.parse(args)
      const result = service.search(input, { signal: extra.signal })
      return textAndStructured(renderPaperSearch(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to search Paper Radar papers.')
    }
  })

  server.registerTool('gui_paper_rank', {
    description: 'Rank local Paper Radar papers against a topic profile and optional query or keyword overrides.',
    inputSchema: paperRankToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_rank.annotations
  }, async (args, extra) => {
    try {
      const input = paperRankToolInputSchema.parse(args)
      const result = service.rank(input, { signal: extra.signal })
      return textAndStructured(renderPaperRank(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to rank Paper Radar papers.')
    }
  })

  server.registerTool('gui_paper_digest', {
    description: 'Build a digest from locally stored Paper Radar papers using a topic profile and optional keyword overrides.',
    inputSchema: paperDigestToolInputSchema,
    annotations: PAPER_RADAR_MCP_TOOL_CONTRACTS.gui_paper_digest.annotations
  }, async (args, extra) => {
    try {
      const input = paperDigestToolInputSchema.parse(args)
      const result = service.digest(input, { signal: extra.signal })
      return textAndStructured(renderPaperDigest(result), { ok: true, ...result })
    } catch (error) {
      return toolError(error, 'Failed to build Paper Radar digest.')
    }
  })

  registerPaperRadarResources(server, service)
  return server
}

export async function startPaperRadarMcpServer(
  service: PaperRadarService = createPaperRadarService(),
  options: StartPaperRadarMcpServerOptions = {}
): Promise<void> {
  const server = createPaperRadarMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function registerPaperRadarResources(server: McpServer, service: PaperRadarService): void {
  server.registerResource('paper_radar_stats', PAPER_RADAR_STATS_RESOURCE_URI, {
    title: 'Paper Radar stats',
    description: 'Paper Radar worker diagnostics, storage paths, and local SQLite paper counts.',
    mimeType: 'application/json'
  }, async (_uri, extra) => {
    try {
      return jsonResource(PAPER_RADAR_STATS_RESOURCE_URI, {
        ok: true,
        ...service.diagnostics({ signal: extra.signal })
      })
    } catch (error) {
      return jsonErrorResource(PAPER_RADAR_STATS_RESOURCE_URI, error, 'Failed to read Paper Radar stats.')
    }
  })

  server.registerResource('paper_radar_sync_state', PAPER_RADAR_SYNC_STATE_RESOURCE_URI, {
    title: 'Paper Radar sync state',
    description: 'Persisted source sync markers from the Paper Radar SQLite database.',
    mimeType: 'application/json'
  }, async (_uri, extra) => {
    try {
      return jsonResource(PAPER_RADAR_SYNC_STATE_RESOURCE_URI, {
        ok: true,
        ...service.syncState({ signal: extra.signal })
      })
    } catch (error) {
      return jsonErrorResource(PAPER_RADAR_SYNC_STATE_RESOURCE_URI, error, 'Failed to read Paper Radar sync state.')
    }
  })

  server.registerResource('paper_radar_profile', new ResourceTemplate(PAPER_RADAR_PROFILE_RESOURCE_URI_TEMPLATE, {
    list: async (extra) => {
      const result = service.listProfiles({}, { signal: extra.signal })
      return {
        resources: result.profiles.map((profile) => ({
          uri: paperRadarProfileResourceUri(profile.name),
          name: `paper_radar_profile_${profile.name}`,
          title: profile.name,
          description: profile.description ?? `Paper Radar profile ${profile.name}`,
          mimeType: 'application/json'
        }))
      }
    },
    complete: {
      name: async (value) => service.listProfiles({})
        .profiles
        .map((profile) => profile.name)
        .filter((name) => name.startsWith(value))
        .slice(0, 50)
    }
  }), {
    title: 'Paper Radar profile',
    description: 'A single Paper Radar topic profile by name.',
    mimeType: 'application/json'
  }, async (uri, variables, extra) => {
    const name = decodeUriTemplateVariable(String(variables.name ?? ''))
    try {
      return jsonResource(uri.toString(), {
        ok: true,
        profile: service.getProfile(name, { signal: extra.signal })
      })
    } catch (error) {
      return jsonErrorResource(uri.toString(), error, `Failed to read Paper Radar profile ${name}.`)
    }
  })

  server.registerResource('paper_radar_paper', new ResourceTemplate(PAPER_RADAR_PAPER_RESOURCE_URI_TEMPLATE, {
    list: async (extra) => {
      const papers = service.listPaperResources(50, { signal: extra.signal })
      return {
        resources: papers.map((paper) => ({
          uri: paperRadarPaperResourceUri(paper.id),
          name: `paper_radar_paper_${paper.id.replace(/[^A-Za-z0-9_-]+/g, '_')}`,
          title: paper.title,
          description: `${paper.source} paper ${paper.externalId}`,
          mimeType: 'application/json'
        }))
      }
    },
    complete: {
      id: async (value) => service.listPaperResources(100)
        .map((paper) => paper.id)
        .filter((id) => id.startsWith(value))
        .slice(0, 50)
    }
  }), {
    title: 'Paper Radar paper',
    description: 'A single locally stored Paper Radar paper by id.',
    mimeType: 'application/json'
  }, async (uri, variables, extra) => {
    const id = decodeUriTemplateVariable(String(variables.id ?? ''))
    try {
      return jsonResource(uri.toString(), {
        ok: true,
        paper: service.getPaper(id, { signal: extra.signal })
      })
    } catch (error) {
      return jsonErrorResource(uri.toString(), error, `Failed to read Paper Radar paper ${id}.`)
    }
  })
}

function textAndStructured(
  text: string,
  structuredContent: Record<string, unknown>
): McpTextToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

function toolError(error: unknown, fallbackReason: string): McpTextToolResult {
  return paperRadarToolError(paperRadarErrorPayloadFromUnknown(error, {
    reason: fallbackReason,
    retryable: error instanceof PaperRadarWorkerError ? error.retryable : false,
    suggestion: 'Check the Paper Radar request and local database configuration.'
  }))
}

function paperRadarToolError(
  payload: PaperRadarErrorPayload,
  extra: Record<string, unknown> = {}
): McpTextToolResult {
  const {
    code,
    reason,
    retryable,
    suggestion,
    ...details
  } = payload
  return {
    content: [{ type: 'text', text: `${code}: ${reason}` }],
    isError: true,
    structuredContent: {
      ok: false,
      code,
      reason,
      retryable,
      suggestion,
      ...details,
      error: payload,
      ...extra
    }
  }
}

function jsonResource(uri: string, value: Record<string, unknown>): ReadResourceResult {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2)
    }]
  }
}

function jsonErrorResource(uri: string, error: unknown, fallbackReason: string): ReadResourceResult {
  const payload = paperRadarErrorPayloadFromUnknown(error, {
    reason: fallbackReason,
    retryable: error instanceof PaperRadarWorkerError ? error.retryable : false,
    suggestion: 'Check the Paper Radar resource URI and local database configuration.'
  })
  return jsonResource(uri, {
    ok: false,
    code: payload.code,
    reason: payload.reason,
    retryable: payload.retryable,
    suggestion: payload.suggestion,
    ...(payload.confirmationRequired ? { confirmationRequired: payload.confirmationRequired } : {}),
    error: payload
  })
}

function renderProfiles(result: PaperProfileListResult): string {
  return result.count > 0
    ? `Found ${result.count} Paper Radar profile(s).`
    : 'No Paper Radar profiles are configured.'
}

function renderProfileSave(result: PaperProfileSaveResult): string {
  if (result.preview) {
    const label = result.dryRun ? 'Dry run' : 'Preview'
    return `${label}: profile would be saved as ${result.profile.name}.`
  }
  return `Paper Radar profile saved: ${result.profile.name}.`
}

function renderProfileSync(result: PaperProfileSyncResult): string {
  if (result.preview) {
    return `Preview: profile ${result.profile} would sync ${result.planned.length} source(s) from ${result.from} to ${result.to}.`
  }
  return `Synced profile ${result.profile}: fetched ${result.fetched}, upserted ${result.upserted}, skipped ${result.skipped}.`
}

function renderPaperSearch(result: PaperSearchResult): string {
  return result.count > 0
    ? `Found ${result.count} local Paper Radar paper(s).`
    : 'No local Paper Radar papers matched.'
}

function renderPaperRank(result: PaperRankResult): string {
  return result.count > 0
    ? `Ranked ${result.count} Paper Radar paper(s) for ${result.profile}.`
    : `No Paper Radar papers ranked above zero for ${result.profile}.`
}

function renderPaperDigest(result: PaperDigestResult): string {
  return result.count > 0
    ? `Built Paper Radar digest with ${result.count} paper(s) for ${result.profile}.`
    : `Paper Radar digest for ${result.profile} is empty.`
}

function decodeUriTemplateVariable(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
