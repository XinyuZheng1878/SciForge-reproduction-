import { describe, expect, it, vi } from 'vitest'
import {
  IMAGE_GENERATION_MCP_SERVER_ID,
  SCIFORGE_CANVAS_MCP_SERVER_ID,
  SCIENTIFIC_PLOTTING_MCP_SERVER_ID,
  buildSciforgeArtifactFlowPrompt,
  diagnosticsHaveConnectedServers,
  ensureSciforgeArtifactMcpsForChat,
  isCanvasReviewRequest,
  isScientificPlottingRequest,
  shouldUseSciforgeArtifactFlow
} from './sciforge-artifact-chat'

describe('SciForge artifact chat compatibility helpers', () => {
  it('does not route artifact requests in the renderer chat layer', () => {
    expect(isScientificPlottingRequest('生成一个季度数据图表')).toBe(false)
    expect(isCanvasReviewRequest('按照我标注的内容修改图片')).toBe(false)
    expect(shouldUseSciforgeArtifactFlow('帮我做一个ppt')).toBe(false)
  })

  it('does not inject hidden workflow prompts', () => {
    const prompt = buildSciforgeArtifactFlowPrompt('帮我画一张季度数据图表', {
      workspaceRoot: '/Users/yhh/Downloads/test_yhh/622test',
      canvasId: 'thread-abc123',
      threadId: 'abc123'
    })

    expect(prompt).toBe('帮我画一张季度数据图表')
    expect(prompt).not.toContain('[SciForge artifact workflow]')
    expect(prompt).not.toContain('sciforge_canvas_insert_artifact')
  })

  it('does not write MCP config based on chat keywords', async () => {
    const writeConfig = vi.fn(async () => undefined)
    const result = await ensureSciforgeArtifactMcpsForChat({
      text: '帮我画一张季度数据图表',
      workspaceRoot: '/tmp/workspace',
      readConfig: async () => ({ content: '{"servers":{}}' }),
      writeConfig,
      buildScientificPlottingConfig: async () => ({
        ok: true,
        config: { servers: { [SCIENTIFIC_PLOTTING_MCP_SERVER_ID]: { command: 'app' } } }
      }),
      buildSciforgeCanvasConfig: async () => ({
        ok: true,
        config: { servers: { [SCIFORGE_CANVAS_MCP_SERVER_ID]: { command: 'app' } } }
      }),
      buildImageGenerationConfig: async () => ({
        ok: true,
        config: { servers: { [IMAGE_GENERATION_MCP_SERVER_ID]: { command: 'app' } } }
      })
    })

    expect(result).toEqual({ status: 'skipped' })
    expect(writeConfig).not.toHaveBeenCalled()
  })

  it('keeps MCP diagnostics helper available for registry/status tests', () => {
    expect(diagnosticsHaveConnectedServers({
      mcpServers: [
        { id: IMAGE_GENERATION_MCP_SERVER_ID, status: 'connected' },
        { id: SCIFORGE_CANVAS_MCP_SERVER_ID, status: 'connected' }
      ]
    }, [IMAGE_GENERATION_MCP_SERVER_ID, SCIFORGE_CANVAS_MCP_SERVER_ID])).toBe(true)
    expect(diagnosticsHaveConnectedServers({
      mcpServers: [{ id: IMAGE_GENERATION_MCP_SERVER_ID, status: 'connected' }]
    }, [IMAGE_GENERATION_MCP_SERVER_ID, SCIENTIFIC_PLOTTING_MCP_SERVER_ID])).toBe(false)
  })
})
