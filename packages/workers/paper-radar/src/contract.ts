import { z } from 'zod'
import type { McpWriteConfirmationRequired } from './write-action.js'

export const PAPER_RADAR_MCP_SERVER_NAME = 'sciforge-paper-radar'
export const PAPER_RADAR_MCP_SERVER_VERSION = '0.1.0'
export const PAPER_RADAR_WORKER_TRANSPORT = 'stdio'
export const PAPER_RADAR_WORKER_CAPABILITIES = [
  'paper_profile_list',
  'paper_profile_save',
  'paper_profile_sync',
  'paper_search',
  'paper_rank',
  'paper_digest',
  'paper_resources'
] as const

export type PaperRadarCapability = typeof PAPER_RADAR_WORKER_CAPABILITIES[number]

export const paperRadarCapabilitySchema = z.enum(PAPER_RADAR_WORKER_CAPABILITIES)
export const paperRadarSideEffectSchema = z.enum(['read_only', 'write', 'destructive'])

export type PaperRadarSideEffect = z.infer<typeof paperRadarSideEffectSchema>

export interface PaperRadarMcpToolAnnotations {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export interface PaperRadarMcpToolContract {
  capability: PaperRadarCapability
  sideEffect: PaperRadarSideEffect
  annotations: PaperRadarMcpToolAnnotations
}

export const paperRadarMcpToolContractSchema = z.object({
  capability: paperRadarCapabilitySchema,
  sideEffect: paperRadarSideEffectSchema,
  annotations: z.object({
    title: z.string().min(1),
    readOnlyHint: z.boolean(),
    destructiveHint: z.boolean(),
    idempotentHint: z.boolean(),
    openWorldHint: z.boolean()
  }).strict()
}).strict()

export const PAPER_RADAR_MCP_TOOL_CONTRACTS = {
  gui_paper_profile_list: {
    capability: 'paper_profile_list',
    sideEffect: 'read_only',
    annotations: {
      title: 'List paper profiles',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_paper_profile_save: {
    capability: 'paper_profile_save',
    sideEffect: 'write',
    annotations: {
      title: 'Save paper profile',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_paper_profile_sync: {
    capability: 'paper_profile_sync',
    sideEffect: 'write',
    annotations: {
      title: 'Sync paper profile',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  gui_paper_search: {
    capability: 'paper_search',
    sideEffect: 'read_only',
    annotations: {
      title: 'Search papers',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_paper_rank: {
    capability: 'paper_rank',
    sideEffect: 'read_only',
    annotations: {
      title: 'Rank papers',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  gui_paper_digest: {
    capability: 'paper_digest',
    sideEffect: 'read_only',
    annotations: {
      title: 'Digest papers',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
} as const satisfies Record<string, PaperRadarMcpToolContract>

export type PaperRadarMcpToolName = keyof typeof PAPER_RADAR_MCP_TOOL_CONTRACTS

export const PAPER_RADAR_STATS_RESOURCE_URI = 'paper-radar://stats'
export const PAPER_RADAR_PROFILE_RESOURCE_URI_TEMPLATE = 'paper-radar://profile/{name}'
export const PAPER_RADAR_PAPER_RESOURCE_URI_TEMPLATE = 'paper-radar://paper/{id}'
export const PAPER_RADAR_SYNC_STATE_RESOURCE_URI = 'paper-radar://sync-state'

export const paperSourceSchema = z.enum(['arxiv', 'biorxiv'])
export const paperRelevanceSchema = z.enum(['high', 'medium', 'low'])
export const paperRadarErrorCodeSchema = z.enum([
  'invalid_input',
  'confirmation_required',
  'not_found',
  'upstream_error',
  'sqlite_error',
  'aborted',
  'unknown'
])

const trimmedString = (max = 16_384) => z.string().trim().min(1).max(max)
const optionalTrimmedString = (max = 16_384) => z.string().trim().max(max).optional()
const dateString = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
const stringList = z.array(z.string().trim().min(1).max(256)).max(100)
const optionalStringList = stringList.optional()
const topKSchema = z.number().int().min(1).max(100).optional()
const maxRecordsSchema = z.number().int().min(1).max(2_000).optional()
const writeConfirmationObjectSchema = z.object({
  confirmed: z.literal(true).describe('Required to execute a write after reviewing dry_run or preview output.'),
  note: optionalTrimmedString(512).describe('Optional short non-sensitive confirmation note.')
}).strict()
const writeConfirmationSchema = z.union([
  writeConfirmationObjectSchema,
  z.literal('confirmed')
])
const writeSafetyFields = {
  dry_run: z.boolean().optional().default(false),
  preview: z.boolean().optional().default(false),
  confirmed: z.boolean().optional(),
  confirmation_id: optionalTrimmedString(128),
  confirmation: writeConfirmationSchema.optional()
} as const

export const paperRecordSchema = z.object({
  id: z.string(),
  source: paperSourceSchema,
  externalId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string(),
  categories: z.array(z.string()),
  subjects: z.array(z.string()),
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  doi: z.string().optional(),
  absUrl: z.string(),
  pdfUrl: z.string().optional()
}).passthrough()

export const rankedPaperSchema = paperRecordSchema.extend({
  score: z.number(),
  reason: z.string(),
  relevance: paperRelevanceSchema.optional()
}).passthrough()

export const paperProfileSchema = z.object({
  name: trimmedString(80).describe('Stable profile name. Unsafe characters are normalized to underscores.'),
  description: optionalTrimmedString(2_000),
  keywords: stringList.describe('Positive keywords used for ranking and digest relevance.'),
  excludeKeywords: stringList.describe('Keywords that suppress matching papers.'),
  arxivCategories: stringList.describe('arXiv categories or roots, for example cs.LG or q-bio.'),
  biorxivSubjects: stringList.describe('bioRxiv subject names, for example bioinformatics.')
}).strict()

export const paperProfileListToolInputSchema = z.object({}).strict()

export const paperProfileSaveToolInputSchema = z.object({
  name: trimmedString(80),
  description: optionalTrimmedString(2_000),
  keywords: stringList,
  exclude_keywords: stringList.default([]),
  arxiv_categories: stringList.default([]),
  biorxiv_subjects: stringList.default([]),
  ...writeSafetyFields
}).strict()

export const paperProfileSyncToolInputSchema = z.object({
  profile: optionalTrimmedString(80).describe('Profile name. Defaults to lab_default.'),
  from: dateString.optional(),
  to: dateString.optional(),
  max_records: maxRecordsSchema,
  ...writeSafetyFields
}).strict()

export const paperSearchToolInputSchema = z.object({
  query: optionalTrimmedString(2_000),
  sources: z.array(paperSourceSchema).max(2).optional(),
  categories: optionalStringList,
  from: dateString.optional(),
  to: dateString.optional(),
  top_k: topKSchema
}).strict()

export const paperRankToolInputSchema = paperSearchToolInputSchema.extend({
  profile: optionalTrimmedString(80),
  keywords: optionalStringList,
  exclude_keywords: optionalStringList,
  days: z.number().int().min(1).max(365).optional()
}).strict()

export const paperDigestToolInputSchema = paperRankToolInputSchema

export const paperStatsSchema = z.object({
  papers: z.number().int().nonnegative(),
  arxiv: z.number().int().nonnegative(),
  biorxiv: z.number().int().nonnegative()
}).strict()

export const paperSyncStateRecordSchema = z.object({
  source: paperSourceSchema,
  key: z.string(),
  value: z.string(),
  updatedAt: z.string()
}).strict()

export const paperRadarErrorPayloadSchema = z.object({
  code: paperRadarErrorCodeSchema,
  reason: z.string(),
  retryable: z.boolean(),
  suggestion: z.string(),
  status: z.number().int().min(100).max(599).optional(),
  auditId: z.string().optional(),
  confirmationRequired: z.unknown().optional(),
  confirmationId: z.string().optional(),
  sideEffect: paperRadarSideEffectSchema.optional(),
  tool: z.string().optional()
}).passthrough()

export type PaperSource = z.infer<typeof paperSourceSchema>
export type PaperRecord = z.infer<typeof paperRecordSchema>
export type RankedPaper = z.infer<typeof rankedPaperSchema>
export type PaperProfile = z.infer<typeof paperProfileSchema>
export type PaperProfileListInput = z.infer<typeof paperProfileListToolInputSchema>
export type PaperProfileSaveInput = z.infer<typeof paperProfileSaveToolInputSchema>
export type PaperProfileSyncInput = z.infer<typeof paperProfileSyncToolInputSchema>
export type PaperSearchInput = z.infer<typeof paperSearchToolInputSchema>
export type PaperRankInput = z.infer<typeof paperRankToolInputSchema>
export type PaperDigestInput = z.infer<typeof paperDigestToolInputSchema>
export type PaperStats = z.infer<typeof paperStatsSchema>
export type PaperSyncStateRecord = z.infer<typeof paperSyncStateRecordSchema>
export type PaperRadarErrorCode = z.infer<typeof paperRadarErrorCodeSchema>
export type PaperRadarErrorPayload = z.infer<typeof paperRadarErrorPayloadSchema> & {
  confirmationRequired?: McpWriteConfirmationRequired
}

export class PaperRadarWorkerError extends Error {
  readonly code: PaperRadarErrorCode
  readonly retryable: boolean
  readonly suggestion: string
  readonly status?: number
  private readonly extra: Record<string, unknown>

  constructor(payload: PaperRadarErrorPayload) {
    super(payload.reason)
    this.name = 'PaperRadarWorkerError'
    this.code = payload.code
    this.retryable = payload.retryable
    this.suggestion = payload.suggestion
    this.status = payload.status
    const {
      code: _code,
      reason: _reason,
      retryable: _retryable,
      suggestion: _suggestion,
      status: _status,
      ...extra
    } = payload
    this.extra = extra
  }

  toPayload(): PaperRadarErrorPayload {
    return {
      code: this.code,
      reason: this.message,
      retryable: this.retryable,
      suggestion: this.suggestion,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...this.extra
    }
  }
}

export function paperRadarProfileResourceUri(name: string): string {
  return `paper-radar://profile/${encodeURIComponent(name)}`
}

export function paperRadarPaperResourceUri(id: string): string {
  return `paper-radar://paper/${encodeURIComponent(id)}`
}

export function paperRadarErrorPayloadFromUnknown(
  error: unknown,
  fallback: Partial<PaperRadarErrorPayload> = {}
): PaperRadarErrorPayload {
  if (error instanceof PaperRadarWorkerError) return error.toPayload()
  if (error instanceof z.ZodError) {
    return {
      code: 'invalid_input',
      reason: 'Invalid Paper Radar tool input.',
      retryable: false,
      suggestion: fallback.suggestion ?? 'Check the tool schema and retry with valid Paper Radar arguments.',
      issues: error.issues.slice(0, 5).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message
      }))
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      code: 'aborted',
      reason: error.message || fallback.reason || 'Paper Radar request was aborted.',
      retryable: false,
      suggestion: fallback.suggestion ?? 'Retry the request if it was cancelled accidentally.'
    }
  }
  if (error instanceof Error && /SQLITE|sqlite/i.test(error.message)) {
    return {
      code: 'sqlite_error',
      reason: error.message,
      retryable: false,
      suggestion: fallback.suggestion ?? 'Check the Paper Radar database path and SQLite file permissions.'
    }
  }
  if (error instanceof Error && /arXiv|bioRxiv|HTTP|fetch|network/i.test(error.message)) {
    return {
      code: 'upstream_error',
      reason: error.message,
      retryable: true,
      suggestion: fallback.suggestion ?? 'Retry later or run the same sync with dry_run to inspect the planned request.'
    }
  }
  return {
    code: fallback.code ?? 'unknown',
    reason: error instanceof Error ? error.message : fallback.reason ?? String(error),
    retryable: fallback.retryable ?? false,
    suggestion: fallback.suggestion ?? 'Check the Paper Radar tool input and local worker logs.'
  }
}
