import type {
  ThreadMode,
  ThreadRecord,
  ThreadGoal,
  ThreadTodoList,
  ThreadRelation,
  ThreadSource,
  ThreadSummary,
  ThreadStatus
} from '../contracts/threads.js'
import {
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  type ApprovalPolicy,
  type SandboxMode
} from '../contracts/policy.js'

/**
 * Domain helper for thread records. The contract type is the source of
 * truth; this module only adds small factory/utility helpers so the
 * services and stores can stay free of date-string formatting.
 */
export type ThreadEntity = ThreadRecord

export function createThreadRecord(input: {
  id: string
  title: string
  workspace: string
  model: string
  mode?: ThreadMode
  status?: ThreadStatus
  approvalPolicy?: ApprovalPolicy
  sandboxMode?: SandboxMode
  costBudgetUsd?: number
  costBudgetWarningSent?: boolean
  relation?: ThreadRelation
  threadSource?: ThreadSource
  visibility?: ThreadRecord['visibility']
  sidebarVisibility?: ThreadRecord['sidebarVisibility']
  titleSource?: ThreadRecord['titleSource']
  parentThreadId?: string
  parentTurnId?: string
  agentMetadata?: ThreadRecord['agentMetadata']
  forkedFromThreadId?: string
  forkedFromTitle?: string
  forkedAt?: string
  forkedFromMessageCount?: number
  forkedFromTurnCount?: number
  goal?: ThreadGoal
  todos?: ThreadTodoList
  guiPlan?: ThreadRecord['guiPlan']
  createdAt?: string
}): ThreadEntity {
  const now = input.createdAt ?? new Date().toISOString()
  return {
    id: input.id,
    title: input.title,
    workspace: input.workspace,
    model: input.model,
    mode: input.mode ?? 'agent',
    status: input.status ?? 'idle',
    approvalPolicy: input.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
    sandboxMode: input.sandboxMode ?? DEFAULT_SANDBOX_MODE,
    ...(input.costBudgetUsd !== undefined ? { costBudgetUsd: input.costBudgetUsd } : {}),
    ...(input.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: input.costBudgetWarningSent } : {}),
    relation: input.relation ?? 'primary',
    ...(input.threadSource ? { threadSource: input.threadSource } : {}),
    ...(input.visibility ? { visibility: input.visibility } : {}),
    ...(input.sidebarVisibility ? { sidebarVisibility: input.sidebarVisibility } : {}),
    ...(input.titleSource ? { titleSource: input.titleSource } : {}),
    ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
    ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
    ...(input.agentMetadata ? { agentMetadata: input.agentMetadata } : {}),
    ...(input.forkedFromThreadId ? { forkedFromThreadId: input.forkedFromThreadId } : {}),
    ...(input.forkedFromTitle ? { forkedFromTitle: input.forkedFromTitle } : {}),
    ...(input.forkedAt ? { forkedAt: input.forkedAt } : {}),
    ...(input.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: input.forkedFromMessageCount } : {}),
    ...(input.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: input.forkedFromTurnCount } : {}),
    ...(input.goal ? { goal: input.goal } : {}),
    ...(input.todos ? { todos: input.todos } : {}),
    ...(input.guiPlan ? { guiPlan: input.guiPlan } : {}),
    createdAt: now,
    updatedAt: now,
    turns: []
  }
}

export function touchThread(thread: ThreadEntity, updatedAt?: string): ThreadEntity {
  return { ...thread, updatedAt: updatedAt ?? new Date().toISOString() }
}

export function toThreadSummary(
  thread: ThreadEntity
): ThreadSummary {
  const threadSource = inferThreadSource(thread)
  return {
    id: thread.id,
    title: thread.title,
    workspace: thread.workspace,
    model: thread.model,
    mode: thread.mode,
    status: thread.status,
    ...(thread.costBudgetUsd !== undefined ? { costBudgetUsd: thread.costBudgetUsd } : {}),
    ...(thread.costBudgetWarningSent !== undefined ? { costBudgetWarningSent: thread.costBudgetWarningSent } : {}),
    relation: thread.relation ?? 'primary',
    ...(threadSource ? { threadSource } : {}),
    ...(thread.visibility ? { visibility: thread.visibility } : {}),
    ...(thread.sidebarVisibility ? { sidebarVisibility: thread.sidebarVisibility } : {}),
    ...(thread.titleSource ? { titleSource: thread.titleSource } : {}),
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.parentTurnId ? { parentTurnId: thread.parentTurnId } : {}),
    ...(thread.agentMetadata ? { agentMetadata: thread.agentMetadata } : {}),
    ...(thread.forkedFromThreadId ? { forkedFromThreadId: thread.forkedFromThreadId } : {}),
    ...(thread.forkedFromTitle ? { forkedFromTitle: thread.forkedFromTitle } : {}),
    ...(thread.forkedAt ? { forkedAt: thread.forkedAt } : {}),
    ...(thread.forkedFromMessageCount !== undefined ? { forkedFromMessageCount: thread.forkedFromMessageCount } : {}),
    ...(thread.forkedFromTurnCount !== undefined ? { forkedFromTurnCount: thread.forkedFromTurnCount } : {}),
    ...(thread.goal ? { goal: thread.goal } : {}),
    ...(thread.todos ? { todos: thread.todos } : {}),
    ...(thread.guiPlan ? { guiPlan: thread.guiPlan } : {}),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  }
}

export function inferThreadSource(
  thread: Pick<ThreadEntity, 'parentThreadId'> & {
    relation?: ThreadRelation
    threadSource?: ThreadSource
    forkedFromThreadId?: string
  }
): ThreadSource | undefined {
  if (thread.threadSource) return thread.threadSource
  if (thread.relation === 'side') return 'side'
  if (thread.relation === 'fork') return 'fork'
  if (thread.relation === undefined && thread.parentThreadId) return 'side'
  return undefined
}
