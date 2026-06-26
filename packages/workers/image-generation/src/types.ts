export const IMAGE_GENERATION_MODES = [
  'text_to_image',
  'image_to_image',
  'variation'
] as const

export type ImageGenerationMode = typeof IMAGE_GENERATION_MODES[number]

export const IMAGE_EDIT_MODES = [
  'inpaint',
  'replace',
  'erase',
  'outpaint',
  'upscale',
  'style_transfer'
] as const

export type ImageEditMode = typeof IMAGE_EDIT_MODES[number]

export const IMAGE_OUTPUT_FORMATS = ['png', 'webp'] as const
export type ImageOutputFormat = typeof IMAGE_OUTPUT_FORMATS[number]

export type ImageSize = {
  width: number
  height: number
}

export type ImageGenerationRecipe = {
  mode: ImageGenerationMode
  prompt: string
  negativePrompt?: string
  size: ImageSize
  stylePreset?: string
  referencePath?: string
  outputFormat?: ImageOutputFormat
}

export type ImageEditIntent = {
  mode: ImageEditMode
  sourcePath: string
  instruction: string
  maskPath?: string
  annotationShapeId?: string
  targetShapeId?: string
  preserve?: Array<'composition' | 'identity' | 'text' | 'layout' | 'palette'>
  outputFormat?: ImageOutputFormat
}

export type ImageGenerationStatus = {
  ok: true
  provider: 'openai-compatible' | 'placeholder'
  configured: boolean
  supportedModes: ImageGenerationMode[]
  supportedEditModes: ImageEditMode[]
  outputDir: string
  artifactDir: string
  warnings: string[]
}

export type ImageGenerationPlanRequest = {
  workspaceRoot: string
  task: string
  modeHint?: ImageGenerationMode
  size?: Partial<ImageSize>
  stylePreset?: string
  referencePath?: string
  canvasId?: string
  threadId?: string
  insertToCanvas?: boolean
}

export type ImageGenerationPlanResult = {
  ok: true
  task: string
  recipe: ImageGenerationRecipe
  suggestedRenderTool: 'image_generation_render'
  suggestedReviewTool: 'image_generation_review'
  artifactPolicy: string
  canvasWorkflow: string[]
  warnings: string[]
}

export type ImageGenerationRenderRequest = {
  workspaceRoot: string
  recipe: ImageGenerationRecipe
  imageId?: string
  outputDir?: string
  reviewReferencePath?: string
  canvasId?: string
  threadId?: string
  insertToCanvas?: boolean
}

export type ImageGenerationRenderResult =
  | {
      ok: true
      status: 'rendered' | 'rendered_placeholder' | 'review_failed'
      outputPath: string
      manifestPath: string
      artifactManifestPath: string
      provider: 'openai-compatible' | 'placeholder'
      review?: ImageGenerationReviewResult
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationReviewRequest = {
  workspaceRoot: string
  outputPath: string
  referencePath?: string
  minOverall?: number
}

export type ImageGenerationSimilarityScore = {
  overall: number
  dimensions: number
  nonEmpty: number
  background: number
  reference?: number
  warnings: string[]
}

export type ImageGenerationReviewResult =
  | {
      ok: true
      score: ImageGenerationSimilarityScore
      repairable: boolean
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'image_unreadable' | 'reference_unreadable'
      message: string
      warnings?: string[]
    }

export type ImageGenerationEditFromCanvasPacketRequest = {
  workspaceRoot: string
  reviewPacketPath?: string
  reviewPacket?: unknown
  outputDir?: string
  imageId?: string
  canvasId?: string
  threadId?: string
}

export type ImageGenerationEditFromCanvasPacketResult =
  | {
      ok: true
      status: 'edited' | 'edited_placeholder'
      intents: ImageEditIntent[]
      outputs: Array<{
        outputPath: string
        manifestPath: string
        artifactManifestPath: string
        provider: 'openai-compatible' | 'placeholder'
      }>
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_packet' | 'no_edit_targets' | 'provider_not_configured' | 'provider_failed' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationReviewPacketRequest = {
  workspaceRoot: string
  manifestPaths: string[]
  packetId?: string
  outputDir?: string
  title?: string
}

export type ImageGenerationReviewPacketResult =
  | {
      ok: true
      packetPath: string
      markdownPath: string
      count: number
      warnings: string[]
    }
  | {
      ok: false
      status: 'invalid_workspace' | 'invalid_request' | 'write_failed'
      message: string
      warnings?: string[]
    }

export type ImageGenerationManifest = {
  version: 1
  renderer: 'sciforge-image-generation-mcp'
  rendererVersion: string
  tool: 'image_generation_render' | 'image_generation_edit_from_canvas_packet'
  createdAt: string
  requestHash: string
  outputPath: string
  canvasId?: string
  threadId?: string
  recipe?: ImageGenerationRecipe
  editIntent?: ImageEditIntent
  provider: 'openai-compatible' | 'placeholder'
  review?: ImageGenerationReviewResult
  warnings: string[]
}
