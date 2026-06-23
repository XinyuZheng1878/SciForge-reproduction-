import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  DEFAULT_MODEL_ROUTER_PROVIDER_ID,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { codexRuntimeEnv, expandHome, prepareCodexAppServerLaunch } from './codex-config'

function settings(codexHome: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'codex',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: {
        ...defaultCodexRuntimeSettings(),
        codexHome,
        extraArgs: ['--profile', 'deepseek-gui']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('codex config launch helpers', () => {
  it('prepares app-server stdio launch config and creates CODEX_HOME', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const managedHome = join(codexHome, 'nested')
    await mkdir(managedHome, { recursive: true })
    await writeFile(
      join(managedHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai_proxy]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareCodexAppServerLaunch({
      settings: settings(managedHome),
      workspace: '~/project',
      env: {
        OPENAI_API_KEY: 'sk-openai',
        DEEPSEEK_API_KEY: 'sk-deepseek',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        QWEN_API_KEY: 'sk-qwen',
        DASHSCOPE_API_KEY: 'sk-dashscope',
        OPENAI_MODEL: 'gpt-5',
        DEEPSEEK_MODEL: 'deepseek-chat',
        ANTHROPIC_MODEL: 'opus',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'bailian/deepseek-v4-flash',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'bailian/deepseek-v4-flash',
        MODEL_PROVIDER: 'anthropic',
        DEEPSEEK_GUI_RUNTIME_API_KEY: 'stale-runtime-key',
        PATH: '/bin',
        CODEX_USER_HOME: '/old',
        CODEX_CONFIG_HOME: '/old-config',
        NO_PROXY: 'example.com'
      }
    })

    expect(launch.command).toBe('codex')
    expect(launch.args).toEqual(['app-server', '--listen', 'stdio://'])
    expect(launch.cwd).toContain('project')
    expect(launch.env.CODEX_HOME).toBe(managedHome)
    expect(launch.env.CODEX_USER_HOME).toBeUndefined()
    expect(launch.env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(launch.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(launch.env.QWEN_API_KEY).toBeUndefined()
    expect(launch.env.DASHSCOPE_API_KEY).toBeUndefined()
    expect(launch.env.OPENAI_MODEL).toBeUndefined()
    expect(launch.env.DEEPSEEK_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(launch.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(launch.env.MODEL_PROVIDER).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.DEEPSEEK_GUI_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.NO_PROXY).toContain('127.0.0.1')
    await expect(stat(managedHome)).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'sessions'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'memories'))).resolves.toMatchObject({})
    await expect(stat(join(managedHome, 'logs'))).resolves.toMatchObject({})

    const config = await readFile(join(managedHome, 'config.toml'), 'utf8')
    expect(config).toContain(`model = "${DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS}"`)
    expect(config).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(config).toContain(`[model_providers.${DEFAULT_MODEL_ROUTER_PROVIDER_ID}]`)
    expect(config).toContain('name = "SciForge Model Router"')
    expect(config).toContain('base_url = "http://127.0.0.1:49876/v1"')
    expect(config).toContain('env_key = "SCIFORGE_RUNTIME_API_KEY"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).not.toContain('api.openai.com')
    expect(config).not.toContain('sk-')
    expect(config).not.toContain('OPENAI_API_KEY')
  })

  it('drops Codex runtime-only profile args before launching app-server', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        agents: {
          ...settings(codexHome).agents,
          codex: {
            ...defaultCodexRuntimeSettings(),
            codexHome,
            extraArgs: [
              '--profile-v2',
              '--profile',
              'deepseek-gui',
              '-p',
              'legacy-profile',
              '--config',
              'features.experimental=true'
            ]
          }
        }
      },
      env: {}
    })

    expect(launch.args).toEqual([
      'app-server',
      '--listen',
      'stdio://',
      '--config',
      'features.experimental=true'
    ])
  })

  it('writes the shared research MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome),
      env: {
        SCIFORGE_RESEARCH_MAX_RESULTS: '7',
        SCIFORGE_RESEARCH_TIMEOUT_MS: '12000'
      },
      researchMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.gui_research]')
    expect(config).toContain('command = "/tmp/deepseek-gui-test-app/SciForge"')
    expect(config).toContain('args = ["/tmp/deepseek-gui-test-app/out/main/research-search-mcp-node-entry.js", "--gui-research-mcp-server"]')
    expect(config).toContain('ELECTRON_RUN_AS_NODE = "1"')
    expect(config).toContain('SCIFORGE_RESEARCH_MAX_RESULTS = "7"')
    expect(config).toContain('SCIFORGE_RESEARCH_TIMEOUT_MS = "12000"')
  })

  it('writes the shared schedule MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        schedule: {
          ...defaultScheduleSettings(),
          internal: {
            port: 9797,
            secret: 'schedule-secret'
          }
        }
      },
      scheduleMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    expect(launch.env.GUI_SCHEDULE_INTERNAL_SECRET).toBe('schedule-secret')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.gui_schedule]')
    expect(config).toContain('command = "/tmp/deepseek-gui-test-app/SciForge"')
    expect(config).toContain('args = ["/tmp/deepseek-gui-test-app/out/main/claw-schedule-mcp-node-entry.js", "--gui-schedule-mcp-server", "--base-url", "http://127.0.0.1:9797"]')
    expect(config).toContain('ELECTRON_RUN_AS_NODE = "1"')
    expect(config).not.toContain('schedule-secret')
  })

  it('writes the shared workflow MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        workflow: {
          ...defaultWorkflowSettings(),
          enabled: true,
          webhookPort: 9898,
          webhookSecret: 'workflow-secret'
        }
      },
      workflowMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    expect(launch.env.GUI_WORKFLOW_INTERNAL_SECRET).toBe('workflow-secret')
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.gui_workflow]')
    expect(config).toContain('command = "/tmp/deepseek-gui-test-app/SciForge"')
    expect(config).toContain('args = ["/tmp/deepseek-gui-test-app/out/main/workflow-mcp-node-entry.js", "--gui-workflow-mcp-server", "--base-url", "http://127.0.0.1:9898"]')
    expect(config).toContain('ELECTRON_RUN_AS_NODE = "1"')
    expect(config).not.toContain('workflow-secret')
  })

  it('writes the shared workspace intel MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        workspaceRoot: '/tmp/codex-workspace'
      },
      workspaceIntelMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.gui_workspace_intel]')
    expect(config).toContain('command = "/tmp/deepseek-gui-test-app/SciForge"')
    expect(config).toContain('args = ["/tmp/deepseek-gui-test-app/out/main/workspace-intel-mcp-node-entry.js", "--gui-workspace-intel-mcp-server", "--include-global-skills", "--workspace-root", "/tmp/codex-workspace"]')
    expect(config).toContain('ELECTRON_RUN_AS_NODE = "1"')
  })

  it('writes the shared computer-use MCP server into managed Codex config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(codexHome),
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    expect(launch.codexHome).toBe(codexHome)
    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.gui_computer_use]')
    expect(config).toContain('command = "/tmp/deepseek-gui-test-app/SciForge"')
    expect(config).toContain('args = ["/tmp/deepseek-gui-test-app/out/main/computer-use-mcp-node-entry.js", "--gui-computer-use-mcp-server"]')
    expect(config).toContain('ELECTRON_RUN_AS_NODE = "1"')
  })

  it('does not write the shared computer-use MCP server when computer use is disabled', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        computerUse: {
          enabled: false,
          runtimeEnabled: {
            kun: true,
            codex: true,
            claude: true
          },
          backend: 'global-native',
          experimentalAppScopedBackend: false
        }
      },
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_computer_use]')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('does not write the shared computer-use MCP server when Codex runtime access is disabled', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    await prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        computerUse: {
          enabled: true,
          runtimeEnabled: {
            kun: true,
            codex: false,
            claude: true
          },
          backend: 'global-native',
          experimentalAppScopedBackend: false
        }
      },
      computerUseMcpLaunch: {
        appPath: '/tmp/deepseek-gui-test-app',
        execPath: '/tmp/deepseek-gui-test-app/SciForge',
        isPackaged: false
      }
    })

    const config = await readFile(join(codexHome, 'config.toml'), 'utf8')
    expect(config).not.toContain('[mcp_servers.gui_computer_use]')
    expect(config).not.toContain('computer-use-mcp-node-entry')
  })

  it('uses the managed Codex home instead of a persisted global Codex home', async () => {
    const settingsCodexHome = await mkdtemp(join(tmpdir(), 'global-codex-home-'))
    const managedCodexHome = await mkdtemp(join(tmpdir(), 'project-codex-home-'))
    await writeFile(
      join(settingsCodexHome, 'config.toml'),
      [
        'model = "gpt-5"',
        'model_provider = "openai"',
        '[model_providers.openai]',
        'base_url = "https://api.openai.com/v1"',
        'env_key = "OPENAI_API_KEY"'
      ].join('\n')
    )

    const launch = await prepareCodexAppServerLaunch({
      settings: settings(settingsCodexHome),
      managedCodexHome,
      env: {
        OPENAI_API_KEY: 'sk-global',
        DEEPSEEK_GUI_RUNTIME_API_KEY: 'stale-runtime-key'
      }
    })

    expect(launch.codexHome).toBe(managedCodexHome)
    expect(launch.env.CODEX_HOME).toBe(managedCodexHome)
    expect(launch.env.OPENAI_API_KEY).toBeUndefined()
    expect(launch.env.SCIFORGE_RUNTIME_API_KEY).toBe('local-runtime-router-key')
    expect(launch.env.DEEPSEEK_GUI_RUNTIME_API_KEY).toBe('local-runtime-router-key')

    const managedConfig = await readFile(join(managedCodexHome, 'config.toml'), 'utf8')
    expect(managedConfig).toContain(`model_provider = "${DEFAULT_MODEL_ROUTER_PROVIDER_ID}"`)
    expect(managedConfig).toContain('base_url = "http://127.0.0.1:49876/v1"')

    const persistedGlobalConfig = await readFile(join(settingsCodexHome, 'config.toml'), 'utf8')
    expect(persistedGlobalConfig).toContain('api.openai.com')
    expect(persistedGlobalConfig).not.toContain(DEFAULT_MODEL_ROUTER_PROVIDER_ID)
  })

  it('rejects non-local Model Router URLs', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))

    await expect(prepareCodexAppServerLaunch({
      settings: {
        ...settings(codexHome),
        modelRouter: {
          ...defaultModelRouterSettings(),
          baseUrl: 'https://router.example.com/v1',
          publicModelAlias: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
          runtimeApiKey: 'local-runtime-router-key'
        }
      },
      env: {}
    })).rejects.toThrow('Codex Model Router base URL must be local')
  })

  it('keeps external env clean and appends loopback no_proxy entries', () => {
    const env = codexRuntimeEnv({
      CODEX_CONFIG_HOME: '/old',
      no_proxy: 'localhost'
    }, '/tmp/codex-home')

    expect(env.CODEX_HOME).toBe('/tmp/codex-home')
    expect(env.CODEX_CONFIG_HOME).toBeUndefined()
    expect(env.no_proxy).toContain('localhost')
    expect(env.no_proxy).toContain('127.0.0.1')
    expect(env.no_proxy).toContain('::1')
  })

  it('expands home paths without rewriting non-home paths', () => {
    expect(expandHome('/tmp/codex')).toBe('/tmp/codex')
    expect(expandHome('')).toBe('')
    expect(expandHome('~/codex')).toContain('codex')
  })
})
