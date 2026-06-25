import { describe, expect, it } from 'vitest'
import {
  GUI_PAPER_RADAR_MCP_SERVER_NAME,
  buildPaperRadarMcpArgs,
  buildPaperRadarMcpServerConfig,
  buildSyncedPaperRadarMcpJson,
  paperRadarMcpEnabledTools,
  paperRadarMcpEnv
} from './paper-radar-mcp-config'
import { GUI_PAPER_RADAR_MCP_LAUNCH_FLAG } from './paper-radar-mcp-server'
import { PAPER_RADAR_MCP_TOOL_CONTRACTS } from '../../packages/workers/paper-radar/src/contract'

const launch = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true,
  dbPath: '/Users/example/Library/Application Support/SciForge/paper-radar/paper-radar.sqlite',
  profilesPath: '/Users/example/Library/Application Support/SciForge/paper-radar/profiles.json'
}

describe('Paper Radar MCP config', () => {
  it('derives enabled tools from the worker contract', () => {
    expect(paperRadarMcpEnabledTools()).toEqual(Object.keys(PAPER_RADAR_MCP_TOOL_CONTRACTS))
  })

  it('builds Electron-as-Node args with explicit shared storage paths', () => {
    expect(buildPaperRadarMcpArgs(launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/paper-radar-mcp-node-entry.js',
      GUI_PAPER_RADAR_MCP_LAUNCH_FLAG,
      '--db',
      launch.dbPath,
      '--profiles',
      launch.profilesPath
    ])
  })

  it('preserves string env and enables only Paper Radar tools', () => {
    const config = buildPaperRadarMcpServerConfig(launch, {
      env: {
        KEEP_ME: 'yes',
        DROP_NUMBER: 1
      }
    })

    expect(config.env).toEqual({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '1'
    })
    expect(config.enabled_tools).toEqual(paperRadarMcpEnabledTools())
    expect(config.disabled_tools).toEqual([])
    expect(config.url).toBeNull()
    expect(config.enabled).toBe(true)
    expect(config.disabled).toBe(false)
  })

  it('removes GUI-managed Paper Radar servers from external local runtime mcp.json', () => {
    const synced = buildSyncedPaperRadarMcpJson({
      timeouts: { connect_timeout: 3, execute_timeout: 30, read_timeout: 90 },
      servers: {
        keep_existing: { command: 'node', args: ['server.js'] },
        [GUI_PAPER_RADAR_MCP_SERVER_NAME]: {
          env: { EXISTING: 'kept' },
          enabled_tools: ['old_tool']
        }
      }
    }, launch)
    const servers = synced.servers as Record<string, Record<string, unknown>>

    expect(synced.timeouts).toEqual({ connect_timeout: 3, execute_timeout: 30, read_timeout: 90 })
    expect(servers.keep_existing).toEqual({ command: 'node', args: ['server.js'] })
    expect(servers[GUI_PAPER_RADAR_MCP_SERVER_NAME]).toBeUndefined()
  })
})
