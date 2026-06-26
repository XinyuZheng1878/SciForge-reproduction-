import { describe, expect, it } from 'vitest'
import {
  buildResearchMemoryMcpArgs,
  buildResearchMemoryMcpServerConfig,
  buildSyncedResearchMemoryMcpJson,
  GUI_RESEARCH_MEMORY_MCP_SERVER_NAME,
  researchMemoryMcpEnabledTools,
  researchMemoryMcpEnv,
  type ResearchMemoryMcpLaunchConfig
} from './research-memory-mcp-config'
import { GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG } from './research-memory-mcp-server'
import { ResearchMemoryToolNames } from '../../packages/workers/research-memory/src/contract'
import {
  defaultConnectPhoneSettings,
  defaultRemoteChannelSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../shared/app-settings'

const launch: ResearchMemoryMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(workspaceRoot = '/tmp/workspace'): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings()
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
    remoteChannel: defaultRemoteChannelSettings(),
    connectPhone: defaultConnectPhoneSettings()
  }
}

describe('research memory MCP config', () => {
  it('builds Electron-as-Node args and derives tools from the worker contract', () => {
    const settings = createSettings('/tmp/project')

    expect(buildResearchMemoryMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/research-memory-mcp-node-entry.js',
      GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG,
      '--workspace-root',
      '/tmp/project'
    ])
    expect(researchMemoryMcpEnabledTools()).toEqual([...ResearchMemoryToolNames])
  })

  it('adds memory workspace args when GitHub Memory is configured', () => {
    const settings = {
      ...createSettings('/tmp/project'),
      researchMemory: {
        enabled: true,
        githubRepoUrl: 'git@github.com:org/memory.git',
        branch: 'memory-main',
        localPath: '/tmp/project-memory',
        autoFetch: true,
        defaultForAgents: true
      }
    }

    expect(buildResearchMemoryMcpArgs(settings, launch)).toEqual([
      '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked/out/main/research-memory-mcp-node-entry.js',
      GUI_RESEARCH_MEMORY_MCP_LAUNCH_FLAG,
      '--workspace-root',
      '/tmp/project',
      '--memory-root',
      '/tmp/project-memory',
      '--github-repo-url',
      'git@github.com:org/memory.git',
      '--github-branch',
      'memory-main'
    ])
  })

  it('preserves string env while forcing Electron node mode', () => {
    expect(researchMemoryMcpEnv({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '0'
    })).toEqual({
      KEEP_ME: 'yes',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('removes GUI-managed research memory servers from external local runtime mcp.json', () => {
    const synced = buildSyncedResearchMemoryMcpJson({
      timeouts: { connect_timeout: 3, execute_timeout: 30, read_timeout: 90 },
      servers: {
        keep_existing: { command: 'node', args: ['server.js'] },
        [GUI_RESEARCH_MEMORY_MCP_SERVER_NAME]: {
          env: { EXISTING: 'kept' },
          enabled_tools: ['old_tool']
        }
      }
    }, createSettings('/tmp/project'), launch)
    const servers = synced.servers as Record<string, Record<string, unknown>>

    expect(synced.timeouts).toEqual({ connect_timeout: 3, execute_timeout: 30, read_timeout: 90 })
    expect(servers.keep_existing).toEqual({ command: 'node', args: ['server.js'] })
    expect(servers[GUI_RESEARCH_MEMORY_MCP_SERVER_NAME]).toBeUndefined()
  })

  it('builds a managed research memory MCP server config', () => {
    const config = buildResearchMemoryMcpServerConfig(createSettings('/tmp/project'), launch, {
      env: { EXISTING: 'kept' },
      enabled_tools: ['old_tool']
    })

    expect(config).toMatchObject({
      args: buildResearchMemoryMcpArgs(createSettings('/tmp/project'), launch),
      env: researchMemoryMcpEnv({ EXISTING: 'kept' }),
      enabled: true,
      disabled: false,
      enabled_tools: researchMemoryMcpEnabledTools(),
      disabled_tools: []
    })
  })
})
