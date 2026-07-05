import { z } from 'zod'

export const REMOTE_EXECUTOR_MCP_SERVER_NAME = 'sciforge-remote-executor'
export const REMOTE_EXECUTOR_MCP_SERVER_VERSION = '0.1.0'
export const REMOTE_WORKER_PROTOCOL = 'sciforge.remote-worker.v1'
export const REMOTE_WORKER_ENTRYPOINT = 'remote_worker.py'

export const REMOTE_EXECUTOR_TOOL_NAMES = [
  'remote_list_targets',
  'remote_probe_target',
  'remote_deploy_worker',
  'remote_run',
  'remote_poll',
  'remote_write',
  'remote_stop',
  'remote_submit_job',
  'remote_job_status',
  'remote_cancel_job',
  'remote_read_output'
] as const

export const REMOTE_EXECUTOR_TOOL_SIDE_EFFECTS = {
  remote_list_targets: { effect: 'read-only', destructive: false },
  remote_probe_target: { effect: 'read-only', destructive: false },
  remote_deploy_worker: { effect: 'write', destructive: false },
  remote_run: { effect: 'write', destructive: false },
  remote_poll: { effect: 'read-only', destructive: false },
  remote_write: { effect: 'write', destructive: false },
  remote_stop: { effect: 'destructive', destructive: true },
  remote_submit_job: { effect: 'write', destructive: false },
  remote_job_status: { effect: 'read-only', destructive: false },
  remote_cancel_job: { effect: 'destructive', destructive: true },
  remote_read_output: { effect: 'read-only', destructive: false }
} as const satisfies Record<RemoteExecutorToolName, {
  effect: RemoteExecutorToolEffect
  destructive: boolean
}>

export const REMOTE_WORKER_CAPABILITIES = [
  'jsonl',
  'hello',
  'direct-run-stub',
  'stdin-stub',
  'cancel-stub',
  'slurm-stub'
] as const

export const remoteTargetKindSchema = z.enum(['ssh', 'local', 'mock'])
export const remoteRunStatusSchema = z.enum(['starting', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'])
export const remoteSchedulerSchema = z.enum(['slurm'])
export const remoteOutputStreamSchema = z.enum(['stdout', 'stderr', 'combined'])
export const remoteToolEffectSchema = z.enum(['read-only', 'write', 'destructive'])
export const slurmNormalizedStateSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timeout',
  'unknown'
])

const trimmedString = (max = 16_384) => z.string().trim().min(1).max(max)
const optionalTrimmedString = (max = 16_384) => z.string().trim().max(max).optional()
const targetIdField = trimmedString(256).describe('Remote target id from remote_list_targets')
const runIdField = trimmedString(256).describe('Run id returned by remote_run')
const jobIdField = trimmedString(256).describe('Scheduler job id returned by remote_submit_job')
const envSchema = z.record(z.string().min(1).max(256), z.string().max(16_384)).optional()

export const remoteTargetCapabilitiesSchema = z.object({
  directRun: z.boolean().optional(),
  stdin: z.boolean().optional(),
  deploy: z.boolean().optional(),
  slurm: z.boolean().optional()
}).strict()

export const remoteTargetInputSchema = z.object({
  id: optionalTrimmedString(256),
  label: optionalTrimmedString(512),
  kind: remoteTargetKindSchema.optional(),
  host: optionalTrimmedString(1024),
  user: optionalTrimmedString(256),
  port: z.number().int().min(1).max(65_535).optional(),
  disabled: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(128)).max(64).optional(),
  workspaceRoot: optionalTrimmedString(4096),
  capabilities: remoteTargetCapabilitiesSchema.optional(),
  auth: z.unknown().optional(),
  password: z.unknown().optional(),
  token: z.unknown().optional(),
  privateKey: z.unknown().optional(),
  private_key: z.unknown().optional()
}).passthrough()

