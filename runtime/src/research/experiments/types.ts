import { z } from 'zod'

// ── Experiment Language ────────────────────────────────────────
export const ExperimentLanguage = z.enum([
  'python',
  'shell',
  'r',
  'julia'
])
export type ExperimentLanguage = z.infer<typeof ExperimentLanguage>

// ── Experiment Status ──────────────────────────────────────────
export const ExperimentStatus = z.enum([
  'draft',        // spec created, not yet run
  'queued',       // waiting to execute
  'running',      // currently executing
  'completed',    // finished successfully
  'failed',       // finished with errors
  'cancelled'     // stopped by user
])
export type ExperimentStatus = z.infer<typeof ExperimentStatus>

// ── Parameter Definition ───────────────────────────────────────
export const ExperimentParameter = z.object({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'path', 'json']).default('string'),
  description: z.string().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  required: z.boolean().default(false)
}).strict()
export type ExperimentParameter = z.infer<typeof ExperimentParameter>

// ── Metric Definition ──────────────────────────────────────────
export const ExperimentMetric = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** How to extract the metric from output: regex capture group, json path, or full output */
  extractor: z.enum(['regex', 'json', 'last_line', 'full_output']).default('last_line'),
  /** Pattern for regex or json extraction */
  pattern: z.string().optional(),
  /** Expected unit, e.g. 'seconds', 'accuracy', 'loss' */
  unit: z.string().optional(),
  /** Higher is better or lower is better */
  direction: z.enum(['maximize', 'minimize']).default('maximize')
}).strict()
export type ExperimentMetric = z.infer<typeof ExperimentMetric>

// ── Error Pattern (for auto-detection) ─────────────────────────
export const ErrorPattern = z.object({
  /** Human-readable name like 'ImportError', 'SyntaxError', 'FileNotFound' */
  name: z.string().min(1),
  /** Regex pattern to match in stderr/stdout */
  pattern: z.string().min(1),
  /** Suggested fix template. Use {module}, {file}, {line} etc. as placeholders */
  suggestion: z.string().optional()
}).strict()
export type ErrorPattern = z.infer<typeof ErrorPattern>

// ── Experiment Specification ────────────────────────────────────
export const ExperimentSpec = z.object({
  /** Unique ID, e.g. EXP-014 */
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  /** Link to hypothesis artifact */
  hypothesisId: z.string().optional(),
  /** Programming language */
  language: ExperimentLanguage,
  /** The experiment code or script */
  code: z.string().min(1),
  /** Working directory for execution */
  workingDir: z.string().default('.'),
  /** Command-line parameters */
  parameters: z.array(ExperimentParameter).default([]),
  /** Parameter values for this run */
  parameterValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** Metrics to extract from output */
  metrics: z.array(ExperimentMetric).default([]),
  /** Max execution time in seconds */
  timeoutSeconds: z.number().int().positive().default(300),
  /** Max auto-repair attempts on failure */
  maxRetries: z.number().int().nonnegative().default(3),
  /** Tags for filtering */
  tags: z.array(z.string()).default([]),
  /** Created timestamp */
  createdAt: z.string(),
  /** Last updated */
  updatedAt: z.string()
}).strict()
export type ExperimentSpec = z.infer<typeof ExperimentSpec>

// ── Experiment Run Record ──────────────────────────────────────
export const ExperimentRun = z.object({
  /** Unique run ID, e.g. RUN-2026-07-03-a1b2 */
  id: z.string().min(1),
  /** Reference to experiment spec */
  specId: z.string().min(1),
  /** Current status */
  status: ExperimentStatus,
  /** Retry attempt number (0 = first attempt) */
  attempt: z.number().int().nonnegative().default(0),
  /** The command that was executed */
  command: z.string().default(''),
  /** Combined stdout + stderr */
  output: z.string().default(''),
  /** Exit code */
  exitCode: z.number().int().nullable().default(null),
  /** Detected error info */
  error: z.string().optional(),
  /** Error pattern matched (if any) */
  errorPattern: z.string().optional(),
  /** Auto-repair suggestion that was applied */
  repairApplied: z.string().optional(),
  /** Extracted metric values */
  metricValues: z.record(z.string(), z.number()).default({}),
  /** Path to output files */
  outputFiles: z.array(z.string()).default([]),
  /** Related research artifact ID */
  artifactId: z.string().optional(),
  /** PID of the child process */
  pid: z.number().int().optional(),
  /** Timestamps */
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  createdAt: z.string()
}).strict()
export type ExperimentRun = z.infer<typeof ExperimentRun>

