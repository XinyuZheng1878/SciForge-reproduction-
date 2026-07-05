import { runImageGenerationMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../../workers/image-generation/src/mcp-server'

export async function runImageGenerationMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
