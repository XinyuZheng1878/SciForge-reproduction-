export type ImageGenerationWorkflowPromptOptions = {
  canvasId?: string
  threadId?: string
  workspaceRoot?: string
}

export type CreateImageWorkflowKind = 'scientific-plotting' | 'image-generation'

export function isCreateImageRequest(text: string): boolean {
  void text
  return false
}

export function resolveCreateImageWorkflow(
  text: string,
  options: { isScientificPlottingRequest: (text: string) => boolean }
): CreateImageWorkflowKind {
  void text
  void options
  return 'image-generation'
}

export function buildImageGenerationDisplayText(text: string): string {
  return text.trim() || '创建图片'
}

export function buildImageGenerationWorkflowPrompt(
  text: string,
  options: ImageGenerationWorkflowPromptOptions = {}
): string {
  void options
  return text.trim()
}
