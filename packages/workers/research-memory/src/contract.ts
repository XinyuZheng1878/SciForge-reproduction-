import { z } from 'zod'

export const RESEARCH_MEMORY_ARTIFACTS_RESOURCE_URI = 'research-memory://artifacts'
export const RESEARCH_MEMORY_STATUS_RESOURCE_URI = 'research-memory://status'
export const RESEARCH_MEMORY_ARTIFACT_RESOURCE_URI_TEMPLATE = 'research-memory://artifact/{artifactId}'

export function researchMemoryArtifactResourceUri(artifactId: string): string {
  return `research-memory://artifact/${encodeURIComponent(artifactId)}`
}

export const ResearchMemoryReadOnlyToolNames = [
  'gui_research_memory_status',
  'gui_research_memory_artifact_list',
  'gui_research_memory_artifact_get',
  'gui_research_memory_feedback_read',
  'gui_research_memory_policy_check'
] as const

export const ResearchMemoryLocalWriteToolNames = [
  'gui_research_memory_artifact_upsert',
  'gui_research_memory_draft_sync',
  'gui_research_memory_write_experiment_card',
  'gui_research_memory_write_decision_record',
  'gui_research_memory_render_status_html'
] as const

export const ResearchMemoryGithubWriteToolNames = [
  'gui_research_memory_create_issue',
  'gui_research_memory_create_comment',
  'gui_research_memory_prepare_pr',
  'gui_research_memory_create_pr'
] as const

export const ResearchMemoryToolNames = [
  ...ResearchMemoryReadOnlyToolNames,
  ...ResearchMemoryLocalWriteToolNames,
  ...ResearchMemoryGithubWriteToolNames
] as const

export type ResearchMemoryToolName = typeof ResearchMemoryToolNames[number]
export type ResearchMemorySideEffect = 'read-only' | 'local-write' | 'github-write'

export type ResearchMemoryToolContract = {
  sideEffect: ResearchMemorySideEffect
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}

export const RESEARCH_MEMORY_TOOL_CONTRACTS = {
  gui_research_memory_status: readOnlyContract('Read research memory status'),
  gui_research_memory_artifact_list: readOnlyContract('List research artifacts'),
  gui_research_memory_artifact_get: readOnlyContract('Read one research artifact'),
  gui_research_memory_feedback_read: readOnlyContract('Read GitHub research feedback'),
  gui_research_memory_policy_check: readOnlyContract('Check research memory policy'),
  gui_research_memory_artifact_upsert: localWriteContract('Create or update an artifact'),
  gui_research_memory_draft_sync: localWriteContract('Draft a research sync'),
  gui_research_memory_write_experiment_card: localWriteContract('Write an experiment card'),
  gui_research_memory_write_decision_record: localWriteContract('Write a decision record'),
  gui_research_memory_render_status_html: localWriteContract('Render status.html'),
  gui_research_memory_create_issue: githubWriteContract('Create a GitHub issue'),
  gui_research_memory_create_comment: githubWriteContract('Create a GitHub comment'),
  gui_research_memory_prepare_pr: githubWriteContract('Prepare a GitHub PR branch'),
  gui_research_memory_create_pr: githubWriteContract('Create a GitHub PR')
} as const satisfies Record<ResearchMemoryToolName, ResearchMemoryToolContract>

function readOnlyContract(title: string): ResearchMemoryToolContract {
  return {
    sideEffect: 'read-only',
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
}

function localWriteContract(title: string): ResearchMemoryToolContract {
  return {
    sideEffect: 'local-write',
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }
}

function githubWriteContract(title: string): ResearchMemoryToolContract {
  return {
    sideEffect: 'github-write',
    annotations: {
      title,
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }
}

export const EvidenceLevelSchema = z.enum(['observation', 'preliminary', 'reproduced', 'validated'])
export const ClaimScopeSchema = z.enum(['local-note', 'internal-summary', 'public-claim'])
export const RiskLevelSchema = z.enum(['low', 'medium', 'high'])

export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>
export type ClaimScope = z.infer<typeof ClaimScopeSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const ArtifactIdSchema = z.string()
  .trim()
  .min(5)
  .max(96)
  .regex(/^(HYP|EXP|RUN|DEC|DOC|ART)-[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'Artifact id must use one of HYP-*, EXP-*, RUN-*, DEC-*, DOC-*, ART-*.'
  })

export const ArtifactKindSchema = z.enum(['hypothesis', 'experiment', 'run', 'decision', 'document', 'artifact'])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const GithubReferenceSchema = z.object({
  issue: z.string().trim().min(1).max(128).optional(),
  pr: z.string().trim().min(1).max(128).optional(),
  comment: z.string().trim().min(1).max(128).optional(),
  review_comment: z.string().trim().min(1).max(128).optional(),
  doc: z.string().trim().min(1).max(512).optional(),
  url: z.string().trim().min(1).max(2048).optional()
}).strict()

export const ArtifactReferenceSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  path: z.string().trim().min(1).max(1024).optional(),
  uri: z.string().trim().min(1).max(2048).optional(),
  github: GithubReferenceSchema.optional()
}).strict()

