import {
  DEFAULT_GUI_UPDATE_CHANNEL,
  normalizeGuiUpdateChannel,
  type AppBehaviorConfigV1,
  type AppSettingsV1,
  type ClawSettingsPatchV1,
  type GuiUpdateConfigV1,
  type NotificationConfigV1,
  type ScheduleSettingsPatchV1,
  type SpeechToTextSettingsPatchV1,
  type WorkflowSettingsPatchV1,
  type WriteSettingsPatchV1
} from './app-settings-types'
import { normalizeKeyboardShortcuts, type KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import {
  defaultKunRuntimeSettings,
  getKunRuntimeSettings,
  kunSettingsEnvelope,
  mergeKunRuntimeSettings,
  migrateLegacyAppSettings,
  normalizeRuntimeGuardSettings
} from './app-settings-kun'
import {
  defaultCodexRuntimeSettings,
  getCodexRuntimeSettings,
  mergeCodexRuntimeSettings,
  normalizeAgentRuntimeId
} from './app-settings-codex'
import {
  defaultClaudeRuntimeSettings,
  getClaudeRuntimeSettings,
  mergeClaudeRuntimeSettings
} from './app-settings-claude'
import { normalizeModelProviderSettings } from './app-settings-provider'
import { normalizeModelRouterSettings } from './app-settings-model-router'
import { normalizeDeepseekBaseUrl, normalizeInstallationId } from './app-settings-normalizers'
import { normalizeClawSettings } from './app-settings-claw'
import { normalizeScheduleSettings } from './app-settings-schedule'
import { normalizeWorkflowSettings } from './app-settings-workflow'
import { normalizeWriteSettings } from './app-settings-write'
import { normalizeSpeechToTextSettings } from './speech-to-text'

export function normalizeAppSettings(settings: AppSettingsV1): AppSettingsV1 {
  const migrated = shouldMigrateLegacySettings(settings)
    ? migrateLegacyAppSettings(settings as Parameters<typeof migrateLegacyAppSettings>[0])
    : settings
  const maybeSettings = migrated as AppSettingsV1 & {
    appBehavior?: Partial<AppBehaviorConfigV1>
    keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
    notifications?: Partial<NotificationConfigV1>
    provider?: Parameters<typeof normalizeModelProviderSettings>[0]
    modelRouter?: Parameters<typeof normalizeModelRouterSettings>[0]
    write?: WriteSettingsPatchV1
    claw?: ClawSettingsPatchV1
    schedule?: ScheduleSettingsPatchV1
    workflow?: WorkflowSettingsPatchV1
    speechToText?: SpeechToTextSettingsPatchV1
    guiUpdate?: Partial<GuiUpdateConfigV1>
    runtimeGuards?: Parameters<typeof normalizeRuntimeGuardSettings>[0]
    kunToolStorm?: unknown
    runtime?: { toolStorm?: unknown }
  }
  const runtime = getKunRuntimeSettings(maybeSettings)
  const codexRuntime = getCodexRuntimeSettings(maybeSettings)
  const claudeRuntime = getClaudeRuntimeSettings(maybeSettings)
  return {
    ...migrated,
    version: 1,
    installationId: normalizeInstallationId(maybeSettings.installationId),
    locale: maybeSettings.locale === 'zh' ? 'zh' : 'en',
    theme:
      maybeSettings.theme === 'light' || maybeSettings.theme === 'dark' || maybeSettings.theme === 'system'
        ? maybeSettings.theme
        : 'system',
    uiFontScale:
      maybeSettings.uiFontScale === 'small' ||
      maybeSettings.uiFontScale === 'medium' ||
      maybeSettings.uiFontScale === 'large'
        ? maybeSettings.uiFontScale
        : 'small',
    provider: normalizeModelProviderSettings(maybeSettings.provider),
    modelRouter: normalizeModelRouterSettings(maybeSettings.modelRouter),
    runtimeGuards: normalizeRuntimeGuardSettings(maybeSettings.runtimeGuards, {
      kunToolStorm: maybeSettings.kunToolStorm,
      runtimeToolStorm: maybeSettings.runtime?.toolStorm
    }),
    activeAgentRuntime: normalizeAgentRuntimeId(maybeSettings.activeAgentRuntime),
    agents: {
      ...kunSettingsEnvelope(mergeKunRuntimeSettings(defaultKunRuntimeSettings(), {
        ...runtime,
        baseUrl: runtime.baseUrl.trim() ? normalizeDeepseekBaseUrl(runtime.baseUrl) : ''
      })),
      codex: mergeCodexRuntimeSettings(defaultCodexRuntimeSettings(), codexRuntime),
      claude: mergeClaudeRuntimeSettings(defaultClaudeRuntimeSettings(), claudeRuntime)
    },
    workspaceRoot: typeof maybeSettings.workspaceRoot === 'string' ? maybeSettings.workspaceRoot : '',
    log: {
      enabled: maybeSettings.log?.enabled !== false,
      retentionDays: typeof maybeSettings.log?.retentionDays === 'number' ? maybeSettings.log.retentionDays : 2
    },
    notifications: {
      turnComplete: maybeSettings.notifications?.turnComplete !== false
    },
    appBehavior: normalizeAppBehaviorSettings(maybeSettings.appBehavior),
    keyboardShortcuts: normalizeKeyboardShortcuts(maybeSettings.keyboardShortcuts),
    write: normalizeWriteSettings(maybeSettings.write),
    speechToText: normalizeSpeechToTextSettings(maybeSettings.speechToText),
    claw: normalizeClawSettings(maybeSettings.claw),
    schedule: normalizeScheduleSettings(maybeSettings.schedule),
    workflow: normalizeWorkflowSettings(maybeSettings.workflow),
    guiUpdate: {
      channel: normalizeGuiUpdateChannel(
        maybeSettings.guiUpdate?.channel ?? DEFAULT_GUI_UPDATE_CHANNEL
      )
    },
    codePromptPrefix: typeof maybeSettings.codePromptPrefix === 'string' ? maybeSettings.codePromptPrefix : ''
  }
}

export function normalizeAppBehaviorSettings(
  settings?: Partial<AppBehaviorConfigV1>
): AppBehaviorConfigV1 {
  const openAtLogin = settings?.openAtLogin === true
  return {
    openAtLogin,
    startMinimized: openAtLogin && settings?.startMinimized === true,
    closeToTray: settings?.closeToTray === true
  }
}

function shouldMigrateLegacySettings(settings: AppSettingsV1): boolean {
  const raw = settings as AppSettingsV1 & {
    agentProvider?: unknown
    deepseek?: unknown
    agents?: {
      kun?: Partial<ReturnType<typeof defaultKunRuntimeSettings>>
      codewhale?: unknown
      reasonix?: unknown
    }
  }
  if (!raw.agents?.kun) return true
  if ('agentProvider' in raw || 'deepseek' in raw) return true
  if (raw.agents.codewhale || raw.agents.reasonix) return true
  const dataDir = typeof raw.agents.kun.dataDir === 'string'
    ? raw.agents.kun.dataDir.replace(/\\/g, '/').toLowerCase()
    : ''
  return dataDir === '~/.deepseekgui/coreagent' ||
    dataDir.endsWith('/.deepseekgui/coreagent') ||
    dataDir === '~/.deepseekgui/kun' ||
    dataDir.endsWith('/.deepseekgui/kun')
}
