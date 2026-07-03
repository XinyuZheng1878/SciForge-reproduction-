import { EMPTY_MULTI_AGENT_USAGE, MultiAgentRuntimeError, type MultiAgentRuntime } from '@sciforge/multi-agent'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const DEFAULT_DELEGATE_TIMEOUT_MS = 600_000
const MAX_DELEGATE_TIMEOUT_MS = 1_200_000
const PARALLEL_BUDGET_RETRY_MS = 250

const CHILD_AGENT_RUNTIME_GUARDRAILS = [
  'Child-agent runtime guardrails:',
  '- Work only inside the assigned workspace unless a tool explicitly permits otherwise.',
  '- Never read app settings, API key files, tokens, or secrets from paths outside the workspace.',
  '- If local Model Router access is needed, use environment variables only: SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY for the key, SCIFORGE_MODEL_ROUTER_BASE_URL for the base URL, and SCIFORGE_MODEL_ROUTER_MODEL for the model. Never print secret values.',
  '- Treat the delegated prompt as a bounded execution request, not as an interactive consultation. Do not ask the parent or user what to do next.',
  '- If the delegated task names deliverables, output paths, or file mutations, create or edit those files with tools before your final response.',
  '- Before declaring completion, verify requested files or observable outputs with read/ls/grep/bash as appropriate and mention the verified paths in your final response.',
  '- If you cannot complete the delegated task, start the final response with CHILD_AGENT_BLOCKED and explain the blocker plus any partial work.',
  '- If you complete the delegated task after initially thinking it was blocked, do not include CHILD_AGENT_BLOCKED anywhere in the final response.',
  '- Before editing an existing file, read that file in this child run first; if a read-before-edit guard blocks an edit, read the file and retry once.',
  '',
  'Delegated task:'
].join('\n')

