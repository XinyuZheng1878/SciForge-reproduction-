import {
  DEFAULT_MODEL_ROUTER_BASE_URL,
  DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
  type AppSettingsV1,
  type ModelRouterMemberProviderSettingsPatchV1,
  type ModelRouterMemberProviderSettingsV1,
  type ModelRouterSettingsPatchV1,
  type ModelRouterSettingsV1
} from './app-settings-types'

export function defaultModelRouterSettings(): ModelRouterSettingsV1 {
  return {
    enabled: true,
    baseUrl: DEFAULT_MODEL_ROUTER_BASE_URL,
    autoStart: true,
    publicModelAlias: DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS,
    runtimeApiKey: '',
    profiles: {
      default: {
        textReasoner: defaultModelRouterMemberProvider('openai-compatible'),
        translators: {
          vision: defaultModelRouterMemberProvider('qwen-compatible')
        }
      }
    }
  }
}

export function normalizeModelRouterSettings(
  input: ModelRouterSettingsPatchV1 | undefined
): ModelRouterSettingsV1 {
  const defaults = defaultModelRouterSettings()
  const defaultProfile = defaults.profiles.default
  const rawDefaultProfile = input?.profiles?.default
  return {
    enabled: input?.enabled !== false,
    baseUrl: normalizeLocalModelRouterBaseUrl(input?.baseUrl, defaults.baseUrl),
    autoStart: input?.autoStart !== false,
    publicModelAlias: nonEmptyString(input?.publicModelAlias, defaults.publicModelAlias),
    runtimeApiKey: optionalString(input?.runtimeApiKey),
    profiles: {
      default: {
        textReasoner: normalizeModelRouterMemberProvider(
          rawDefaultProfile?.textReasoner,
          defaultProfile.textReasoner
        ),
        translators: {
          vision: normalizeModelRouterMemberProvider(
            rawDefaultProfile?.translators?.vision,
            defaultProfile.translators.vision
          )
        }
      }
    }
  }
}

export function mergeModelRouterSettings(
  current: ModelRouterSettingsV1 | undefined,
  patch: ModelRouterSettingsPatchV1 | undefined
): ModelRouterSettingsV1 {
  const safeCurrent = normalizeModelRouterSettings(current)
  return normalizeModelRouterSettings({
    ...safeCurrent,
    ...(patch ?? {}),
    profiles: {
      default: {
        textReasoner: {
          ...safeCurrent.profiles.default.textReasoner,
          ...(patch?.profiles?.default?.textReasoner ?? {})
        },
        translators: {
          vision: {
            ...safeCurrent.profiles.default.translators.vision,
            ...(patch?.profiles?.default?.translators?.vision ?? {})
          }
        }
      }
    }
  })
}

export function getModelRouterSettings(settings: AppSettingsV1): ModelRouterSettingsV1 {
  return normalizeModelRouterSettings(
    (settings as { modelRouter?: ModelRouterSettingsPatchV1 }).modelRouter
  )
}

export function modelRouterSettingsPatch(
  modelRouter: ModelRouterSettingsPatchV1 | undefined
): { modelRouter?: ModelRouterSettingsPatchV1 } {
  return modelRouter ? { modelRouter } : {}
}

export function resolveRuntimeModelRouterSettings(settings: AppSettingsV1): {
  baseUrl: string
  apiKey: string
  model: string
} {
  const modelRouter = getModelRouterSettings(settings)
  return {
    baseUrl: modelRouter.baseUrl,
    apiKey: modelRouter.runtimeApiKey.trim(),
    model: modelRouter.publicModelAlias
  }
}

function defaultModelRouterMemberProvider(provider: string): ModelRouterMemberProviderSettingsV1 {
  return {
    provider,
    baseUrl: '',
    apiKey: '',
    model: ''
  }
}

function normalizeModelRouterMemberProvider(
  input: ModelRouterMemberProviderSettingsPatchV1 | undefined,
  defaults: ModelRouterMemberProviderSettingsV1
): ModelRouterMemberProviderSettingsV1 {
  return {
    provider: nonEmptyString(input?.provider, defaults.provider),
    baseUrl: optionalString(input?.baseUrl),
    apiKey: optionalString(input?.apiKey),
    model: optionalString(input?.model)
  }
}

function normalizeLocalModelRouterBaseUrl(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
  const baseUrl = raw || fallback
  return baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
