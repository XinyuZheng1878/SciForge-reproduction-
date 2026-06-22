import type { GuiUpdateChannel } from './gui-update'
import type { KeyboardShortcutsConfigV1 } from './keyboard-shortcuts'
import type { SpeechToTextSettingsPatchV1, SpeechToTextSettingsV1 } from './speech-to-text'
import type { ApprovalPolicy, SandboxMode } from '../../kun/src/contracts/policy.js'
import type { ModelEndpointFormat } from '../../kun/src/contracts/model-endpoint-format.js'
export {
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  MODEL_ENDPOINT_FORMATS,
  modelEndpointPath,
  normalizeModelEndpointFormat
} from '../../kun/src/contracts/model-endpoint-format.js'
export { DEFAULT_GUI_UPDATE_CHANNEL, normalizeGuiUpdateChannel, type GuiUpdateChannel } from './gui-update'
export {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../../kun/src/contracts/policy.js'
export type UiFontScale = 'small' | 'medium' | 'large'
export type ScheduleRunMode = 'agent' | 'plan'
export type ScheduleKind = 'manual' | 'interval' | 'daily' | 'at'
export type ScheduleTaskStatus = 'idle' | 'running' | 'success' | 'error'
export type ScheduleModel = 'auto' | 'deepseek-v4-pro' | 'deepseek-v4-flash'
export type ScheduleReasoningEffort = 'off' | 'low' | 'medium' | 'high' | 'max'
export type ClawRunMode = ScheduleRunMode
export type ClawImProvider = 'feishu' | 'weixin' | 'discord'
export type ClawImChannelGuardModeV1 = 'only_mention' | 'all_messages' | 'off'
export type ClawScheduleKind = ScheduleKind
export type ClawTaskStatus = ScheduleTaskStatus
export type ClawModel = ScheduleModel

export const DEFAULT_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
export const DEFAULT_MODEL_ROUTER_PUBLIC_MODEL_ALIAS = 'sciforge-router'
export const LEGACY_MODEL_ROUTER_PUBLIC_MODEL_ALIAS = 'deepseek-gui-router'
export const DEFAULT_MODEL_ROUTER_PROVIDER_ID = 'sciforge-model-router'
export const LEGACY_MODEL_ROUTER_PROVIDER_ID = 'deepseek-gui-model-router'
export const DEFAULT_DEEPSEEK_BASE_URL = DEFAULT_MODEL_ROUTER_BASE_URL
export const DEFAULT_CLAW_MODEL = 'auto'
export const CLAW_MODEL_IDS = ['auto', 'deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_SCHEDULE_MODEL = DEFAULT_CLAW_MODEL
export const SCHEDULE_MODEL_IDS = CLAW_MODEL_IDS
export const DEFAULT_SCHEDULE_REASONING_EFFORT = 'medium'
export const SCHEDULE_REASONING_EFFORT_IDS = ['off', 'low', 'medium', 'high', 'max'] as const
export const DEFAULT_SCHEDULE_INTERNAL_PORT = 8788
export const DEFAULT_WRITE_WORKSPACE_ROOT = '~/.sciforge/write_workspace'
export const DEFAULT_KUN_DATA_DIR = '~/.sciforge/kun'
export const DEFAULT_CODEX_DATA_DIR = '~/.sciforge/codex'
export const DEFAULT_CLAUDE_CONFIG_DIR = '~/.sciforge/claude-code'
export const DEFAULT_KUN_MODEL = 'deepseek-v4-pro'
export const DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL = DEFAULT_MODEL_ROUTER_BASE_URL
export const DEFAULT_WRITE_INLINE_COMPLETION_MODEL = 'deepseek-v4-flash'
export const WRITE_INLINE_COMPLETION_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-v4-flash'] as const
export const DEFAULT_WRITE_INLINE_COMPLETION_DEBOUNCE_MS = 650
export const DEFAULT_WRITE_INLINE_COMPLETION_MIN_ACCEPT_SCORE = 0.52
export const DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS = 96
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_DEBOUNCE_MS = 2_800
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MIN_ACCEPT_SCORE = 0.36
export const DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS = 256
export const DEFAULT_KUN_PORT = 8899
export const DEFAULT_WEIXIN_BRIDGE_RPC_URL = 'http://127.0.0.1:18790/api/v1/admin/rpc'
export const DEFAULT_MODEL_PROVIDER_ID = 'deepseek'
export type { ModelEndpointFormat }
export type { SpeechToTextSettingsPatchV1, SpeechToTextSettingsV1 } from './speech-to-text'
export type ModelProviderProfileV1 = {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  endpointFormat: ModelEndpointFormat
  models: string[]
}
export type ModelProviderSettingsV1 = {
  apiKey: string
  baseUrl: string
  providers: ModelProviderProfileV1[]
}

export type ModelProviderProfilePatchV1 = Partial<ModelProviderProfileV1>
export type ModelProviderSettingsPatchV1 = Partial<
  Omit<ModelProviderSettingsV1, 'providers'>
> & {
  providers?: ModelProviderProfilePatchV1[]
}

export type ModelRouterMemberProviderSettingsV1 = {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

export type ModelRouterProfileSettingsV1 = {
  textReasoner: ModelRouterMemberProviderSettingsV1
  translators: {
    vision: ModelRouterMemberProviderSettingsV1
  }
}

export type ModelRouterSettingsV1 = {
  enabled: boolean
  baseUrl: string
  autoStart: boolean
  publicModelAlias: string
  runtimeApiKey: string
  profiles: {
    default: ModelRouterProfileSettingsV1
  }
}

export type ModelRouterMemberProviderSettingsPatchV1 =
  Partial<ModelRouterMemberProviderSettingsV1>

export type ModelRouterProfileSettingsPatchV1 = {
  textReasoner?: ModelRouterMemberProviderSettingsPatchV1
  translators?: {
    vision?: ModelRouterMemberProviderSettingsPatchV1
  }
}

export type ModelRouterSettingsPatchV1 = Partial<
  Omit<ModelRouterSettingsV1, 'profiles'>
> & {
  profiles?: {
    default?: ModelRouterProfileSettingsPatchV1
  }
}

export type AgentRuntimeId = 'kun' | 'codex' | 'claude'

export type AgentThreadIdsV1 = Partial<Record<AgentRuntimeId, string>>

export type KunRuntimeSettingsV1 = {
  binaryPath: string
  port: number
  autoStart: boolean
  /** Optional override. Leave empty to inherit the General model provider API key. */
  apiKey: string
  /** Optional override. Leave empty to inherit the General model provider Base URL. */
  baseUrl: string
  /** Selected General model provider profile. Empty or missing means the default provider. */
  providerId: string
  /** Effective model request format. Resolved from the selected model provider. */
  endpointFormat: ModelEndpointFormat
  runtimeToken: string
  dataDir: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  /** Compress safe tool context before each model call. */
  tokenEconomyMode: boolean
  /** Detailed token-saving behavior used when building Kun model requests. */
  tokenEconomy: KunTokenEconomySettingsV1
  /** When true, the runtime skips bearer-token auth. Local dev only. */
  insecure: boolean
  /** GUI-managed MCP progressive discovery/search settings written into Kun config.json. */
  mcpSearch: KunMcpSearchSettingsV1
  /** Persistent store backend used by Kun. */
  storage: KunStorageSettingsV1
  /** Fallback compaction thresholds and summary behavior. Per-model thresholds live in Kun config models.profiles. */
  contextCompaction: KunContextCompactionSettingsV1
  /** Low-level model argument repair tuning. Runtime-neutral loop guards live in `runtimeGuards`. */
  runtimeTuning: KunRuntimeTuningSettingsV1
}

export type KunMcpSearchMode = 'direct' | 'search' | 'auto'

export type KunMcpSearchSettingsV1 = {
  enabled: boolean
  mode: KunMcpSearchMode
  autoThresholdToolCount: number
  topKDefault: number
  topKMax: number
  minScore: number
}

export type KunStorageBackend = 'hybrid' | 'file'

export type KunStorageSettingsV1 = {
  backend: KunStorageBackend
  sqlitePath: string
}

export type KunCompactionSummaryMode = 'heuristic' | 'model'

export type KunHistoryHygieneSettingsV1 = {
  maxToolResultLines: number
  maxToolResultBytes: number
  maxToolResultTokens: number
  maxToolArgumentStringBytes: number
  maxToolArgumentStringTokens: number
  maxArrayItems: number
}

export type KunTokenEconomySettingsV1 = {
  enabled: boolean
  compressToolDescriptions: boolean
  compressToolResults: boolean
  conciseResponses: boolean
  historyHygiene: KunHistoryHygieneSettingsV1
}

export type KunContextCompactionSettingsV1 = {
  defaultSoftThreshold: number
  defaultHardThreshold: number
  summaryMode: KunCompactionSummaryMode
  summaryTimeoutMs: number
  summaryMaxTokens: number
  summaryInputMaxBytes: number
}

export type KunToolArgumentRepairSettingsV1 = {
  maxStringBytes: number
}

export type KunRuntimeTuningSettingsV1 = {
  toolArgumentRepair: KunToolArgumentRepairSettingsV1
}

export type RuntimeToolStormGuardSettingsV1 = {
  enabled: boolean
  windowSize: number
  softThreshold: number
  hardThreshold: number
}

export type RuntimeBudgetSettingsV1 = {
  defaultMaxToolEvents: number
  writeMaxToolEvents: number
  remoteGuardMaxToolEvents: number
}

export type RuntimeGuardSettingsV1 = {
  toolStorm: RuntimeToolStormGuardSettingsV1
  budgets: RuntimeBudgetSettingsV1
}

export type RuntimeGuardSettingsPatchV1 = {
  toolStorm?: Partial<RuntimeToolStormGuardSettingsV1>
  budgets?: Partial<RuntimeBudgetSettingsV1>
}

export type CodexRuntimeSettingsV1 = {
  command: string
  autoStart: boolean
  codexHome: string
  profile: string
  model: string
  modelProvider: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  extraArgs: string[]
}

export type ClaudeRuntimeSettingsV1 = {
  command: string
  configDir: string
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  extraArgs: string[]
}

/**
 * Compatibility shell kept because old persisted settings only have
 * `agents.kun`. New code should read runtime settings through the
 * dedicated helper for each runtime so missing migrated fields get
 * defaulted consistently.
 */
export type KunSettingsEnvelopeV1 = {
  kun: KunRuntimeSettingsV1
  codex?: CodexRuntimeSettingsV1
  claude?: ClaudeRuntimeSettingsV1
}

export type AgentRuntimeSettingsMapV1 = KunSettingsEnvelopeV1

export type KunRuntimeTuningSettingsPatchV1 = {
  toolArgumentRepair?: Partial<KunToolArgumentRepairSettingsV1>
}

export type KunTokenEconomySettingsPatchV1 = Partial<
  Omit<KunTokenEconomySettingsV1, 'historyHygiene'>
> & {
  historyHygiene?: Partial<KunHistoryHygieneSettingsV1>
}

export type KunRuntimeSettingsPatchV1 = Partial<
  Omit<
    KunRuntimeSettingsV1,
    'mcpSearch' | 'storage' | 'contextCompaction' | 'runtimeTuning' | 'tokenEconomy'
  >
> & {
  mcpSearch?: Partial<KunMcpSearchSettingsV1>
  tokenEconomy?: KunTokenEconomySettingsPatchV1
  storage?: Partial<KunStorageSettingsV1>
  contextCompaction?: Partial<KunContextCompactionSettingsV1>
  runtimeTuning?: KunRuntimeTuningSettingsPatchV1
}

export type KunSettingsEnvelopePatchV1 = {
  kun?: KunRuntimeSettingsPatchV1
  codex?: CodexRuntimeSettingsPatchV1
  claude?: ClaudeRuntimeSettingsPatchV1
}

export type CodexRuntimeSettingsPatchV1 = Partial<CodexRuntimeSettingsV1>
export type ClaudeRuntimeSettingsPatchV1 = Partial<ClaudeRuntimeSettingsV1>

export type LogConfigV1 = {
  enabled: boolean
  retentionDays: number
}

export type NotificationConfigV1 = {
  turnComplete: boolean
}

export type AppBehaviorConfigV1 = {
  openAtLogin: boolean
  startMinimized: boolean
  closeToTray: boolean
}

export type ScheduleSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
}

export type ScheduledTaskScheduleV1 = {
  kind: ScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ScheduledTaskV1 = {
  id: string
  title: string
  enabled: boolean
  prompt: string
  workspaceRoot: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
  schedule: ScheduledTaskScheduleV1
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: ScheduleTaskStatus
  lastMessage: string
  lastThreadId: string
  runtimeId?: AgentRuntimeId
  agentThreadIds?: AgentThreadIdsV1
}

export type ScheduleInternalSettingsV1 = {
  port: number
  secret: string
}

export type ScheduleSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  model: string
  mode: ScheduleRunMode
  promptPrefix: string
  skills: ScheduleSkillSettingsV1
  keepAwake: boolean
  internal: ScheduleInternalSettingsV1
  tasks: ScheduledTaskV1[]
}

export type ClawSkillSettingsV1 = {
  defaultNames: string[]
  extraDirs: string[]
  promptPrefix: string
}

export type ClawImSettingsV1 = {
  enabled: boolean
  provider: ClawImProvider
  port: number
  path: string
  secret: string
  weixinBridgeUrl: string
  workspaceRoot: string
  model: string
  mode: ClawRunMode
  responseTimeoutMs: number
}

export type ClawTaskScheduleV1 = {
  kind: ClawScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
}

export type ClawTaskV1 = ScheduledTaskV1

export type ClawImAgentProfileV1 = {
  name: string
  description: string
  identity: string
  personality: string
  userContext: string
  replyRules: string
}

export type ClawImFeishuPlatformCredentialV1 = {
  kind: 'feishu'
  appId: string
  appSecret: string
  domain: string
  createdAt: string
}

export type ClawImWeixinPlatformCredentialV1 = {
  kind: 'weixin'
  accountId: string
  sessionKey: string
  createdAt: string
}

export type ClawImDiscordPlatformCredentialV1 = {
  kind: 'discord'
  applicationId: string
  botId: string
  botUsername: string
  guildId: string
  guildName: string
  channelId: string
  channelName: string
  installationId?: string
  guardOwnerInstallationId?: string
  guardOwnerUpdatedAt?: string
  createdAt: string
}

export type ClawImPlatformCredentialV1 =
  | ClawImFeishuPlatformCredentialV1
  | ClawImWeixinPlatformCredentialV1
  | ClawImDiscordPlatformCredentialV1

export type ClawImRemoteSessionV1 = {
  chatId: string
  messageId: string
  threadId: string
  senderId: string
  senderName: string
  updatedAt: string
}

export type ClawImRecentMessageV1 = {
  provider: ClawImProvider
  channelId: string
  chatId: string
  remoteThreadId: string
  messageId: string
  senderName?: string
  text?: string
  receivedAt: string
}

export type ClawImLastFailureV1 = {
  provider: ClawImProvider
  message: string
  failureKind?: string
  failureTitle?: string
  channelId?: string
  chatId?: string
  remoteThreadId?: string
  threadId?: string
  runtimeId?: AgentRuntimeId
  occurredAt: string
}

export type ClawImConversationV1 = {
  id: string
  chatId: string
  remoteThreadId: string
  latestMessageId: string
  senderId: string
  senderName: string
  /** Kun thread id this conversation maps to. */
  localThreadId: string
  runtimeId?: AgentRuntimeId
  agentThreadIds?: AgentThreadIdsV1
  workspaceRoot: string
  lastFailure?: ClawImLastFailureV1
  createdAt: string
  updatedAt: string
}

export type ClawImChannelV1 = {
  id: string
  provider: ClawImProvider
  label: string
  enabled: boolean
  guardMode?: ClawImChannelGuardModeV1
  model: string
  /** Kun thread id this channel maps to. */
  threadId: string
  runtimeId?: AgentRuntimeId
  agentThreadIds?: AgentThreadIdsV1
  workspaceRoot: string
  agentProfile: ClawImAgentProfileV1
  platformCredential?: ClawImPlatformCredentialV1
  remoteSession?: ClawImRemoteSessionV1
  conversations: ClawImConversationV1[]
  recentMessages?: ClawImRecentMessageV1[]
  lastFailure?: ClawImLastFailureV1
  createdAt: string
  updatedAt: string
}

export type ClawSettingsV1 = {
  enabled: boolean
  skills: ClawSkillSettingsV1
  im: ClawImSettingsV1
  channels: ClawImChannelV1[]
  tasks: ClawTaskV1[]
}

// Workflow (n8n-style node-based automation)
//
// A workflow is the multi-step generalization of a scheduled task: instead of a
// single prompt it is a graph of nodes connected by edges. The "ai-agent" node
// reuses the exact same Kun-runtime execution path as a scheduled task.
// ---------------------------------------------------------------------------

export type WorkflowNodeKind =
  | 'manual-trigger'
  | 'schedule-trigger'
  | 'webhook-trigger'
  | 'ai-agent'
  | 'generate-image'
  | 'condition'
  | 'switch'
  | 'filter'
  | 'set-fields'
  | 'code'
  | 'sort'
  | 'limit'
  | 'aggregate'
  | 'http-request'
  | 'merge'
  | 'subworkflow'
  | 'loop'
  | 'delay'
  | 'template'
  | 'json'
  | 'output'
  | 'parameter-extractor'
  | 'question-classifier'
  | 'human-approval'
  | 'custom'

export const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  'manual-trigger',
  'schedule-trigger',
  'webhook-trigger',
  'ai-agent',
  'generate-image',
  'condition',
  'switch',
  'filter',
  'set-fields',
  'code',
  'sort',
  'limit',
  'aggregate',
  'http-request',
  'merge',
  'subworkflow',
  'loop',
  'delay',
  'template',
  'json',
  'output',
  'parameter-extractor',
  'question-classifier',
  'human-approval',
  'custom'
]

export type WorkflowRunStatus = 'idle' | 'running' | 'success' | 'error'
export type WorkflowNodeRunStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

/** Schedule trigger extends the scheduled-task schedule kinds with cron. */
export type WorkflowTriggerScheduleKind = ScheduleKind | 'cron'

export type WorkflowScheduleV1 = {
  kind: WorkflowTriggerScheduleKind
  everyMinutes: number
  timeOfDay: string
  atTime: string
  /** Cron expression, used when kind === 'cron'. */
  cron: string
}

export type WorkflowConditionOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'

export type WorkflowHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const WORKFLOW_INPUT_FIELD_TYPES = ['text', 'paragraph', 'number', 'boolean', 'select', 'json'] as const
export type WorkflowInputFieldType = (typeof WORKFLOW_INPUT_FIELD_TYPES)[number]

/** Types offered for a node's typed inputs (subset of the field types — no select/paragraph). */
export const WORKFLOW_NODE_INPUT_TYPES = ['text', 'number', 'boolean', 'json'] as const
export type WorkflowNodeInputType = (typeof WORKFLOW_NODE_INPUT_TYPES)[number]

/**
 * A named, typed input a node pulls from an upstream node's output (dify-style).
 * `source` is an expression ({{$nodes.<id>.json.path}} / {{text}} / {{json.x}});
 * the resolved + coerced value is exposed to the node as {{$input.key}}.
 */
export type WorkflowNodeInputV1 = {
  key: string
  type: WorkflowNodeInputType
  source: string
}

/**
 * The value-type vocabulary the variable picker uses to badge a node's outputs.
 * A trimmed analogue of Dify's VarType — only what our nodes actually emit. NOT
 * persisted (never enters the settings schema); derived on the fly by
 * describeNodeOutput. `object` is drillable (has children); `json` is an opaque
 * blob the user dot-paths into manually; `any` is unknowable. Defer array[*]/file
 * until a node actually produces them.
 */
export const WORKFLOW_VAR_TYPES = ['string', 'number', 'boolean', 'object', 'json', 'any'] as const
export type WorkflowVarType = (typeof WORKFLOW_VAR_TYPES)[number]

/**
 * One advertised output field of a node, for the typed reference picker. `key` is
 * a dot-path relative to the node's json (or the literal 'text'). Derived metadata
 * only — see workflow-output-descriptors.ts. `children` cascades object types.
 */
export type WorkflowOutputVar = {
  key: string
  type: WorkflowVarType
  /** Present only for object types; lets the picker drill in. */
  children?: WorkflowOutputVar[]
  /** Optional human label for the picker row. */
  label?: string
}

/**
 * One typed input the caller supplies when starting a workflow. Drives the
 * "Run once" form, validates the /workflow/run + run_workflow input, and lifts
 * each value onto the run's initial payload.json by `key`.
 */
export type WorkflowInputFieldV1 = {
  key: string
  label: string
  type: WorkflowInputFieldType
  required: boolean
  /** Options for `select`. */
  options: string[]
  defaultValue: string
  description: string
}

/**
 * Triggers carry the run's working directory. When a workflow fires from this
 * trigger, `workspaceRoot` is the default cwd for AI / image / code nodes
 * (empty inherits settings.workflow.defaultWorkspaceRoot, then the app workspace).
 */
export type WorkflowManualTriggerConfigV1 = {
  workspaceRoot?: string
  /** Typed inputs the caller provides when starting the workflow. */
  inputSchema?: WorkflowInputFieldV1[]
}

export type WorkflowScheduleTriggerConfigV1 = {
  schedule: WorkflowScheduleV1
  workspaceRoot?: string
}

export type WorkflowWebhookMethod = 'ANY' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type WorkflowWebhookTriggerConfigV1 = {
  /** Path (leading slash) the local webhook listener matches, e.g. "/my-hook". */
  path: string
  method: WorkflowWebhookMethod
  workspaceRoot?: string
}

export type WorkflowAiAgentConfigV1 = {
  prompt: string
  workspaceRoot: string
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
  mode: ScheduleRunMode
}

export type WorkflowGenerateImageConfigV1 = {
  /** Image prompt; supports {{json.x}} / {{text}} interpolation. */
  prompt: string
  /** Provider profile (with an image capability) to use; empty falls back to the Settings image provider. */
  providerId: string
  /** Image model name; empty uses the provider/Settings default. */
  model: string
  /** Optional size override (e.g. "1024x1024"); empty uses the provider default. */
  size: string
  /**
   * Folder to save the image into. Empty = <workspace>/workflow-images.
   * Relative paths resolve against the workspace; absolute paths are used as-is.
   * Supports {{json.x}} / {{text}} interpolation.
   */
  outputDir: string
}

export type WorkflowConditionConfigV1 = {
  /** Accessor into the incoming payload, e.g. "text" or "json.value". Empty = previous node's text. */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

/** One rule of a Switch node; matches feed the output handle `case-<index>`. */
export type WorkflowSwitchRuleV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSwitchConfigV1 = {
  rules: WorkflowSwitchRuleV1[]
  /** When true, expose a `fallback` output for inputs that match no rule. */
  fallback: boolean
}

/** Filter gate: passes the payload through only when the condition holds. */
export type WorkflowFilterConfigV1 = {
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowSortOrder = 'asc' | 'desc'
export type WorkflowSortConfigV1 = {
  /** Field path within each array item; empty sorts by the item itself. */
  field: string
  order: WorkflowSortOrder
  numeric: boolean
}

export type WorkflowLimitFrom = 'first' | 'last'
export type WorkflowLimitConfigV1 = {
  count: number
  from: WorkflowLimitFrom
}

export type WorkflowAggregateMode = 'count' | 'sum' | 'collect' | 'join'
export type WorkflowAggregateConfigV1 = {
  mode: WorkflowAggregateMode
  /** Field path within each array item (for sum/collect/join). */
  field: string
  /** Separator for 'join' mode. */
  separator: string
}

export type WorkflowMergeMode = 'array' | 'object'

export type WorkflowMergeConfigV1 = {
  /** 'array' collects upstream outputs into a list; 'object' shallow-merges object outputs. */
  mode: WorkflowMergeMode
}

export const WORKFLOW_CODE_LANGUAGES = ['javascript', 'python', 'bash'] as const
export type WorkflowCodeLanguage = (typeof WORKFLOW_CODE_LANGUAGES)[number]
export type WorkflowCodeConfigV1 = {
  /** Execution language. javascript runs sandboxed in-process; python/bash spawn a local interpreter. */
  language: WorkflowCodeLanguage
  /**
   * Script body.
   * - javascript: receives $json / $text and may `return` a value (sandboxed, short timeout).
   * - python / bash: input arrives on stdin as JSON and via $WORKFLOW_JSON / $WORKFLOW_TEXT;
   *   whatever the script prints to stdout becomes the output (parsed as JSON when possible).
   */
  code: string
}

export type WorkflowSubWorkflowConfigV1 = {
  /** id of another workflow to run; its output becomes this node's output. */
  workflowId: string
}

/** Renders the payload into a free-form text string (or JSON parsed from it). */
export type WorkflowTemplateConfigV1 = {
  /** Template with {{json.x}} / {{text}} interpolation. */
  template: string
  /** 'text' emits the rendered string; 'json' parses it as JSON (falls back to { text }). */
  outputMode: 'text' | 'json'
}

/** Converts between text and structured JSON. */
export type WorkflowJsonConfigV1 = {
  /** 'parse' turns the incoming text into JSON; 'stringify' serializes the incoming JSON to text. */
  mode: 'parse' | 'stringify'
  /** When parsing, throw on invalid JSON instead of falling back to { text }. */
  strict: boolean
}

/**
 * Terminal node that shapes the workflow's final output — what run_workflow,
 * the local /workflow/run endpoint, and the run viewer treat as the result.
 */
export type WorkflowOutputConfigV1 = {
  /** 'auto' passes the incoming payload through; 'text' renders a template; 'json' extracts a path. */
  mode: 'auto' | 'text' | 'json'
  /** Used in 'text' mode — supports {{json.x}} / {{text}}. */
  textTemplate: string
  /** Used in 'json' mode — dot path into the incoming json (empty = the whole json). */
  jsonPath: string
}

/** A node that runs a user-defined custom module, with the module's field values. */
export type WorkflowCustomConfigV1 = {
  /** id of the WorkflowCustomModuleV1 this node runs. */
  moduleId: string
  /** Field key -> value (stored as strings; coerced by the field's type at runtime). */
  values: Record<string, string>
}

/** dify-style Parameter Extractor: an LLM turns free text into typed JSON fields. */
export type WorkflowParameterExtractorConfigV1 = {
  /** Expression for the source text (default {{text}}). */
  source: string
  instruction: string
  /** Fields to extract (reuses the typed input-field schema). */
  fields: WorkflowInputFieldV1[]
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowClassifierCategoryV1 = { id: string; label: string }

/** dify-style Question Classifier: an LLM routes the input to one of N categories. */
export type WorkflowQuestionClassifierConfigV1 = {
  /** Expression for the text to classify (default {{text}}). */
  source: string
  instruction: string
  categories: WorkflowClassifierCategoryV1[]
  providerId: string
  model: string
  reasoningEffort: ScheduleReasoningEffort
}

export type WorkflowApprovalDecision = 'approved' | 'rejected'

/** Human-in-the-loop pause: the run waits for an approve/reject decision before continuing. */
export type WorkflowHumanApprovalConfigV1 = {
  title: string
  instruction: string
  /** Auto-resolve after this many ms; 0 = wait indefinitely. */
  timeoutMs: number
  onTimeout: WorkflowApprovalDecision
}

export const WORKFLOW_MODULE_FIELD_TYPES = ['text', 'textarea', 'number', 'boolean', 'select'] as const
export type WorkflowModuleFieldType = (typeof WORKFLOW_MODULE_FIELD_TYPES)[number]

/** One input on a custom module's auto-generated form. */
export type WorkflowModuleFieldV1 = {
  /** Identifier exposed to the script as $fields.<key> / WORKFLOW_FIELDS[<key>]. */
  key: string
  label: string
  type: WorkflowModuleFieldType
  /** Default value (string form); number/boolean are coerced from this. */
  defaultValue: string
  /** Options for `select` fields. */
  options: string[]
  placeholder: string
}

/**
 * A reusable, user-defined module = a script (JS/Python/Shell) plus a set of
 * named form fields. Instantiated on the canvas as a `custom` node, which shows
 * a form generated from `fields` and runs `code` with those values injected.
 */
export type WorkflowCustomModuleV1 = {
  id: string
  name: string
  description: string
  /** Reserved for a future icon picker; empty uses a generic module icon. */
  icon: string
  language: WorkflowCodeLanguage
  fields: WorkflowModuleFieldV1[]
  code: string
}

/**
 * Loop agent: repeatedly runs a body workflow, feeding each iteration's output
 * back in as the next input, until the stop condition holds or maxIterations is
 * reached. Turns "you press enter each step" into "you set the goal, the loop runs".
 */
export type WorkflowLoopMode = 'condition' | 'foreach'
export type WorkflowLoopExecution = 'sequential' | 'parallel'

export type WorkflowLoopConfigV1 = {
  /** id of the workflow run once per iteration. */
  workflowId: string
  /** 'condition' (while-loop, default) or 'foreach' (iterate an array). */
  mode?: WorkflowLoopMode
  /** foreach: expression resolving to the array to iterate (empty = the incoming payload json). */
  arraySource?: string
  /** foreach: run items one-at-a-time or concurrently. */
  execution?: WorkflowLoopExecution
  /** foreach: max concurrent iterations when execution = 'parallel' (1-8). */
  concurrency?: number
  /** foreach: collect failed items as { error } instead of aborting the loop. */
  continueOnError?: boolean
  /** Caps iterations (condition mode) and array length (foreach mode). */
  maxIterations: number
  /** Stop-when condition evaluated against each iteration's output (condition mode). */
  leftExpr: string
  operator: WorkflowConditionOperator
  rightValue: string
  caseSensitive: boolean
}

export type WorkflowHttpHeaderV1 = {
  key: string
  value: string
}

export type WorkflowHttpRequestConfigV1 = {
  method: WorkflowHttpMethod
  url: string
  headers: WorkflowHttpHeaderV1[]
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  body: string
  timeoutMs: number
  /** Parse the response body as JSON into the payload for downstream nodes. */
  parseJson: boolean
}

export type WorkflowDelayConfigV1 = {
  delayMs: number
}

export type WorkflowFieldV1 = {
  key: string
  /** Templated with {{json.x}} / {{text}} from the incoming payload. */
  value: string
}

export type WorkflowSetFieldsConfigV1 = {
  fields: WorkflowFieldV1[]
  /** When true, merge the new fields onto the incoming json; otherwise replace it. */
  keepIncoming: boolean
  /** 'payload' (default) writes to the node output; 'run' writes into run-scoped vars ({{$run.key}}). */
  scope?: 'payload' | 'run'
}

export type WorkflowNodeConfigByKind = {
  'manual-trigger': WorkflowManualTriggerConfigV1
  'schedule-trigger': WorkflowScheduleTriggerConfigV1
  'webhook-trigger': WorkflowWebhookTriggerConfigV1
  'ai-agent': WorkflowAiAgentConfigV1
  'generate-image': WorkflowGenerateImageConfigV1
  condition: WorkflowConditionConfigV1
  switch: WorkflowSwitchConfigV1
  filter: WorkflowFilterConfigV1
  'set-fields': WorkflowSetFieldsConfigV1
  code: WorkflowCodeConfigV1
  sort: WorkflowSortConfigV1
  limit: WorkflowLimitConfigV1
  aggregate: WorkflowAggregateConfigV1
  'http-request': WorkflowHttpRequestConfigV1
  merge: WorkflowMergeConfigV1
  subworkflow: WorkflowSubWorkflowConfigV1
  loop: WorkflowLoopConfigV1
  delay: WorkflowDelayConfigV1
  template: WorkflowTemplateConfigV1
  json: WorkflowJsonConfigV1
  output: WorkflowOutputConfigV1
  'parameter-extractor': WorkflowParameterExtractorConfigV1
  'question-classifier': WorkflowQuestionClassifierConfigV1
  'human-approval': WorkflowHumanApprovalConfigV1
  custom: WorkflowCustomConfigV1
}

/** How a node behaves when its execution fails after retries. */
export type WorkflowNodeErrorMode = 'fail' | 'continue' | 'fallback'

/** Discriminated union over `type`, each kind carrying its own `config`. */
export type WorkflowNodeV1 = {
  [K in WorkflowNodeKind]: {
    id: string
    type: K
    /** Display label shown on the canvas. */
    name: string
    /** React Flow canvas coordinates. Opaque to the backend. */
    position: { x: number; y: number }
    disabled: boolean
    /** Error policy. Absent = 'fail' (the run stops) — preserves the original behavior. */
    onError?: WorkflowNodeErrorMode
    /** Retry attempts before applying onError (0 = no retry). */
    retries?: number
    retryDelayMs?: number
    /** For onError = 'fallback': JSON the node emits instead of failing. */
    fallbackJson?: string
    /** Named, typed inputs pulled from upstream output; resolved before the node runs as {{$input.key}}. */
    inputs?: WorkflowNodeInputV1[]
    config: WorkflowNodeConfigByKind[K]
  }
}[WorkflowNodeKind]

/** Flat edge array, binds directly to React Flow. Condition uses sourceHandle 'true' | 'false'. */
export type WorkflowConnectionV1 = {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export type WorkflowNodeRunResultV1 = {
  nodeId: string
  status: WorkflowNodeRunStatus
  startedAt: string
  finishedAt: string
  /** Assistant text / HTTP body / condition branch summary. */
  message: string
  /** JSON payload this node emitted, serialized. Empty when none. */
  outputJson: string
  /** JSON payload this node received, serialized. Empty when none. (For the run history viewer.) */
  inputJson?: string
  /** Retry attempts spent before this result (0/absent = first try). */
  retries?: number
  /** For ai-agent nodes: the Kun thread it created. */
  threadId: string
  error: string
}

/** Result of a single-node test run (not persisted to history). */
export type WorkflowNodeTestResult =
  | { ok: true; result: WorkflowNodeRunResultV1 }
  | { ok: false; message: string }

/** A human-approval node that has paused a run and is awaiting a decision. */
export type WorkflowPendingApprovalV1 = {
  token: string
  workflowId: string
  runId: string
  nodeId: string
  nodeName: string
  title: string
  instruction: string
  createdAt: string
}

export type WorkflowRunV1 = {
  id: string
  /** 'manual' | 'schedule' | trigger node id. */
  trigger: string
  status: WorkflowRunStatus
  startedAt: string
  finishedAt: string
  message: string
  nodeResults: WorkflowNodeRunResultV1[]
}

/** A workflow-scoped variable readable via {{$env.key}} in node expressions. */
export type WorkflowEnvVarV1 = {
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'secret'
}

export type WorkflowV1 = {
  id: string
  name: string
  enabled: boolean
  /** When true, the Kun agent may invoke this workflow as a tool (list_workflows / run_workflow). */
  callableByAgent: boolean
  /** Workflow-scoped variables, exposed to node expressions as {{$env.key}}. */
  env: WorkflowEnvVarV1[]
  nodes: WorkflowNodeV1[]
  connections: WorkflowConnectionV1[]
  createdAt: string
  updatedAt: string
  lastRunAt: string
  nextRunAt: string
  lastStatus: WorkflowRunStatus
  lastMessage: string
  /** Bounded history of recent runs (most recent last, capped). */
  runs: WorkflowRunV1[]
}

/**
 * A reusable palette item created by snapshotting a configured node. Dropping it
 * onto the canvas creates a fresh node of `nodeType` pre-filled with `config`.
 */
export type WorkflowNodePresetV1 = {
  id: string
  /** Palette label chosen by the user. */
  label: string
  /** Optional lucide icon name; empty falls back to the node kind's default icon. */
  icon: string
  /** Underlying built-in node kind this preset instantiates. */
  nodeType: WorkflowNodeKind
  /** Default name applied to the created node. */
  nodeName: string
  /** Saved config snapshot; shape matches `nodeType`. */
  config: WorkflowNodeV1['config']
}

/** The kun agent hook phases a workflow can be bound to. Mirrors kun's HOOK_PHASES. */
export const WORKFLOW_HOOK_PHASES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'TurnStart',
  'TurnEnd',
  'PreCompact'
] as const
export type WorkflowHookPhase = (typeof WORKFLOW_HOOK_PHASES)[number]

/** How a bound workflow's output maps back to the hook result. */
export const WORKFLOW_HOOK_MODES = ['observe', 'block', 'rewrite'] as const
export type WorkflowHookMode = (typeof WORKFLOW_HOOK_MODES)[number]

/** Binds a Create Loop workflow to a kun agent hook phase (reactive automation). */
export type WorkflowHookTriggerV1 = {
  id: string
  enabled: boolean
  /** Workflow to run when the phase fires. */
  workflowId: string
  phase: WorkflowHookPhase
  /** Exact tool names to match (tool phases only); empty matches all tools. */
  toolNames: string[]
  /**
   * observe = run, change nothing; block = deny the action if the workflow fails/says DENY;
   * rewrite = fold the workflow output into the tool result / injected context.
   */
  mode: WorkflowHookMode
  /** Hook timeout in ms; 0 uses the kun default. */
  timeoutMs: number
}

export type WorkflowSettingsV1 = {
  enabled: boolean
  defaultWorkspaceRoot: string
  /** Default model provider for new AI nodes. Empty inherits the Kun runtime provider. */
  providerId?: string
  model: string
  mode: ScheduleRunMode
  keepAwake: boolean
  /** Local-only (127.0.0.1) port the webhook-trigger listener binds to. */
  webhookPort: number
  /** Optional shared secret required on inbound webhook requests (x-kun-secret / Bearer). */
  webhookSecret: string
  workflows: WorkflowV1[]
  /** Reusable palette items the user saved from configured nodes. */
  presets: WorkflowNodePresetV1[]
  /** User-defined script-backed modules. */
  modules: WorkflowCustomModuleV1[]
  /** Workflows bound to kun agent hook phases (reactive automation in code mode). */
  hookTriggers: WorkflowHookTriggerV1[]
}

export type WorkflowSettingsPatchV1 = Partial<Omit<WorkflowSettingsV1, 'workflows'>> & {
  /** Replaced wholesale when present. */
  workflows?: Array<Partial<WorkflowV1>>
}

export type WorkflowRunResult =
  | { ok: true; runId: string; status: WorkflowRunStatus; message: string }
  | { ok: false; message: string }

/** Result of an editor-time syntax check on a Code node's script. */
export type WorkflowCodeCheckResult =
  | { status: 'ok' }
  | { status: 'error'; message: string }
  | { status: 'unavailable'; message: string }

export type WorkflowNodeStatusMap = Record<string, WorkflowNodeRunStatus>

export type WorkflowRuntimeStatus = {
  runningWorkflowIds: string[]
  /** workflowId -> nodeId -> live status, for lighting up the canvas during a run. */
  nodeStatus: Record<string, WorkflowNodeStatusMap>
  /** workflowId -> nodeId -> live per-node result (input/output/timing), for the run-log panel. */
  nodeResults: Record<string, Record<string, WorkflowNodeRunResultV1>>
  powerSaveBlockerActive: boolean
  /** Human-approval nodes currently paused, awaiting an approve/reject decision. */
  pendingApprovals: WorkflowPendingApprovalV1[]
}

export type WriteInlineCompletionSettingsV1 = {
  enabled: boolean
  retrievalEnabled: boolean
  longCompletionEnabled: boolean
  apiKey: string
  baseUrl: string
  /** When true, Write inherits Kun's runtime model instead of using `model` as an override. */
  inheritModel: boolean
  model: string
  debounceMs: number
  longDebounceMs: number
  minAcceptScore: number
  longMinAcceptScore: number
  maxTokens: number
  longMaxTokens: number
}

export type WriteSettingsV1 = {
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  workspaces: string[]
  inlineCompletion: WriteInlineCompletionSettingsV1
}

export type ClawSettingsPatchV1 = Partial<Omit<ClawSettingsV1, 'skills' | 'im' | 'channels' | 'tasks'>> & {
  skills?: Partial<ClawSkillSettingsV1>
  im?: Partial<ClawImSettingsV1>
  channels?: Array<Partial<ClawImChannelV1>>
  tasks?: Array<Partial<ClawTaskV1>>
}

export type ScheduleSettingsPatchV1 = Partial<
  Omit<ScheduleSettingsV1, 'skills' | 'internal' | 'tasks'>
> & {
  skills?: Partial<ScheduleSkillSettingsV1>
  internal?: Partial<ScheduleInternalSettingsV1>
  tasks?: Array<Partial<ScheduledTaskV1>>
}

export type WriteSettingsPatchV1 = Partial<Omit<WriteSettingsV1, 'inlineCompletion'>> & {
  inlineCompletion?: Partial<WriteInlineCompletionSettingsV1>
}

export type ClawGeneratedFileV1 = {
  path: string
  relativePath?: string
  fileName: string
}

export type ClawRunResult =
  | { ok: true; threadId: string; turnId?: string; text?: string; message?: string; files?: ClawGeneratedFileV1[] }
  | { ok: false; message: string }

export type ScheduleRunResult = ClawRunResult

export type ScheduleTaskFromTextResult =
  | { kind: 'noop' }
  | { kind: 'created'; taskId: string; title: string; scheduleAt: string; confirmationText: string }
  | { kind: 'error'; message: string }

export type ClawTaskFromTextResult = ScheduleTaskFromTextResult

export type ClawRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}

export type ScheduleRuntimeStatus = {
  internalServerRunning: boolean
  internalUrl: string
  runningTaskIds: string[]
  powerSaveBlockerActive: boolean
}

export type GuiUpdateConfigV1 = {
  channel: GuiUpdateChannel
}

export type AppSettingsV1 = {
  version: 1
  installationId?: string
  locale: 'en' | 'zh'
  theme: 'system' | 'light' | 'dark'
  uiFontScale: UiFontScale
  provider: ModelProviderSettingsV1
  modelRouter?: ModelRouterSettingsV1
  runtimeGuards?: RuntimeGuardSettingsV1
  activeAgentRuntime?: AgentRuntimeId
  agents: KunSettingsEnvelopeV1
  workspaceRoot: string
  log: LogConfigV1
  notifications: NotificationConfigV1
  appBehavior: AppBehaviorConfigV1
  keyboardShortcuts: KeyboardShortcutsConfigV1
  write: WriteSettingsV1
  speechToText?: SpeechToTextSettingsV1
  claw: ClawSettingsV1
  schedule: ScheduleSettingsV1
  workflow: WorkflowSettingsV1
  guiUpdate: GuiUpdateConfigV1
  codePromptPrefix: string
}

export type AppSettingsPatch = Partial<
  Omit<AppSettingsV1, 'provider' | 'agents' | 'log' | 'notifications' | 'appBehavior' | 'keyboardShortcuts' | 'write' | 'speechToText' | 'claw' | 'schedule' | 'workflow' | 'guiUpdate'>
> & {
  provider?: ModelProviderSettingsPatchV1
  modelRouter?: ModelRouterSettingsPatchV1
  runtimeGuards?: RuntimeGuardSettingsPatchV1
  agents?: KunSettingsEnvelopePatchV1
  log?: Partial<LogConfigV1>
  notifications?: Partial<NotificationConfigV1>
  appBehavior?: Partial<AppBehaviorConfigV1>
  keyboardShortcuts?: Partial<KeyboardShortcutsConfigV1>
  write?: WriteSettingsPatchV1
  speechToText?: SpeechToTextSettingsPatchV1
  claw?: ClawSettingsPatchV1
  schedule?: ScheduleSettingsPatchV1
  workflow?: WorkflowSettingsPatchV1
  guiUpdate?: Partial<GuiUpdateConfigV1>
}
