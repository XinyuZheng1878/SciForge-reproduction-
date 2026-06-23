import { runWorkflowMcpServerFromArgv } from './workflow-mcp-server'

void runWorkflowMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[workflow-mcp] missing --gui-workflow-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[workflow-mcp] server failed:', error)
    process.exit(1)
  })
