import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  createResearchSearchService,
  type ResearchSearchService
} from './research-service.js';
import type { ResearchDomain, ResearchIntent, ResearchSourceKind } from './types.js';

export function createResearchSearchMcpServer(service: ResearchSearchService = createResearchSearchService()): McpServer {
  const server = new McpServer(
    { name: 'sciforge-research-search', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );

  server.registerTool('research_search', {
    description: [
      'Explore an AI4S or scientific research direction using arXiv, bioRxiv, Semantic Scholar, CNS official sites, and configured web search.',
      'Use it for latest progress, baselines, SOTA, datasets, code, or research gap discovery.',
      'One call expands the query and searches multiple enabled sources; normally call it once per user request, then synthesize the result.',
      'The returned structured data is internal evidence for the assistant; synthesize it instead of showing raw JSON unless requested.'
    ].join(' '),
    inputSchema: {
      query: z.string().min(1),
      intent: z.enum(['overview', 'latest', 'baseline', 'sota', 'dataset', 'code', 'gap']).optional(),
      domain: z.enum(['ai4s', 'biology', 'chemistry', 'materials', 'physics', 'climate', 'general']).optional(),
      sinceYear: z.number().int().min(1991).max(3000).optional(),
      maxResults: z.number().int().min(1).max(service.config.maxResults).optional(),
      sources: z.array(z.enum(['arxiv', 'biorxiv', 'semantic_scholar', 'web', 'cns'])).optional()
    }
  }, async (args, extra) => {
    try {
      const result = await service.search({
        query: args.query,
        intent: args.intent as ResearchIntent | undefined,
        domain: args.domain as ResearchDomain | undefined,
        sinceYear: args.sinceYear,
        maxResults: args.maxResults,
        sources: args.sources as ResearchSourceKind[] | undefined,
        signal: extra.signal
      });
      return {
        content: [{
          type: 'text',
          text: renderResearchSummary(result)
        }],
        structuredContent: result
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `research_search failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  });

  return server;
}

export async function startResearchSearchMcpServer(service: ResearchSearchService = createResearchSearchService()): Promise<void> {
  const server = createResearchSearchMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function renderResearchSummary(result: Awaited<ReturnType<ResearchSearchService['search']>>): string {
  const paperCount = result.papers.length;
  const webCount = result.webResults.length;
  const providers = result.diagnostics
    .filter((diagnostic) => diagnostic.enabled)
    .map((diagnostic) => `${diagnostic.id}:${diagnostic.available ? 'ok' : 'unavailable'}`)
    .join(', ');
  return [
    `Found ${paperCount} paper result(s) and ${webCount} web result(s).`,
    `Intent: ${result.interpretedIntent.intent}; domain: ${result.interpretedIntent.domain}.`,
    providers ? `Providers: ${providers}.` : ''
  ].filter(Boolean).join(' ');
}
