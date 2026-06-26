import { runSciforgeCanvasMcpServerFromArgv } from './sciforge-canvas-mcp-server'

void runSciforgeCanvasMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[sciforge-canvas-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[sciforge-canvas-mcp] server failed:', error)
    process.exit(1)
  })
