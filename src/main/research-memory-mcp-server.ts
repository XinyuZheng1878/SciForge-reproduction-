import {
  createResearchMemoryService,
  researchMemoryConfigFromEnv,
  type ResearchMemoryServiceOptions
} from '../../packages/workers/research-memory/src/service'
import { startResearchMemoryMcpServer } from '../../packages/workers/research-memory/src/mcp-server'

export const GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG = '--gui-research-memory-mcp-server'

export async function runResearchMemoryMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG)) return false
  await startResearchMemoryMcpServer(createResearchMemoryService(researchMemoryOptionsFromArgv(argv)))
  return true
}

function researchMemoryOptionsFromArgv(argv: string[]): ResearchMemoryServiceOptions {
  const options = researchMemoryConfigFromEnv()
  const workspaceRoot = argValue(argv, '--workspace-root')
  const memoryRoot = argValue(argv, '--memory-root')
  if (workspaceRoot) options.workspaceRoot = workspaceRoot
  if (memoryRoot) options.memoryRoot = memoryRoot
  return options
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}
