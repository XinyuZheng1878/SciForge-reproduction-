import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OutputAccumulator } from '../../adapters/tool/output-accumulator.js'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from '../../adapters/tool/truncate.js'
import {
  type ExperimentSpec,
  type ExperimentRun,
  type ErrorPattern,
  BUILTIN_ERROR_PATTERNS,
  type ExperimentMetric
} from './types.js'
import type { ExperimentStore } from './store.js'

// ── Types ─────────────────────────────────────────────────

export type ExperimentRunResult = {
  run: ExperimentRun
  output: string
  exitCode: number | null
  error?: string
  errorPattern?: string
  repairSuggestion?: string
  metrics: Record<string, number>
}

export type ExperimentRunnerOptions = {
  store: ExperimentStore
  workspaceDir: string
  errorPatterns?: ErrorPattern[]
  nowIso?: () => string
}

// ── Shell helpers ─────────────────────────────────────────

function shellArgs(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'cmd.exe', args: ['/c'] }
  }
  return { shell: '/bin/zsh', args: ['-c'] }
}

// ── Command Builder ───────────────────────────────────────

function buildCommand(spec: ExperimentSpec, workspaceRoot: string): string {
  const { shell } = shellArgs()
  const ext = spec.language === 'python' ? '.py' : spec.language === 'r' ? '.R' : '.sh'
  const wd = resolve(workspaceRoot, spec.workingDir)
  const scriptPath = resolve(wd, `exp_${spec.id}${ext}`)

  switch (spec.language) {
    case 'python':
      return `${shell === 'cmd.exe' ? 'python' : 'python3'} "${scriptPath}"`
    case 'r':
      return `Rscript "${scriptPath}"`
    case 'julia':
      return `julia "${scriptPath}"`
    case 'shell':
      return `${shell} "${scriptPath}"`
    default:
      return `${shell === 'cmd.exe' ? 'python' : 'python3'} "${scriptPath}"`
  }
}

// ── Error Detection ───────────────────────────────────────

type ErrorMatch = {
  pattern: ErrorPattern
  match: RegExpMatchArray
  score: number
}

function detectErrors(
  output: string,
  patterns: ErrorPattern[]
): ErrorMatch | null {
  const matches: ErrorMatch[] = []
  for (const pattern of patterns) {
    const re = new RegExp(pattern.pattern, 'im')
    const match = output.match(re)
    if (match) {
      matches.push({ pattern, match, score: match[0].length })
    }
  }
  if (matches.length === 0) return null
  // Return the best match: prefer specific patterns over generic ones
  matches.sort((a, b) => {
    // Prefer named patterns (Python errors) over generic patterns
    const aIsGeneric = ['CommandNotFound', 'PermissionDenied', 'TimeoutError', 'OutOfMemory'].includes(a.pattern.name)
    const bIsGeneric = ['CommandNotFound', 'PermissionDenied', 'TimeoutError', 'OutOfMemory'].includes(b.pattern.name)
    if (aIsGeneric && !bIsGeneric) return 1
    if (!aIsGeneric && bIsGeneric) return -1
    return b.score - a.score
  })
  return matches[0]
}

// ── Metric Extraction ─────────────────────────────────────

function extractMetrics(
  output: string,
  metricDefs: ExperimentMetric[]
): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const def of metricDefs) {
    try {
      let value: number | null = null
      switch (def.extractor) {
        case 'last_line': {
          const lines = output.trim().split('\n')
          const lastLine = lines[lines.length - 1]?.trim()
          if (lastLine) {
            const parsed = parseFloat(lastLine)
            if (!isNaN(parsed)) value = parsed
          }
          break
        }
        case 'regex': {
          if (def.pattern) {
            const re = new RegExp(def.pattern, 'im')
            const match = output.match(re)
            if (match && match[1]) {
              const parsed = parseFloat(match[1])
              if (!isNaN(parsed)) value = parsed
            }
          }
          break
        }
        case 'json': {
          // Look for JSON lines in output
          const lines = output.trim().split('\n')
          for (const line of lines.reverse()) {
            try {
              const obj = JSON.parse(line.trim())
              if (def.pattern && typeof obj === 'object') {
                const key = def.pattern.trim()
                const v = obj[key]
                if (typeof v === 'number') value = v
                else if (typeof v === 'string') {
                  const parsed = parseFloat(v)
                  if (!isNaN(parsed)) value = parsed
                }
              }
              if (value !== null) break
            } catch {
              // Not a JSON line, skip
            }
          }
          break
        }
        case 'full_output': {
          const parsed = parseFloat(output.trim())
          if (!isNaN(parsed)) value = parsed
          break
        }
      }
      if (value !== null) {
        metrics[def.name] = value
      }
    } catch {
      // Metric extraction failure is non-fatal
    }
  }
  return metrics
}

// ── Auto-Repair Suggestion ────────────────────────────────

function buildRepairSuggestion(
  errorMatch: ErrorMatch | null,
  spec: ExperimentSpec
): string | undefined {
  if (!errorMatch) return undefined
  let suggestion = errorMatch.pattern.suggestion ?? `Detected error: ${errorMatch.pattern.name}`
  // Replace placeholders {1}, {2}, etc. with regex capture groups
  for (let i = 1; i < errorMatch.match.length; i++) {
    suggestion = suggestion.replace(`{${i}}`, errorMatch.match[i])
  }
  return suggestion
}

// ── Runner ────────────────────────────────────────────────

