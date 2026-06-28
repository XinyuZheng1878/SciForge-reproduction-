import type { AgentRuntimeChild } from '../../../shared/agent-runtime-contract'
import {
  EMPTY_MULTI_AGENT_USAGE,
  FileMultiAgentStore,
  InMemoryMultiAgentStore,
  MultiAgentRuntime,
  type MultiAgentChildEvent,
  type MultiAgentChildRunRecord,
  type MultiAgentExecutor,
  type MultiAgentExecutorResult,
  type MultiAgentStore,
  type MultiAgentUsage
} from '../../../../packages/workers/multi-agent/src'
import type {
  CodexAppServerDynamicToolCallRequest,
  CodexAppServerDynamicToolCallResponse,
  CodexAppServerDynamicToolSpec
} from './codex-dynamic-mcp-tools'

export const CODEX_MULTI_AGENT_NAMESPACE = 'multi_agent_v1'
export const CODEX_MULTI_AGENT_SPAWN_TOOL = 'spawn_agent'
export const CODEX_MULTI_AGENT_FLAT_TOOL_NAME = 'delegate_task'

export type CodexMultiAgentToolBridgeOptions = {
  enabled?: boolean
  maxParallel?: number
  maxChildren?: number
  store?: MultiAgentStore
  storeRoot?: string
  executor: MultiAgentExecutor
  onChildEvent?: (event: MultiAgentChildEvent) => Promise<void> | void
}

type ActiveRequest = {
  controller: AbortController
  threadId?: string
  turnId?: string
}

export function createCodexMultiAgentToolBridge(
  options: CodexMultiAgentToolBridgeOptions
): CodexMultiAgentToolBridge {
  return new CodexMultiAgentToolBridge(options)
}

export class CodexMultiAgentToolBridge {
  private readonly runtime: MultiAgentRuntime
  private readonly activeRequests = new Set<ActiveRequest>()

  constructor(private readonly options: CodexMultiAgentToolBridgeOptions) {
    this.runtime = new MultiAgentRuntime({
      config: {
        enabled: options.enabled ?? true,
        maxParallel: options.maxParallel ?? 2,
        maxChildren: options.maxChildren ?? 4
      },
      store: options.store ?? (options.storeRoot
        ? new FileMultiAgentStore(options.storeRoot)
        : new InMemoryMultiAgentStore()),
      executor: options.executor,
      events: options.onChildEvent ? { onChildEvent: options.onChildEvent } : undefined
    })
  }

