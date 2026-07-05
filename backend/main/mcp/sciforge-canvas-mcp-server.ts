import { runSciforgeCanvasMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../../workers/canvas/src/sciforge-canvas-mcp-server'
import { SCIFORGE_CANVAS_MCP_FLAG } from '../../../workers/canvas/src/contract'

export const GUI_SCIFORGE_CANVAS_MCP_LAUNCH_FLAG = SCIFORGE_CANVAS_MCP_FLAG

export async function runSciforgeCanvasMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