export function createExperimentRunner(options: ExperimentRunnerOptions) {
  const { store, workspaceDir, errorPatterns, nowIso } = options
  const patterns = [...BUILTIN_ERROR_PATTERNS, ...(errorPatterns ?? [])]
  const resolvedWorkspace = resolve(workspaceDir)

  function now(): string {
    return nowIso?.() ?? new Date().toISOString()
  }

  /**
   * Write experiment code to a script file in the working directory.
   */
  async function writeScriptFile(spec: ExperimentSpec): Promise<string> {
    const wd = resolve(resolvedWorkspace, spec.workingDir)
    await mkdir(wd, { recursive: true })
    const ext = spec.language === 'python' ? '.py'
      : spec.language === 'r' ? '.R'
      : spec.language === 'julia' ? '.jl'
      : '.sh'
    const scriptPath = resolve(wd, `exp_${spec.id}${ext}`)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(scriptPath, spec.code, 'utf-8')
    return scriptPath
  }

  /**
   * Execute a single experiment run. Returns the run result with
   * output, metrics, error detection, and repair suggestions.
   */
  async function execute(spec: ExperimentSpec, attempt: number = 0): Promise<ExperimentRunResult> {
    const cwd = resolve(resolvedWorkspace, spec.workingDir)
    const command = buildCommand(spec, resolvedWorkspace)

    // Write script file
    await writeScriptFile(spec)

    // Create the run record
    const run = await store.createRun({
      specId: spec.id,
      attempt,
      command
    })

    // Update status to running
    await store.updateRun(run.id, {
      status: 'running',
      pid: undefined,
      startedAt: now()
    })

    // Execute
    const simd = shellArgs()
    const outputBuf = new OutputAccumulator({
      maxLines: DEFAULT_MAX_LINES,
      maxBytes: DEFAULT_MAX_BYTES,
      tempFilePrefix: 'sciforge-experiment'
    })

    return new Promise((resolveResult) => {
      const child = spawn(simd.shell, [...simd.args, command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true
      })

      // Update run with PID
      if (child.pid) {
        store.updateRun(run.id, { pid: child.pid }).catch(() => {})
      }

      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // Force kill after 5s
        setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
        }, 5000)
      }, spec.timeoutSeconds * 1000)

      child.stdout?.on('data', (chunk: Buffer) => {
        outputBuf.append(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        outputBuf.append(chunk)
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        outputBuf.append(Buffer.from(`\n[experiment error: ${err.message}]\n`))
        finalize(1, err.message)
      })

      child.on('exit', (code) => {
        clearTimeout(timer)
        finalize(code, undefined)
      })

      async function finalize(exitCode: number | null, spawnError?: string) {
        outputBuf.finish()
        const snapshot = outputBuf.snapshot({ persistIfTruncated: true })
        const output = snapshot.content
        await outputBuf.closeTempFile()

        // Extract metrics
        const metrics = extractMetrics(output, spec.metrics)

        // Detect errors
        let error: string | undefined
        let errorPattern: string | undefined
        let repairSuggestion: string | undefined

        if (spawnError) {
          error = spawnError
        } else if (exitCode !== null && exitCode !== 0) {
          error = `Exit code: ${exitCode}`
        } else if (timedOut) {
          error = `Timed out after ${spec.timeoutSeconds}s`
          exitCode = -1
        }

        // Try to detect specific error patterns
        const errorMatch = detectErrors(output, patterns)
        if (errorMatch) {
          errorPattern = errorMatch.pattern.name
          if (!error) error = errorMatch.match[0]
          repairSuggestion = buildRepairSuggestion(errorMatch, spec)
        }

        // Build result
        const status = timedOut ? 'failed'
          : spawnError ? 'failed'
          : exitCode === 0 ? 'completed'
          : 'failed'

        const result: ExperimentRunResult = {
          run: { ...run, status, output, exitCode, error, errorPattern },
          output,
          exitCode,
          error,
          errorPattern,
          repairSuggestion,
          metrics
        }

        // Persist the run
        try {
          await store.updateRun(run.id, {
            status,
            output,
            exitCode,
            error,
            errorPattern,
            repairApplied: repairSuggestion,
            metricValues: metrics,
            finishedAt: now()
          })
        } catch {
          // Persistence failure is non-fatal
        }

        resolveResult(result)
      }
    })
  }

  /**
   * Execute with auto-retry on failure.
   * If the run fails and repairSuggestion is available,
   * retries up to spec.maxRetries times.
   */
  async function executeWithRetry(spec: ExperimentSpec): Promise<ExperimentRunResult> {
    let lastResult: ExperimentRunResult | null = null

    for (let attempt = 0; attempt <= spec.maxRetries; attempt++) {
      lastResult = await execute(spec, attempt)

      if (lastResult.run.status === 'completed') {
        return lastResult
      }

      // No repair suggestion = no point retrying
      if (!lastResult.repairSuggestion && attempt < spec.maxRetries) {
        // Still retry once more in case of transient errors
        if (attempt === 0 && lastResult.exitCode !== null && lastResult.exitCode !== 0) {
          continue
        }
        break
      }

      // If we have a repair suggestion and more retries, continue
      if (attempt < spec.maxRetries) {
        // The agent is responsible for applying the repair
        // We just record the suggestion for the agent to use
        continue
      }
    }

    return lastResult!
  }

  return {
    execute,
    executeWithRetry,
    detectErrors: (output: string) => detectErrors(output, patterns),
    extractMetrics: (output: string, defs: ExperimentMetric[]) => extractMetrics(output, defs)
  }
}

export type ExperimentRunner = ReturnType<typeof createExperimentRunner>
