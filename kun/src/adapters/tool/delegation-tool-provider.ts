import type { MultiAgentRuntime } from '@sciforge/multi-agent'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

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
            model: { type: 'string' }
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
            prompt,
            workspace: typeof args.workspace === 'string' ? args.workspace : context.workspace,
            model: typeof args.model === 'string' ? args.model : context.model?.id,
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
                  model: { type: 'string' }
                },
                required: ['prompt'],
                additionalProperties: false
              }
            },
            workspace: { type: 'string' },
            model: { type: 'string' }
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
          const sharedModel = typeof args.model === 'string' ? args.model.trim() : ''
          const records = await runWithConcurrency(tasks, concurrency, async (task) => runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            label: task.label,
            prompt: task.prompt,
            workspace: (task.workspace ?? sharedWorkspace) || context.workspace,
            model: (task.model ?? sharedModel) || context.model?.id,
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

type NormalizedDelegateTask = {
  prompt: string
  label?: string
  workspace?: string
  model?: string
}

function normalizeDelegateTask(value: unknown): NormalizedDelegateTask | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (!prompt) return null
  const label = trimOptional(record.label)
  const workspace = trimOptional(record.workspace)
  const model = trimOptional(record.model)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {})
  }
}

function trimOptional(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed ? trimmed : undefined
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