export function buildDelegationToolProviders(runtime: MultiAgentRuntime | undefined): CapabilityToolProvider[] {
  if (!runtime) return []
  return [{
    id: 'delegation',
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [
      LocalToolHost.defineTool({
        name: 'delegate_task',
        description: 'Run a bounded child agent task and return its summary.',
        inputSchema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            prompt: { type: 'string' },
            workspace: { type: 'string' },
            model: { type: 'string' },
            timeout_ms: { type: 'number' }
          },
          required: ['prompt'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : ''
          if (!prompt) return { output: { error: 'prompt is required' }, isError: true }
          const spawnIndex = (await runtime.diagnostics(context.threadId)).childRuns.length + 1
          const timeoutMs = normalizeDelegateTimeoutMs(args.timeout_ms, DEFAULT_DELEGATE_TIMEOUT_MS)
          const task = {
            prompt,
            ...(typeof args.label === 'string' ? { label: args.label } : {})
          }
          let record: DelegateRecordLike
          try {
            record = await runDelegateChildWithWatchdog({
              parentSignal: context.abortSignal,
              timeoutMs,
              run: (signal) => retryWhileParallelBudgetExhausted(signal, () => runtime.runChild({
                parentThreadId: context.threadId,
                parentTurnId: context.turnId,
                label: typeof args.label === 'string' ? args.label : undefined,
                prompt: withChildRuntimeGuardrails(prompt),
                workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
                model: normalizeDelegateModel(args.model) ?? context.model?.id,
                childTimeoutMs: timeoutMs,
                allowedToolNames: context.explicitAllowedToolNames,
                strictAllowedToolNames: context.explicitStrictAllowedToolNames === true,
                ...(context.bashCommandPolicy ? { bashCommandPolicy: context.bashCommandPolicy } : {}),
                ...(context.filePathPolicy ? { filePathPolicy: context.filePathPolicy } : {}),
                signal
              }))
            })
          } catch (error) {
            record = failedDelegateRecord(task, 0, error, context.threadId, context.turnId)
          }
          return {
            output: {
              childId: record.id,
              status: record.status,
              summary: record.summary,
              error: record.error,
              usage: record.usage,
              effective_timeout_ms: timeoutMs,
              ...(spawnIndex > 1
                ? { warning: `This is child agent spawn #${spawnIndex} for the thread. Spawn only when the extra prefix/cache cost is worth it.` }
                : {})
            },
            isError: record.status === 'failed' || record.status === 'aborted'
          }
        }
      }),
      LocalToolHost.defineTool({
        name: 'delegate_tasks',
        description: 'Run a batch of bounded child agent tasks concurrently up to the configured subagent parallel budget and return their summaries.',
        inputSchema: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  prompt: { type: 'string' },
                  workspace: { type: 'string' },
                  model: { type: 'string' },
                  timeout_ms: { type: 'number' }
                },
                required: ['prompt'],
                additionalProperties: false
              }
            },
            workspace: { type: 'string' },
            model: { type: 'string' },
            timeout_ms: { type: 'number' }
          },
          required: ['tasks'],
          additionalProperties: false
        },
        policy: 'auto',
        execute: async (args, context) => {
          const rawTasks = Array.isArray(args.tasks) ? args.tasks : []
          const tasks = rawTasks
            .map((task) => normalizeDelegateTask(task))
            .filter((task): task is NormalizedDelegateTask => task != null)
          if (tasks.length === 0) return { output: { error: 'at least one task with a prompt is required' }, isError: true }

          const diagnostics = await runtime.diagnostics(context.threadId)
          const availableParallel = Math.max(1, diagnostics.config.maxParallel - diagnostics.active)
          const concurrency = Math.min(tasks.length, availableParallel)
          const firstSpawnIndex = diagnostics.childRuns.length + 1
          const sharedWorkspace = typeof args.workspace === 'string' ? args.workspace.trim() : ''
          const sharedModel = normalizeDelegateModel(args.model)
          const sharedTimeoutMs = normalizeDelegateTimeoutMs(args.timeout_ms, DEFAULT_DELEGATE_TIMEOUT_MS)
          const records = await runWithConcurrency(tasks, concurrency, async (task, index) => {
            const timeoutMs = task.timeoutMs ?? sharedTimeoutMs
            try {
              return await runDelegateChildWithWatchdog({
                parentSignal: context.abortSignal,
                timeoutMs,
                run: (signal) => retryWhileParallelBudgetExhausted(signal, () => runtime.runChild({
                  parentThreadId: context.threadId,
                  parentTurnId: context.turnId,
                  label: task.label,
                  prompt: withChildRuntimeGuardrails(task.prompt),
                  workspace: (task.workspace ?? sharedWorkspace) || context.workspace,
                  model: task.model ?? sharedModel ?? context.model?.id,
                  childTimeoutMs: timeoutMs,
                  allowedToolNames: context.explicitAllowedToolNames,
                  strictAllowedToolNames: context.explicitStrictAllowedToolNames === true,
                  ...(context.bashCommandPolicy ? { bashCommandPolicy: context.bashCommandPolicy } : {}),
                  ...(context.filePathPolicy ? { filePathPolicy: context.filePathPolicy } : {}),
                  signal
                }))
              })
            } catch (error) {
              return failedDelegateRecord(task, index, error, context.threadId, context.turnId)
            }
          })
          const children = records.map((record, index) => ({
            childId: record.id,
            label: record.label,
            status: record.status,
            summary: record.summary,
            error: record.error,
            usage: record.usage,
            effective_timeout_ms: tasks[index]?.timeoutMs ?? sharedTimeoutMs
          }))
          const completed = children.filter((child) => child.status === 'completed').length
          const failed = children.filter((child) => child.status === 'failed').length
          const aborted = children.filter((child) => child.status === 'aborted').length
          const batchStatus = completed === children.length
            ? 'completed'
            : completed > 0
              ? 'partial'
              : 'failed'
          return {
            output: {
              children,
              total: children.length,
              status: batchStatus,
              completed,
              failed,
              aborted,
              concurrency,
              configured_concurrency: diagnostics.config.maxParallel,
              effective_timeout_ms: sharedTimeoutMs,
              ...(firstSpawnIndex > 1
                ? { warning: `This batch starts at child agent spawn #${firstSpawnIndex} for the thread. Spawn only when the extra prefix/cache cost is worth it.` }
                : {})
            },
            isError: batchStatus === 'failed'
          }
        }
      })
    ]
  }]
}

