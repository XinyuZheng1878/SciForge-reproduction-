import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationDisplayText,
  buildImageGenerationWorkflowPrompt,
  isCreateImageRequest,
  resolveCreateImageWorkflow
} from './image-generation-chat'

describe('image generation chat compatibility helpers', () => {
  it('does not route image requests in the renderer chat layer', () => {
    expect(isCreateImageRequest('生成一张图片')).toBe(false)
    expect(isCreateImageRequest('画一张流程图')).toBe(false)
    expect(isCreateImageRequest('做一个 PPT')).toBe(false)
  })

  it('builds the explicit image-generation MCP workflow prompt', () => {
    const prompt = buildImageGenerationWorkflowPrompt('一张神经网络架构示意图', {
      workspaceRoot: '/tmp/workspace',
      canvasId: 'thread-canvas',
      threadId: 'canvas'
    })

    expect(prompt).toContain('[SciForge image generation workflow]')
    expect(prompt).toContain('一张神经网络架构示意图')
    expect(prompt).toContain('image_generation_plan')
    expect(prompt).toContain('image_generation_render')
    expect(prompt).toContain('"workspaceRoot":"/tmp/workspace"')
    expect(prompt).toContain('"canvasId":"thread-canvas"')
    expect(prompt).toContain('"threadId":"canvas"')
    expect(prompt).toContain('"insertToCanvas":true')
  })

  it('keeps legacy return shapes stable for unused callers', () => {
    expect(buildImageGenerationDisplayText('一张神经网络架构示意图')).toBe('一张神经网络架构示意图')
    expect(resolveCreateImageWorkflow('生成一个季度数据图表', { isScientificPlottingRequest: () => true }))
      .toBe('image-generation')
  })
})
