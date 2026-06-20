import { startResearchSearchMcpServer } from './mcp-server.js';
import { createResearchSearchService, researchSearchConfigFromEnv } from './research-service.js';

const quiet = process.argv.includes('--quiet');
const config = researchSearchConfigFromEnv();
const service = createResearchSearchService(config);

if (!quiet) {
  console.error('[sciforge-research-search] starting MCP stdio server');
  console.error(`[sciforge-research-search] maxResults=${config.maxResults} timeoutMs=${config.timeoutMs}`);
}

await startResearchSearchMcpServer(service);
