import { z } from 'zod'
import {
  ApprovalPolicySchema,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  SandboxModeSchema
} from '../contracts/policy.js'
import {
  ContextCompactionConfigSchema,
  DEFAULT_STORAGE_CONFIG,
  ModelConfigSchema,
  RuntimeTuningConfigSchema,
  StorageConfigSchema,
  TokenEconomyConfigSchema
} from '../config/kun-config.js'
import {
  DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG,
  LocalRuntimeCapabilitiesConfig
} from '../contracts/capabilities.js'

export const DEFAULT_SERVE_PORT = 8899
export const DEFAULT_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'
export const DEFAULT_SERVE_MODEL = 'sciforge-router'

/**
 * Validated CLI options for SciForge Runtime serve mode.
 *
 * `host` and `port` decide the bind address. `dataDir` is the on-disk root
 * for thread JSONL logs and indexes. `runtimeToken` is the bearer token
 * the GUI must send for `/v1/*` requests. The optional `insecure` flag
 * disables the token check (only allowed when the GUI is local).
 */
export const ServeOptionsSchema = z.object({
  configPath: z.string().optional(),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(0).max(65_535).default(DEFAULT_SERVE_PORT),
  dataDir: z.string().min(1),
  runtimeToken: z.string().default(''),
  apiKey: z.string().default(''),
  modelRouterBaseUrl: z.string().default(DEFAULT_MODEL_ROUTER_BASE_URL),
  model: z.string().default(DEFAULT_SERVE_MODEL),
  forceDefaultModel: z.boolean().default(false),
  approvalPolicy: ApprovalPolicySchema.default(DEFAULT_APPROVAL_POLICY),
  sandboxMode: SandboxModeSchema.default(DEFAULT_SANDBOX_MODE),
  tokenEconomyMode: z.boolean().default(false),
  tokenEconomy: TokenEconomyConfigSchema.optional(),
  insecure: z.boolean().default(false),
  storage: StorageConfigSchema.default(DEFAULT_STORAGE_CONFIG),
  models: ModelConfigSchema.optional(),
  contextCompaction: ContextCompactionConfigSchema.optional(),
  runtime: RuntimeTuningConfigSchema.optional(),
  capabilities: LocalRuntimeCapabilitiesConfig.default(DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG)
})
export type ServeOptions = z.infer<typeof ServeOptionsSchema>

export const DEFAULT_SERVE_OPTIONS: ServeOptions = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  apiKey: '',
  modelRouterBaseUrl: DEFAULT_MODEL_ROUTER_BASE_URL,
  model: DEFAULT_SERVE_MODEL,
  forceDefaultModel: false,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  tokenEconomyMode: false,
  insecure: false,
  storage: DEFAULT_STORAGE_CONFIG,
  capabilities: DEFAULT_LOCAL_RUNTIME_CAPABILITIES_CONFIG
}
