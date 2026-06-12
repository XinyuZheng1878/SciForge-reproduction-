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
  DEFAULT_KUN_CAPABILITIES_CONFIG,
  KunCapabilitiesConfig
} from '../contracts/capabilities.js'
import {
  type ModelEndpointFormat,
  MODEL_ENDPOINT_FORMATS,
  normalizeModelEndpointFormat
} from '../contracts/model-endpoint-format.js'

export const DEFAULT_SERVE_PORT = 8899
export const DEFAULT_SERVE_BASE_URL = 'http://127.0.0.1:3892/v1'
export const DEFAULT_SERVE_ENDPOINT_FORMAT: ModelEndpointFormat = 'responses'
export const DEFAULT_SERVE_MODEL = 'deepseek-gui-router'

/**
 * Validated CLI options for `kun serve`.
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
  baseUrl: z.string().default(DEFAULT_SERVE_BASE_URL),
  endpointFormat: z.preprocess(normalizeModelEndpointFormat, z.enum(MODEL_ENDPOINT_FORMATS)).default(DEFAULT_SERVE_ENDPOINT_FORMAT),
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
  capabilities: KunCapabilitiesConfig.default(DEFAULT_KUN_CAPABILITIES_CONFIG)
})
export type ServeOptions = z.infer<typeof ServeOptionsSchema>

export const DEFAULT_SERVE_OPTIONS: ServeOptions = {
  host: '127.0.0.1',
  port: DEFAULT_SERVE_PORT,
  dataDir: '',
  runtimeToken: '',
  apiKey: '',
  baseUrl: DEFAULT_SERVE_BASE_URL,
  endpointFormat: DEFAULT_SERVE_ENDPOINT_FORMAT,
  model: DEFAULT_SERVE_MODEL,
  forceDefaultModel: false,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  tokenEconomyMode: false,
  insecure: false,
  storage: DEFAULT_STORAGE_CONFIG,
  capabilities: DEFAULT_KUN_CAPABILITIES_CONFIG
}