  dynamicTools(): CodexAppServerDynamicToolSpec[] {
    if (this.options.enabled === false) return []
    return [{
      type: 'function',
      name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      description: 'Run a bounded child agent task in parallel and return its child run status.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The child agent task prompt.' },
          task: { type: 'string', description: 'Alias for prompt.' },
          instructions: { type: 'string', description: 'Alias for prompt.' },
          label: { type: 'string', description: 'Short label for the child agent.' },
          name: { type: 'string', description: 'Alias for label.' },
          workspace: { type: 'string', description: 'Workspace root for the child task.' },
          cwd: { type: 'string', description: 'Alias for workspace.' },
          model: { type: 'string', description: 'Optional model override routed through Model Router.' }
        },
        additionalProperties: false
      }
    }]
  }

  canHandle(request: CodexAppServerDynamicToolCallRequest): boolean {
    const name = normalizedToolName(request)
    return name === CODEX_MULTI_AGENT_FLAT_TOOL_NAME ||
      name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_SPAWN_TOOL}` ||
      name === 'multi_agent_v1_spawn_agent'
  }

  async callTool(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    if (!this.canHandle(request)) {
      return failedMultiAgentResponse(`Unsupported multi-agent tool: ${displayToolName(request)}.`)
    }
    const input = parseSpawnAgentArguments(request.arguments)
    if (!input.prompt) return failedMultiAgentResponse('delegate_task requires a prompt, task, or instructions string.')
    if (!request.threadId) return failedMultiAgentResponse('delegate_task requires threadId.')
    if (!request.turnId) return failedMultiAgentResponse('delegate_task requires turnId.')

    const active = { controller: new AbortController(), threadId: request.threadId, turnId: request.turnId }
    this.activeRequests.add(active)
    try {
      const record = await this.runtime.runChild({
        parentThreadId: request.threadId,
        parentTurnId: request.turnId,
        label: input.label,
        prompt: input.prompt,
        workspace: input.workspace,
        model: input.model,
        signal: active.controller.signal
      })
      return responseFromChildRecord(record)
    } finally {
      this.activeRequests.delete(active)
    }
  }

  abortRequestsForTurn(threadId: string, turnId: string): number {
    let aborted = 0
    for (const request of this.activeRequests) {
      if (request.threadId !== threadId && request.turnId !== turnId) continue
      if (request.controller.signal.aborted) continue
      request.controller.abort(new Error('multi-agent request aborted by parent turn interrupt'))
      aborted += 1
    }
    return aborted
  }

  async child(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    return this.runtime.child(parentThreadId, childId)
  }
}

export function codexChildFromMultiAgentRecord(
  record: MultiAgentChildRunRecord,
  event?: MultiAgentChildEvent
): AgentRuntimeChild {
  const usage = agentUsageFromMultiAgentUsage(record.usage)
  return {
    id: record.id,
    runtimeId: 'codex',
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    kind: 'agent',
    status: record.status,
    ...(record.label ? { label: record.label, name: record.label } : {}),
    prompt: record.prompt,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(usage ? { usage } : {}),
    transcriptRef: {
      runtimeId: 'codex',
      childId: record.id,
      transcriptId: record.threadRef?.threadId ?? record.id,
      source: 'codex-multi-agent',
      kind: record.threadRef?.threadId ? 'runtime' : 'remote'
    },
    ...(record.threadRef?.threadId
      ? {
          openAsThreadRef: {
            runtimeId: 'codex',
            threadId: record.threadRef.threadId,
            relation: 'side' as const,
            ...(record.threadRef.url ? { url: record.threadRef.url } : {})
          }
        }
      : {}),
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { completedAt: record.finishedAt } : {}),
    metadata: {
      source: 'codex.multi_agent_v1.spawn_agent',
      ...(record.threadRef?.turnId ? { childTurnId: record.threadRef.turnId } : {}),
      ...(event?.seq !== undefined ? { childSeq: event.seq } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }
}

function responseFromChildRecord(record: MultiAgentChildRunRecord): CodexAppServerDynamicToolCallResponse {
  const ok = record.status !== 'failed' && record.status !== 'aborted'
  return {
    success: ok,
    contentItems: [{
      type: 'inputText',
      text: JSON.stringify({
        childId: record.id,
        status: record.status,
        ...(record.label ? { label: record.label } : {}),
        ...(record.summary ? { summary: record.summary } : {}),
        ...(record.threadRef ? { threadRef: record.threadRef } : {}),
        ...(record.usage ? { usage: record.usage } : {}),
        ...(record.error ? { error: record.error } : {})
      }, null, 2)
    }]
  }
}

function parseSpawnAgentArguments(value: unknown): {
  prompt: string
  label?: string
  workspace?: string
  model?: string
} {
  const args = recordArguments(value)
  const prompt = firstString(args.prompt, args.task, args.instructions, args.input, args.message)
  const label = firstString(args.label, args.name, args.agentName, args.agent)
  const workspace = firstString(args.workspace, args.cwd, args.workspaceRoot)
  const model = firstString(args.model)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {})
  }
}

function normalizedToolName(request: CodexAppServerDynamicToolCallRequest): string {
  if (request.namespace) return `${request.namespace}.${request.tool}`.trim()
  return request.tool.trim()
}

function displayToolName(request: CodexAppServerDynamicToolCallRequest): string {
  return request.namespace ? `${request.namespace}.${request.tool}` : request.tool
}

function recordArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function agentUsageFromMultiAgentUsage(usage: MultiAgentUsage = EMPTY_MULTI_AGENT_USAGE): AgentRuntimeChild['usage'] | undefined {
  const normalized = {
    ...(usage.promptTokens ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.totalTokens ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cachedTokens ? { cacheReadTokens: usage.cachedTokens } : {})
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function failedMultiAgentResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }]
  }
}
