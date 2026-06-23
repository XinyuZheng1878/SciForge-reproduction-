import type { ComputerUseSession } from './contract.js'

export type ComputerUseBudgetDimension = 'turn' | 'session'

export type ComputerUseActionBudgetOptions = {
  maxActionsPerTurn?: number
  maxActionsPerSession?: number
  maxTrackedTurns?: number
}

export type ComputerUseBudgetExhausted = {
  ok: false
  dimension: ComputerUseBudgetDimension
  used: number
  limit: number
  message: string
}

export type ComputerUseBudgetConsumed = {
  ok: true
  sessionUsed: number
  sessionLimit: number
  turnUsed: number
  turnLimit: number
}

export type ComputerUseBudgetResult = ComputerUseBudgetConsumed | ComputerUseBudgetExhausted

export type ComputerUseBudgetSnapshot = {
  maxActionsPerTurn: number
  maxActionsPerSession: number
  sessions: Array<{ computerUseSessionId: string; used: number; remaining: number }>
  turns: Array<{ key: string; computerUseSessionId: string; turnId?: string; used: number; remaining: number }>
}

const DEFAULT_MAX_ACTIONS_PER_TURN = 40
const DEFAULT_MAX_ACTIONS_PER_SESSION = 200
const DEFAULT_MAX_TRACKED_TURNS = 128

export class ComputerUseActionBudget {
  private readonly maxActionsPerTurn: number
  private readonly maxActionsPerSession: number
  private readonly maxTrackedTurns: number
  private readonly sessionCounts = new Map<string, number>()
  private readonly turnCounts = new Map<string, { computerUseSessionId: string; turnId?: string; used: number }>()

  constructor(options: ComputerUseActionBudgetOptions = {}) {
    this.maxActionsPerTurn = positiveInteger(options.maxActionsPerTurn, DEFAULT_MAX_ACTIONS_PER_TURN)
    this.maxActionsPerSession = positiveInteger(options.maxActionsPerSession, DEFAULT_MAX_ACTIONS_PER_SESSION)
    this.maxTrackedTurns = positiveInteger(options.maxTrackedTurns, DEFAULT_MAX_TRACKED_TURNS)
  }

  consume(session: ComputerUseSession): ComputerUseBudgetResult {
    const sessionId = session.computerUseSessionId
    const turnKey = this.turnKey(session)
    const sessionUsed = this.sessionCounts.get(sessionId) ?? 0
    if (sessionUsed >= this.maxActionsPerSession) {
      return exhausted('session', sessionUsed, this.maxActionsPerSession)
    }
    const turn = this.turnCounts.get(turnKey)
    const turnUsed = turn?.used ?? 0
    if (turnUsed >= this.maxActionsPerTurn) {
      return exhausted('turn', turnUsed, this.maxActionsPerTurn)
    }

    const nextSessionUsed = sessionUsed + 1
    const nextTurnUsed = turnUsed + 1
    this.sessionCounts.set(sessionId, nextSessionUsed)
    this.turnCounts.set(turnKey, {
      computerUseSessionId: sessionId,
      ...(session.turnId ? { turnId: session.turnId } : {}),
      used: nextTurnUsed
    })
    this.evictOldTurns(turnKey)
    return {
      ok: true,
      sessionUsed: nextSessionUsed,
      sessionLimit: this.maxActionsPerSession,
      turnUsed: nextTurnUsed,
      turnLimit: this.maxActionsPerTurn
    }
  }

  snapshot(): ComputerUseBudgetSnapshot {
    return {
      maxActionsPerTurn: this.maxActionsPerTurn,
      maxActionsPerSession: this.maxActionsPerSession,
      sessions: [...this.sessionCounts.entries()].map(([computerUseSessionId, used]) => ({
        computerUseSessionId,
        used,
        remaining: Math.max(0, this.maxActionsPerSession - used)
      })),
      turns: [...this.turnCounts.entries()].map(([key, value]) => ({
        key,
        computerUseSessionId: value.computerUseSessionId,
        ...(value.turnId ? { turnId: value.turnId } : {}),
        used: value.used,
        remaining: Math.max(0, this.maxActionsPerTurn - value.used)
      }))
    }
  }

  private turnKey(session: ComputerUseSession): string {
    return [
      session.computerUseSessionId,
      session.threadId,
      session.turnId ?? 'turn:unknown'
    ].join(':')
  }

  private evictOldTurns(activeKey: string): void {
    while (this.turnCounts.size > this.maxTrackedTurns) {
      let deleted = false
      for (const key of this.turnCounts.keys()) {
        if (key === activeKey) continue
        this.turnCounts.delete(key)
        deleted = true
        break
      }
      if (!deleted) break
    }
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function exhausted(
  dimension: ComputerUseBudgetDimension,
  used: number,
  limit: number
): ComputerUseBudgetExhausted {
  return {
    ok: false,
    dimension,
    used,
    limit,
    message:
      dimension === 'turn'
        ? `reached the computer_use action limit (${limit}) for this turn; summarize progress or ask the user how to proceed`
        : `reached the computer_use action limit (${limit}) for this session; release the target or ask the user how to proceed`
  }
}
