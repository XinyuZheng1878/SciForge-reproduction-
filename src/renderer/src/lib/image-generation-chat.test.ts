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

  it('does not inject hidden workflow prompts', () => {
    const prompt = buildImageGenerationWorkflowPrompt('一张神经网络架构示意图', {
      workspaceRoot: '/tmp/workspace',
      canvasId: 'thread-canvas',
      threadId: 'canvas'
    })

    expect(prompt).toBe('一张神经网络架构示意图')
    expect(prompt).not.toContain('[SciForge image generation workflow]')
    expect(prompt).not.toContain('image_generation_render')
  })

  it('keeps legacy return shapes stable for unused callers', () => {
    expect(buildImageGenerationDisplayText('一张神经网络架构示意图')).toBe('一张神经网络架构示意图')
    expect(resolveCreateImageWorkflow('生成一个季度数据图表', { isScientificPlottingRequest: () => true }))
      .toBe('image-generation')
  })
})