export const remoteTargetSchema = z.object({
  id: trimmedString(256),
  label: z.string().max(512).optional(),
  kind: remoteTargetKindSchema,
  host: trimmedString(1024),
  user: z.string().max(256).optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  disabled: z.boolean(),
  tags: z.array(z.string().min(1).max(128)),
  workspaceRoot: z.string().max(4096).optional(),
  capabilities: z.object({
    directRun: z.boolean(),
    stdin: z.boolean(),
    deploy: z.boolean(),
    slurm: z.boolean()
  }).strict()
}).strict()

export const remoteListTargetsInputSchema = z.object({
  include_disabled: z.boolean().optional()
}).strict()

export const remoteProbeTargetInputSchema = z.object({
  target_id: targetIdField
}).strict()

export const remoteDeployWorkerInputSchema = z.object({
  target_id: targetIdField,
  remote_path: optionalTrimmedString(4096),
  force: z.boolean().optional(),
  dry_run: z.boolean().optional()
}).strict()

export const remoteRunInputSchema = z.object({
  target_id: targetIdField,
  command: z.union([
    trimmedString(16_384),
    z.array(trimmedString(1024)).min(1).max(256)
  ]),
  cwd: optionalTrimmedString(4096),
  env: envSchema,
  stdin: z.string().max(1024 * 1024).optional(),
  timeout_ms: z.number().int().min(1).max(24 * 60 * 60 * 1000).optional(),
  run_id: optionalTrimmedString(256)
}).strict()

export const remotePollInputSchema = z.object({
  run_id: runIdField
}).strict()

export const remoteWriteInputSchema = z.object({
  run_id: runIdField,
  data: z.string().max(1024 * 1024),
  eof: z.boolean().optional()
}).strict()

export const remoteStopInputSchema = z.object({
  run_id: runIdField,
  signal: z.enum(['TERM', 'INT', 'KILL']).optional()
}).strict()

export const remoteSubmitJobInputSchema = z.object({
  target_id: targetIdField,
  scheduler: remoteSchedulerSchema.optional(),
  script: trimmedString(1024 * 1024),
  name: optionalTrimmedString(256),
  cwd: optionalTrimmedString(4096),
  env: envSchema,
  dry_run: z.boolean().optional()
}).strict()

export const remoteJobStatusInputSchema = z.object({
  target_id: targetIdField,
  scheduler: remoteSchedulerSchema.optional(),
  job_id: jobIdField
}).strict()

export const remoteCancelJobInputSchema = z.object({
  target_id: targetIdField,
  scheduler: remoteSchedulerSchema.optional(),
  job_id: jobIdField
}).strict()

export const remoteReadOutputInputSchema = z.object({
  run_id: runIdField.optional(),
  target_id: targetIdField.optional(),
  job_id: jobIdField.optional(),
  stream: remoteOutputStreamSchema.optional(),
  offset: z.number().int().min(0).max(2_000_000_000).optional(),
  max_bytes: z.number().int().min(1).max(1024 * 1024).optional()
}).strict().superRefine((input, context) => {
  if (!input.run_id && !(input.target_id && input.job_id)) {
    context.addIssue({
      code: 'custom',
      message: 'Provide either run_id or target_id plus job_id.'
    })
  }
  if (input.run_id && (input.target_id || input.job_id)) {
    context.addIssue({
      code: 'custom',
      message: 'run_id cannot be combined with target_id or job_id.'
    })
  }
})

export const remoteExecutorErrorCodeSchema = z.enum([
  'invalid_request',
  'target_not_found',
  'target_unavailable',
  'worker_not_deployed',
  'run_not_found',
  'job_not_found',
  'unsupported_operation',
  'command_rejected',
  'timeout',
  'aborted',
  'remote_protocol_error',
  'internal_error',
  'unknown'
])

export const remoteExecutorErrorPayloadSchema = z.object({
  code: remoteExecutorErrorCodeSchema,
  reason: z.string().min(1),
  retryable: z.boolean(),
  suggestion: z.string().min(1),
  targetId: z.string().optional(),
  details: z.unknown().optional()
}).strict()

