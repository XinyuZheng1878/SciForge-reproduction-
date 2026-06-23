export type ComputerUseBackendKind = 'global-native' | 'mac-app-scoped'

export type ComputerUseLeaseState = 'unbound' | 'active' | 'released' | 'rejected'

export type ComputerUseReleaseReason =
  | 'agent_release'
  | 'user_stop'
  | 'service_shutdown'
  | 'backend_unavailable'
  | 'session_replaced'
  | 'unknown'
  | (string & {})

export type ComputerUseAction =
  | 'list_targets'
  | 'bind_target'
  | 'release_target'
  | 'diagnostics'
  | 'screenshot'
  | 'cursor_position'
  | 'mouse_move'
  | 'click'
  | 'drag'
  | 'scroll'
  | 'type'
  | 'key'
  | 'wait'

export const COMPUTER_USE_WORKER_VERSION = '0.1.0'
export const COMPUTER_USE_WORKER_TRANSPORT = 'stdio'
export const COMPUTER_USE_WORKER_CAPABILITIES = [
  'list_targets',
  'bind_target',
  'release_target',
  'diagnostics',
  'screenshot',
  'cursor_position',
  'mouse_move',
  'click',
  'drag',
  'scroll',
  'type',
  'key',
  'wait'
] as const satisfies readonly ComputerUseAction[]

export type ComputerUseWorkerTransport = typeof COMPUTER_USE_WORKER_TRANSPORT
export type ComputerUseWorkerHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export type ComputerUseWorkerHealth = {
  status: ComputerUseWorkerHealthStatus
  available: boolean
  reason?: string
}

export type ComputerUseWorkerDiagnostics = {
  version: string
  transport: ComputerUseWorkerTransport
  health: ComputerUseWorkerHealth
  recentError?: string
  capabilities: ComputerUseAction[]
}

export type ComputerUseTargetKind = 'desktop' | 'app' | 'window'

export type ComputerUseMouseButton = 'left' | 'right' | 'middle'
export type ComputerUseScrollDirection = 'up' | 'down' | 'left' | 'right'

export type ComputerUseRiskCategory =
  | 'delete'
  | 'upload'
  | 'send_message'
  | 'submit_form'
  | 'system_settings'
  | 'transaction'
  | 'sensitive_data_transfer'

export type ComputerUseRiskAssessment = {
  requiresConfirmation: boolean
  confirmed: boolean
  blocked?: boolean
  blockedReason?: string
  categories: ComputerUseRiskCategory[]
  message?: string
  intent?: string
  confirmationId?: string
}

export type ComputerUseTarget = {
  id: string
  kind: ComputerUseTargetKind
  title: string
  appName?: string
  pid?: number
  windowId?: string
  backend: ComputerUseBackendKind
}

export type ComputerUseSession = {
  computerUseSessionId: string
  agentId: string
  threadId: string
  turnId?: string
  targetId?: string
  backend: ComputerUseBackendKind
  leaseState: ComputerUseLeaseState
  cursor?: { x: number; y: number }
  releaseReason?: ComputerUseReleaseReason
  releasedAt?: string
  createdAt: string
  updatedAt: string
}

export type ComputerUseLease = {
  leaseId: string
  computerUseSessionId: string
  agentId: string
  threadId: string
  turnId?: string
  targetId: string
  backend: ComputerUseBackendKind
  acquiredAt: string
  updatedAt: string
}

export type ComputerUseLeaseRejection = {
  code:
    | 'target_in_use'
    | 'backend_unavailable'
    | 'target_not_found'
    | 'invalid_request'
    | 'action_budget_exhausted'
    | 'confirmation_required'
    | 'policy_blocked'
    | 'aborted'
  message: string
  targetId?: string
  activeLease?: ComputerUseLease
  risk?: ComputerUseRiskAssessment
}

export type ComputerUseBindResult =
  | { ok: true; session: ComputerUseSession; target: ComputerUseTarget; lease: ComputerUseLease }
  | { ok: false; session: ComputerUseSession; target?: ComputerUseTarget; rejection: ComputerUseLeaseRejection }

export type ComputerUseImage = {
  mime_type: string
  data_base64: string
  width?: number
  height?: number
}

export type ComputerUseActionRequest = {
  action: Exclude<ComputerUseAction, 'list_targets' | 'bind_target' | 'release_target' | 'diagnostics'>
  computerUseSessionId: string
  targetId?: string
  x?: number
  y?: number
  startX?: number
  startY?: number
  button?: ComputerUseMouseButton
  clickCount?: 1 | 2
  modifiers?: string[]
  scrollDirection?: ComputerUseScrollDirection
  scrollAmount?: number
  text?: string
  durationMs?: number
  agentId?: string
  threadId?: string
  turnId?: string
  riskIntent?: string
  riskCategories?: ComputerUseRiskCategory[]
  confirmedRisk?: boolean
  confirmationId?: string
  signal?: AbortSignal
}

export type ComputerUseActionOutput = {
  kind: 'computer_action'
  action: ComputerUseAction
  ok: boolean
  screen?: { width: number; height: number }
  cursor?: [number, number]
  message?: string
  computerUseSessionId?: string
  targetId?: string
  risk?: ComputerUseRiskAssessment
}

export type ComputerUseScreenshotOutput = {
  kind: 'computer_screenshot'
  action: ComputerUseAction
  screen: { width: number; height: number }
  note: string
  images: ComputerUseImage[]
  computerUseSessionId?: string
  targetId?: string
}

export type ComputerUseActionResult =
  | { ok: true; output: ComputerUseActionOutput | ComputerUseScreenshotOutput }
  | { ok: false; output: ComputerUseActionOutput; rejection: ComputerUseLeaseRejection }

export type ComputerUseBackendDiagnostic = {
  backend: ComputerUseBackendKind
  available: boolean
  platform: NodeJS.Platform
  reason?: string
  activeLeases: ComputerUseLease[]
  recentRejections: ComputerUseLeaseRejection[]
  recentError?: string
}

export interface ComputerUseBackend {
  readonly kind: ComputerUseBackendKind
  listTargets(): Promise<ComputerUseTarget[]>
  bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult>
  releaseTarget(sessionId: string, reason?: string): Promise<ComputerUseSession | null>
  executeAction(session: ComputerUseSession, input: ComputerUseActionRequest): Promise<ComputerUseActionResult>
  diagnostics(): Promise<ComputerUseBackendDiagnostic>
}
