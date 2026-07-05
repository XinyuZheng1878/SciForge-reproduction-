import { runPaperRadarMcpServerFromArgv } from './paper-radar-mcp-server'

void runPaperRadarMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[paper-radar-mcp] missing --gui-paper-radar-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[paper-radar-mcp] server failed:', error)
    process.exit(1)
  })
