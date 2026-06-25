import { startResearchMemoryMcpServer } from './mcp-server.js'
import {
  createResearchMemoryService,
  researchMemoryConfigFromEnv
} from './service.js'

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

const quiet = process.argv.includes('--quiet')
const workspaceRoot = argValue(process.argv, '--workspace-root')

if (!quiet) {
  console.error('[sciforge-research-memory] starting MCP stdio server')
}

await startResearchMemoryMcpServer(createResearchMemoryService({
  ...researchMemoryConfigFromEnv(),
  ...(workspaceRoot ? { workspaceRoot } : {})
}))
