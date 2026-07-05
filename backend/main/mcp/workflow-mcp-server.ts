import {
  createWorkflowInternalHttpClient,
  createWorkflowService
} from '../../../workers/workflow/src/service'
import { startWorkflowMcpServer } from '../../../workers/workflow/src/mcp-server'

export const GUI_WORKFLOW_MCP_LAUNCH_FLAG = '--gui-workflow-mcp-server'

export async function runWorkflowMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_WORKFLOW_MCP_LAUNCH_FLAG)) return false
  const baseUrl = argValue(argv, '--base-url') || process.env.GUI_WORKFLOW_INTERNAL_BASE_URL
  const secret = argValue(argv, '--secret') || process.env.GUI_WORKFLOW_INTERNAL_SECRET
  await startWorkflowMcpServer(createWorkflowService({
    client: createWorkflowInternalHttpClient({
      ...(baseUrl ? { baseUrl } : {}),
      ...(secret ? { secret } : {})
    })
  }))
  return true
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}
