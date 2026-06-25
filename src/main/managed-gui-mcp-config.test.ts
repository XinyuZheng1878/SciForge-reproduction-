import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildExternalLocalRuntimeMcpJson,
  buildManagedGuiLocalRuntimeMcpServerConfig,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

const descriptor: ManagedGuiMcpDescriptor = {
  serverName: 'gui_test',
  legacyServerNames: ['gui_test_legacy'],
  nodeEntry: 'out/main/test-mcp-node-entry.js',
  launchFlag: '--gui-test-mcp-server',
  timeoutMs: 12_345,
  enabledTools: () => ['test_tool']
}

const launch: ManagedGuiMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('managed GUI MCP config helpers', () => {
  it('resolves the local runtime MCP JSON path under the existing SciForge data dir', () => {
    expect(resolveLocalRuntimeMcpJsonPath()).toBe(join(homedir(), '.sciforge', 'mcp.json'))
  })

  it('builds local runtime MCP server configs with the runtime transport contract', () => {
    expect(buildManagedGuiLocalRuntimeMcpServerConfig({
      descriptor,
      launch,
      args: ['/entry.js', '--gui-test-mcp-server'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      existing: {
        env: { OLD: 'drop' },
        metadata: 'keep'
      },
      enabled: false
    })).toMatchObject({
      enabled: false,
      transport: 'stdio',
      command: expect.stringContaining('SciForge'),
      args: ['/entry.js', '--gui-test-mcp-server'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      trustScope: 'user',
      timeoutMs: 12_345,
      metadata: 'keep'
    })
  })

  it('strips GUI-managed servers from external local runtime mcp.json without dropping user servers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sciforge-managed-mcp-'))
    const runtimeDir = join(root, '.sciforge')
    const mcpJsonPath = join(runtimeDir, 'mcp.json')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(
      mcpJsonPath,
      JSON.stringify({
        timeouts: { connect_timeout: 1 },
        servers: {
          keep_user_server: { command: 'node', args: ['server.js'] },
          gui_test: { command: 'old-managed' },
          gui_test_legacy: { command: 'old-legacy-managed' }
        }
      }),
      'utf8'
    )

    expect(buildExternalLocalRuntimeMcpJson({
      servers: {
        keep_user_server: { command: 'node' },
        gui_test: { command: 'old-managed' }
      }
    }, ['gui_test'])).toEqual({
      servers: {
        keep_user_server: { command: 'node' }
      }
    })

    await syncExternalLocalRuntimeMcpJson(mcpJsonPath, ['gui_test', 'gui_test_legacy'])

    const synced = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(synced).toMatchObject({
      timeouts: { connect_timeout: 1 },
      servers: {
        keep_user_server: { command: 'node', args: ['server.js'] }
      }
    })
    expect((synced.servers as Record<string, unknown>).gui_test).toBeUndefined()
    expect((synced.servers as Record<string, unknown>).gui_test_legacy).toBeUndefined()
  })
})
