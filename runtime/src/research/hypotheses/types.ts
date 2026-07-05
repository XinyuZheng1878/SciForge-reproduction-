import { z } from 'zod'

// ── Hypothesis Confidence ─────────────────────────────────────
/** Bayesian-style confidence tracking for scientific hypotheses */
export const HypothesisConfidence = z.object({
  /** Prior probability (0-1) at hypothesis creation */
  prior: z.number().min(0).max(1),
  /** Current posterior probability (0-1) given accumulated evidence */
  posterior: z.number().min(0).max(1),
  /** Total number of experiments run for/against this hypothesis */
  totalTrials: z.number().int().nonnegative().default(0),
  /** Number of trials that support the hypothesis */
  supportingTrials: z.number().int().nonnegative().default(0),
  /** Number of trials that contradict the hypothesis */
  contradictingTrials: z.number().int().nonnegative().default(0),
  /** Last updated timestamp */
  lastUpdated: z.string()
}).strict()
export type HypothesisConfidence = z.infer<typeof HypothesisConfidence>

// ── Hypothesis Status ─────────────────────────────────────────
export const HypothesisStatus = z.enum([
  'draft',        // just created, not yet tested
  'active',       // currently being investigated
  'supported',    // evidence supports it (posterior > prior)
  'contradicted', // evidence contradicts it (posterior < prior)
  'inconclusive', // evidence is mixed
  'falsified',    // conclusively disproven
  'validated'     // strong evidence, can be treated as finding
])
export type HypothesisStatus = z.infer<typeof HypothesisStatus>

// ── Hypothesis ─────────────────────────────────────────────────
export const Hypothesis = z.object({
  /** Unique ID, e.g. HYP-2026-07-03-a1b2 */
  id: z.string().min(1),
  /** Short title */
  title: z.string().min(1),
  /** Full statement: "If X is true, then Y should be observed when Z" */
  statement: z.string().min(1),
  /** Current status */
  status: HypothesisStatus,
  /** Confidence tracking */
  confidence: HypothesisConfidence,
  /** What would falsify this hypothesis */
  falsificationCriteria: z.string().default(''),
  /** Domain/topic tags */
  tags: z.array(z.string()).default([]),
  /** Link to parent hypothesis (null if root) */
  parentHypothesisId: z.string().optional(),
  /** Child hypotheses derived from this one */
  childHypothesisIds: z.array(z.string()).default([]),
  /** Key observations that led to this hypothesis */
  premises: z.array(z.string()).default([]),
  /** Predictions this hypothesis makes */
  predictions: z.array(z.string()).default([]),
  /** Related experiment spec IDs */
  experimentIds: z.array(z.string()).default([]),
  /** Related research artifact IDs */
  artifactIds: z.array(z.string()).default([]),
  /** Research notes */
  notes: z.string().default(''),
  /** Timestamps */
  createdAt: z.string(),
  updatedAt: z.string()
}).strict()
export type Hypothesis = z.infer<typeof Hypothesis>

// ── Hypothesis Index ──────────────────────────────────────────
export const HypothesisIndex = z.object({
  version: z.literal(1),
  hypotheses: z.array(Hypothesis).default([]),
  lastUpdated: z.string()
}).strict()
export type HypothesisIndex = z.infer<typeof HypothesisIndex>

// ── CRUD Requests ─────────────────────────────────────────────
export const HypothesisCreateRequest = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  statement: z.string().min(1),
  falsificationCriteria: z.string().default(''),
  premises: z.array(z.string()).default([]),
  predictions: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  parentHypothesisId: z.string().optional(),
  priorConfidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().default('')
}).strict()
export type HypothesisCreateRequest = z.input<typeof HypothesisCreateRequest>

export const HypothesisUpdateRequest = z.object({
  title: z.string().min(1).optional(),
  statement: z.string().min(1).optional(),
  status: HypothesisStatus.optional(),
  falsificationCriteria: z.string().optional(),
  premises: z.array(z.string()).optional(),
  predictions: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  childHypothesisIds: z.array(z.string()).optional(),
  experimentIds: z.array(z.string()).optional(),
  artifactIds: z.array(z.string()).optional(),
  notes: z.string().optional(),
  /** Update confidence with a new trial result */
  recordTrial: z.object({
    supported: z.boolean(),
    experimentId: z.string().optional()
  }).optional()
}).strict()
export type HypothesisUpdateRequest = z.input<typeof HypothesisUpdateRequest>

// ── Research Loop State ───────────────────────────────────────
export const ResearchPhase = z.enum([
  'idle',          // not running
  'observing',     // gathering data/observations
  'hypothesizing', // generating hypotheses
  'designing',     // designing experiments
  'executing',     // running experiments
  'analyzing',     // analyzing results
  'deciding',      // choosing next action
  'concluding'     // writing up findings
])
export type ResearchPhase = z.infer<typeof ResearchPhase>

export const ResearchLoopState = z.object({
  /** Unique session ID */
  sessionId: z.string().min(1),
  /** Current phase */
  phase: ResearchPhase,
  /** Active hypothesis being investigated */
  activeHypothesisId: z.string().optional(),
  /** Research goal / question */
  goal: z.string().default(''),
  /** Iteration counter */
  iteration: z.number().int().nonnegative().default(0),
  /** Max iterations before stopping */
  maxIterations: z.number().int().positive().default(10),
  /** Termination conditions */
  stopConditions: z.array(z.string()).default([]),
  /** Whether to stop */
  shouldStop: z.boolean().default(false),
  /** Stop reason */
  stopReason: z.string().default(''),
  /** Summary of findings so far */
  summary: z.string().default(''),
  /** Started at */
  startedAt: z.string(),
  /** Last updated */
  updatedAt: z.string(),
  /** Session log (concise entries) */
  log: z.array(z.object({
    phase: ResearchPhase,
    message: z.string(),
    timestamp: z.string()
  })).default([])
}).strict()
export type ResearchLoopState = z.infer<typeof ResearchLoopState>

// ── Diagnostics ────────────────────────────────────────────────
export const HypothesisDiagnostics = z.object({
  totalCount: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  activeCount: z.number().int().nonnegative(),
  validatedCount: z.number().int().nonnegative(),
  falsifiedCount: z.number().int().nonnegative(),
  averageConfidence: z.number().min(0).max(1),
  totalTrials: z.number().int().nonnegative()
})
export type HypothesisDiagnostics = z.infer<typeof HypothesisDiagnostics>
