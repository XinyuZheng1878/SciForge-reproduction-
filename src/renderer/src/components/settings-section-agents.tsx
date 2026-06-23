import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type {
  ApprovalPolicy,
  AgentRuntimeId,
  AppSettingsPatch,
  AppSettingsV1,
  ClaudeRuntimeSettingsPatchV1,
  CodexRuntimeSettingsPatchV1,
  ModelEndpointFormat,
  ModelRouterSettingsPatchV1,
  ModelRouterSettingsV1,
  ModelProviderProfileV1,
  ModelProviderSettingsV1,
  SandboxMode
} from '@shared/app-settings'
import {
  claudeSettingsPatch,
  codexSettingsPatch,
  defaultComputerUseSettings,
  DEFAULT_MODEL_PROVIDER_ID,
  MODEL_ENDPOINT_FORMATS,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_KUN_DATA_DIR,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  defaultCodexRuntimeSettings,
  defaultClaudeRuntimeSettings,
  defaultRuntimeGuardSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  getComputerUseSettings,
  getModelRouterSettings,
  isKunRuntimeInsecure,
  normalizeRuntimeGuardSettings,
  normalizeModelProviderId
} from '@shared/app-settings'
import type {
  ComputerUsePermissionKind,
  ComputerUsePermissionState,
  ComputerUseStatusView
} from '@shared/ds-gui-api'
import type { GuiUpdateChannel } from '@shared/gui-update'
import type { SkillRootId } from '../lib/skill-root-preference'
import {
  Ban,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  X
} from 'lucide-react'
import { GuiUpdateControl } from './settings-gui-update'
import {
  InlineNoticeView,
  SecretInput,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { formatCompactNumber, formatCost } from '../hooks/use-thread-usage'

function statusPill(status: string | undefined): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'disabled') return 'border-ds-border-muted bg-ds-card text-ds-faint'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

function permissionBadgeClass(state: ComputerUsePermissionState): string {
  if (state === 'granted') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (state === 'denied') return 'border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200'
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function computerUseStatusPill(available: boolean | undefined): string {
  if (available === true) return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (available === false) return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
  return 'border-ds-border-muted bg-ds-card text-ds-faint'
}

function checkpointStatusPill(status: string | undefined): string {
  if (status === 'available') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  if (status === 'restored') return 'border-blue-400/30 bg-blue-500/10 text-blue-700 dark:text-blue-200'
  if (status === 'blocked') return 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:text-amber-200'
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

type ModelRouterHealthDisplayStatus = 'healthy' | 'unavailable' | 'provider_auth_blocked'

type ModelRouterHealthDisplay = {
  status: ModelRouterHealthDisplayStatus
  labelKey: string
  message?: string
  messageKey?: string
}

const MODEL_ROUTER_HEALTH_LABEL_KEYS: Record<ModelRouterHealthDisplayStatus, string> = {
  healthy: 'modelRouterHealthHealthy',
  unavailable: 'modelRouterHealthUnavailable',
  provider_auth_blocked: 'modelRouterHealthProviderAuthBlocked'
}

function modelRouterHealthPill(status: ModelRouterHealthDisplayStatus): string {
  if (status === 'healthy') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
  }
  if (status === 'provider_auth_blocked') {
    return 'border-amber-300/60 bg-amber-500/10 text-amber-800 dark:border-amber-700/70 dark:text-amber-200'
  }
  return 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-200'
}

function normalizeModelRouterHealthStatus(status: unknown): ModelRouterHealthDisplayStatus | null {
  if (status === 'healthy') return 'healthy'
  if (status === 'provider_auth_blocked' || status === 'provider-auth blocked') return 'provider_auth_blocked'
  if (status === 'unavailable' || status === 'not_configured') return 'unavailable'
  return null
}

function modelRouterHealthDisplay(
  input: unknown,
  router: ModelRouterSettingsV1
): ModelRouterHealthDisplay {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : null
  const status = normalizeModelRouterHealthStatus(record?.status)
  if (status) {
    return {
      status,
      labelKey: MODEL_ROUTER_HEALTH_LABEL_KEYS[status],
      message: typeof record?.message === 'string' ? record.message : undefined
    }
  }
  const missingConfig =
    !router.enabled ||
    !router.baseUrl.trim() ||
    !router.runtimeApiKey.trim() ||
    !router.publicModelAlias.trim()
  return {
    status: 'unavailable',
    labelKey: MODEL_ROUTER_HEALTH_LABEL_KEYS.unavailable,
    messageKey: missingConfig ? 'modelRouterHealthMissing' : 'modelRouterHealthStatic'
  }
}

function compactList(values: unknown, empty: string): string {
  if (!Array.isArray(values) || values.length === 0) return empty
  return values
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
    .slice(0, 4)
    .join(', ')
}

type TokenEconomySavingsSummary = {
  tokens: number
  costUsd: number
  costCny: number | null
}

type TokenEconomySavingsState = {
  loading: boolean
  loaded: boolean
  summary: TokenEconomySavingsSummary | null
}

const EMPTY_TOKEN_ECONOMY_SAVINGS_STATE: TokenEconomySavingsState = {
  loading: false,
  loaded: false,
  summary: null
}

const MODEL_ENDPOINT_FORMAT_LABEL_KEYS: Record<ModelEndpointFormat, string> = {
  chat_completions: 'modelEndpointChatCompletions',
  responses: 'modelEndpointResponses',
  messages: 'modelEndpointMessages'
}

export function modelProvidersSettingsPatch(input: {
  provider: ModelProviderSettingsV1
  providers: ModelProviderProfileV1[]
  kun?: Partial<AppSettingsV1['agents']['kun']>
}): AppSettingsPatch {
  const defaultProvider = input.providers.find((item) => item.id === DEFAULT_MODEL_PROVIDER_ID)
  return {
    provider: {
      apiKey: defaultProvider?.apiKey ?? input.provider.apiKey,
      baseUrl: defaultProvider?.baseUrl ?? input.provider.baseUrl,
      providers: input.providers
    },
    ...(input.kun ? { agents: { kun: input.kun } } : {})
  }
}

export function codexRuntimeSettingsPatch(codex: CodexRuntimeSettingsPatchV1): AppSettingsPatch {
  return {
    agents: codexSettingsPatch(codex)
  }
}

export function claudeRuntimeSettingsPatch(claude: ClaudeRuntimeSettingsPatchV1): AppSettingsPatch {
  return {
    agents: claudeSettingsPatch(claude)
  }
}

type ModelContextProfileSummary = {
  modelLabel: string
  contextWindowLabel: string
  softThresholdLabel: string
  hardThresholdLabel: string
  sourceLabelKey: string
}

const DEEPSEEK_V4_CONTEXT_PROFILE = {
  contextWindowTokens: 1_000_000,
  softThreshold: 980_000,
  hardThreshold: 990_000
}

function formatTokenNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

function normalizeModelId(model: string | undefined): string {
  const normalized = model?.trim().toLowerCase() ?? ''
  return normalized === 'auto' ? '' : normalized
}

function knownModelContextProfile(input: string | undefined): { modelLabel: string } | null {
  const normalized = normalizeModelId(input)
  if (!normalized) return null
  const match = ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner']
    .find((modelId) => normalized === modelId || normalized.endsWith(`/${modelId}`))
  return match ? { modelLabel: match } : null
}

function modelContextProfileSummary(input: {
  model: string | undefined
  fallbackSoftThreshold: number
  fallbackHardThreshold: number
}): ModelContextProfileSummary {
  const known = knownModelContextProfile(input.model)
  if (known) {
    return {
      modelLabel: known.modelLabel,
      contextWindowLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.contextWindowTokens),
      softThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.softThreshold),
      hardThresholdLabel: formatTokenNumber(DEEPSEEK_V4_CONTEXT_PROFILE.hardThreshold),
      sourceLabelKey: 'kunModelContextSourceBuiltIn'
    }
  }
  const model = input.model?.trim() || 'auto'
  return {
    modelLabel: model,
    contextWindowLabel: 'models.profiles',
    softThresholdLabel: formatTokenNumber(input.fallbackSoftThreshold),
    hardThresholdLabel: formatTokenNumber(input.fallbackHardThreshold),
    sourceLabelKey: 'kunModelContextSourceFallback'
  }
}

function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function usageField(record: Record<string, unknown>, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake]
}

async function loadTokenEconomySavingsSummary(): Promise<TokenEconomySavingsSummary | null> {
  if (typeof window === 'undefined' || typeof window.dsGui?.agentRuntime?.usage !== 'function') return null
  const parsed = await window.dsGui.agentRuntime.usage({ groupBy: 'thread' })
  if (parsed.supported === false) return null
  const totals = parsed.totals ?? {}
  const tokens = usageNumber(usageField(totals, 'tokenEconomySavingsTokens', 'token_economy_savings_tokens'))
  const costUsd = usageNumber(usageField(totals, 'tokenEconomySavingsUsd', 'token_economy_savings_usd'))
  const costCnyValue = usageField(totals, 'tokenEconomySavingsCny', 'token_economy_savings_cny')
  const costCny =
    typeof costCnyValue === 'number' && Number.isFinite(costCnyValue)
      ? costCnyValue
    : null
  if (tokens <= 0 && costUsd <= 0 && (costCny ?? 0) <= 0) return null
  return { tokens, costUsd, costCny }
}

