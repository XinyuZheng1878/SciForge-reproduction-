import { PPT_MASTER_MCP_FLAG } from './contract.js'
import { runPptMasterMcpServer } from './server.js'

if (!process.argv.includes(PPT_MASTER_MCP_FLAG)) {
  console.error('[ppt-master-mcp] missing --ppt-master-mcp-server launch flag')
  process.exit(1)
}

await runPptMasterMcpServer()
