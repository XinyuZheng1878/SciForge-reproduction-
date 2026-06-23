import type {
  WorkflowFacadeErrorCode,
  WorkflowSideEffectCategory
} from './contract.js'

export type WorkflowAuditAction =
  | 'list'
  | 'run'
  | 'status'
  | 'stop'
  | 'validate'
  | 'import'
  | 'export'
  | 'schema'

export type WorkflowAuditTarget = {
  workflowId?: string
  runId?: string
  refKind?: 'workflow_id' | 'workflow' | 'name'
}

export type WorkflowAuditRecord = {
  auditId: string
  sequence: number
  timestamp: string
  event: 'workflow_operation'
  action: WorkflowAuditAction
  sideEffect: WorkflowSideEffectCategory
  outcome: 'success' | 'rejected' | 'failed'
  ok: boolean
  dryRun?: boolean
  preview?: boolean
  confirmationRequired?: boolean
  errorCode?: WorkflowFacadeErrorCode
  target?: WorkflowAuditTarget
}

export type WorkflowAuditRecordInput = Omit<
  WorkflowAuditRecord,
  'auditId' | 'sequence' | 'timestamp'
>

export interface WorkflowAuditRecorder {
  record(input: WorkflowAuditRecordInput): WorkflowAuditRecord
  records(): WorkflowAuditRecord[]
}

export type InMemoryWorkflowAuditRecorderOptions = {
  nowIso?: () => string
  nextId?: (prefix: string) => string
  maxRecords?: number
}

export class InMemoryWorkflowAuditRecorder implements WorkflowAuditRecorder {
  private readonly entries: WorkflowAuditRecord[] = []
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string
  private readonly maxRecords: number
  private sequence = 0

  constructor(options: InMemoryWorkflowAuditRecorderOptions = {}) {
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`)
    this.maxRecords = Math.max(1, Math.floor(options.maxRecords ?? 500))
  }

  record(input: WorkflowAuditRecordInput): WorkflowAuditRecord {
    const record: WorkflowAuditRecord = {
      auditId: this.nextId('wf_audit'),
      sequence: ++this.sequence,
      timestamp: this.nowIso(),
      ...input
    }
    this.entries.push(record)
    while (this.entries.length > this.maxRecords) this.entries.shift()
    return record
  }

  records(): WorkflowAuditRecord[] {
    return [...this.entries]
  }
}