// ── Experiment Index ───────────────────────────────────────────
export const ExperimentIndex = z.object({
  version: z.literal(1),
  specs: z.array(ExperimentSpec).default([]),
  runs: z.array(ExperimentRun).default([]),
  lastUpdated: z.string()
}).strict()
export type ExperimentIndex = z.infer<typeof ExperimentIndex>

// ── Create/Update requests ─────────────────────────────────────
export const ExperimentSpecCreateRequest = ExperimentSpec.omit({
  id: true,
  createdAt: true,
  updatedAt: true
}).extend({
  id: z.string().min(1).optional()
}).strict()
export type ExperimentSpecCreateRequest = z.input<typeof ExperimentSpecCreateRequest>

export const ExperimentSpecUpdateRequest = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  code: z.string().min(1).optional(),
  parameters: z.array(ExperimentParameter).optional(),
  metrics: z.array(ExperimentMetric).optional(),
  timeoutSeconds: z.number().int().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).optional()
}).strict()
export type ExperimentSpecUpdateRequest = z.input<typeof ExperimentSpecUpdateRequest>

// ── Diagnostics ────────────────────────────────────────────────
export const ExperimentDiagnostics = z.object({
  indexPath: z.string(),
  specCount: z.number().int().nonnegative(),
  runCount: z.number().int().nonnegative(),
  byStatus: z.record(z.string(), z.number().int().nonnegative()),
  byLanguage: z.record(z.string(), z.number().int().nonnegative()),
  totalOutputBytes: z.number().int().nonnegative()
})
export type ExperimentDiagnostics = z.infer<typeof ExperimentDiagnostics>

// ── Built-in error patterns for auto-detection ─────────────────
export const BUILTIN_ERROR_PATTERNS: ErrorPattern[] = [
  {
    name: 'PythonImportError',
    pattern: 'ModuleNotFoundError: No module named [\'"](\\w+)[\'"]',
    suggestion: 'Install missing package: pip install {1}'
  },
  {
    name: 'PythonNameError',
    pattern: "NameError: name '(\\w+)' is not defined",
    suggestion: "Variable '{1}' is not defined. Check spelling or add import."
  },
  {
    name: 'PythonSyntaxError',
    pattern: 'SyntaxError: (.+)',
    suggestion: 'Fix syntax error: {1}'
  },
  {
    name: 'PythonFileNotFoundError',
    pattern: "FileNotFoundError: .* '(.*)'",
    suggestion: "File not found: '{1}'. Check the file path."
  },
  {
    name: 'PythonAttributeError',
    pattern: "AttributeError: '([^']+)' object has no attribute '([^']+)'",
    suggestion: "Object of type '{1}' has no attribute '{2}'. Check the API."
  },
  {
    name: 'PythonKeyError',
    pattern: "KeyError: ['\"](.+)['\"]",
    suggestion: "Key '{1}' not found. Check the dictionary keys."
  },
  {
    name: 'CommandNotFound',
    pattern: 'command not found: (\\w+)',
    suggestion: "Command '{1}' not found. Install it or check PATH."
  },
  {
    name: 'PermissionDenied',
    pattern: 'Permission denied',
    suggestion: 'Permission denied. Check file permissions or use chmod.'
  },
  {
    name: 'OutOfMemory',
    pattern: 'MemoryError|Killed|out of memory',
    suggestion: 'Out of memory. Reduce data size or use a larger machine.'
  },
  {
    name: 'TimeoutError',
    pattern: 'timeout|timed out',
    suggestion: 'Command timed out. Increase timeout or optimize the code.'
  }
]