function AdvancedSettingsDisclosure({
  title,
  description,
  children
}: {
  title: string
  description?: string
  children: ReactNode
}): ReactElement {
  return (
    <details className="group overflow-hidden rounded-xl border border-ds-border-muted bg-ds-main/35">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-ds-hover/70 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-ds-ink">{title}</span>
          {description ? (
            <span className="mt-1 block text-[12.5px] leading-5 text-ds-faint">{description}</span>
          ) : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ds-faint transition group-open:rotate-180" strokeWidth={1.9} />
      </summary>
      <div className="border-t border-ds-border-muted bg-ds-card/45">{children}</div>
    </details>
  )
}

export function AgentsSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    provider: providerFromContext,
    kun,
    codex: codexFromContext,
    claude: claudeFromContext,
    activeApiKey,
    update,
    updateKun,
    updateCodex,
    updateClaude,
    updateSharedCredential,
    sharedApiKey,
    sharedBaseUrl,
    showApiKey,
    setShowApiKey,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    runtimeInfo,
    modelRouterHealth,
    toolDiagnostics,
    memoryRecords,
    memoryScopeFilter,
    setMemoryScopeFilter,
    memoryQuery,
    setMemoryQuery,
    memoryDraftContent,
    setMemoryDraftContent,
    memoryDraftScope,
    setMemoryDraftScope,
    memoryEditingId,
    memoryEditingContent,
    setMemoryEditingContent,
    modelAuditRecords,
    gitCheckpoints,
    gitCheckpointPreviewId,
    gitCheckpointPreview,
    gitCheckpointForceRestore,
    setGitCheckpointForceRestore,
    runtimeDiagnosticsBusy,
    runtimeDiagnosticsNotice,
    refreshKunDiagnostics,
    clearModelAuditRecords,
    previewGitCheckpoint,
    restoreGitCheckpoint,
    createMemoryRecord,
    startEditingMemoryRecord,
    cancelEditingMemoryRecord,
    saveMemoryRecord,
    disableMemoryRecord,
    deleteMemoryRecord,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const mcpSearch = kun.mcpSearch ?? {
    enabled: false,
    mode: 'auto',
    autoThresholdToolCount: 24,
    topKDefault: 5,
    topKMax: 10,
    minScore: 0.15
  }
  const tokenEconomyDefaults = {
    enabled: false,
    compressToolDescriptions: true,
    compressToolResults: true,
    conciseResponses: true,
    historyHygiene: {
      maxToolResultLines: 320,
      maxToolResultBytes: 32768,
      maxToolResultTokens: 8000,
      maxToolArgumentStringBytes: 8192,
      maxToolArgumentStringTokens: 2000,
      maxArrayItems: 80
    }
  }
  const tokenEconomy = {
    ...tokenEconomyDefaults,
    ...(kun.tokenEconomy ?? {}),
    enabled: kun.tokenEconomy?.enabled ?? kun.tokenEconomyMode ?? false,
    historyHygiene: {
      ...tokenEconomyDefaults.historyHygiene,
      ...(kun.tokenEconomy?.historyHygiene ?? {})
    }
  }
  const [tokenEconomySavingsState, setTokenEconomySavingsState] =
    useState<TokenEconomySavingsState>(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
  useEffect(() => {
    let cancelled = false
    if (!tokenEconomy.enabled) {
      setTokenEconomySavingsState(EMPTY_TOKEN_ECONOMY_SAVINGS_STATE)
      return
    }
    setTokenEconomySavingsState((current) => ({ ...current, loading: true }))
    void loadTokenEconomySavingsSummary()
      .then((summary) => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary })
      })
      .catch(() => {
        if (!cancelled) setTokenEconomySavingsState({ loading: false, loaded: true, summary: null })
      })
    return () => {
      cancelled = true
    }
  }, [tokenEconomy.enabled])
  const tokenEconomySavings = tokenEconomySavingsState.summary
  const settingsLocale = typeof form?.locale === 'string' ? form.locale : undefined
  const storage = kun.storage ?? {
    backend: 'hybrid',
    sqlitePath: ''
  }
  const contextCompaction = kun.contextCompaction ?? {
    defaultSoftThreshold: 16000,
    defaultHardThreshold: 24000,
    summaryMode: 'heuristic',
    summaryTimeoutMs: 15000,
    summaryMaxTokens: 1200,
    summaryInputMaxBytes: 98304
  }
  const modelContext = modelContextProfileSummary({
    model: kun.model,
    fallbackSoftThreshold: contextCompaction.defaultSoftThreshold,
    fallbackHardThreshold: contextCompaction.defaultHardThreshold
  })
  const runtimeTuning = kun.runtimeTuning ?? {
    toolArgumentRepair: {
      maxStringBytes: 524288
    }
  }
  const runtimeGuards = normalizeRuntimeGuardSettings(form?.runtimeGuards ?? defaultRuntimeGuardSettings())
  const updateMcpSearch = (patch: Record<string, unknown>): void => {
    updateKun({
      mcpSearch: {
        ...mcpSearch,
        ...patch
      }
    })
  }
  const updateTokenEconomy = (patch: Record<string, unknown>): void => {
    const enabled = typeof patch.enabled === 'boolean' ? patch.enabled : tokenEconomy.enabled
    updateKun({
      tokenEconomyMode: enabled,
      tokenEconomy: {
        ...tokenEconomy,
        ...patch,
        enabled
      }
    })
  }
  const updateHistoryHygiene = (patch: Record<string, unknown>): void => {
    updateTokenEconomy({
      historyHygiene: {
        ...tokenEconomy.historyHygiene,
        ...patch
      }
    })
  }
  const updateStorage = (patch: Record<string, unknown>): void => {
    updateKun({
      storage: {
        ...storage,
        ...patch
      }
    })
  }
  const updateContextCompaction = (patch: Record<string, unknown>): void => {
    updateKun({
      contextCompaction: {
        ...contextCompaction,
        ...patch
      }
    })
  }
  const updateRuntimeTuning = (patch: Record<string, unknown>): void => {
    updateKun({
      runtimeTuning: {
        ...runtimeTuning,
        ...patch
      }
    })
  }
  const updateToolStorm = (patch: Record<string, unknown>): void => {
    update({
      runtimeGuards: {
        ...runtimeGuards,
        toolStorm: {
          ...runtimeGuards.toolStorm,
          ...patch
        }
      }
    })
  }
  const updateToolArgumentRepair = (patch: Record<string, unknown>): void => {
    updateRuntimeTuning({
      toolArgumentRepair: {
        ...runtimeTuning.toolArgumentRepair,
        ...patch
      }
    })
  }
  const codex = codexFromContext ?? (form ? getCodexRuntimeSettings(form) : defaultCodexRuntimeSettings())
  const claude = claudeFromContext ?? (form ? getClaudeRuntimeSettings(form) : defaultClaudeRuntimeSettings())
  const modelRouter = form ? getModelRouterSettings(form) : defaultModelRouterSettings()
  const modelRouterHealthView = modelRouterHealthDisplay(modelRouterHealth, modelRouter)
  const [modelRouterConfigNotice, setModelRouterConfigNotice] =
    useState<{ tone: 'error' | 'info' | 'success'; message: string } | null>(null)
  const updateModelRouter = (patch: ModelRouterSettingsPatchV1): void => {
    update({ modelRouter: patch })
  }
  const openModelRouterConfigFile = async (): Promise<void> => {
    const api = window.dsGui as typeof window.dsGui & {
      openModelRouterConfigFile?: () => Promise<{ ok: boolean; message?: string }>
    }
    if (typeof api?.openModelRouterConfigFile !== 'function') {
      setModelRouterConfigNotice({
        tone: 'error',
        message: t('modelRouterOpenConfigFileUnavailable')
      })
      return
    }
    setModelRouterConfigNotice(null)
    try {
      const result = await api.openModelRouterConfigFile()
      if (!result.ok) {
        setModelRouterConfigNotice({
          tone: 'error',
          message: t('modelRouterOpenConfigFileError', {
            message: result.message || tCommon('unknownError')
          })
        })
      }
    } catch (error) {
      setModelRouterConfigNotice({
        tone: 'error',
        message: t('modelRouterOpenConfigFileError', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }
  const updateCodexRuntime = (patch: CodexRuntimeSettingsPatchV1): void => {
    if (typeof updateCodex === 'function') {
      updateCodex(patch)
      return
    }
    update(codexRuntimeSettingsPatch(patch))
  }
  const updateClaudeRuntime = (patch: ClaudeRuntimeSettingsPatchV1): void => {
    if (typeof updateClaude === 'function') {
      updateClaude(patch)
      return
    }
    update(claudeRuntimeSettingsPatch(patch))
  }
  const textInputClass =
    'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
  const provider = providerFromContext ?? form.provider ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const activeProviderId = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const activeProvider = modelProviders.find((item) => item.id === activeProviderId) ?? modelProviders[0]
  const updateModelProviders = (
    providers: ModelProviderProfileV1[],
    kunPatch?: Partial<AppSettingsV1['agents']['kun']>
  ): void => {
    update(modelProvidersSettingsPatch({
      provider,
      providers,
      kun: kunPatch
    }))
  }
  const updateModelProvider = (id: string, patch: Partial<ModelProviderProfileV1>): void => {
    updateModelProviders(modelProviders.map((item) => item.id === id ? { ...item, ...patch } : item))
  }
  const updateModelProviderId = (id: string, value: string): void => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const nextId = normalizeModelProviderId(value)
    if (!nextId || nextId === id) return
    if (modelProviders.some((item) => item.id === nextId && item.id !== id)) return
    updateModelProviders(
      modelProviders.map((item) => item.id === id ? { ...item, id: nextId } : item),
      activeProviderId === id ? { providerId: nextId } : undefined
    )
  }
  const addModelProvider = (): void => {
    const baseId = 'custom-provider'
    let index = modelProviders.length + 1
    let id = `${baseId}-${index}`
    const used = new Set(modelProviders.map((item) => item.id))
    while (used.has(id)) {
      index += 1
      id = `${baseId}-${index}`
    }
    const nextProvider: ModelProviderProfileV1 = {
      id,
      name: t('modelProviderNewName', { index }),
      apiKey: '',
      baseUrl: 'https://api.example.com/v1',
      endpointFormat: 'chat_completions',
      models: []
    }
    updateModelProviders([...modelProviders, nextProvider], { providerId: id })
  }
  const removeModelProvider = (id: string): void => {
    if (id === DEFAULT_MODEL_PROVIDER_ID) return
    const nextProviders = modelProviders.filter((item) => item.id !== id)
    updateModelProviders(
      nextProviders,
      activeProviderId === id ? { providerId: DEFAULT_MODEL_PROVIDER_ID } : undefined
    )
  }
  const canEditActiveProviderId = Boolean(activeProvider && activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID)
  return (
            <>
              <div className="mb-6 flex flex-wrap gap-2">
                <SectionJumpButton label={t('agentsQuickBase')} onClick={() => scrollToAgentSection('agents')} />
                <SectionJumpButton label={t('agentsQuickSkill')} onClick={() => scrollToAgentSection('skill')} />
                <SectionJumpButton label={t('agentsQuickMcp')} onClick={() => scrollToAgentSection('mcp')} />
                <SectionJumpButton
                  label={t('agentsQuickKunPermissions')}
                  onClick={() => scrollToAgentSection('permissions')}
                />
              </div>

              <div ref={agentsSectionRef}>
                <SettingsCard title={t('agents')}>
                  <SettingRow
                    title={t('modelRouter')}
                    description={t('modelRouterDesc')}
                    wideControl
                    control={
                      <div className="grid gap-4 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                        <div className="flex flex-col gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2 sm:flex-row sm:items-start sm:justify-between">
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-ds-ink">
                              {t('modelRouterHealth')}
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-5 text-ds-muted">
                              {modelRouterHealthView.message ?? t(modelRouterHealthView.messageKey ?? 'modelRouterHealthDesc')}
                            </span>
                          </span>
                          <span
                            className={`inline-flex w-fit shrink-0 items-center rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${modelRouterHealthPill(modelRouterHealthView.status)}`}
                          >
                            {t(modelRouterHealthView.labelKey)}
                          </span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('modelRouterBaseUrl')}
                            <span className="font-normal leading-5 text-ds-faint">{t('modelRouterBaseUrlDesc')}</span>
                            <input
                              className={textInputClass}
                              value={modelRouter.baseUrl}
                              placeholder={t('baseUrlPlaceholder')}
                              onChange={(e) => updateModelRouter({ baseUrl: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('modelRouterPublicModelAlias')}
                            <span className="font-normal leading-5 text-ds-faint">
                              {t('modelRouterPublicModelAliasDesc')}
                            </span>
                            <input
                              className={textInputClass}
                              value={modelRouter.publicModelAlias}
                              spellCheck={false}
                              onChange={(e) => updateModelRouter({ publicModelAlias: e.target.value })}
                            />
                          </label>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2">
                            <span className="min-w-0">
                              <span className="block text-[13px] font-semibold text-ds-ink">
                                {t('modelRouterAutoStart')}
                              </span>
                              <span className="mt-0.5 block text-[12px] leading-5 text-ds-muted">
                                {t('modelRouterAutoStartDesc')}
                              </span>
                            </span>
                            <Toggle
                              checked={modelRouter.autoStart}
                              onChange={(autoStart) => updateModelRouter({ autoStart })}
                            />
                          </div>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('modelRouterRuntimeApiKey')}
                            <span className="font-normal leading-5 text-ds-faint">
                              {t('modelRouterRuntimeApiKeyDesc')}
                            </span>
                            <SecretInput
                              value={modelRouter.runtimeApiKey}
                              onChange={(runtimeApiKey) => updateModelRouter({ runtimeApiKey })}
                              visible={showRuntimeToken}
                              onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                              placeholder={t('modelRouterRuntimeApiKeyPlaceholder')}
                              autoComplete="off"
                              showLabel={t('showSecret')}
                              hideLabel={t('hideSecret')}
                            />
                          </label>
                        </div>
                        <div className="flex flex-col gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-ds-ink">
                              {t('modelRouterConfigFile')}
                            </span>
                            <span className="mt-0.5 block text-[12px] leading-5 text-ds-muted">
                              {t('modelRouterConfigFileDesc')}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => void openModelRouterConfigFile()}
                            className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('modelRouterOpenConfigFile')}
                          </button>
                        </div>
                        {modelRouterConfigNotice ? <InlineNoticeView notice={modelRouterConfigNotice} /> : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('codexRuntime')}
                    description={t('codexRuntimeDesc')}
                    wideControl
                    control={
                      <div className="grid gap-4 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2">
                          <span className="min-w-0">
                            <span className="block text-[13px] font-semibold text-ds-ink">{t('autoStart')}</span>
                            <span className="mt-0.5 block text-[12px] leading-5 text-ds-muted">{t('autoStartDesc')}</span>
                          </span>
                          <Toggle
                            checked={codex.autoStart}
                            onChange={(autoStart) => updateCodexRuntime({ autoStart })}
                          />
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('codexCommand')}
                            <span className="font-normal leading-5 text-ds-faint">{t('codexCommandDesc')}</span>
                            <input
                              className={textInputClass}
                              value={codex.command}
                              placeholder={t('codexCommandPlaceholder')}
                              onChange={(e) => updateCodexRuntime({ command: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('codexHome')}
                            <span className="font-normal leading-5 text-ds-faint">{t('codexHomeDesc')}</span>
                            <input
                              className={textInputClass}
                              value={codex.codexHome}
                              placeholder={t('codexHomePlaceholder')}
                              onChange={(e) => updateCodexRuntime({ codexHome: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('codexProfile')}
                            <span className="font-normal leading-5 text-ds-faint">{t('codexProfileDesc')}</span>
                            <input
                              className={textInputClass}
                              value={codex.profile}
                              placeholder={t('codexProfilePlaceholder')}
                              onChange={(e) => updateCodexRuntime({ profile: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('codexModel')}
                            <span className="font-normal leading-5 text-ds-faint">{t('codexModelDesc')}</span>
                            <input
                              className={textInputClass}
                              value={codex.model}
                              placeholder={t('codexModelPlaceholder')}
                              onChange={(e) => updateCodexRuntime({ model: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('codexModelProvider')}
                            <span className="font-normal leading-5 text-ds-faint">{t('codexModelProviderDesc')}</span>
                            <input
                              className={textInputClass}
                              value={codex.modelProvider}
                              placeholder={t('codexModelProviderPlaceholder')}
                              onChange={(e) => updateCodexRuntime({ modelProvider: e.target.value })}
                            />
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('approvalPolicy')}
                            <span className="font-normal leading-5 text-ds-faint">{t('approvalPolicyDesc')}</span>
                            <select
                              className={selectControlClass}
                              value={codex.approvalPolicy}
                              onChange={(e) =>
                                updateCodexRuntime({
                                  approvalPolicy: e.target.value as ApprovalPolicy
                                })
                              }
                            >
                              <option value="on-request">{t('approvalOnRequest')}</option>
                              <option value="untrusted">{t('approvalUntrusted')}</option>
                              <option value="never">{t('approvalNever')}</option>
                            </select>
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('sandboxMode')}
                            <span className="font-normal leading-5 text-ds-faint">{t('sandboxModeDesc')}</span>
                            <select
                              className={selectControlClass}
                              value={codex.sandboxMode}
                              onChange={(e) =>
                                updateCodexRuntime({
                                  sandboxMode: e.target.value as SandboxMode
                                })
                              }
                            >
                              <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
                              <option value="read-only">{t('sandboxReadOnly')}</option>
                              <option value="danger-full-access">{t('sandboxFullAccess')}</option>
                            </select>
                          </label>
                        </div>
                        <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                          {t('codexExtraArgs')}
                          <span className="font-normal leading-5 text-ds-faint">{t('codexExtraArgsDesc')}</span>
                          <textarea
                            className="min-h-24 w-full min-w-0 resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={listSettingsText(codex.extraArgs)}
                            placeholder={t('codexExtraArgsPlaceholder')}
                            onChange={(e) =>
                              updateCodexRuntime({
                                extraArgs: splitSettingsList(e.target.value)
                              })
                            }
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('claudeRuntime')}
                    description={t('claudeRuntimeDesc')}
                    wideControl
	                    control={
	                      <div className="grid gap-4 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
	                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('claudeCommand')}
                            <span className="font-normal leading-5 text-ds-faint">{t('claudeCommandDesc')}</span>
                            <input
                              className={textInputClass}
                              value={claude.command}
                              placeholder={t('claudeCommandPlaceholder')}
                              onChange={(e) => updateClaudeRuntime({ command: e.target.value })}
                            />
	                          </label>
	                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
	                            {t('claudeConfigDir')}
	                            <span className="font-normal leading-5 text-ds-faint">{t('claudeConfigDirDesc')}</span>
	                            <input
	                              className={textInputClass}
	                              value={claude.configDir}
	                              placeholder={t('claudeConfigDirPlaceholder')}
	                              onChange={(e) => updateClaudeRuntime({ configDir: e.target.value })}
	                            />
	                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('claudeModel')}
                            <span className="font-normal leading-5 text-ds-faint">{t('claudeModelDesc')}</span>
	                            <input
	                              className={textInputClass}
	                              value={claude.model}
	                              placeholder={modelRouter.publicModelAlias}
	                              onChange={(e) => updateClaudeRuntime({ model: e.target.value })}
	                            />
	                          </label>
	                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
	                            {t('approvalPolicy')}
	                            <span className="font-normal leading-5 text-ds-faint">{t('claudeApprovalPolicyDesc')}</span>
                            <select
                              className={selectControlClass}
                              value={claude.approvalPolicy}
                              onChange={(e) =>
                                updateClaudeRuntime({
                                  approvalPolicy: e.target.value as ApprovalPolicy
                                })
                              }
                            >
                              <option value="on-request">{t('approvalOnRequest')}</option>
                              <option value="untrusted">{t('approvalUntrusted')}</option>
                              <option value="never">{t('approvalNever')}</option>
                              <option value="auto">{t('approvalAuto')}</option>
                            </select>
                          </label>
                          <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                            {t('sandboxMode')}
                            <span className="font-normal leading-5 text-ds-faint">{t('claudeSandboxModeDesc')}</span>
                            <select
                              className={selectControlClass}
                              value={claude.sandboxMode}
                              onChange={(e) =>
                                updateClaudeRuntime({
                                  sandboxMode: e.target.value as SandboxMode
                                })
                              }
	                            >
	                              <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
	                              <option value="read-only">{t('sandboxReadOnly')}</option>
	                              <option value="danger-full-access">{t('sandboxFullAccess')}</option>
	                            </select>
	                          </label>
                        </div>
                        <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                          {t('claudeExtraArgs')}
                          <span className="font-normal leading-5 text-ds-faint">{t('claudeExtraArgsDesc')}</span>
                          <textarea
                            className="min-h-24 w-full min-w-0 resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={listSettingsText(claude.extraArgs)}
                            placeholder={t('claudeExtraArgsPlaceholder')}
                            onChange={(e) =>
                              updateClaudeRuntime({
                                extraArgs: splitSettingsList(e.target.value)
                              })
                            }
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('autoStart')}
                    description={t('autoStartDesc')}
                    control={
                      <Toggle
                        checked={kun.autoStart}
                        onChange={(v) => updateKun({ autoStart: v })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('codePromptPrefix')}
                    description={t('codePromptPrefixDesc')}
                    wideControl
                    control={
                      <textarea
                        value={form?.codePromptPrefix ?? ''}
                        onChange={(e) => update({ codePromptPrefix: e.target.value })}
                        placeholder={t('codePromptPrefixPlaceholder')}
                        className="min-h-[110px] w-full resize-y rounded-xl border border-ds-border bg-ds-main/60 px-3 py-3 text-[14px] leading-6 text-ds-ink outline-none focus:border-accent/40 focus:ring-1 focus:ring-accent/25"
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunAssistantAdvanced')}
                      description={t('kunAssistantAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunProvider')}
                    description={t('kunProviderDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                        <div className="space-y-2">
                          <select
                            className={selectControlClass}
                            value={activeProvider?.id ?? DEFAULT_MODEL_PROVIDER_ID}
                            onChange={(e) => updateKun({ providerId: e.target.value })}
                          >
                            {modelProviders.map((item) => (
                              <option key={item.id} value={item.id}>{item.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={addModelProvider}
                            className="inline-flex h-9 items-center gap-2 rounded-full border border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink"
                          >
                            <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
                            {t('modelProviderAdd')}
                          </button>
                        </div>
                        {activeProvider ? (
                          <div className="grid gap-3 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                                {t('modelProviderName')}
                                <input
                                  className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                  value={activeProvider.name}
                                  onChange={(e) => updateModelProvider(activeProvider.id, { name: e.target.value })}
                                />
                              </label>
                              <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                                {t('modelProviderId')}
                                <input
                                  className={`w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] font-normal shadow-sm ${
                                    canEditActiveProviderId
                                      ? 'text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
                                      : 'text-ds-faint'
                                  }`}
                                  value={activeProvider.id}
                                  readOnly={!canEditActiveProviderId}
                                  spellCheck={false}
                                  onChange={(e) => updateModelProviderId(activeProvider.id, e.target.value)}
                                />
                              </label>
                            </div>
                            <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                              {t('modelProviderApiKey')}
                              <SecretInput
                                value={activeProvider.apiKey}
                                onChange={(value) => updateModelProvider(activeProvider.id, { apiKey: value })}
                                visible={showApiKey}
                                onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                                placeholder={t('kunApiKeyPlaceholder')}
                                autoComplete="off"
                                showLabel={t('showSecret')}
                                hideLabel={t('hideSecret')}
                              />
                            </label>
                            <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                              {t('modelProviderBaseUrl')}
                              <input
                                className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                value={activeProvider.baseUrl}
                                placeholder={t('baseUrlPlaceholder')}
                                onChange={(e) => updateModelProvider(activeProvider.id, { baseUrl: e.target.value })}
                              />
                            </label>
                            <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                              {t('modelProviderEndpointFormat')}
                              <select
                                className={selectControlClass}
                                value={activeProvider.endpointFormat}
                                onChange={(e) => updateModelProvider(activeProvider.id, {
                                  endpointFormat: e.target.value as ModelEndpointFormat
                                })}
                              >
                                {MODEL_ENDPOINT_FORMATS.map((format) => (
                                  <option key={format} value={format}>
                                    {t(MODEL_ENDPOINT_FORMAT_LABEL_KEYS[format])}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1.5 text-[12px] font-semibold text-ds-muted">
                              {t('modelProviderModels')}
                              <textarea
                                className="min-h-24 w-full min-w-0 resize-y rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] font-normal text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                value={activeProvider.models.join('\n')}
                                placeholder="deepseek-v4-pro&#10;deepseek-v4-flash"
                                onChange={(e) => updateModelProvider(activeProvider.id, {
                                  models: e.target.value.split('\n').map((item) => item.trim()).filter(Boolean)
                                })}
                              />
                            </label>
                            {activeProvider.id !== DEFAULT_MODEL_PROVIDER_ID ? (
                              <button
                                type="button"
                                onClick={() => removeModelProvider(activeProvider.id)}
                                className="inline-flex h-9 w-fit items-center gap-2 rounded-full border border-red-200/70 bg-red-50 px-3 text-[12.5px] font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900/70 dark:bg-red-950/25 dark:text-red-200 dark:hover:bg-red-950/40"
                              >
                                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                                {t('modelProviderRemove')}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunApiKey')}
                    description={t('kunApiKeyDesc')}
                    control={
                      <div className="w-full min-w-0 md:max-w-md">
                        <SecretInput
                          value={kun.apiKey}
                          onChange={(value) => updateKun({ apiKey: value })}
                          visible={showApiKey}
                          onToggleVisibility={() => setShowApiKey((value: boolean) => !value)}
                          placeholder={t('kunApiKeyPlaceholder')}
                          autoComplete="off"
                          showLabel={t('showSecret')}
                          hideLabel={t('hideSecret')}
                        />
                        <p className="mt-2 text-[12px] text-ds-muted">
                          {kun.apiKey.trim()
                            ? t('kunApiKeyOverride')
                            : sharedApiKey.trim()
                              ? t('kunApiKeyInherited')
                              : t('kunApiKeyMissing')}
                        </p>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunBaseUrl')}
                    description={t('kunBaseUrlDesc')}
                    control={
                      <div className="w-full min-w-0 md:max-w-md">
                        <input
                          className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={kun.baseUrl}
                          placeholder={t('kunBaseUrlPlaceholder')}
                          onChange={(e) => updateKun({ baseUrl: e.target.value })}
                        />
                        <p className="mt-2 text-[12px] text-ds-muted">
                          {kun.baseUrl.trim()
                            ? t('kunBaseUrlOverride', { value: kun.baseUrl.trim() })
                            : t('kunBaseUrlInherited', { value: sharedBaseUrl.trim() || t('kunBaseUrlOfficial') })}
                        </p>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('port')}
                    description={t('portDesc')}
                    control={
                      <div>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          className={`w-28 rounded-xl border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 ${
                            portError
                              ? 'border-red-400 focus:ring-red-300'
                              : 'border-ds-border focus:border-accent/40 focus:ring-accent/30'
                          }`}
                          value={kun.port}
                          onChange={(e) => updateKun({ port: Number(e.target.value) })}
                        />
                        {portError ? (
                          <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{portError}</p>
                        ) : null}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunBinary')}
                    description={t('kunBinaryDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={t('kunBinaryPlaceholder')}
                        value={kun.binaryPath}
                        onChange={(e) => updateKun({ binaryPath: e.target.value })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunDataDir')}
                    description={t('kunDataDirDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        placeholder={DEFAULT_KUN_DATA_DIR}
                        value={kun.dataDir}
                        onChange={(e) => updateKun({ dataDir: e.target.value })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunModel')}
                    description={t('kunModelDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={kun.model}
                        onChange={(e) => updateKun({ model: e.target.value })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                  <SettingRow
                    title={t('kunTokenEconomy')}
                    description={t('kunTokenEconomyDesc')}
                    control={
                      <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
                        <Toggle
                          checked={tokenEconomy.enabled}
                          onChange={(enabled) => updateTokenEconomy({ enabled })}
                        />
                        {tokenEconomy.enabled ? (
                          <div className="max-w-full rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-[12px] font-medium leading-5 text-emerald-700 dark:text-emerald-200">
                            {tokenEconomySavings ? (
                              <span>
                                {t('kunTokenEconomySavings', {
                                  tokens: formatCompactNumber(tokenEconomySavings.tokens),
                                  cost: formatCost(
                                    tokenEconomySavings.costUsd,
                                    settingsLocale,
                                    tokenEconomySavings.costCny
                                  )
                                })}
                              </span>
                            ) : tokenEconomySavingsState.loading ? (
                              <span>{t('kunTokenEconomySavingsLoading')}</span>
                            ) : (
                              <span>{t('kunTokenEconomySavingsEmpty')}</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunTokenEconomyAdvanced')}
                      description={t('kunTokenEconomyAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunTokenEconomyOptions')}
                    description={t('kunTokenEconomyOptionsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunCompressToolDescriptions')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolDescriptions}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolDescriptions) =>
                              updateTokenEconomy({ compressToolDescriptions })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunCompressToolResults')}</span>
                          <Toggle
                            checked={tokenEconomy.compressToolResults}
                            disabled={!tokenEconomy.enabled}
                            onChange={(compressToolResults) =>
                              updateTokenEconomy({ compressToolResults })}
                          />
                        </label>
                        <label className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-muted">
                          <span>{t('kunConciseResponses')}</span>
                          <Toggle
                            checked={tokenEconomy.conciseResponses}
                            disabled={!tokenEconomy.enabled}
                            onChange={(conciseResponses) =>
                              updateTokenEconomy({ conciseResponses })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunHistoryHygiene')}
                    description={t('kunHistoryHygieneDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultLines')}
                          <input
                            type="number"
                            min={1}
                            max={100000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultLines}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultLines: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultBytes}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxResultTokens')}
                          <input
                            type="number"
                            min={128}
                            max={256000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolResultTokens}
                            onChange={(e) => updateHistoryHygiene({ maxToolResultTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArgumentBytes')}
                          <input
                            type="number"
                            min={512}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringBytes}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringBytes: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArgumentTokens')}
                          <input
                            type="number"
                            min={128}
                            max={64000}
                            step={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxToolArgumentStringTokens}
                            onChange={(e) =>
                              updateHistoryHygiene({ maxToolArgumentStringTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunHistoryMaxArrayItems')}
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={tokenEconomy.historyHygiene.maxArrayItems}
                            onChange={(e) => updateHistoryHygiene({ maxArrayItems: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('runtimeToken')}
                    description={t('runtimeTokenDesc')}
                    control={
                      <SecretInput
                        value={kun.runtimeToken}
                        onChange={(value) => updateKun({ runtimeToken: value })}
                        visible={showRuntimeToken}
                        onToggleVisibility={() => setShowRuntimeToken((value: boolean) => !value)}
                        showLabel={t('showSecret')}
                        hideLabel={t('hideSecret')}
                        className="md:max-w-md"
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunInsecure')}
                    description={
                      kun.runtimeToken.trim()
                        ? t('kunInsecureDesc')
                        : t('kunInsecureForcedDesc')
                    }
                    control={
                      <Toggle
                        checked={isKunRuntimeInsecure(kun)}
                        disabled={!kun.runtimeToken.trim()}
                        onChange={(v) => updateKun({ insecure: v })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('kunAdvanced')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunAdvancedDetails')}
                      description={t('kunAdvancedDetailsDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunModelContextProfile')}
                    description={t('kunModelContextProfileDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextModel')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.modelLabel}
                          </div>
                          <div className="mt-1 text-[11px] leading-4 text-ds-muted">
                            {t(modelContext.sourceLabelKey)}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextWindow')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.contextWindowLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextSoft')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.softThresholdLabel}
                          </div>
                        </div>
                        <div className="min-w-0 rounded-xl border border-ds-border-muted bg-ds-card px-3 py-2">
                          <div className="text-[11px] font-medium uppercase text-ds-faint">
                            {t('kunModelContextHard')}
                          </div>
                          <div className="mt-1 truncate text-[13px] font-semibold text-ds-ink">
                            {modelContext.hardThresholdLabel}
                          </div>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunStorageBackend')}
                    description={t('kunStorageBackendDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={storage.backend}
                        onChange={(e) => updateStorage({ backend: e.target.value })}
                      >
                        <option value="hybrid">{t('kunStorageHybrid')}</option>
                        <option value="file">{t('kunStorageFile')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('kunStorageSqlitePath')}
                    description={t('kunStorageSqlitePathDesc')}
                    control={
                      <input
                        className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 md:max-w-md"
                        value={storage.sqlitePath}
                        disabled={storage.backend !== 'hybrid'}
                        placeholder={t('kunStorageSqlitePathPlaceholder')}
                        onChange={(e) => updateStorage({ sqlitePath: e.target.value })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('kunCompactionThresholds')}
                    description={t('kunCompactionThresholdsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSoftThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultSoftThreshold}
                            onChange={(e) => updateContextCompaction({ defaultSoftThreshold: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionHardThreshold')}
                          <input
                            type="number"
                            min={1024}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.defaultHardThreshold}
                            onChange={(e) => updateContextCompaction({ defaultHardThreshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunCompactionSummary')}
                    description={t('kunCompactionSummaryDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryMode')}
                          <select
                            className={selectControlClass}
                            value={contextCompaction.summaryMode}
                            onChange={(e) => updateContextCompaction({ summaryMode: e.target.value })}
                          >
                            <option value="heuristic">{t('kunCompactionSummaryHeuristic')}</option>
                            <option value="model">{t('kunCompactionSummaryModel')}</option>
                          </select>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryTimeout')}
                          <input
                            type="number"
                            min={1000}
                            max={120000}
                            step={1000}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryTimeoutMs}
                            onChange={(e) => updateContextCompaction({ summaryTimeoutMs: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryMaxTokens')}
                          <input
                            type="number"
                            min={64}
                            max={16000}
                            step={64}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryMaxTokens}
                            onChange={(e) => updateContextCompaction({ summaryMaxTokens: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('kunCompactionSummaryInputBytes')}
                          <input
                            type="number"
                            min={1024}
                            max={8388608}
                            step={1024}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={contextCompaction.summaryInputMaxBytes}
                            onChange={(e) => updateContextCompaction({ summaryInputMaxBytes: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('runtimeGuardToolStorm')}
                    description={t('runtimeGuardToolStormDesc')}
                    control={
                      <Toggle
                        checked={runtimeGuards.toolStorm.enabled}
                        onChange={(enabled) => updateToolStorm({ enabled })}
                      />
                    }
                  />
                  <SettingRow
                    title={t('runtimeGuardToolStormLimits')}
                    description={t('runtimeGuardToolStormLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('runtimeGuardToolStormWindowSize')}
                          <input
                            type="number"
                            min={1}
                            max={256}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeGuards.toolStorm.windowSize}
                            disabled={!runtimeGuards.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ windowSize: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('runtimeGuardToolStormSoftThreshold')}
                          <input
                            type="number"
                            min={2}
                            max={128}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeGuards.toolStorm.softThreshold}
                            disabled={!runtimeGuards.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ softThreshold: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('runtimeGuardToolStormHardThreshold')}
                          <input
                            type="number"
                            min={2}
                            max={256}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={runtimeGuards.toolStorm.hardThreshold}
                            disabled={!runtimeGuards.toolStorm.enabled}
                            onChange={(e) => updateToolStorm({ hardThreshold: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunToolArgumentRepair')}
                    description={t('kunToolArgumentRepairDesc')}
                    control={
                      <input
                        type="number"
                        min={1024}
                        max={16777216}
                        step={1024}
                        className="w-40 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        value={runtimeTuning.toolArgumentRepair.maxStringBytes}
                        onChange={(e) => updateToolArgumentRepair({ maxStringBytes: Number(e.target.value) })}
                      />
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div className="mt-6">
                <SettingsCard title={t('kunDiagnostics')}>
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('kunDiagnosticsAdvanced')}
                      description={t('kunDiagnosticsAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('kunRuntimeCapabilities')}
                    description={t('kunRuntimeCapabilitiesDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          {[
                            ['MCP', runtimeInfo?.capabilities?.mcp?.status],
                            ['Web', runtimeInfo?.capabilities?.web?.status],
                            ['Skills', runtimeInfo?.capabilities?.skills?.status],
                            ['Subagents', runtimeInfo?.capabilities?.subagents?.status],
                            ['Images', runtimeInfo?.capabilities?.attachments?.status],
                            ['Memory', runtimeInfo?.capabilities?.memory?.status]
                          ].map(([label, status]) => (
                            <span
                              key={label}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${statusPill(status as string | undefined)}`}
                            >
                              {label}
                              <span className="font-mono text-[11px] opacity-75">{status || 'unknown'}</span>
                            </span>
                          ))}
                        </div>
                        <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('kunRuntimeModel')}: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.model?.id ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            {t('kunRuntimePid')}: <span className="font-mono text-ds-ink">{runtimeInfo?.pid ?? 'unknown'}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            MCP: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.mcp?.connectedServers ?? 0}/{runtimeInfo?.capabilities?.mcp?.configuredServers ?? 0}</span>
                          </div>
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                            Web: <span className="font-mono text-ds-ink">{runtimeInfo?.capabilities?.web?.provider ?? 'none'}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void refreshKunDiagnostics()}
                            disabled={runtimeDiagnosticsBusy}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${runtimeDiagnosticsBusy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('kunDiagnosticsRefresh')}
                          </button>
                          {runtimeDiagnosticsNotice ? <InlineNoticeView notice={runtimeDiagnosticsNotice} /> : null}
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunToolDiagnostics')}
                    description={t('kunToolDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-2">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsProviders')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.providers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsMcpServers')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpServers?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsSkills')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.skills?.skills?.length ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('kunDiagnosticsAttachments')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.attachments?.count ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('modelAuditRecords')}
                    description={t('modelAuditRecordsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[12.5px] text-ds-muted">
                            {t('modelAuditCount', { count: modelAuditRecords?.length ?? 0 })}
                          </div>
                          <button
                            type="button"
                            onClick={() => void clearModelAuditRecords?.()}
                            disabled={runtimeDiagnosticsBusy || !modelAuditRecords?.length}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            {t('modelAuditClear')}
                          </button>
                        </div>
                        {!modelAuditRecords?.length ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('modelAuditEmpty')}
                          </div>
                        ) : (
                          modelAuditRecords.slice(0, 5).map((record: any) => (
                            <div key={record.id} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-[13px] font-semibold text-ds-ink">
                                    {record.runtimeId}
                                    {record.model ? ` · ${record.model}` : ''}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{record.threadId}</span>
                                    {record.turnId ? <span className="font-mono">{record.turnId}</span> : null}
                                    {typeof record.durationMs === 'number' ? <span>{record.durationMs}ms</span> : null}
                                    {record.streamOutput?.stopReason ? <span>{record.streamOutput.stopReason}</span> : null}
                                  </div>
                                  <div className="mt-1 line-clamp-2 text-[12px] text-ds-muted">
                                    {record.streamOutput?.error || record.streamOutput?.text || t('modelAuditNoOutput')}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('gitCheckpoints')}
                    description={t('gitCheckpointsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[12.5px] text-ds-muted">
                            {t('gitCheckpointCount', { count: gitCheckpoints?.length ?? 0 })}
                          </div>
                          <label className="inline-flex items-center gap-2 text-[12.5px] text-ds-muted">
                            <input
                              type="checkbox"
                              checked={gitCheckpointForceRestore === true}
                              onChange={(event) => setGitCheckpointForceRestore?.(event.target.checked)}
                              className="h-4 w-4 rounded border-ds-border text-accent focus:ring-accent/30"
                            />
                            {t('gitCheckpointForceRestore')}
                          </label>
                        </div>
                        {!gitCheckpoints?.length ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('gitCheckpointEmpty')}
                          </div>
                        ) : (
                          gitCheckpoints.slice(0, 8).map((checkpoint: any) => (
                            <div key={checkpoint.checkpointId} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="truncate text-[13px] font-semibold text-ds-ink">
                                      {checkpoint.threadId}
                                    </span>
                                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${checkpointStatusPill(checkpoint.status)}`}>
                                      {checkpoint.status ?? 'unknown'}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{checkpoint.runtimeId}</span>
                                    {checkpoint.turnId ? <span className="font-mono">{checkpoint.turnId}</span> : null}
                                    {checkpoint.branch ? <span>{checkpoint.branch}</span> : null}
                                    <span>{checkpoint.createdAt ? new Date(checkpoint.createdAt).toLocaleString() : ''}</span>
                                  </div>
                                  {checkpoint.diffStat ? (
                                    <pre className="mt-2 max-h-16 overflow-auto whitespace-pre-wrap rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-2 text-[11px] text-ds-muted">
                                      {checkpoint.diffStat}
                                    </pre>
                                  ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void previewGitCheckpoint?.(checkpoint.checkpointId)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                    aria-label={t('gitCheckpointPreview')}
                                    title={t('gitCheckpointPreview')}
                                  >
                                    <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void restoreGitCheckpoint?.(checkpoint.checkpointId)}
                                    className="rounded-lg p-1.5 text-ds-muted transition hover:bg-amber-500/10 hover:text-amber-700"
                                    aria-label={t('gitCheckpointRestore')}
                                    title={t('gitCheckpointRestore')}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                                  </button>
                                </div>
                              </div>
                              {gitCheckpointPreviewId === checkpoint.checkpointId && gitCheckpointPreview ? (
                                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-ds-border-muted bg-ds-card px-3 py-2 text-[11px] leading-5 text-ds-muted">
                                  {gitCheckpointPreview}
                                </pre>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('kunMemoryRecords')}
                    description={t('kunMemoryRecordsDesc')}
                    wideControl
                    control={
                      <div className="flex flex-col gap-2">
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                          <input
                            type="search"
                            value={memoryQuery}
                            onChange={(e) => setMemoryQuery?.(e.target.value)}
                            placeholder={t('kunMemorySearchPlaceholder')}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          />
                          <select
                            value={memoryScopeFilter}
                            onChange={(e) => setMemoryScopeFilter?.(e.target.value)}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          >
                            <option value="all">{t('kunMemoryScopeAll')}</option>
                            <option value="user">{t('kunMemoryScopeUser')}</option>
                            <option value="workspace">{t('kunMemoryScopeWorkspace')}</option>
                            <option value="project">{t('kunMemoryScopeProject')}</option>
                          </select>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
                          <input
                            type="text"
                            value={memoryDraftContent}
                            onChange={(e) => setMemoryDraftContent?.(e.target.value)}
                            placeholder={t('kunMemoryCreatePlaceholder')}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          />
                          <select
                            value={memoryDraftScope}
                            onChange={(e) => setMemoryDraftScope?.(e.target.value)}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          >
                            <option value="user">{t('kunMemoryScopeUser')}</option>
                            <option value="workspace">{t('kunMemoryScopeWorkspace')}</option>
                            <option value="project">{t('kunMemoryScopeProject')}</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void createMemoryRecord?.()}
                            disabled={!memoryDraftContent?.trim()}
                            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="h-3.5 w-3.5" strokeWidth={1.85} />
                            {t('kunMemoryCreate')}
                          </button>
                        </div>
                        {memoryRecords.length === 0 ? (
                          <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                            {t('kunMemoryEmpty')}
                          </div>
                        ) : (
                          memoryRecords.slice(0, 8).map((memory: any) => (
                            <div key={memory.id} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                              <div className="flex min-w-0 items-start justify-between gap-3">
                                <div className="min-w-0">
                                  {memoryEditingId === memory.id ? (
                                    <input
                                      type="text"
                                      value={memoryEditingContent}
                                      onChange={(e) => setMemoryEditingContent?.(e.target.value)}
                                      className="w-full rounded-lg border border-ds-border bg-ds-card px-2.5 py-1.5 text-[13px] font-semibold text-ds-ink focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                                    />
                                  ) : (
                                    <div className="truncate text-[13px] font-semibold text-ds-ink">{memory.content}</div>
                                  )}
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                                    <span className="font-mono">{memory.scope}</span>
                                    <span className="font-mono">{memory.id}</span>
                                    {memory.disabledAt ? <span>{t('kunMemoryDisabled')}</span> : null}
                                    {memory.tags?.length ? <span>{compactList(memory.tags, '')}</span> : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  {memoryEditingId === memory.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void saveMemoryRecord?.(memory.id)}
                                        disabled={!memoryEditingContent?.trim()}
                                        className="rounded-lg p-1.5 text-ds-muted transition hover:bg-emerald-500/10 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
                                        aria-label={t('kunMemorySave')}
                                        title={t('kunMemorySave')}
                                      >
                                        <Check className="h-3.5 w-3.5" strokeWidth={1.9} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => cancelEditingMemoryRecord?.()}
                                        className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                        aria-label={tCommon('cancel')}
                                        title={tCommon('cancel')}
                                      >
                                        <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => startEditingMemoryRecord?.(memory)}
                                        className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                                        aria-label={t('kunMemoryEdit')}
                                        title={t('kunMemoryEdit')}
                                      >
                                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={Boolean(memory.disabledAt)}
                                        onClick={() => void disableMemoryRecord(memory.id)}
                                        className="rounded-lg p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-45"
                                        aria-label={t('kunMemoryDisable')}
                                        title={t('kunMemoryDisable')}
                                      >
                                        <Ban className="h-3.5 w-3.5" strokeWidth={1.8} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void deleteMemoryRecord(memory.id)}
                                        className="rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600"
                                        aria-label={t('kunMemoryDelete')}
                                        title={t('kunMemoryDelete')}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div ref={skillSectionRef} className="mt-6">
                <SettingsCard title={t('skill')}>
                  <SettingRow
                    title={t('skillsLocation')}
                    description={t('skillsLocationDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={selectedSkillRoot?.id ?? skillRootId}
                        onChange={(event) => setSkillRootId(event.target.value as SkillRootId)}
                      >
                        {skillRootOptions.map((option: any) => (
                          <option key={option.id} value={option.id} disabled={!option.available}>
                            {option.available ? option.label : `${option.label} · ${tCommon('pluginSkillRootNeedsWorkspace')}`}
                          </option>
                        ))}
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('skillsPath')}
                    description={t('skillsPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {selectedSkillRoot?.path || t('skillsRootUnavailable')}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('skillsScanDirs')}
                    description={t('skillsScanDirsDesc')}
                    wideControl
                    control={
                      <textarea
                        value={listSettingsText(form.claw.skills.extraDirs)}
                        onChange={(event) =>
                          update({
                            claw: {
                              skills: {
                                extraDirs: splitSettingsList(event.target.value)
                              }
                            }
                          })
                        }
                        spellCheck={false}
                        placeholder={selectedSkillRoot?.path || '~/.agents/skills'}
                        className="min-h-24 w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                      />
                    }
                  />
                  <SettingRow
                    title={t('skillsActions')}
                    description={t('skillsActionsDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void openSkillRoot()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('skillsOpenRoot')}
                          </button>
                          <button
                            type="button"
                            onClick={() => openPlugins()}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90"
                          >
                            <Settings className="h-4 w-4" />
                            {t('skillsOpenPlugins')}
                          </button>
                        </div>
                        {skillNotice ? <InlineNoticeView notice={skillNotice} /> : null}
                      </div>
                    }
                  />
                </SettingsCard>
              </div>

              <div ref={mcpSectionRef} className="mt-6">
                <SettingsCard title={t('mcp')}>
                  <SettingRow
                    title={t('mcpSearchEnabled')}
                    description={t('mcpSearchEnabledDesc')}
                    control={
                      <Toggle
                        checked={mcpSearch.enabled}
                        onChange={(v) => updateMcpSearch({ enabled: v })}
                      />
                    }
                  />
                  <div className="px-3 py-4">
                    <AdvancedSettingsDisclosure
                      title={t('mcpAdvanced')}
                      description={t('mcpAdvancedDesc')}
                    >
                      <div className="divide-y divide-ds-border-muted">
                  <SettingRow
                    title={t('mcpSearchMode')}
                    description={t('mcpSearchModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={mcpSearch.mode}
                        disabled={!mcpSearch.enabled}
                        onChange={(e) => updateMcpSearch({ mode: e.target.value })}
                      >
                        <option value="auto">{t('mcpSearchModeAuto')}</option>
                        <option value="search">{t('mcpSearchModeSearch')}</option>
                        <option value="direct">{t('mcpSearchModeDirect')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchLimits')}
                    description={t('mcpSearchLimitsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchAutoThreshold')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.autoThresholdToolCount}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ autoThresholdToolCount: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKDefault')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKDefault}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKDefault: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchTopKMax')}
                          <input
                            type="number"
                            min={1}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.topKMax}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ topKMax: Number(e.target.value) })}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-ds-muted">
                          {t('mcpSearchMinScore')}
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                            value={mcpSearch.minScore}
                            disabled={!mcpSearch.enabled}
                            onChange={(e) => updateMcpSearch({ minScore: Number(e.target.value) })}
                          />
                        </label>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpSearchDiagnostics')}
                    description={t('mcpSearchDiagnosticsDesc')}
                    wideControl
                    control={
                      <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchStatus')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.active ? t('mcpSearchActive') : t('mcpSearchInactive')}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchIndexed')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.indexedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.indexedToolCount ?? 0}</span>
                        </div>
                        <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                          {t('mcpSearchAdvertised')}: <span className="font-mono text-ds-ink">{toolDiagnostics?.mcpSearch?.advertisedToolCount ?? runtimeInfo?.capabilities?.mcp?.search?.advertisedToolCount ?? 0}</span>
                        </div>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('configFilePath')}
                    description={t('mcpPathDesc')}
                    control={
                      <div className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-muted shadow-sm">
                        <code className="block break-all rounded-lg bg-ds-main/70 px-2 py-1 font-mono text-[12px] text-ds-ink">
                          {mcpConfigPath}
                        </code>
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpEditor')}
                    description={t('mcpEditorDesc')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="rounded-xl border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] leading-5 text-ds-muted">
                          {mcpConfigExists ? t('mcpFileStatusReady') : t('mcpFileStatusMissing')}
                        </div>
                        <textarea
                          value={mcpConfigText}
                          onChange={(e) => setMcpConfigText(e.target.value)}
                          spellCheck={false}
                          placeholder={mcpLoading ? t('loading') : ''}
                          className="min-h-[320px] w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                        />
                      </div>
                    }
                  />
                  <SettingRow
                    title={t('mcpActions')}
                    description={t('mcpRuntimeHint')}
                    wideControl
                    control={
                      <div className="flex w-full flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void saveMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            {mcpBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                            ) : null}
                            {t('mcpSave')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadMcpConfig()}
                            disabled={mcpBusy || mcpLoading}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${mcpLoading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                            {t('mcpReload')}
                          </button>
                          <button
                            type="button"
                            onClick={() => void openMcpConfigDir()}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                          >
                            <FolderOpen className="h-4 w-4" />
                            {t('mcpOpenDir')}
                          </button>
                        </div>
                        {mcpNotice ? <InlineNoticeView notice={mcpNotice} /> : null}
                      </div>
                    }
                  />
                      </div>
                    </AdvancedSettingsDisclosure>
                  </div>
                </SettingsCard>
              </div>

              <div ref={permissionsSectionRef} className="mt-6">
                <ComputerUseSettingsCard ctx={ctx} />
              </div>

              <div className="mt-6">
                <SettingsCard title={t('kunPermissions')}>
                  <SettingRow
                    title={t('approvalPolicy')}
                    description={t('approvalPolicyDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={kun.approvalPolicy}
                        onChange={(e) =>
                          updateKun({
                            approvalPolicy: e.target.value as ApprovalPolicy
                          })
                        }
                      >
                        <option value="auto">{t('approvalAuto')}</option>
                        <option value="on-request">{t('approvalOnRequest')}</option>
                        <option value="untrusted">{t('approvalUntrusted')}</option>
                        <option value="suggest">{t('approvalSuggest')}</option>
                        <option value="never">{t('approvalNever')}</option>
                      </select>
                    }
                  />
                  <SettingRow
                    title={t('sandboxMode')}
                    description={t('sandboxModeDesc')}
                    control={
                      <select
                        className={selectControlClass}
                        value={kun.sandboxMode}
                        onChange={(e) =>
                          updateKun({
                            sandboxMode: e.target.value as SandboxMode
                          })
                        }
                      >
                        <option value="workspace-write">{t('sandboxWorkspaceWrite')}</option>
                        <option value="read-only">{t('sandboxReadOnly')}</option>
                        <option value="danger-full-access">{t('sandboxFullAccess')}</option>
                        <option value="external-sandbox">{t('sandboxExternal')}</option>
                      </select>
                    }
                  />
                </SettingsCard>
              </div>
            </>
  )
}

function ComputerUseSettingsCard({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    update,
    runtimeDiagnosticsBusy
  } = ctx
  const initialStatus = ctx.computerUseStatus as ComputerUseStatusView | null | undefined
  const [status, setStatus] = useState<ComputerUseStatusView | null>(initialStatus ?? null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'info' | 'success'; message: string } | null>(null)
  const computerUse = form ? getComputerUseSettings(form) : defaultComputerUseSettings()
  const backend = status?.runtime.backend
  const activeLeases = status?.runtime.activeLeases ?? []
  const recentRejections = status?.runtime.recentRejections ?? []
  const permissions = status?.permissions
  const platform = permissions?.platform ?? (typeof window !== 'undefined' ? window.dsGui?.platform : '')
  const needsPermission = permissions?.needsPermission ?? platform === 'darwin'
  const canRequestPermission = typeof window !== 'undefined' && typeof window.dsGui?.requestComputerUsePermission === 'function'
  const updateRuntimeEnabled = (runtimeId: AgentRuntimeId, enabled: boolean): void => {
    update({
      computerUse: {
        ...computerUse,
        runtimeEnabled: {
          ...computerUse.runtimeEnabled,
          [runtimeId]: enabled
        }
      }
    })
  }

  const refresh = async (): Promise<void> => {
    if (typeof window === 'undefined' || typeof window.dsGui?.getComputerUseStatus !== 'function') return
    setBusy(true)
    setNotice(null)
    try {
      setStatus(await window.dsGui.getComputerUseStatus())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const requestPermission = async (kind: ComputerUsePermissionKind): Promise<void> => {
    if (!canRequestPermission) return
    setBusy(true)
    setNotice(null)
    try {
      const nextPermissions = await window.dsGui.requestComputerUsePermission(kind)
      setStatus((current) => current
        ? { ...current, permissions: nextPermissions }
        : {
            settings: computerUse,
            permissions: nextPermissions,
            runtime: {
              updatedAt: new Date(0).toISOString(),
              servers: [],
              activeLeases: [],
              recentRejections: [],
              backend: null
            }
          })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }

  const permissionBadge = (label: string, state: ComputerUsePermissionState): ReactNode => (
    <span className={`rounded-lg border px-2 py-0.5 text-[12px] font-medium ${permissionBadgeClass(state)}`}>
      {label}: {t(`computerUsePermission_${state}`)}
    </span>
  )

  return (
    <SettingsCard title={t('computerUseTitle')}>
      <div className="px-3 py-4">
        <InlineNoticeView notice={{ tone: 'info', message: t('computerUseHint') }} />
      </div>
      <SettingRow
        title={t('computerUseEnable')}
        description={t('computerUseEnableDesc')}
        control={
          <Toggle
            checked={computerUse.enabled}
            onChange={(enabled) => update({ computerUse: { ...computerUse, enabled } })}
          />
        }
      />
      <SettingRow
        title={t('computerUseRuntimeAccess')}
        description={t('computerUseRuntimeAccessDesc')}
        wideControl
        control={
          <div className="grid gap-2 sm:grid-cols-3">
            {([
              ['kun', t('agentRuntimeKun')],
              ['codex', t('agentRuntimeCodex')],
              ['claude', t('agentRuntimeClaude')]
            ] as const).map(([runtimeId, label]) => (
              <label
                key={runtimeId}
                className="flex items-center justify-between gap-3 rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12.5px] font-medium text-ds-ink"
              >
                <span>{label}</span>
                <Toggle
                  checked={computerUse.runtimeEnabled[runtimeId]}
                  disabled={!computerUse.enabled}
                  onChange={(enabled) => updateRuntimeEnabled(runtimeId, enabled)}
                />
              </label>
            ))}
          </div>
        }
      />
      <SettingRow
        title={t('computerUseBackend')}
        description={t('computerUseBackendDesc')}
        wideControl
        control={
          <div className="grid gap-3">
            <div className="grid gap-2 text-[12.5px] text-ds-muted sm:grid-cols-3">
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUseConfiguredBackend')}: <span className="font-mono text-ds-ink">{computerUse.backend}</span>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUseRuntimeBackend')}: <span className="font-mono text-ds-ink">{backend?.backend ?? computerUse.backend}</span>
              </div>
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                {t('computerUsePlatform')}: <span className="font-mono text-ds-ink">{backend?.platform ?? platform ?? 'unknown'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${computerUseStatusPill(backend?.available)}`}
              >
                {backend?.available
                  ? t('computerUseBackendAvailable')
                  : backend
                    ? t('computerUseBackendUnavailable')
                    : t('computerUseBackendUnknown')}
              </span>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy || runtimeDiagnosticsBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} strokeWidth={1.75} />
                {t('computerUseRefresh')}
              </button>
              {notice ? <InlineNoticeView notice={notice} /> : null}
            </div>
            {backend?.reason ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2 text-[12.5px] leading-5 text-ds-muted">
                {backend.reason}
              </div>
            ) : null}
            {!computerUse.enabled ? (
              <InlineNoticeView notice={{ tone: 'info', message: t('computerUseDisabledHint') }} />
            ) : null}
          </div>
        }
      />
      {needsPermission ? (
        <SettingRow
          title={t('computerUsePermissions')}
          description={t('computerUsePermissionsDesc')}
          wideControl
          control={
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                {permissions?.accessibilityNeedsRestart ? (
                  <span className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[12px] font-medium text-amber-700 dark:text-amber-200">
                    {t('computerUseAccessibility')}: {t('computerUsePermissionNeedsRestart')}
                  </span>
                ) : (
                  permissionBadge(t('computerUseAccessibility'), permissions?.accessibility ?? 'unknown')
                )}
                {permissionBadge(t('computerUseScreenRecording'), permissions?.screenRecording ?? 'unknown')}
              </div>
              {permissions?.accessibilityNeedsRestart ? (
                <p className="text-[12px] leading-5 text-amber-700 dark:text-amber-200">
                  {t('computerUseRestartHint')}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={!canRequestPermission || busy}
                  onClick={() => void requestPermission('accessibility')}
                >
                  {t('computerUseGrantAccessibility')}
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
                  disabled={!canRequestPermission || busy}
                  onClick={() => void requestPermission('screenRecording')}
                >
                  {t('computerUseGrantScreenRecording')}
                </button>
              </div>
            </div>
          }
        />
      ) : null}
      <SettingRow
        title={t('computerUseActiveLeases')}
        description={t('computerUseActiveLeasesDesc')}
        wideControl
        control={
          <div className="grid gap-2">
            {activeLeases.length === 0 ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                {t('computerUseNoActiveLeases')}
              </div>
            ) : activeLeases.slice(0, 6).map((lease) => (
              <div key={lease.leaseId} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="truncate text-[13px] font-semibold text-ds-ink">{lease.targetId}</div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ds-faint">
                  <span className="font-mono">{lease.agentId}</span>
                  <span className="font-mono">{lease.threadId}</span>
                  {lease.turnId ? <span className="font-mono">{lease.turnId}</span> : null}
                  <span className="font-mono">{lease.computerUseSessionId}</span>
                  <span>{new Date(lease.updatedAt).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        }
      />
      <SettingRow
        title={t('computerUseRecentRejections')}
        description={t('computerUseRecentRejectionsDesc')}
        wideControl
        control={
          <div className="grid gap-2">
            {recentRejections.length === 0 ? (
              <div className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-3 text-[13px] text-ds-faint">
                {t('computerUseNoRecentRejections')}
              </div>
            ) : recentRejections.slice(-6).reverse().map((rejection, index) => (
              <div key={`${rejection.code}-${rejection.targetId ?? 'target'}-${index}`} className="rounded-xl border border-ds-border-muted bg-ds-main/40 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-amber-300/60 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                    {rejection.code}
                  </span>
                  {rejection.targetId ? <span className="font-mono text-[11px] text-ds-faint">{rejection.targetId}</span> : null}
                </div>
                <div className="mt-1 text-[12.5px] leading-5 text-ds-muted">{rejection.message}</div>
              </div>
            ))}
          </div>
        }
      />
    </SettingsCard>
  )
}
