import {
  createPaperRadarService
} from '../../../workers/paper-radar/src/service'
import { startPaperRadarMcpServer } from '../../../workers/paper-radar/src/mcp-server'

export const GUI_PAPER_RADAR_MCP_LAUNCH_FLAG = '--gui-paper-radar-mcp-server'

export async function runPaperRadarMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_PAPER_RADAR_MCP_LAUNCH_FLAG)) return false
  await startPaperRadarMcpServer(createPaperRadarService({
    dbPath: argValue(argv, '--db'),
    profilesPath: argValue(argv, '--profiles'),
    userDataDir: argValue(argv, '--user-data-dir')
  }))
  return true
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value?.trim() || undefined
}
