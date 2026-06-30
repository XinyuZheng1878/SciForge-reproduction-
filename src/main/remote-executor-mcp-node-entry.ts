import { runRemoteExecutorMcpServerFromArgv } from './remote-executor-mcp-server'

void runRemoteExecutorMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[remote-executor-mcp] missing --gui-remote-executor-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[remote-executor-mcp] server failed:', error)
    process.exit(1)
  })
