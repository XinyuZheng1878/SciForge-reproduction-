import {
  DEFAULT_CLAUDE_DATA_DIR,
  type AppSettingsV1,
  type ClaudePermissionMode,
  type ClaudeRuntimeSettingsPatchV1,
  type ClaudeRuntimeSettingsV1,
  type KunSettingsEnvelopePatchV1
} from './app-settings-types'

const DEFAULT_CLAUDE_COMMAND = 'claude'
const DEFAULT_CLAUDE_PERMISSION_MODE: ClaudePermissionMode = 'default'
const CLAUDE_PERMISSION_MODES = new Set<ClaudePermissionMode>([
  'default',
  'acceptEdits',
  'auto',
  'bypassPermissions',
  'dontAsk',
  'plan'
])

export function defaultClaudeRuntimeSettings(): ClaudeRuntimeSettingsV1 {
  return {
    command: DEFAULT_CLAUDE_COMMAND,
    autoStart: false,
    claudeHome: DEFAULT_CLAUDE_DATA_DIR,
    model: '',
    permissionMode: DEFAULT_CLAUDE_PERMISSION_MODE,
    extraArgs: []
  }
}

export function getClaudeRuntimeSettings(settings: AppSettingsV1): ClaudeRuntimeSettingsV1 {
  return mergeClaudeRuntimeSettings(
    defaultClaudeRuntimeSettings(),
    (settings as { agents?: { claude?: ClaudeRuntimeSettingsPatchV1 } }).agents?.claude
  )
}

export function claudeSettingsPatch(
  claude: ClaudeRuntimeSettingsPatchV1 | undefined
): KunSettingsEnvelopePatchV1 {
  return claude ? { claude } : {}
}

export function mergeClaudeRuntimeSettings(
  current: ClaudeRuntimeSettingsV1,
  patch: ClaudeRuntimeSettingsPatchV1 | undefined
): ClaudeRuntimeSettingsV1 {
  return normalizeClaudeRuntimeSettings({
    ...current,
    ...(patch ?? {}),
    extraArgs: Array.isArray(patch?.extraArgs) ? patch.extraArgs : current.extraArgs
  })
}

export function withClaudeRuntimeSettings(
  settings: AppSettingsV1,
  claude: ClaudeRuntimeSettingsV1
): AppSettingsV1 {
  return {
    ...settings,
    agents: {
      ...settings.agents,
      claude
    }
  }
}

export function applyClaudeRuntimePatch(
  settings: AppSettingsV1,
  patch: ClaudeRuntimeSettingsPatchV1 | undefined
): AppSettingsV1 {
  return withClaudeRuntimeSettings(
    settings,
    mergeClaudeRuntimeSettings(getClaudeRuntimeSettings(settings), patch)
  )
}

function normalizeClaudeRuntimeSettings(
  input: Partial<ClaudeRuntimeSettingsV1> | undefined
): ClaudeRuntimeSettingsV1 {
  const defaults = defaultClaudeRuntimeSettings()
  return {
    command: nonEmptyString(input?.command, defaults.command),
    autoStart: input?.autoStart === true,
    claudeHome: optionalString(input?.claudeHome),
    model: optionalString(input?.model),
    permissionMode: normalizePermissionMode(input?.permissionMode),
    extraArgs: normalizeExtraArgs(input?.extraArgs)
  }
}

function normalizePermissionMode(value: unknown): ClaudePermissionMode {
  return CLAUDE_PERMISSION_MODES.has(value as ClaudePermissionMode)
    ? value as ClaudePermissionMode
    : DEFAULT_CLAUDE_PERMISSION_MODE
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeExtraArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter(Boolean)
}
