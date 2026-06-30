import type { MultiAgentRuntime } from '@sciforge/multi-agent'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

const CHILD_AGENT_RUNTIME_GUARDRAILS = [
  'Child-agent runtime guardrails:',
  '- Work only inside the assigned workspace unless a tool explicitly permits otherwise.',
  '- Never read app settings, API key files, tokens, or secrets from paths outside the workspace.',
  '- If local Model Router access is needed, use environment variables only: SCIFORGE_MODEL_ROUTER_RUNTIME_API_KEY, KUN_MODEL_ROUTER_API_KEY, or MODEL_ROUTER_API_KEY for the key; SCIFORGE_MODEL_ROUTER_BASE_URL or MODEL_ROUTER_BASE_URL for the base URL; and SCIFORGE_MODEL_ROUTER_MODEL or MODEL_ROUTER_MODEL for the model. Never print secret values.',
  '- Treat the delegated prompt as a bounded execution request, not as an interactive consultation. Do not ask the parent or user what to do next.',
  '- If the delegated task names deliverables, output paths, or file mutations, create or edit those files with tools before your final response.',
  '- Before declaring completion, verify requested files or observable outputs with read/ls/grep/bash as appropriate and mention the verified paths in your final response.',
  '- If you cannot complete the delegated task, start the final response with CHILD_AGENT_BLOCKED and explain the blocker plus any partial work.',
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
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: typeof args.label === 'string' ? args.label : undefined,
            prompt: withChildRuntimeGuardrails(prompt),
            workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
            model: normalizeDelegateModel(args.model) ?? context.model?.id,
            childTimeoutMs: normalizeDelegateTimeoutMs(args.timeout_ms),
            allowedToolNames: context.allowedToolNames,
            strictAllowedToolNames: false,
            ...(context.bashCommandPolicy ? { bashCommandPolicy: context.bashCommandPolicy } : {}),
            ...(context.filePathPolicy ? { filePathPolicy: context.filePathPolicy } : {}),
            signal: context.abortSignal
          })
          return {
            output: {
              childId: record.id,
              status: record.status,
              summary: record.summary,
              error: record.error,
              usage: record.usage,
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
          const sharedTimeoutMs = normalizeDelegateTimeoutMs(args.timeout_ms)
          const records = await runWithConcurrency(tasks, concurrency, async (task) => runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: task.label,
            prompt: withChildRuntimeGuardrails(task.prompt),
            workspace: (task.workspace ?? sharedWorkspace) || context.workspace,
            model: task.model ?? sharedModel ?? context.model?.id,
            childTimeoutMs: task.timeoutMs ?? sharedTimeoutMs,
            allowedToolNames: context.allowedToolNames,
            strictAllowedToolNames: false,
            ...(context.bashCommandPolicy ? { bashCommandPolicy: context.bashCommandPolicy } : {}),
            ...(context.filePathPolicy ? { filePathPolicy: context.filePathPolicy } : {}),
            signal: context.abortSignal
          }))
          const children = records.map((record) => ({
            childId: record.id,
            label: record.label,
            status: record.status,
            summary: record.summary,
            error: record.error,
            usage: record.usage
          }))
          return {
            output: {
              children,
              total: children.length,
              completed: children.filter((child) => child.status === 'completed').length,
              failed: children.filter((child) => child.status === 'failed').length,
              aborted: children.filter((child) => child.status === 'aborted').length,
              concurrency,
              configured_concurrency: diagnostics.config.maxParallel,
              ...(sharedTimeoutMs !== undefined ? { shared_timeout_ms: sharedTimeoutMs } : {}),
              ...(firstSpawnIndex > 1
                ? { warning: `This batch starts at child agent spawn #${firstSpawnIndex} for the thread. Spawn only when the extra prefix/cache cost is worth it.` }
                : {})
            },
            isError: children.some((child) => child.status === 'failed' || child.status === 'aborted')
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

function normalizeDelegateTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : undefined
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await run(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}
