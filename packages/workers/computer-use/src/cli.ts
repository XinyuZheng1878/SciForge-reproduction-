import { startComputerUseMcpServer } from './mcp-server.js'

const quiet = process.argv.includes('--quiet')

if (!quiet) {
  console.error('[sciforge-computer-use] starting MCP stdio server')
}

await startComputerUseMcpServer()