export function withChildRuntimeGuardrails(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed.startsWith(CHILD_AGENT_RUNTIME_GUARDRAILS)) return trimmed
  return `${CHILD_AGENT_RUNTIME_GUARDRAILS}\n\n${trimmed}`
}

type NormalizedDelegateTask = {
  prompt: string
  label?: string
  workspace?: string
  model?: string
  timeoutMs?: number
}

function normalizeDelegateTask(value: unknown): NormalizedDelegateTask | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!prompt) return null
  const label = trimOptional(record.label)
  const workspace = trimOptional(record.workspace)
  const model = normalizeDelegateModel(record.model)
  const timeoutMs = normalizeDelegateTimeoutMs(record.timeout_ms)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  }
}

function trimOptional(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : undefined
}

function normalizeDelegateModel(value: unknown): string | undefined {
  const model = trimOptional(value)
  if (!model || model.toLowerCase() === 'auto') return undefined
  return model
}

function normalizeDelegateTimeoutMs(value: unknown, defaultMs?: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return defaultMs
  const normalized = Math.trunc(value)
  if (normalized <= 0) return defaultMs
  return Math.min(normalized, MAX_DELEGATE_TIMEOUT_MS)
}

type DelegateRecordLike = Awaited<ReturnType<MultiAgentRuntime['runChild']>>

async function retryWhileParallelBudgetExhausted(
  signal: AbortSignal,
  run: () => Promise<DelegateRecordLike>
): Promise<DelegateRecordLike> {
  while (true) {
    try {
      return await run()
    } catch (error) {
      if (!isParallelBudgetExhausted(error) || signal.aborted) throw error
      await delay(PARALLEL_BUDGET_RETRY_MS, signal)
    }
  }
}

function isParallelBudgetExhausted(error: unknown): boolean {
  if (error instanceof MultiAgentRuntimeError) return error.code === 'parallel_budget_exhausted' && error.retryable !== false
  return error instanceof Error && /\bmulti-agent parallel budget exhausted\b/i.test(error.message)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('delegate child run aborted'))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timeout)
      reject(signal.reason instanceof Error ? signal.reason : new Error('delegate child run aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

async function runDelegateChildWithWatchdog(input: {
  parentSignal?: AbortSignal
  timeoutMs?: number
  run: (signal: AbortSignal) => Promise<DelegateRecordLike>
}): Promise<DelegateRecordLike> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let rejectAbort: ((error: Error) => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject
  })
  aborted.catch(() => undefined)
  const abort = (error: Error) => {
    if (!controller.signal.aborted) controller.abort(error)
    rejectAbort?.(error)
  }
  const abortFromParent = () => abort(new Error('delegate child run aborted'))
  if (input.parentSignal?.aborted) {
    abortFromParent()
  } else {
    input.parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  }
  const timedOut = input.timeoutMs === undefined
    ? undefined
    : new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(`delegate child run timed out after ${input.timeoutMs}ms`)
          if (!controller.signal.aborted) controller.abort(error)
          reject(error)
        }, input.timeoutMs)
      })
  try {
    return await Promise.race([
      input.run(controller.signal),
      aborted,
      ...(timedOut ? [timedOut] : [])
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    input.parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function failedDelegateRecord(
  task: NormalizedDelegateTask,
  index: number,
  error: unknown,
  parentThreadId: string,
  parentTurnId: string
): DelegateRecordLike {
  const message = error instanceof Error ? error.message : String(error)
  const now = new Date().toISOString()
  return {
    contractVersion: 1,
    id: `delegate_failed_${index + 1}`,
    parentThreadId,
    parentTurnId,
    label: task.label,
    prompt: task.prompt,
    status: 'failed',
    summary: `Child agent failed before completion: ${message}`,
    error: {
      code: 'child_failed',
      message,
      retryable: /\b(timeout|timed out|parallel|budget|unavailable|overloaded|503|502|504)\b/i.test(message)
    },
    usage: EMPTY_MULTI_AGENT_USAGE,
    transcript: [],
    createdAt: now,
    updatedAt: now,
    finishedAt: now
  }
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await run(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}