export const remoteWorkerManifestSchema = z.object({
  protocol: z.literal(REMOTE_WORKER_PROTOCOL),
  version: z.string().min(1),
  createdAt: z.string().min(1),
  entrypoint: z.literal(REMOTE_WORKER_ENTRYPOINT),
  files: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().min(0),
    mode: z.string().optional()
  }).strict()).min(1),
  capabilities: z.array(z.enum(REMOTE_WORKER_CAPABILITIES))
}).strict()

export const remoteJsonlEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(256).optional(),
  ts: z.string().optional(),
  type: z.string().min(1).max(128),
  payload: z.unknown().optional()
}).strict()

export type RemoteExecutorToolName = typeof REMOTE_EXECUTOR_TOOL_NAMES[number]
export type RemoteExecutorToolEffect = z.infer<typeof remoteToolEffectSchema>
export type RemoteTargetKind = z.infer<typeof remoteTargetKindSchema>
export type RemoteTargetCapabilities = z.infer<typeof remoteTargetCapabilitiesSchema>
export type RemoteTargetInput = z.input<typeof remoteTargetInputSchema>
export type RemoteTarget = z.infer<typeof remoteTargetSchema>
export type RemoteListTargetsInput = z.infer<typeof remoteListTargetsInputSchema>
export type RemoteProbeTargetInput = z.infer<typeof remoteProbeTargetInputSchema>
export type RemoteDeployWorkerInput = z.infer<typeof remoteDeployWorkerInputSchema>
export type RemoteRunInput = z.infer<typeof remoteRunInputSchema>
export type RemotePollInput = z.infer<typeof remotePollInputSchema>
export type RemoteWriteInput = z.infer<typeof remoteWriteInputSchema>
export type RemoteStopInput = z.infer<typeof remoteStopInputSchema>
export type RemoteSubmitJobInput = z.infer<typeof remoteSubmitJobInputSchema>
export type RemoteJobStatusInput = z.infer<typeof remoteJobStatusInputSchema>
export type RemoteCancelJobInput = z.infer<typeof remoteCancelJobInputSchema>
export type RemoteReadOutputInput = z.infer<typeof remoteReadOutputInputSchema>
export type RemoteExecutorErrorCode = z.infer<typeof remoteExecutorErrorCodeSchema>
export type RemoteExecutorErrorPayload = z.infer<typeof remoteExecutorErrorPayloadSchema>
export type RemoteWorkerManifest = z.infer<typeof remoteWorkerManifestSchema>
export type RemoteJsonlEnvelope<TType extends string = string, TPayload = unknown> = {
  v: 1
  id?: string
  ts?: string
  type: TType
  payload?: TPayload
}

export type RemoteWorkerRequestEnvelope =
  | RemoteJsonlEnvelope<'hello', { client: string }>
  | RemoteJsonlEnvelope<'run.start', { command: string[]; cwd?: string; env?: Record<string, string>; stdin?: string }>
  | RemoteJsonlEnvelope<'run.poll', { runId: string }>
  | RemoteJsonlEnvelope<'run.stdin', { runId: string; data: string; eof?: boolean }>
  | RemoteJsonlEnvelope<'run.cancel', { runId: string; signal?: string }>
  | RemoteJsonlEnvelope<'slurm.submit', { script: string; name?: string; cwd?: string; env?: Record<string, string> }>
  | RemoteJsonlEnvelope<'slurm.status', { jobId: string }>
  | RemoteJsonlEnvelope<'slurm.cancel', { jobId: string }>

