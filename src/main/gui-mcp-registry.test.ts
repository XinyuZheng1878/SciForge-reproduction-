import { describe, expect, it } from 'vitest'
import {
  buildClaudeCodeManagedGuiMcpServers,
  buildCodexManagedGuiMcpServers,
  buildKunManagedGuiMcpServers,
  managedGuiMcpServerNames
} from './gui-mcp-registry'
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
import {
  COMPUTER_USE_MCP_TOOL_NAME,
  COMPUTER_USE_STATUS_PATH_ENV,
  GUI_COMPUTER_USE_MCP_SERVER_NAME
} from './computer-use-mcp-config'

const launch = {
  appPath: '/Applications/SciForge.app/Contents/Resources/app.asar.unpacked',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: true
}

function createSettings(): AppSettingsV1 {
  const schedule = defaultScheduleSettings()
  const workflow = defaultWorkflowSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:4567/v1'
    },
    agents: {
      kun: defaultKunRuntimeSettings(9876)
    },
    workspaceRoot: '/tmp/project',
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
    schedule: {
      ...schedule,
      internal: {
        ...schedule.internal,
        port: 9797,
        secret: 'schedule-secret'
      }
    },
    workflow: {
      ...workflow,
      webhookPort: 9898,
      webhookSecret: 'workflow-secret'
    },
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    claw: defaultClawSettings()
  }
}

describe('GUI MCP runtime registry', () => {
  it('exposes every managed server name that must be stripped from external Kun mcp.json', () => {
    expect(managedGuiMcpServerNames()).toEqual(expect.arrayContaining([
      'gui_schedule',
      'gui_research',
      'gui_workflow',
      'gui_workspace_intel',
      'gui_paper_radar',
      'gui_write_assist',
      'gui_runtime_inspector',
      'gui_computer_use'
    ]))
  })

  it('builds Kun managed server configs from shared descriptors and preserves existing env safely', () => {
    const settings = createSettings()
    const servers = buildKunManagedGuiMcpServers({
      scheduleMcp: { settings, launch },
      workflowMcp: { settings, launch },
      computerUseMcp: {
        launch: {
          ...launch,
          statusPath: '/tmp/computer-use-status.json'
        },
        enabled: false
      }
    }, {
      gui_workflow: {
        env: { WORKFLOW_KEEP: 'yes' }
      }
    })

    expect(servers.gui_schedule).toMatchObject({
      enabled: true,
      command: expect.stringContaining('SciForge Helper'),
      args: expect.arrayContaining(['--gui-schedule-mcp-server', '--base-url', 'http://127.0.0.1:9797']),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: 5000
    })
    expect(servers.gui_workflow).toMatchObject({
      enabled: true,
      args: expect.arrayContaining(['--gui-workflow-mcp-server', '--base-url', 'http://127.0.0.1:9898']),
      env: { WORKFLOW_KEEP: 'yes', ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: 30000
    })
    expect(servers.gui_computer_use).toMatchObject({
      enabled: false,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_COMPUTER_USE_STATUS_PATH: '/tmp/computer-use-status.json'
      }
    })
  })

  it('builds Codex dynamic MCP server configs with contract-derived tools and local secrets', () => {
    const settings = createSettings()
    const servers = buildCodexManagedGuiMcpServers({
      settings,
      scheduleMcp: { settings, launch },
      workflowMcp: { settings, launch },
      workspaceIntelMcp: { settings, launch },
      computerUseMcp: { launch, enabled: false }
    })

    expect(servers.map((server) => server.id)).toEqual([
      'gui_schedule',
      'gui_workflow',
      'gui_workspace_intel'
    ])
    expect(servers.find((server) => server.id === 'gui_schedule')).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_SCHEDULE_INTERNAL_SECRET: 'schedule-secret'
      },
      enabledTools: expect.arrayContaining(['gui_schedule_list', 'gui_schedule_run'])
    })
    expect(servers.find((server) => server.id === 'gui_workflow')).toMatchObject({
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        GUI_WORKFLOW_INTERNAL_SECRET: 'workflow-secret'
      },
      enabledTools: expect.arrayContaining(['gui_workflow_list', 'gui_workflow_run'])
    })
  })

  it('builds Claude Code MCP config from the same computer-use registry entry', () => {
    const servers = buildClaudeCodeManagedGuiMcpServers({
      computerUseMcp: {
        launch: {
          ...launch,
          defaultThreadId: 'thread-1'
        }
      }
    })

    expect(servers.gui_computer_use).toMatchObject({
      type: 'stdio',
      args: expect.arrayContaining(['--gui-computer-use-mcp-server']),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_COMPUTER_USE_DEFAULT_THREAD_ID: 'thread-1'
      },
      timeout: 30000,
      alwaysLoad: true
    })
  })

  it('reuses one computer-use MCP launch contract across Kun, Codex, and Claude Code', () => {
    const sharedLaunch = {
      ...launch,
      statusPath: '/tmp/computer-use-status.json'
    }
    const kun = buildKunManagedGuiMcpServers({
      computerUseMcp: { launch: sharedLaunch }
    })[GUI_COMPUTER_USE_MCP_SERVER_NAME] as Record<string, unknown>
    const codex = buildCodexManagedGuiMcpServers({
      computerUseMcp: { launch: sharedLaunch }
    }).find((server) => server.id === GUI_COMPUTER_USE_MCP_SERVER_NAME)
    const claude = buildClaudeCodeManagedGuiMcpServers({
      computerUseMcp: { launch: sharedLaunch }
    })[GUI_COMPUTER_USE_MCP_SERVER_NAME]

    expect(kun).toMatchObject({
      command: codex?.command,
      args: codex?.args,
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        [COMPUTER_USE_STATUS_PATH_ENV]: '/tmp/computer-use-status.json'
      }
    })
    expect(codex).toMatchObject({
      command: kun.command,
      args: kun.args,
      env: kun.env,
      enabledTools: [COMPUTER_USE_MCP_TOOL_NAME]
    })
    expect(claude).toMatchObject({
      command: codex?.command,
      args: codex?.args,
      env: codex?.env,
      timeout: codex?.timeoutMs
    })
  })
})
