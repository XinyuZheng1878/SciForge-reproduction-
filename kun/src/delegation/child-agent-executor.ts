import { InMemoryApprovalGate } from '../adapters/in-memory-approval-gate.js'
import { InMemoryEventBus } from '../adapters/in-memory-event-bus.js'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { InMemoryThreadStore } from '../adapters/in-memory-thread-store.js'
import { InMemoryUserInputGate } from '../adapters/in-memory-user-input-gate.js'
import type { ImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type { TurnItem } from '../contracts/items.js'
import type { ApprovalPolicy, SandboxMode } from '../contracts/policy.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { AgentLoop } from '../loop/agent-loop.js'
import type { ContextCompactionConfig, ModelConfig } from '../loop/model-context-profile.js'
import { ContextCompactor } from '../loop/context-compactor.js'
import { InflightTracker } from '../loop/inflight-tracker.js'
import { SteeringQueue } from '../loop/steering-queue.js'
import type { TokenEconomyConfig } from '../loop/token-economy.js'
import type { MemoryStore } from '../memory/memory-store.js'
import type { ModelClient } from '../ports/model-client.js'
import { RandomIdGenerator } from '../ports/id-generator.js'
import type { ToolHost } from '../ports/tool-host.js'
import type { SkillRuntime } from '../skills/skill-runtime.js'
import { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import { ThreadService } from '../services/thread-service.js'
import { TurnService } from '../services/turn-service.js'
import { UsageService } from '../services/usage-service.js'
import type { ChildRunExecutor, ChildRunTranscriptEntry } from '@sciforge/multi-agent'

export type ChildAgentExecutorOptions = {
  model: ModelClient
  toolHost: ToolHost
  prefix: ImmutablePrefix
  defaultModel: string
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  tokenEconomy?: TokenEconomyConfig
  runtime?: RuntimeTuningConfig
  nowIso?: () => string
  modelCapabilities?: (model: string) => ModelCapabilityMetadata
  skillRuntime?: SkillRuntime
  memoryStore?: MemoryStore
}

export const DEFAULT_CHILD_MAX_TURN_MODEL_STEPS = 512

export function resolveChildMaxTurnModelSteps(runtime: RuntimeTuningConfig | undefined): number {
  const configured = runtime?.maxTurnModelSteps
  return Math.max(
    typeof configured === 'number' && Number.isFinite(configured) ? Math.trunc(configured) : 0,
    DEFAULT_CHILD_MAX_TURN_MODEL_STEPS
  )
}

export function createChildAgentExecutor(options: ChildAgentExecutorOptions): ChildRunExecutor {
  return async (input) => {
    const nowIso = options.nowIso ?? (() => new Date().toISOString())
    const eventBus = new InMemoryEventBus()
    const sessionStore = new InMemorySessionStore()
    const threadStore = new InMemoryThreadStore()
    const usage = new UsageService()
    const ids = new RandomIdGenerator()
    const inflight = new InflightTracker()
    const steering = new SteeringQueue()
    const compactor = new ContextCompactor({
      contextCompaction: options.contextCompaction,
      models: options.models
    })
    const events = new RuntimeEventRecorder({
      eventBus,
      sessionStore,
      allocateSeq: (threadId) => eventBus.allocateSeq(threadId),
      nowIso
    })
    const turns = new TurnService({
      threadStore,
      sessionStore,
      events,
      inflight,
      steering,
      compactor,
      ids,
      nowIso
    })
    const threads = new ThreadService({
      threadStore,
      sessionStore,
      events,
      ids,
      nowIso
    })
    const loop = new AgentLoop({
      threadStore,
      sessionStore,
      approvalGate: new InMemoryApprovalGate(),
      userInputGate: new InMemoryUserInputGate(),
      model: options.model,
      toolHost: options.toolHost,
      usage,
      events,
      turns,
      inflight,
      steering,
      compactor,
      prefix: options.prefix,
      ids,
      nowIso,
      ...(options.modelCapabilities ? { modelCapabilities: options.modelCapabilities } : {}),
      ...(options.skillRuntime ? { skillRuntime: options.skillRuntime } : {}),
      ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
      ...(options.contextCompaction ? { contextCompaction: options.contextCompaction } : {}),
      ...(options.tokenEconomy ? { tokenEconomy: options.tokenEconomy } : {}),
      maxTurnModelSteps: resolveChildMaxTurnModelSteps(options.runtime),
      ...(options.runtime?.toolStorm ? { toolStorm: options.runtime.toolStorm } : {}),
      ...(options.runtime?.toolArgumentRepair ? { toolArgumentRepair: options.runtime.toolArgumentRepair } : {})
    })

    const model = input.model?.trim() || options.defaultModel
    const thread = await threads.create({
      title: childThreadTitle(input.childId, input.label),
      workspace: input.workspace?.trim() || '~',
      model,
      mode: 'agent',
      approvalPolicy: options.approvalPolicy ?? 'auto',
      ...(options.sandboxMode ? { sandboxMode: options.sandboxMode } : {})
    }, {
      id: input.childId,
      title: childThreadTitle(input.childId, input.label)
    })
    const started = await turns.startTurn({
      threadId: thread.id,
      request: {
        prompt: input.prompt,
        model,
        mode: 'agent',
        ...(input.allowedToolNames ? { allowedToolNames: [...input.allowedToolNames] } : {}),
        ...(input.strictAllowedToolNames !== undefined ? { strictAllowedToolNames: input.strictAllowedToolNames } : {}),
        ...(input.bashCommandPolicy ? { bashCommandPolicy: input.bashCommandPolicy } : {}),
        ...(input.filePathPolicy ? { filePathPolicy: input.filePathPolicy } : {})
      }
    })
    let parentAbortHandler: (() => void) | undefined
    if (input.signal) {
      const abortChildTurn = () => {
        void turns.interruptTurn({
          threadId: thread.id,
          turnId: started.turnId,
          discard: false
        }).catch(() => undefined)
      }
      if (input.signal.aborted) {
        abortChildTurn()
      } else {
        parentAbortHandler = abortChildTurn
        input.signal.addEventListener('abort', parentAbortHandler, { once: true })
      }
    }
    const seenTranscriptEntries = new Map<string, string>()
    let appendTranscriptChain = Promise.resolve()
    const appendChildTranscript = (entry: ChildRunTranscriptEntry) => {
      const fingerprint = JSON.stringify(entry)
      if (seenTranscriptEntries.get(entry.id) === fingerprint) return
      seenTranscriptEntries.set(entry.id, fingerprint)
      appendTranscriptChain = appendTranscriptChain
        .catch(() => undefined)
        .then(() => input.appendTranscript(entry))
    }
    const unsubscribe = eventBus.subscribe(thread.id, (event) => {
      const entry = transcriptEntryFromRuntimeEvent(event, started.turnId)
      if (!entry) return
      appendChildTranscript(entry)
    })
    let status: 'completed' | 'failed' | 'aborted'
    try {
      status = await loop.runTurn(thread.id, started.turnId)
    } finally {
      if (input.signal && parentAbortHandler) input.signal.removeEventListener('abort', parentAbortHandler)
      unsubscribe()
      await appendTranscriptChain.catch(() => undefined)
    }
    const childEvents = await sessionStore.loadEventsSince(thread.id, 0)
    const items = await sessionStore.loadItems(thread.id)
    const transcript = transcriptEntriesForChild(items, started.turnId)
    const summary = summarizeChildTurn(items, started.turnId, status)
    const threadUsage = usage.forThread(thread.id)
    const runtimeError = childEvents
      .filter((event) => event.kind === 'error' && event.turnId === started.turnId)
      .find((event) => event.kind === 'error' && event.severity !== 'warning' && event.severity !== 'info')
    const recoveredToolLoopFailure = isRecoverableToolLoopFailure({
      status,
      runtimeError,
      transcript
    })
    if (runtimeError?.kind === 'error' && !recoveredToolLoopFailure) {
      throw childAgentFailure(runtimeError.message, transcript, threadUsage)
    }
    if (status !== 'completed' && !recoveredToolLoopFailure) {
      throw childAgentFailure(summary || `child agent ${status}`, transcript, threadUsage)
    }
    if (isBlockedChildFinalText(summary)) {
      throw childAgentFailure(
        summary || 'child agent reported a blocker',
        transcript,
        threadUsage
      )
    }
    if (isPrematureChildClarification(summary)) {
      throw childAgentFailure(
        'child agent stopped for clarification instead of completing the delegated task',
        transcript,
        threadUsage
      )
    }
    return {
      summary,
      usage: threadUsage,
      transcript
    }
  }
}

function childAgentFailure(
  message: string,
  transcript: ChildRunTranscriptEntry[],
  usage: ReturnType<UsageService['forThread']>
): Error {
  return Object.assign(new Error(message), {
    multiAgentTranscript: transcript,
    multiAgentUsage: usage
  })
}

function childThreadTitle(childId: string, label?: string): string {
  const suffix = label?.trim() || childId
  return `Child agent: ${suffix}`
}

function summarizeChildTurn(
  items: readonly TurnItem[],
  turnId: string,
  status: 'completed' | 'failed' | 'aborted'
): string {
  const turnItems = items.filter((item) => item.turnId === turnId)
  const assistantText = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
    .map((item) => redactSecretText(item.text).trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (assistantText) return assistantText
  const errors = turnItems
    .filter((item): item is Extract<TurnItem, { kind: 'error' }> => item.kind === 'error')
    .map((item) => redactSecretText(item.message).trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (errors) return errors
  const toolResult = [...turnItems]
    .reverse()
    .find((item): item is Extract<TurnItem, { kind: 'tool_result' }> => item.kind === 'tool_result')
  if (toolResult) return stringifySummary(toolResult.output)
  return status === 'completed'
    ? 'Child agent completed without a text response.'
    : `Child agent ${status}.`
}

function isRecoverableToolLoopFailure(input: {
  status: 'completed' | 'failed' | 'aborted'
  runtimeError: RuntimeEvent | undefined
  transcript: readonly ChildRunTranscriptEntry[]
}): boolean {
  if (input.status !== 'failed') return false
  if (input.runtimeError?.kind !== 'error') return false
  if (input.runtimeError.code !== 'tool_loop_recovery_exhausted') return false
  return input.transcript.some((entry) =>
    entry.kind === 'assistant_message' &&
    isUsefulChildFinalText(entry.text)
  )
}

function isUsefulChildFinalText(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < 40) return false
  if (/^```json\s*\{\s*"type"\s*:\s*"final_answer"\s*,\s*"content"\s*:\s*""/i.test(trimmed)) return false
  if (/^(done|completed|finished|ok|okay|cannot continue|i'?m stuck)\.?$/i.test(trimmed)) return false
  if (/^Tool loop recovery failed:/i.test(trimmed)) return false
  return true
}

export function isBlockedChildFinalText(text: string | undefined): boolean {
  const normalized = normalizedChildFinalText(text)
  if (!/^CHILD_AGENT_BLOCKED\b/i.test(normalized)) return false
  return !hasSelfCorrectedBlocker(normalized)
}

function normalizedChildFinalText(text: string | undefined): string {
  return (text?.trim() ?? '')
    .replace(/^(?:[#>*_\-\s`])+/g, '')
    .replace(/^(?:\*\*)?CHILD_AGENT_BLOCKED(?:\*\*)?/i, 'CHILD_AGENT_BLOCKED')
}

function hasSelfCorrectedBlocker(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  if (!/\b(?:actually|not blocked|no longer blocked|completed after all|successfully completed|误判|已完成)\b/i.test(firstLine)) {
    return false
  }
  if (!/\b(?:deliverable|verified|completed|complete|created|written|wrote|successfully|输出|完成|已写入|已生成)\b/i.test(text)) {
    return false
  }
  return /(?:^|\s)(?:outputs\/|reports\/|tables\/|figures\/|scripts\/|\/[^\s`'")]+\/[^\s`'")]+)\S*/m.test(text)
}

export function isPrematureChildClarification(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length < 20) return false
  if (isBlockedChildFinalText(trimmed)) return false

  const asksForNextInstruction = [
    /\bwhat would you like me to\b/i,
    /\bhow would you like me to\b/i,
    /\bwould you like me to\b/i,
    /\bdo you want me to\b/i,
    /\bshould i\b.{0,80}\b(?:edit|write|continue|proceed|revise|add|check)\b/i,
    /\bplease let me know\b.{0,120}\b(?:next|how to proceed|what to do|which option)\b/i,
    /请问.{0,40}(?:需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /请告诉我.{0,40}(?:想要|需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /你.{0,20}(?:需要|希望).{0,20}我.{0,20}(?:做|修改|补充|继续|检查|润色)/,
    /需要我.{0,30}(?:做什么|继续|修改|补充|润色|检查)/,
    /我可以.{0,40}(?:润色|修改|补充|检查|继续|添加)/
  ]
  if (!asksForNextInstruction.some((pattern) => pattern.test(trimmed))) return false

  return /[?？]/.test(trimmed) || /(?:例如|for example|options include)/i.test(trimmed)
}

function stringifySummary(value: unknown): string {
  if (typeof value === 'string') return redactSecretText(value).trim()
  if (value == null) return ''
  try {
    return redactSecretText(JSON.stringify(redactSecrets(value)))
  } catch {
    return redactSecretText(String(value))
  }
}

function transcriptEntriesForChild(
  items: readonly TurnItem[],
  turnId: string
): ChildRunTranscriptEntry[] {
  return items
    .filter((item) => item.turnId === turnId)
    .map((item) => transcriptEntryFromItem(item))
    .filter((entry): entry is ChildRunTranscriptEntry => entry != null)
}

function transcriptEntryFromRuntimeEvent(
  event: RuntimeEvent,
  turnId: string
): ChildRunTranscriptEntry | null {
  if (event.turnId !== turnId) return null
  switch (event.kind) {
    case 'item_created':
    case 'item_updated':
    case 'item_completed':
    case 'tool_call_started':
    case 'tool_call_finished':
      return transcriptEntryFromItem(event.item)
    default:
      return null
  }
}

function transcriptEntryFromItem(item: TurnItem): ChildRunTranscriptEntry | null {
  const base = {
    id: item.id,
    createdAt: item.createdAt,
    ...(item.status ? { status: item.status } : {})
  }
  switch (item.kind) {
    case 'user_message':
      return {
        ...base,
        kind: 'user_message',
        text: redactSecretText(item.displayText?.trim() || item.text)
      }
    case 'assistant_text':
      return {
        ...base,
        kind: 'assistant_message',
        text: redactSecretText(item.text)
      }
    case 'assistant_reasoning':
      return {
        ...base,
        kind: 'reasoning',
        text: redactSecretText(item.text)
      }
    case 'tool_call':
      return {
        ...base,
        kind: 'tool',
        summary: item.summary ?? `Call ${item.toolName}`,
        text: stringifySummary(item.arguments),
        metadata: {
          phase: 'call',
          toolName: item.toolName,
          callId: item.callId,
          toolKind: item.toolKind
        }
      }
    case 'tool_result':
      return {
        ...base,
        kind: 'tool',
        summary: item.isError ? `${item.toolName} failed` : `${item.toolName} result`,
        text: stringifySummary(item.output),
        metadata: {
          phase: 'result',
          toolName: item.toolName,
          callId: item.callId,
          toolKind: item.toolKind,
          isError: item.isError
        }
      }
    case 'approval':
      return {
        ...base,
        kind: 'event',
        summary: redactSecretText(item.summary),
        text: redactSecretText(item.summary),
        metadata: {
          approvalId: item.approvalId,
          toolName: item.toolName
        }
      }
    case 'user_input':
      return {
        ...base,
        kind: 'event',
        text: redactSecretText(item.prompt),
        metadata: {
          inputId: item.inputId,
          questions: redactSecrets(item.questions)
        }
      }
    case 'compaction':
      return {
        ...base,
        kind: 'system',
        text: redactSecretText(item.summary),
        metadata: {
          replacedTokens: item.replacedTokens,
          pinnedConstraints: item.pinnedConstraints.map(redactSecretText)
        }
      }
    case 'review':
      return {
        ...base,
        kind: 'assistant_message',
        summary: redactSecretText(item.title),
        text: item.reviewText ? redactSecretText(item.reviewText) : stringifySummary(item.output)
      }
    case 'error':
      return {
        ...base,
        kind: 'event',
        text: redactSecretText(item.message),
        status: item.status,
        metadata: {
          ...(item.code ? { code: item.code } : {}),
          ...(item.severity ? { severity: item.severity } : {}),
          ...(item.details !== undefined ? { details: redactSecrets(item.details) } : {})
        }
      }
    default:
      return null
  }
}
