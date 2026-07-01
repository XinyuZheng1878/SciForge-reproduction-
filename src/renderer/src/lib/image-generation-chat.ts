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

function imageGenerationWorkflowSharedArgs(
  options: ImageGenerationWorkflowPromptOptions
): Record<string, string | boolean> {
  const sharedArgs: Record<string, string | boolean> = {}
  const workspaceRoot = options.workspaceRoot?.trim()
  const canvasId = options.canvasId?.trim()
  const threadId = options.threadId?.trim()
  if (workspaceRoot) sharedArgs.workspaceRoot = workspaceRoot
  if (canvasId) {
    sharedArgs.canvasId = canvasId
    sharedArgs.insertToCanvas = true
  }
  if (threadId) sharedArgs.threadId = threadId
  return sharedArgs
}

export function buildImageGenerationWorkflowPrompt(
  text: string,
  options: ImageGenerationWorkflowPromptOptions = {}
): string {
  const task = text.trim() || 'Create an image.'
  const sharedArgs = imageGenerationWorkflowSharedArgs(options)
  const sharedArgsHint = Object.keys(sharedArgs).length > 0
    ? `Use these shared arguments when calling image_generation_plan and image_generation_render: ${JSON.stringify(sharedArgs)}.`
    : 'If workspaceRoot is required and is not already configured by the MCP launch, ask the user to choose a workspace before rendering.'

  return [
    '[SciForge image generation workflow]',
    '',
    'The user explicitly selected Image Generation in the composer. Treat the request below as an image artifact creation task, not a normal chat answer.',
    '',
    'User image request:',
    task,
    '',
    sharedArgsHint,
    '',
    'Workflow:',
    '1. Call `image_generation_plan` with `task` set to the user image request to produce a controlled render recipe.',
    '2. Call `image_generation_render` with the planned `recipe` to write the image artifact and manifest. Set `insertToCanvas` to true when a canvasId is available; this marks the artifact for Canvas handoff, while Canvas insertion is handled by Canvas tools or the GUI.',
    '3. Summarize the generated artifact path(s) and any review notes. Do not claim success without a tool result.'
  ].join('\n')
}