export const ArtifactRecordSchema = z.object({
  id: ArtifactIdSchema,
  kind: ArtifactKindSchema.optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(20_000),
  evidence_level: EvidenceLevelSchema.default('observation'),
  claim_scope: ClaimScopeSchema.default('local-note'),
  risk_level: RiskLevelSchema.default('low'),
  references: z.array(ArtifactReferenceSchema).default([]),
  github: GithubReferenceSchema.optional(),
  tags: z.array(z.string().trim().min(1).max(80)).default([]),
  status: z.string().trim().min(1).max(80).optional(),
  created_at: z.string().trim().min(1).max(80).optional(),
  updated_at: z.string().trim().min(1).max(80).optional()
}).strict()

export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>

export const WorkspaceRootInputSchema = z.object({
  workspace_root: z.string().trim().min(1).max(4096).optional()
}).strict()

export const ResearchMemoryStatusInputSchema = WorkspaceRootInputSchema

export const ArtifactListInputSchema = WorkspaceRootInputSchema.extend({
  ids: z.array(ArtifactIdSchema).optional(),
  kind: ArtifactKindSchema.optional(),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  query: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(500).optional()
}).strict()

export const ArtifactGetInputSchema = WorkspaceRootInputSchema.extend({
  id: ArtifactIdSchema
}).strict()

