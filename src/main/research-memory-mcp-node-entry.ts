import { runResearchMemoryMcpServerFromArgv } from './research-memory-mcp-server'

void runResearchMemoryMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[research-memory-mcp] missing --gui-research-memory-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[research-memory-mcp] server failed:', error)
    process.exit(1)
  })
