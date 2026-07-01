import { describe, expect, it } from 'vitest'
import {
  buildMcpConfig,
  customMcpConfigFragment,
  mcpConfigHasServer,
  mcpMarketplaceItemsFromConfigAndDiagnostics,
  mergeMcpJsonConfig,
  scientificSkillsRootSourceLabel,
  scientificSkillsRootSourceTitle,
  skillMarketplaceItemsFromDiscoveredSkills
} from './PluginMarketplaceView'

describe('PluginMarketplaceView MCP config helpers', () => {
  it('merges recommended MCP servers into JSON config without dropping existing fields', () => {
    const existing = JSON.stringify({
      timeouts: { read_timeout: 120 },
      servers: {
        gui_schedule: { command: '/Applications/SciForge.app' }
      }
    })

    const merged = mergeMcpJsonConfig(
      existing,
      buildMcpConfig('playwright', 'npx', ['-y', '@playwright/mcp@latest'])
    )
    const parsed = JSON.parse(merged.text) as Record<string, any>

    expect(merged.alreadyExists).toBe(false)
    expect(parsed.timeouts).toEqual({ read_timeout: 120 })
    expect(parsed.servers.gui_schedule).toEqual({ command: '/Applications/SciForge.app' })
    expect(parsed.servers.playwright).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      trustScope: 'user'
    })
    expect(mcpConfigHasServer(merged.text, 'playwright')).toBe(true)
  })

  it('preserves full local runtime capability config when adding recommended MCP servers', () => {
    const existing = JSON.stringify({
      serve: { approvalPolicy: 'auto' },
      servers: {
        stale_root_server: { command: 'stale' }
      },
      capabilities: {
        mcp: {
          enabled: true,
          servers: {
            gui_schedule: { command: '/Applications/SciForge.app' }
          }
        }
      }
    })

    const merged = mergeMcpJsonConfig(
      existing,
      buildMcpConfig('image_generation', '/Applications/SciForge.app', ['image-generation'])
    )
    const parsed = JSON.parse(merged.text) as Record<string, any>

    expect(merged.alreadyExists).toBe(false)
    expect(parsed.servers).toBeUndefined()
    expect(parsed.serve).toEqual({ approvalPolicy: 'auto' })
    expect(parsed.capabilities.mcp.enabled).toBe(true)
    expect(parsed.capabilities.mcp.servers.stale_root_server).toEqual({ command: 'stale' })
    expect(parsed.capabilities.mcp.servers.gui_schedule).toEqual({ command: '/Applications/SciForge.app' })
    expect(parsed.capabilities.mcp.servers.image_generation).toMatchObject({
      enabled: true,
      transport: 'stdio',
      command: '/Applications/SciForge.app',
      args: ['image-generation']
    })
    expect(mcpConfigHasServer(merged.text, 'image_generation')).toBe(true)
  })

  it('detects duplicate MCP servers instead of appending old-style snippets', () => {
    const fragment = buildMcpConfig('context7', 'npx', ['-y', '@upstash/context7-mcp@latest'])
    const first = mergeMcpJsonConfig('', fragment)
    const second = mergeMcpJsonConfig(first.text, fragment)

    expect(first.alreadyExists).toBe(false)
    expect(second.alreadyExists).toBe(true)
    expect(JSON.parse(second.text).servers.context7).toMatchObject({ command: 'npx' })
  })

  it('accepts custom JSON as either a single server or a local runtime config fragment', () => {
    expect(customMcpConfigFragment(
      'docs',
      '{"transport":"stdio","command":"npx","args":["-y","docs-mcp"]}',
      {}
    )).toEqual({
      servers: {
        docs: {
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'docs-mcp']
        }
      }
    })

    expect(customMcpConfigFragment(
      'github',
      '{"capabilities":{"mcp":{"servers":{"github":{"transport":"stdio","command":"github-mcp"}}}}}',
      {}
    )).toEqual({
      servers: {
        github: {
          transport: 'stdio',
          command: 'github-mcp'
        }
      }
    })
  })

  it('detects MCP servers from full local runtime capability config', () => {
    const content = JSON.stringify({
      capabilities: {
        mcp: {
          servers: {
            github: {
              transport: 'stdio',
              command: 'github-mcp'
            }
          }
        }
      }
    })

    expect(mcpConfigHasServer(content, 'github')).toBe(true)
  })

  it('turns configured MCP servers into personal marketplace items', () => {
    const items = mcpMarketplaceItemsFromConfigAndDiagnostics(
      '{"servers":{"docs":{"transport":"stdio","command":"docs-mcp"}}}',
      null,
      {
        configured: 'Configured',
        connected: 'Connected',
        error: 'Error',
        disabled: 'Disabled'
      }
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'docs',
        kind: 'mcp',
        group: 'personal',
        title: 'docs',
        description: expect.stringContaining('docs-mcp'),
        sourceLabel: 'Configured',
        statusTone: 'default'
      })
    ])
  })

  it('overlays MCP runtime diagnostics onto configured marketplace items', () => {
    const items = mcpMarketplaceItemsFromConfigAndDiagnostics(
      JSON.stringify({
        servers: {
          github: {
            transport: 'stdio',
            command: 'github-mcp'
          },
          disabled_docs: {
            transport: 'stdio',
            command: 'docs-mcp',
            enabled: false
          }
        }
      }),
      {
        mcpServers: [
          { id: 'github', status: 'connected', toolCount: 12 },
          { id: 'bad', status: 'error', lastError: 'missing token' }
        ]
      },
      {
        configured: 'Configured',
        connected: 'Connected',
        error: 'Error',
        disabled: 'Disabled'
      }
    )

    expect(items).toEqual([
      expect.objectContaining({
        id: 'bad',
        sourceLabel: 'Error',
        statusTone: 'error',
        description: expect.stringContaining('missing token')
      }),
      expect.objectContaining({
        id: 'disabled_docs',
        sourceLabel: 'Disabled',
        statusTone: 'warning'
      }),
      expect.objectContaining({
        id: 'github',
        sourceLabel: 'Connected',
        statusTone: 'success',
        description: expect.stringContaining('github-mcp')
      })
    ])
  })
})

