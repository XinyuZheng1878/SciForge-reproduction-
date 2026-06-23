import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedComputerUseMcpJson,
  COMPUTER_USE_DEFAULT_AGENT_ID_ENV,
  COMPUTER_USE_DEFAULT_SESSION_ID_ENV,
  COMPUTER_USE_DEFAULT_THREAD_ID_ENV,
  COMPUTER_USE_DEFAULT_TURN_ID_ENV,
  COMPUTER_USE_MCP_AGENT_RUNTIME_IDS,
  COMPUTER_USE_STATUS_PATH_ENV,
  computerUseMcpEnv,
  computerUseMcpEnvForLaunch,
  resolveComputerUseMcpCommand,
  resolveComputerUseMcpNodeEntryPath,
  syncComputerUseMcpConfig,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'

const launch: ComputerUseMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('computer use MCP config', () => {
  it('tracks every agent runtime as a computer-use MCP integration target', () => {
    expect(COMPUTER_USE_MCP_AGENT_RUNTIME_IDS).toEqual(['kun', 'codex', 'claude'])
  })

  it('writes the gui_computer_use server without dropping existing MCP servers', () => {
    const synced = buildSyncedComputerUseMcpJson(
      {
        timeouts: { connect_timeout: 1 },
        servers: {
          context7: {
            command: 'npx',
            args: ['-y', '@upstash/context7-mcp'],
            env: {},
            url: null
          }
        }
      },
      launch
    )

    expect(synced.servers).toMatchObject({
      context7: {
        command: 'npx'
      },
      gui_computer_use: {
        command: resolveComputerUseMcpCommand(launch),
        args: [
          resolveComputerUseMcpNodeEntryPath(launch),
          '--gui-computer-use-mcp-server'
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        },
        enabled: true,
        enabled_tools: ['computer_use']
      }
    })
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('preserves manually configured env while forcing Electron node mode', () => {
    expect(computerUseMcpEnv({
      CUSTOM_COMPUTER_USE_ENV: 'keep',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      CUSTOM_COMPUTER_USE_ENV: 'keep',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('injects the runtime status path into launched MCP server env', () => {
    const env = computerUseMcpEnvForLaunch({
      ...launch,
      statusPath: '/tmp/sciforge-computer-use-status.json',
      defaultAgentId: 'claude:thread-1',
      defaultThreadId: 'thread-1',
      defaultTurnId: 'turn-1',
      defaultSessionId: 'session-1'
    })

    expect(env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      [COMPUTER_USE_STATUS_PATH_ENV]: '/tmp/sciforge-computer-use-status.json',
      [COMPUTER_USE_DEFAULT_AGENT_ID_ENV]: 'claude:thread-1',
      [COMPUTER_USE_DEFAULT_THREAD_ID_ENV]: 'thread-1',
      [COMPUTER_USE_DEFAULT_TURN_ID_ENV]: 'turn-1',
      [COMPUTER_USE_DEFAULT_SESSION_ID_ENV]: 'session-1'
    })
  })

  it('marks the synced server disabled when computer use is off', () => {
    const synced = buildSyncedComputerUseMcpJson({}, launch, false)

    expect(synced.servers).toMatchObject({
      gui_computer_use: {
        enabled: false,
        disabled: true,
        enabled_tools: ['computer_use']
      }
    })
  })

  it('syncs mcp.json on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ds-gui-computer-use-mcp-'))
    const kunDir = join(root, '.kun')
    const mcpJsonPath = join(kunDir, 'mcp.json')
    await mkdir(kunDir, { recursive: true })
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        servers: {
          existing: {
            command: '/bin/echo',
            args: ['ok'],
            env: {},
            url: null
          }
        }
      }),
      'utf8'
    )

    await syncComputerUseMcpConfig(launch, { mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        },
        gui_computer_use: {
          command: resolveComputerUseMcpCommand(launch),
          args: [
            resolveComputerUseMcpNodeEntryPath(launch),
            '--gui-computer-use-mcp-server'
          ],
          env: {
            ELECTRON_RUN_AS_NODE: '1'
          }
        }
      }
    })
  })
})
