import { mkdtemp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
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
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('codex config launch helpers', () => {
  it('prepares app-server stdio launch config and creates CODEX_HOME', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'deepseek-gui-codex-home-'))
    const launch = await prepareCodexAppServerLaunch({
      settings: settings(join(codexHome, 'nested')),
      workspace: '~/project',
      env: {
        PATH: '/bin',
        CODEX_USER_HOME: '/old',
        NO_PROXY: 'example.com'
      }
    })

    expect(launch.command).toBe('codex')
    expect(launch.args).toEqual(['app-server', '--listen', 'stdio://', '--profile', 'deepseek-gui'])
    expect(launch.cwd).toContain('project')
    expect(launch.env.CODEX_HOME).toBe(join(codexHome, 'nested'))
    expect(launch.env.CODEX_USER_HOME).toBeUndefined()
    expect(launch.env.NO_PROXY).toContain('127.0.0.1')
    await expect(stat(join(codexHome, 'nested'))).resolves.toMatchObject({})
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
