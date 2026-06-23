import { describe, expect, it } from 'vitest'
import {
  buildSyncedWorkspaceIntelMcpJson,
  buildWorkspaceIntelMcpArgs,
  buildWorkspaceIntelMcpServerConfig,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  workspaceIntelMcpEnabledTools,
  workspaceIntelMcpEnv,
  type WorkspaceIntelMcpLaunchConfig
} from './workspace-intel-mcp-config'
import { GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG } from './workspace-intel-mcp-server'
import { WorkspaceIntelToolNames } from '../../packages/workers/workspace-intel/src/contract'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const launch: WorkspaceIntelMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(workspaceRoot = '/tmp/workspace'): AppSettingsV1 {
  const claw = defaultClawSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot,
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    claw
  }
}

describe('workspace intel MCP config', () => {
  it('builds Electron-as-Node args and exposes the full read-only tool surface', () => {
    const settings = createSettings('/tmp/project')

    expect(buildWorkspaceIntelMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/workspace-intel-mcp-node-entry.js',
      GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG,
      '--include-global-skills',
      '--workspace-root',
      '/tmp/project'
    ])
    expect(workspaceIntelMcpEnabledTools()).toEqual([...WorkspaceIntelToolNames])
  })

  it('preserves string env while forcing Electron node mode', () => {
    expect(workspaceIntelMcpEnv({
      KEEP_ME: 'yes',
      DROP_ME: 'no',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      KEEP_ME: 'yes',
      DROP_ME: 'no',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('removes GUI-managed workspace intel servers from external Kun mcp.json', () => {
    const synced = buildSyncedWorkspaceIntelMcpJson({
      timeouts: { connect_timeout: 3, execute_timeout: 30, read_timeout: 90 },
      servers: {
        keep_existing: { command: 'node', args: ['server.js'] },
        [GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]: {
          env: { EXISTING: 'kept' },
          enabled_tools: ['old_tool']
        }
      }
    }, createSettings('/tmp/project'), launch)
    const servers = synced.servers as Record<string, Record<string, unknown>>

    expect(synced.timeouts).toEqual({ connect_timeout: 3, execute_timeout: 30, read_timeout: 90 })
    expect(servers.keep_existing).toEqual({ command: 'node', args: ['server.js'] })
    expect(servers[GUI_WORKSPACE_INTEL_MCP_SERVER_NAME]).toBeUndefined()
  })

  it('builds the runtime server config with read-only workspace tools', () => {
    const config = buildWorkspaceIntelMcpServerConfig(createSettings('/tmp/project'), launch)

    expect(config).toMatchObject({
      args: buildWorkspaceIntelMcpArgs(createSettings('/tmp/project'), launch),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      enabled: true,
      disabled: false,
      enabled_tools: workspaceIntelMcpEnabledTools(),
      disabled_tools: []
    })
  })
})
