import type {
  ComputerUseAction,
  ComputerUseBackendKind,
  ComputerUseLeaseState,
  ComputerUseReleaseReason,
  ComputerUseRiskAssessment
} from './contract.js'

export type ComputerUseAuditEvent =
  | 'list_targets'
  | 'bind_target'
  | 'release_target'
  | 'release_all_targets'
  | 'action'
  | 'diagnostics'

export type ComputerUseAuditRecord = {
  auditId: string
  sequence: number
  timestamp: string
  event: ComputerUseAuditEvent
  ok: boolean
  action?: ComputerUseAction
  computerUseSessionId?: string
  agentId?: string
  threadId?: string
  turnId?: string
  targetId?: string
  backend?: ComputerUseBackendKind
  leaseState?: ComputerUseLeaseState
  rejectionCode?: string
  message?: string
  releaseReason?: ComputerUseReleaseReason
  risk?: ComputerUseRiskAssessment
  budget?: {
    dimension: 'turn' | 'session'
    used: number
    limit: number
  }
}

export type ComputerUseAuditRecordInput = Omit<
  ComputerUseAuditRecord,
  'auditId' | 'sequence' | 'timestamp'
>

export interface ComputerUseAuditRecorder {
  record(input: ComputerUseAuditRecordInput): ComputerUseAuditRecord
  records(): ComputerUseAuditRecord[]
}

export type InMemoryComputerUseAuditRecorderOptions = {
  nowIso?: () => string
  nextId?: (prefix: string) => string
  maxRecords?: number
}

export class InMemoryComputerUseAuditRecorder implements ComputerUseAuditRecorder {
  private readonly entries: ComputerUseAuditRecord[] = []
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string
  private readonly maxRecords: number
  private sequence = 0

  constructor(options: InMemoryComputerUseAuditRecorderOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`)
    this.maxRecords = Math.max(1, Math.floor(options.maxRecords ?? 500))
  }

  record(input: ComputerUseAuditRecordInput): ComputerUseAuditRecord {
    const record: ComputerUseAuditRecord = {
      auditId: this.nextId('cu_audit'),
      sequence: ++this.sequence,
      timestamp: this.nowIso(),
      ...input
    }
    this.entries.push(record)
    while (this.entries.length > this.maxRecords) this.entries.shift()
    return record
  }

  records(): ComputerUseAuditRecord[] {
    return [...this.entries]
  }
}
