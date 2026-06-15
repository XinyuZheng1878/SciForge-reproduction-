import type { Readable, Writable } from 'node:stream'

export type CodexAppServerRequestId = number | string

export type CodexAppServerApprovalPolicy =
  | 'never'
  | 'on-request'
  | 'on-failure'
  | 'untrusted'

export type CodexAppServerThreadSandboxPolicy =
  | 'read-only'
  | 'workspace-write'
  | 'danger-full-access'

export type CodexAppServerTurnSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess?: boolean }
  | {
    type: 'workspaceWrite'
    writableRoots?: string[]
    networkAccess?: boolean
    excludeTmpdirEnvVar?: boolean
    excludeSlashTmp?: boolean
  }

export type CodexAppServerInputItem = {
  type: string
  [key: string]: unknown
}

export type CodexAppServerClientInfo = {
  name: string
  title?: string | null
  version: string
}

export type SpawnCodexAppServerProcess = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ['pipe', 'pipe', 'pipe'] },
) => CodexAppServerProcess

export interface CodexAppServerProcess {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  killed: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export type CodexAppServerJsonRpcRequest = {
  id: CodexAppServerRequestId
  method: string
  params?: unknown
}

export type CodexAppServerJsonRpcNotification = {
  method: string
  params?: unknown
}

export type CodexAppServerJsonRpcResponse = {
  id: CodexAppServerRequestId
  result?: unknown
  error?: {
    code?: number
    message?: string
    data?: unknown
  }
}

export type CodexAppServerServerRequestHandler = (
  request: CodexAppServerJsonRpcRequest,
) => unknown | Promise<unknown>

export type CodexAppServerInitializeParams = {
  clientInfo?: CodexAppServerClientInfo
  capabilities?: Record<string, unknown>
  [key: string]: unknown
}

export type CodexAppServerThreadStartParams = {
  cwd: string
  model?: string
  modelProvider?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandbox?: CodexAppServerThreadSandboxPolicy
  ephemeral?: boolean
  serviceName?: string
  developerInstructions?: string
  [key: string]: unknown
}

export type CodexAppServerThreadResumeParams = {
  threadId: string
  cwd?: string
  model?: string
  modelProvider?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandbox?: CodexAppServerThreadSandboxPolicy
  [key: string]: unknown
}

export type CodexAppServerThreadListParams = {
  limit?: number
  cursor?: string
  [key: string]: unknown
}

export type CodexAppServerThreadReadParams = {
  threadId: string
  [key: string]: unknown
}

export type CodexAppServerThreadRenameParams = {
  threadId: string
  title: string
  [key: string]: unknown
}

export type CodexAppServerThreadDeleteParams = {
  threadId: string
  [key: string]: unknown
}

export type CodexAppServerTurnStartParams = {
  threadId: string
  input?: CodexAppServerInputItem[]
  cwd?: string
  model?: string
  modelProvider?: string
  approvalPolicy?: CodexAppServerApprovalPolicy
  sandboxPolicy?: CodexAppServerTurnSandboxPolicy
  [key: string]: unknown
}

export type CodexAppServerTurnInterruptParams = {
  threadId: string
  turnId: string
  [key: string]: unknown
}

export type CodexAppServerTurnSteerParams = {
  threadId: string
  expectedTurnId: string
  input: CodexAppServerInputItem[]
  [key: string]: unknown
}
