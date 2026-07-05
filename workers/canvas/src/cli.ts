import { runSciforgeCanvasMcpServerFromArgv } from './sciforge-canvas-mcp-server.js'

const handled = await runSciforgeCanvasMcpServerFromArgv(process.argv)
if (!handled) {
  console.error('[sciforge-canvas] missing MCP launch flag')
  process.exit(1)
}