export const ArtifactUpsertInputSchema = WorkspaceRootInputSchema.extend({
  artifact: ArtifactRecordSchema,
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const PolicyCheckInputSchema = WorkspaceRootInputSchema.extend({
  text: z.string().max(200_000).optional(),
  artifact: ArtifactRecordSchema.optional(),
  artifact_ids: z.array(ArtifactIdSchema).optional(),
  target: z.enum(['local', 'github']).default('github'),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional()
}).strict()

export const DraftSyncInputSchema = WorkspaceRootInputSchema.extend({
  artifact_id: ArtifactIdSchema.optional(),
  artifact_ids: z.array(ArtifactIdSchema).optional(),
  draft_type: z.enum(['github_issue', 'github_comment', 'github_pr', 'experiment_card', 'decision_record', 'status_html']),
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(200_000).optional(),
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const WriteExperimentCardInputSchema = WorkspaceRootInputSchema.extend({
  artifact_id: ArtifactIdSchema,
  title: z.string().trim().min(1).max(240).optional(),
  objective: z.string().trim().max(20_000).optional(),
  method: z.string().trim().max(20_000).optional(),
  result: z.string().trim().max(20_000).optional(),
  next_steps: z.array(z.string().trim().min(1).max(1000)).optional(),
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const WriteDecisionRecordInputSchema = WorkspaceRootInputSchema.extend({
  artifact_id: ArtifactIdSchema,
  title: z.string().trim().min(1).max(240).optional(),
  context: z.string().trim().max(20_000).optional(),
  decision: z.string().trim().max(20_000).optional(),
  consequences: z.string().trim().max(20_000).optional(),
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const RenderStatusHtmlInputSchema = WorkspaceRootInputSchema.extend({
  output_path: z.string().trim().min(1).max(1024).optional(),
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const FeedbackReadInputSchema = WorkspaceRootInputSchema.extend({
  labels: z.array(z.enum([
    'question',
    'suggestion',
    'experiment-request',
    'decision-needed',
    'needs-student-review',
    'risk-high'
  ])).optional(),
  include_issues: z.boolean().optional(),
  include_comments: z.boolean().optional(),
  include_prs: z.boolean().optional(),
  include_review_comments: z.boolean().optional(),
  include_mentions: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict()

const GithubWriteGuardSchema = z.object({
  confirmed: z.boolean().optional(),
  risk_acknowledged: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  preview: z.boolean().optional()
}).strict()

export const GithubIssueInputSchema = WorkspaceRootInputSchema.merge(GithubWriteGuardSchema).extend({
  artifact_id: ArtifactIdSchema,
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(200_000).optional(),
  labels: z.array(z.string().trim().min(1).max(80)).optional(),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional()
}).strict()

export const GithubCommentInputSchema = WorkspaceRootInputSchema.merge(GithubWriteGuardSchema).extend({
  artifact_id: ArtifactIdSchema,
  issue_or_pr: z.string().trim().min(1).max(128),
  body: z.string().trim().min(1).max(200_000),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional()
}).strict()

export const GithubPreparePrInputSchema = WorkspaceRootInputSchema.merge(GithubWriteGuardSchema).extend({
  artifact_ids: z.array(ArtifactIdSchema).min(1).max(100).optional(),
  branch: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  body: z.string().trim().min(1).max(200_000).optional(),
  files: z.array(z.string().trim().min(1).max(1024)).optional(),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional()
}).strict()

export const GithubCreatePrInputSchema = WorkspaceRootInputSchema.merge(GithubWriteGuardSchema).extend({
  artifact_ids: z.array(ArtifactIdSchema).min(1).max(100).optional(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(200_000).optional(),
  base: z.string().trim().min(1).max(160).optional(),
  head: z.string().trim().min(1).max(160).optional(),
  draft: z.boolean().optional(),
  evidence_level: EvidenceLevelSchema.optional(),
  claim_scope: ClaimScopeSchema.optional(),
  risk_level: RiskLevelSchema.optional()
}).strict()

export type ResearchMemoryStatusInput = z.infer<typeof ResearchMemoryStatusInputSchema>
export type ArtifactListInput = z.infer<typeof ArtifactListInputSchema>
export type ArtifactGetInput = z.infer<typeof ArtifactGetInputSchema>
export type ArtifactUpsertInput = z.infer<typeof ArtifactUpsertInputSchema>
export type PolicyCheckInput = z.infer<typeof PolicyCheckInputSchema>
export type DraftSyncInput = z.infer<typeof DraftSyncInputSchema>
export type WriteExperimentCardInput = z.infer<typeof WriteExperimentCardInputSchema>
export type WriteDecisionRecordInput = z.infer<typeof WriteDecisionRecordInputSchema>
export type RenderStatusHtmlInput = z.infer<typeof RenderStatusHtmlInputSchema>
export type FeedbackReadInput = z.infer<typeof FeedbackReadInputSchema>
export type GithubIssueInput = z.infer<typeof GithubIssueInputSchema>
export type GithubCommentInput = z.infer<typeof GithubCommentInputSchema>
export type GithubPreparePrInput = z.infer<typeof GithubPreparePrInputSchema>
export type GithubCreatePrInput = z.infer<typeof GithubCreatePrInputSchema>

export type ResearchMemoryErrorCode =
  | 'workspace_root_required'
  | 'workspace_root_not_found'
  | 'invalid_request'
  | 'artifact_not_found'
  | 'policy_violation'
  | 'confirmation_required'
  | 'github_unavailable'
  | 'git_unavailable'
  | 'command_failed'
  | 'write_failed'
  | 'read_failed'

export type ResearchMemoryError = {
  code: ResearchMemoryErrorCode
  message: string
  retryable: boolean
  suggestedFix: string
  confirmationRequired?: {
    tool: ResearchMemoryToolName
    reason: string
    requiredFields: string[]
  }
}

export type ResearchMemoryFailure = {
  ok: false
  error: ResearchMemoryError
}

export type PolicyFinding = {
  code: 'local_absolute_path' | 'secret' | 'server_info' | 'sensitive_info' | 'high_risk_claim'
  severity: 'low' | 'medium' | 'high'
  message: string
  excerpt?: string
}

export type PolicyCheckResult = ResearchMemoryFailure | {
  ok: true
  allowed: boolean
  target: 'local' | 'github'
  findings: PolicyFinding[]
  sanitizedText?: string
  requiresConfirmation: boolean
}

export type ArtifactIndexDocument = {
  version: 1
  artifacts: ArtifactRecord[]
}

export type ResearchMemoryResult = ResearchMemoryFailure | Record<string, unknown> & { ok: true }
