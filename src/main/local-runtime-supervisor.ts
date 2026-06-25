import type { LocalRuntimeStatusPayload } from '../shared/sciforge-api'

export type LocalRuntimeStatus = LocalRuntimeStatusPayload

export type RestartVerdict =
  | { allowed: true; attempt: number; delayMs: number }
  | { allowed: false; attempt: number; delayMs: 0 }

export type RestartBudgetOptions = {
  windowMs: number
  maxRestarts: number
  baseDelayMs?: number
  delayFactor?: number
  now?: () => number
}

export class RestartBudget {
  private readonly windowMs: number
  private readonly maxRestarts: number
  private readonly baseDelayMs: number
  private readonly delayFactor: number
  private readonly now: () => number
  private attempts: number[] = []

  constructor(options: RestartBudgetOptions) {
    this.windowMs = Math.max(1, options.windowMs)
    this.maxRestarts = Math.max(1, options.maxRestarts)
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000)
    this.delayFactor = Math.max(1, options.delayFactor ?? 3)
    this.now = options.now ?? (() => Date.now())
  }

  note(): RestartVerdict {
    const at = this.now()
    this.attempts = this.attempts.filter((time) => at - time < this.windowMs)
    if (this.attempts.length >= this.maxRestarts) {
      return { allowed: false, attempt: this.attempts.length, delayMs: 0 }
    }
    this.attempts.push(at)
    const attempt = this.attempts.length
    return {
      allowed: true,
      attempt,
      delayMs: Math.round(this.baseDelayMs * Math.pow(this.delayFactor, attempt - 1))
    }
  }

  reset(): void {
    this.attempts = []
  }
}
