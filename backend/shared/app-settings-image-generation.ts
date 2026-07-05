import type { AppSettingsV1, ImageGenerationSettingsPatchV1, ImageGenerationSettingsV1 } from './app-settings-types'

export function defaultImageGenerationSettings(): ImageGenerationSettingsV1 {
  return {
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    model: 'gpt-image-1'
  }
}

export function normalizeImageGenerationSettings(
  input: ImageGenerationSettingsPatchV1 | undefined
): ImageGenerationSettingsV1 {
  const defaults = defaultImageGenerationSettings()
  return {
    enabled: input?.enabled === true,
    provider: input?.provider === 'openai-compatible' ? 'openai-compatible' : defaults.provider,
    baseUrl: optionalString(input?.baseUrl),
    apiKey: optionalString(input?.apiKey),
    model: nonEmptyString(input?.model, defaults.model)
  }
}

export function mergeImageGenerationSettings(
  current: ImageGenerationSettingsV1 | undefined,
  patch: ImageGenerationSettingsPatchV1 | undefined
): ImageGenerationSettingsV1 {
  return normalizeImageGenerationSettings({
    ...normalizeImageGenerationSettings(current),
    ...(patch ?? {})
  })
}

export function getImageGenerationSettings(settings: AppSettingsV1): ImageGenerationSettingsV1 {
  return normalizeImageGenerationSettings(
    (settings as { imageGeneration?: ImageGenerationSettingsPatchV1 }).imageGeneration
  )
}

export function imageGenerationSettingsPatch(
  patch: ImageGenerationSettingsPatchV1 | undefined
): { imageGeneration?: ImageGenerationSettingsPatchV1 } {
  return patch ? { imageGeneration: patch } : {}
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
