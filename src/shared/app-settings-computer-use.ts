import type {
  AgentRuntimeId,
  AppSettingsV1,
  ComputerUseBackendPreference,
  ComputerUseSettingsPatchV1,
  ComputerUseSettingsV1
} from './app-settings-types'

export const DEFAULT_COMPUTER_USE_BACKEND: ComputerUseBackendPreference = 'global-native'

export function defaultComputerUseSettings(): ComputerUseSettingsV1 {
  return {
    enabled: true,
    runtimeEnabled: defaultComputerUseRuntimeEnabled(),
    backend: DEFAULT_COMPUTER_USE_BACKEND,
    experimentalAppScopedBackend: false
  }
}

export function normalizeComputerUseSettings(
  input: ComputerUseSettingsPatchV1 | undefined
): ComputerUseSettingsV1 {
  const defaults = defaultComputerUseSettings()
  const experimentalAppScopedBackend = input?.experimentalAppScopedBackend === true
  const backend = normalizeComputerUseBackend(input?.backend, experimentalAppScopedBackend)
  return {
    enabled: input?.enabled !== false,
    runtimeEnabled: normalizeComputerUseRuntimeEnabled(input?.runtimeEnabled),
    backend,
    experimentalAppScopedBackend
  }
}

export function mergeComputerUseSettings(
  current: ComputerUseSettingsV1 | undefined,
  patch: ComputerUseSettingsPatchV1 | undefined
): ComputerUseSettingsV1 {
  const normalizedCurrent = normalizeComputerUseSettings(current)
  return normalizeComputerUseSettings({
    ...normalizedCurrent,
    ...(patch ?? {}),
    runtimeEnabled: {
      ...normalizedCurrent.runtimeEnabled,
      ...(patch?.runtimeEnabled ?? {})
    }
  })
}

export function getComputerUseSettings(settings: AppSettingsV1): ComputerUseSettingsV1 {
  return normalizeComputerUseSettings(settings.computerUse)
}

export function isComputerUseEnabledForRuntime(
  settings: AppSettingsV1,
  runtimeId: AgentRuntimeId
): boolean {
  const computerUse = getComputerUseSettings(settings)
  return computerUse.enabled && computerUse.runtimeEnabled[runtimeId] !== false
}

function defaultComputerUseRuntimeEnabled(): Record<AgentRuntimeId, boolean> {
  return {
    kun: true,
    codex: true,
    claude: true
  }
}

function normalizeComputerUseRuntimeEnabled(
  input: ComputerUseSettingsPatchV1['runtimeEnabled'] | undefined
): Record<AgentRuntimeId, boolean> {
  const defaults = defaultComputerUseRuntimeEnabled()
  return {
    kun: input?.kun !== false && defaults.kun,
    codex: input?.codex !== false && defaults.codex,
    claude: input?.claude !== false && defaults.claude
  }
}

function normalizeComputerUseBackend(
  value: unknown,
  experimentalAppScopedBackend: boolean
): ComputerUseBackendPreference {
  if (value === 'mac-app-scoped' && experimentalAppScopedBackend) return value
  return DEFAULT_COMPUTER_USE_BACKEND
}