describe('skillMarketplaceItemsFromDiscoveredSkills', () => {
  it('turns discovered project and global skills into personal marketplace items', () => {
    const items = skillMarketplaceItemsFromDiscoveredSkills([
      {
        id: 'openspec-apply-change',
        name: 'Openspec Apply Change',
        description: 'Implement tasks from an OpenSpec change.',
        root: '/workspace/.codex/skills/openspec-apply-change',
        entryPath: '/workspace/.codex/skills/openspec-apply-change/SKILL.md',
        scope: 'project',
        legacy: true
      },
      {
        id: 'remotion-best-practices',
        name: 'Remotion Best Practices',
        description: 'Best practices for Remotion.',
        root: '/Users/demo/.agents/skills/remotion-best-practices',
        entryPath: '/Users/demo/.agents/skills/remotion-best-practices/SKILL.md',
        scope: 'global',
        legacy: true
      }
    ], { project: 'Project', global: 'Global' })

    expect(items).toEqual([
      expect.objectContaining({
        id: 'openspec-apply-change',
        group: 'personal',
        title: 'Openspec Apply Change',
        sourceLabel: 'Project'
      }),
      expect.objectContaining({
        id: 'remotion-best-practices',
        group: 'personal',
        title: 'Remotion Best Practices',
        sourceLabel: 'Global'
      })
    ])
  })
})

describe('scientific skills root display labels', () => {
  const labels: Record<string, string> = {
    pluginScientificSkillsRootEnv: 'ENV',
    pluginScientificSkillsRootWorkspaceAgents: 'Workspace .agents',
    pluginScientificSkillsRootWorkspaceSkills: 'Workspace skills',
    pluginScientificSkillsRootGlobalAgents: 'Global .agents'
  }
  const t = (key: string): string => labels[key] ?? key

  it('keeps current roots path-addressable', () => {
    expect(scientificSkillsRootSourceLabel('global-agents', t)).toBe('Global .agents')
    expect(scientificSkillsRootSourceTitle('global-agents', '/Users/demo/.agents/skills', t)).toBe(
      '/Users/demo/.agents/skills'
    )
  })

  it('falls back to unknown source ids without adding legacy root labels', () => {
    expect(scientificSkillsRootSourceLabel('custom-source', t)).toBe('custom-source')
    expect(scientificSkillsRootSourceTitle('custom-source', '/tmp/custom', t)).toBe('/tmp/custom')
  })
})
