// ── SciForge Autonomous Research System ──────────────────────────
// Barrel export for all research modules (Phase 1-4).
//
// Architecture:
//   artifacts/    Phase 1 — Research Memory (types, store, github, tools)
//   experiments/  Phase 2 — Experiment Orchestration (types, store, runner, tools)
//   hypotheses/   Phase 3 — Autonomous Research Loop (types, store, loop-tools)
//   papers/       Phase 4 — Paper Generation (types, store, tools)

// ── Phase 1: Research Artifacts ─────────────────────────────────
export { YamlResearchArtifactStore } from './artifacts/store.js'
export { GhCliGitHubAdapter } from './artifacts/github-adapter.js'
export { buildResearchArtifactToolProviders } from './artifacts/tools.js'
export {
  ResearchArtifact,
  ResearchArtifactCreateRequest,
  ResearchArtifactUpdateRequest,
  ResearchArtifactIndex,
  ResearchArtifactDiagnostics
} from './artifacts/types.js'
export type {
  ResearchArtifactStore,
  ArtifactListFilter
} from './artifacts/store.js'
export type {
  GitHubAdapter,
  GitHubIssueDraft,
  GitHubPRDraft,
  GitHubSyncResult,
  GitHubFeedbackItem
} from './artifacts/github-adapter.js'

// ── Phase 2: Experiment Orchestration ───────────────────────────
export { JsonExperimentStore } from './experiments/store.js'
export { buildExperimentToolProviders } from './experiments/tools.js'
export { createExperimentRunner } from './experiments/runner.js'
export {
  ExperimentSpec,
  ExperimentRun,
  ExperimentIndex,
  ExperimentDiagnostics,
  ExperimentLanguage,
  ExperimentStatus,
  ExperimentParameter,
  ExperimentMetric,
  ErrorPattern,
  BUILTIN_ERROR_PATTERNS
} from './experiments/types.js'
export type {
  ExperimentStore,
  ExperimentListFilter,
  RunListFilter
} from './experiments/store.js'
export type {
  ExperimentRunner,
  ExperimentRunResult,
  ExperimentRunnerOptions
} from './experiments/runner.js'

// ── Phase 3: Autonomous Research Loop ───────────────────────────
export { JsonHypothesisStore } from './hypotheses/store.js'
export { buildResearchLoopToolProviders } from './hypotheses/loop-tools.js'
export {
  Hypothesis,
  HypothesisCreateRequest,
  HypothesisUpdateRequest,
  HypothesisConfidence,
  HypothesisStatus,
  ResearchLoopState,
  ResearchPhase,
  HypothesisDiagnostics
} from './hypotheses/types.js'
export type {
  HypothesisStore,
  HypothesisListFilter
} from './hypotheses/store.js'

// ── Phase 4: Paper Generation ───────────────────────────────────
export { JsonPaperStore } from './papers/store.js'
export { buildPaperToolProviders } from './papers/tools.js'
export {
  Paper,
  PaperCreateRequest,
  PaperUpdateRequest,
  PaperStatus,
  PaperSection,
  PaperReference,
  IMRAD_OUTLINE,
  SHORT_REPORT_OUTLINE,
  PaperDiagnostics
} from './papers/types.js'
export type {
  PaperStore,
  PaperListFilter,
  ResearchData
} from './papers/store.js'
