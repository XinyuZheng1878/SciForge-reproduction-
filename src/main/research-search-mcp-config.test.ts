import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSyncedResearchSearchMcpJson,
  researchSearchMcpEnv,
  resolveResearchSearchMcpCommand,
  resolveResearchSearchMcpNodeEntryPath,
  syncResearchSearchMcpConfig,
  type ResearchSearchMcpLaunchConfig
} from './research-search-mcp-config'

const launch: ResearchSearchMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('research search MCP config', () => {
  it('writes the gui_research server without dropping existing MCP servers', () => {
    const synced = buildSyncedResearchSearchMcpJson(
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
      gui_research: {
        command: resolveResearchSearchMcpCommand(launch),
        args: [
          resolveResearchSearchMcpNodeEntryPath(launch),
          '--gui-research-mcp-server'
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1'
        },
        enabled: true,
        enabled_tools: ['research_search']
      }
    })
    expect(synced.timeouts).toEqual({ connect_timeout: 1 })
  })

  it('preserves manually configured research env while forcing Electron node mode', () => {
    expect(researchSearchMcpEnv({
      SCIFORGE_RESEARCH_MAX_RESULTS: '5',
      TAVILY_API_KEY: 'from-process'
    }, {
      TAVILY_API_KEY: 'from-config',
      CUSTOM_RESEARCH_ENV: 'keep'
    })).toEqual({
      SCIFORGE_RESEARCH_MAX_RESULTS: '5',
      TAVILY_API_KEY: 'from-config',
      CUSTOM_RESEARCH_ENV: 'keep',
      ELECTRON_RUN_AS_NODE: '1'
    })
  })

  it('syncs mcp.json on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ds-gui-research-mcp-'))
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

    await syncResearchSearchMcpConfig(launch, { mcpJsonPath })

    const json = JSON.parse(await readFile(mcpJsonPath, 'utf8')) as Record<string, unknown>
    expect(json).toMatchObject({
      servers: {
        existing: {
          command: '/bin/echo'
        },
        gui_research: {
          command: resolveResearchSearchMcpCommand(launch),
          args: [
            resolveResearchSearchMcpNodeEntryPath(launch),
            '--gui-research-mcp-server'
          ],
          env: {
            ELECTRON_RUN_AS_NODE: '1'
          }
        }
      }
    })
  })
})
