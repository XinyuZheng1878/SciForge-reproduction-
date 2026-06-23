import { main as runRuntimeInspectorCli } from '../../packages/workers/runtime-inspector/src/cli'

export const GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG = '--gui-runtime-inspector-mcp-server'

export async function runRuntimeInspectorMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG)) return false
  await runRuntimeInspectorCli(argv.slice(1))
  return true
}
