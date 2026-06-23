import { createWorkflowInternalHttpClient, createWorkflowService } from './service.js'
import { startWorkflowMcpServer } from './mcp-server.js'

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

const quiet = process.argv.includes('--quiet')
const baseUrl = argValue(process.argv, '--base-url') || process.env.GUI_WORKFLOW_INTERNAL_BASE_URL
const secret = argValue(process.argv, '--secret') || process.env.GUI_WORKFLOW_INTERNAL_SECRET

if (!quiet) {
  console.error('[sciforge-workflow] starting MCP stdio server')
}

await startWorkflowMcpServer(createWorkflowService({
  client: createWorkflowInternalHttpClient({
    ...(baseUrl ? { baseUrl } : {}),
    ...(secret ? { secret } : {})
  })
}))
