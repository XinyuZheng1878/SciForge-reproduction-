import { createComputerUseService, type ComputerUseService } from '../../packages/workers/computer-use/src/service'
import { startComputerUseMcpServer } from '../../packages/workers/computer-use/src/mcp-server'
import type {
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackendDiagnostic,
  ComputerUseBindResult,
  ComputerUseSession
} from '../../packages/workers/computer-use/src/contract'
import type { ComputerUseSessionInput } from '../../packages/workers/computer-use/src/lease'
import { COMPUTER_USE_STATUS_PATH_ENV } from './computer-use-mcp-config'
import { recordComputerUseDiagnostic } from './services/computer-use-status'

export const GUI_COMPUTER_USE_MCP_LAUNCH_FLAG = '--gui-computer-use-mcp-server'

export async function runComputerUseMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_COMPUTER_USE_MCP_LAUNCH_FLAG)) return false
  await startComputerUseMcpServer(createStatusRecordingComputerUseService())
  return true
}

function createStatusRecordingComputerUseService(): ComputerUseService {
  const service = createComputerUseService()
  const statusPath = process.env[COMPUTER_USE_STATUS_PATH_ENV]
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (property === 'diagnostics') {
        return async (): Promise<ComputerUseBackendDiagnostic> => {
          const diagnostic = await target.diagnostics()
          await recordComputerUseDiagnostic(statusPath, diagnostic)
          return diagnostic
        }
      }
      if (property === 'bindTarget') {
        return async (input: ComputerUseSessionInput & { targetId: string }): Promise<ComputerUseBindResult> => {
          const result = await target.bindTarget(input)
          await recordComputerUseDiagnostic(statusPath, await target.diagnostics())
          return result
        }
      }
      if (property === 'releaseTarget') {
        return async (sessionId: string, reason?: string): Promise<ComputerUseSession | null> => {
          const result = await target.releaseTarget(sessionId, reason)
          await recordComputerUseDiagnostic(statusPath, await target.diagnostics())
          return result
        }
      }
      if (property === 'executeAction') {
        return async (input: ComputerUseActionRequest): Promise<ComputerUseActionResult> => {
          const result = await target.executeAction(input)
          await recordComputerUseDiagnostic(statusPath, await target.diagnostics())
          return result
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
