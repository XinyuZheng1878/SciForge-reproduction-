import type { CapabilityToolProvider } from '../../adapters/tool/capability-registry.js'
import { LocalToolHost } from '../../adapters/tool/local-tool-host.js'
import type { ExperimentStore } from './store.js'
import { ExperimentRunner, createExperimentRunner } from './runner.js'
import {
  ExperimentSpecCreateRequest,
  ExperimentSpecUpdateRequest,
  ExperimentLanguage,
  type ExperimentSpec
} from './types.js'

/**
 * Builds agent-facing tool providers for the Experiment Orchestration system.
 * These tools allow the agent to define, execute, monitor, and manage
 * scientific experiments with automatic error detection, metric extraction,
 * and repair suggestions.
 */
export function buildExperimentToolProviders(
  store: ExperimentStore | undefined
): CapabilityToolProvider[] {
  if (!store) return []

  const runner = createExperimentRunner({
    store,
    workspaceDir: process.cwd()
  })

  return [
    {
      id: 'experiment-orchestration',
      kind: 'memory',
      enabled: true,
      available: true,
      tools: [
        // ── experiment_create ──────────────────────────
        LocalToolHost.defineTool({
          name: 'experiment_create',
          description:
            'Define a new experiment specification. ' +
            'An experiment is a structured code execution with defined parameters, ' +
            'metrics, and error handling. Supported languages: python, shell, r, julia. ' +
            'The experiment will be saved and can be executed with experiment_run.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional experiment ID (e.g., EXP-001). Auto-generated if not provided.' },
              title: { type: 'string', description: 'Short descriptive title' },
              description: { type: 'string', description: 'What this experiment tests and why' },
              hypothesisId: { type: 'string', description: 'Optional link to a hypothesis artifact ID' },
              language: { type: 'string', enum: ExperimentLanguage.options, description: 'Programming language for the experiment code' },
              code: { type: 'string', description: 'The experiment code/script to execute' },
              workingDir: { type: 'string', description: 'Working directory for execution (default ".")' },
              parameters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'path', 'json'] },
                    description: { type: 'string' },
                    default: {},
                    required: { type: 'boolean' }
                  },
                  required: ['name']
                }
              },
              parameterValues: { type: 'object', description: 'Parameter values for this run' },
              metrics: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    extractor: { type: 'string', enum: ['regex', 'json', 'last_line', 'full_output'] },
                    pattern: { type: 'string', description: 'Regex pattern or JSON key for extraction' },
                    unit: { type: 'string' },
                    direction: { type: 'string', enum: ['maximize', 'minimize'] }
                  },
                  required: ['name']
                }
              },
              timeoutSeconds: { type: 'number', description: 'Max execution time in seconds (default 300)' },
              maxRetries: { type: 'number', description: 'Max auto-retry attempts on failure (default 3)' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' }
            },
            required: ['title', 'language', 'code']
          },
          execute: async (args) => {
            try {
              const input = ExperimentSpecCreateRequest.parse(args)
              const spec = await store.createSpec(input)
              return { output: { ok: true, spec } }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── experiment_run ─────────────────────────────
        LocalToolHost.defineTool({
          name: 'experiment_run',
          description:
            'Execute an experiment specification. Writes the code to a script file, ' +
            'runs it in a subprocess, captures output, detects errors, extracts metrics, ' +
            'and returns structured results with repair suggestions on failure. ' +
            'Results are automatically recorded as experiment runs with links to ' +
            'research artifacts.',
          policy: 'on-request',
          toolKind: 'command_execution',
          inputSchema: {
            type: 'object',
            properties: {
              specId: { type: 'string', description: 'ID of the experiment spec to run' },
              retry: { type: 'boolean', description: 'Enable auto-retry with repair suggestions (default true)' }
            },
            required: ['specId']
          },
          execute: async (args) => {
            try {
              const specId = typeof args.specId === 'string' ? args.specId.trim() : ''
              if (!specId) return { output: { ok: false, error: 'specId is required' }, isError: true }

              const spec = await store.getSpec(specId)
              if (!spec) return { output: { ok: false, error: `Experiment spec not found: ${specId}` }, isError: true }

              const retry = args.retry !== false
              const result = retry
                ? await runner.executeWithRetry(spec)
                : await runner.execute(spec)

              return {
                output: {
                  ok: true,
                  runId: result.run.id,
                  specId: spec.id,
                  status: result.run.status,
                  exitCode: result.exitCode,
                  metrics: result.metrics,
                  error: result.error,
                  errorPattern: result.errorPattern,
                  repairSuggestion: result.repairSuggestion,
                  output: result.output.slice(-8000) // Return last 8KB of output
                },
                isError: result.run.status === 'failed'
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── experiment_get ─────────────────────────────
        LocalToolHost.defineTool({
          name: 'experiment_get',
          description:
            'Get experiment details including the spec and recent runs. ' +
            'Use this to check experiment status, view results, and inspect metrics.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              specId: { type: 'string', description: 'Experiment spec ID' },
              includeRuns: { type: 'boolean', description: 'Include recent run records (default true)' }
            },
            required: ['specId']
          },
          execute: async (args) => {
            try {
              const specId = typeof args.specId === 'string' ? args.specId.trim() : ''
              if (!specId) return { output: { ok: false, error: 'specId is required' }, isError: true }

              const spec = await store.getSpec(specId)
              if (!spec) return { output: { ok: false, error: `Experiment spec not found: ${specId}` }, isError: true }

              const includeRuns = args.includeRuns !== false
              const runs = includeRuns ? await store.listRuns(specId, { limit: 10 }) : []

              return {
                output: {
                  ok: true,
                  spec,
                  runs: runs.map(r => ({
                    id: r.id,
                    status: r.status,
                    attempt: r.attempt,
                    exitCode: r.exitCode,
                    error: r.error,
                    errorPattern: r.errorPattern,
                    repairApplied: r.repairApplied,
                    metrics: r.metricValues,
                    startedAt: r.startedAt,
                    finishedAt: r.finishedAt
                  }))
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── experiment_list ────────────────────────────
        LocalToolHost.defineTool({
          name: 'experiment_list',
          description:
            'List all experiment specs with optional filtering by language, tags, or hypothesis.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {
              language: { type: 'string', description: 'Filter by language (python, shell, r, julia)' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
              hypothesisId: { type: 'string', description: 'Filter by hypothesis artifact ID' },
              limit: { type: 'number', description: 'Max results (default 50)' }
            }
          },
          execute: async (args) => {
            try {
              const specs = await store.listSpecs({
                language: typeof args.language === 'string' ? args.language : undefined,
                tags: Array.isArray(args.tags) ? args.tags : undefined,
                hypothesisId: typeof args.hypothesisId === 'string' ? args.hypothesisId : undefined,
                limit: typeof args.limit === 'number' ? args.limit : 50
              })
              return {
                output: {
                  ok: true,
                  count: specs.length,
                  specs: specs.map(s => ({
                    id: s.id,
                    title: s.title,
                    language: s.language,
                    hypothesisId: s.hypothesisId,
                    tags: s.tags,
                    createdAt: s.createdAt
                  }))
                }
              }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        }),

        // ── experiment_diagnostics ─────────────────────
        LocalToolHost.defineTool({
          name: 'experiment_diagnostics',
          description:
            'Get experiment system diagnostics — counts by status, language, output volume.',
          policy: 'auto',
          inputSchema: {
            type: 'object',
            properties: {}
          },
          execute: async () => {
            try {
              const diag = await store.diagnostics()
              return { output: { ok: true, ...diag } }
            } catch (error) {
              return { output: { ok: false, error: error instanceof Error ? error.message : String(error) }, isError: true }
            }
          }
        })
      ]
    }
  ]
}