export type RemoteWorkerResponseEnvelope =
  | RemoteJsonlEnvelope<'hello.ok', { protocol: typeof REMOTE_WORKER_PROTOCOL; version: string; capabilities: string[] }>
  | RemoteJsonlEnvelope<'run.started', { runId: string; status: RemoteRunStatus }>
  | RemoteJsonlEnvelope<'run.status', { runId: string; status: RemoteRunStatus; exitCode?: number; stdout?: string; stderr?: string }>
  | RemoteJsonlEnvelope<'run.stdin.ok', { runId: string; acceptedBytes: number; eof: boolean }>
  | RemoteJsonlEnvelope<'run.cancelled', { runId: string; status: 'cancelled' }>
  | RemoteJsonlEnvelope<'slurm.submitted', { jobId: string; state: SlurmNormalizedState }>
  | RemoteJsonlEnvelope<'slurm.status', { jobId: string; state: SlurmNormalizedState; raw: string }>
  | RemoteJsonlEnvelope<'slurm.cancelled', { jobId: string; state: 'cancelled' }>
  | RemoteJsonlEnvelope<'error', RemoteExecutorErrorPayload>

export type RemoteRunStatus = z.infer<typeof remoteRunStatusSchema>
export type RemoteScheduler = z.infer<typeof remoteSchedulerSchema>
export type RemoteOutputStream = z.infer<typeof remoteOutputStreamSchema>
export type SlurmNormalizedState = z.infer<typeof slurmNormalizedStateSchema>

export type SlurmStatusNormalized = {
  raw: string
  slurmState: string
  state: SlurmNormalizedState
  terminal: boolean
  reason?: string
  exitCode?: string
}

export type RemoteRunSummary = {
  runId: string
  targetId: string
  status: RemoteRunStatus
  command: string[]
  cwd?: string
  startedAt: string
  finishedAt?: string
  exitCode?: number
  signal?: string
}

export type RemoteJobSummary = {
  jobId: string
  targetId: string
  scheduler: RemoteScheduler
  name?: string
  submittedAt: string
  status: SlurmStatusNormalized
}

export type RemoteExecutorFailure = {
  ok: false
  error: RemoteExecutorErrorPayload
}

export type RemoteExecutorResult<T extends Record<string, unknown>> =
  | ({ ok: true } & T)
  | RemoteExecutorFailure

export class RemoteExecutorWorkerError extends Error {
  readonly code: RemoteExecutorErrorCode
  readonly retryable: boolean
  readonly suggestion: string
  readonly targetId?: string
  readonly details?: unknown

  constructor(payload: RemoteExecutorErrorPayload) {
    super(payload.reason)
    this.name = 'RemoteExecutorWorkerError'
    this.code = payload.code
    this.retryable = payload.retryable
    this.suggestion = payload.suggestion
    this.targetId = payload.targetId
    this.details = payload.details
  }

  toPayload(): RemoteExecutorErrorPayload {
    return {
      code: this.code,
      reason: this.message,
      retryable: this.retryable,
      suggestion: this.suggestion,
      ...(this.targetId ? { targetId: this.targetId } : {}),
      ...(this.details !== undefined ? { details: this.details } : {})
    }
  }
}

export function remoteExecutorErrorPayloadFromUnknown(
  error: unknown,
  fallback: Partial<RemoteExecutorErrorPayload> = {}
): RemoteExecutorErrorPayload {
  if (error instanceof RemoteExecutorWorkerError) {
    return error.toPayload()
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_request',
      reason: formatZodIssues(error),
      retryable: false,
      suggestion: 'Fix the remote executor tool arguments and retry.'
    }
  }
  const reason = error instanceof Error ? error.message : String(error)
  return {
    code: fallback.code ?? 'unknown',
    reason: fallback.reason ?? (reason.trim() || 'Unknown remote executor error.'),
    retryable: fallback.retryable ?? false,
    suggestion: fallback.suggestion ?? 'Check the remote executor request and try again.',
    ...(fallback.targetId ? { targetId: fallback.targetId } : {}),
    ...(fallback.details !== undefined ? { details: fallback.details } : {})
  }
}

function formatZodIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'input'
    return `${path}: ${issue.message}`
  })
  const suffix = error.issues.length > issues.length
    ? `; ${error.issues.length - issues.length} more issue(s)`
    : ''
  return issues.length > 0
    ? `Invalid remote executor input: ${issues.join('; ')}${suffix}.`
    : 'Invalid remote executor input.'
}
