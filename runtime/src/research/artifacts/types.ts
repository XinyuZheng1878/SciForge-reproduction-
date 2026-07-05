import { z } from 'zod'

// ── Evidence Level ────────────────────────────────────────────
export const EvidenceLevel = z.enum([
  'observation',
  'preliminary',
  'reproduced',
  'validated'
])
export type EvidenceLevel = z.infer<typeof EvidenceLevel>

// ── Claim Scope ───────────────────────────────────────────────
export const ClaimScope = z.enum([
  'local-note',
  'internal-summary',
  'public-claim'
])
export type ClaimScope = z.infer<typeof ClaimScope>

// ── Risk Level ────────────────────────────────────────────────
export const RiskLevel = z.enum([
  'low',
  'medium',
  'high'
])
export type RiskLevel = z.infer<typeof RiskLevel>

// ── Artifact Status ───────────────────────────────────────────
export const ArtifactStatus = z.enum([
  'draft',
  'active',
  'completed',
  'paused',
  'abandoned'
])
export type ArtifactStatus = z.infer<typeof ArtifactStatus>

// ── Artifact Type ─────────────────────────────────────────────
export const ArtifactType = z.enum([
  'experiment',
  'run',
  'observation',
  'decision',
  'document',
  'milestone'
])
export type ArtifactType = z.infer<typeof ArtifactType>

// ── GitHub Reference ──────────────────────────────────────────
export const GitHubRef = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumber: z.number().int().positive().optional(),
  prNumber: z.number().int().positive().optional(),
  commentId: z.string().optional(),
  url: z.string().url().optional()
}).strict()
export type GitHubRef = z.infer<typeof GitHubRef>

// ── Artifact Record ───────────────────────────────────────────
export const ResearchArtifact = z.object({
  /** Unique artifact ID, e.g. EXP-014, RUN-2026-06-25-a17 */
  id: z.string().min(1),
  type: ArtifactType,
  title: z.string().min(1),
  status: ArtifactStatus.default('draft'),
  /** Brief summary for collaborators */
  summary: z.string().min(1),

  // Scientific metadata
  hypothesisId: z.string().optional(),
  evidenceLevel: EvidenceLevel,
  claimScope: ClaimScope.default('local-note'),
  riskLevel: RiskLevel.default('medium'),

  // Source evidence
  sourceRunId: z.string().optional(),
  sourceLogPath: z.string().optional(),
  sourceFilePath: z.string().optional(),

  // Limitations and interpretation
  limitations: z.array(z.string()).default([]),
  interpretation: z.string().optional(),

  // Next actions
  nextActions: z.array(z.string()).default([]),

  // GitHub associations
  githubRefs: z.array(GitHubRef).default([]),

  // Tags for filtering
  tags: z.array(z.string()).default([]),

  // Visibility
  visibility: z.enum(['local-only', 'github-summary-only', 'github-full']).default('local-only'),

  // Relations to other artifacts
  relatedArtifactIds: z.array(z.string()).default([]),

  // Timestamps
  createdAt: z.string(),
  updatedAt: z.string(),
  confirmedAt: z.string().optional()
}).strict()
export type ResearchArtifact = z.infer<typeof ResearchArtifact>

// ── Artifact Create Request ───────────────────────────────────
export const ResearchArtifactCreateRequest = z.object({
  id: z.string().min(1).optional(),
  type: ArtifactType,
  title: z.string().min(1),
  summary: z.string().min(1),
  hypothesisId: z.string().optional(),
  evidenceLevel: EvidenceLevel,
  claimScope: ClaimScope.default('local-note'),
  riskLevel: RiskLevel.default('medium'),
  sourceRunId: z.string().optional(),
  sourceLogPath: z.string().optional(),
  sourceFilePath: z.string().optional(),
  limitations: z.array(z.string()).default([]),
  interpretation: z.string().optional(),
  nextActions: z.array(z.string()).default([]),
  githubRefs: z.array(GitHubRef).default([]),
  tags: z.array(z.string()).default([]),
  visibility: z.enum(['local-only', 'github-summary-only', 'github-full']).default('local-only'),
  relatedArtifactIds: z.array(z.string()).default([])
}).strict()
export type ResearchArtifactCreateRequest = z.input<typeof ResearchArtifactCreateRequest>

// ── Artifact Update Request ───────────────────────────────────
export const ResearchArtifactUpdateRequest = z.object({
  title: z.string().min(1).optional(),
  status: ArtifactStatus.optional(),
  summary: z.string().min(1).optional(),
  evidenceLevel: EvidenceLevel.optional(),
  claimScope: ClaimScope.optional(),
  riskLevel: RiskLevel.optional(),
  sourceRunId: z.string().optional(),
  sourceLogPath: z.string().optional(),
  sourceFilePath: z.string().optional(),
  limitations: z.array(z.string()).optional(),
  interpretation: z.string().optional(),
  nextActions: z.array(z.string()).optional(),
  githubRefs: z.array(GitHubRef).optional(),
  tags: z.array(z.string()).optional(),
  visibility: z.enum(['local-only', 'github-summary-only', 'github-full']).optional(),
  relatedArtifactIds: z.array(z.string()).optional(),
  confirmedAt: z.string().optional()
}).strict()
export type ResearchArtifactUpdateRequest = z.input<typeof ResearchArtifactUpdateRequest>

// ── Artifact Index ────────────────────────────────────────────
export const ResearchArtifactIndex = z.object({
  version: z.literal(1),
  projectName: z.string().min(1).optional(),
  artifacts: z.array(ResearchArtifact).default([]),
  lastUpdated: z.string()
}).strict()
export type ResearchArtifactIndex = z.infer<typeof ResearchArtifactIndex>

// ── Diagnostics ───────────────────────────────────────────────
export const ResearchArtifactDiagnostics = z.object({
  indexPath: z.string(),
  totalCount: z.number().int().nonnegative(),
  byType: z.record(z.string(), z.number().int().nonnegative()),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  byEvidenceLevel: z.record(z.string(), z.number().int().nonnegative()),
  byVisibility: z.record(z.string(), z.number().int().nonnegative()),
  highRiskCount: z.number().int().nonnegative(),
  pendingSyncCount: z.number().int().nonnegative()
})
export type ResearchArtifactDiagnostics = z.infer<typeof ResearchArtifactDiagnostics>
