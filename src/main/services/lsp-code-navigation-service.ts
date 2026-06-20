import { spawn, type ChildProcess } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type {
  AgentRuntimeCodeNavigationInput,
  AgentRuntimeCodeNavigationOperation,
  AgentRuntimeCodeNavigationOutput,
  AgentRuntimeFailure,
  AgentRuntimeResult
} from '../../shared/agent-runtime-contract'
import {
  canonicalPath,
  resolveOpenTargetPath
} from './workspace-paths'

type LspSession = {
  process: ChildProcess
  workspaceRoot: string
  refCount: number
  cleanupTimer: ReturnType<typeof setTimeout> | null
  stdoutBuffer: Buffer
  pending: Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>
  nextId: number
  initialized: boolean
  initPromise: Promise<void> | null
}

type LspCommand = {
  command: string
  args: string[]
}

const CLEANUP_DELAY_MS = 30_000
const REQUEST_TIMEOUT_MS = 30_000
const SERVER_PROBE_TIMEOUT_MS = 3_000
const POSITION_REQUIRED = new Set<AgentRuntimeCodeNavigationOperation>([
  'goToDefinition',
  'findReferences',
  'hover',
  'goToImplementation'
])
const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

export class LspCodeNavigationService {
  private readonly sessions = new Map<string, Promise<LspSession>>()

  async query(input: AgentRuntimeCodeNavigationInput): Promise<AgentRuntimeResult<AgentRuntimeCodeNavigationOutput>> {
    try {
      const workspaceRoot = await canonicalPath(input.workspaceRoot)
      const operation = input.operation
      const filePath = operation === 'workspaceSymbol'
        ? undefined
        : await resolveOpenTargetPath(requiredFilePath(input), workspaceRoot, { allowBasenameFallback: false })
      if (filePath && !isTsJsFile(filePath)) {
        return failure(
          'unsupported_language',
          'Code navigation currently supports TypeScript and JavaScript files only.',
          true,
          { filePath }
        )
      }
      if (POSITION_REQUIRED.has(operation) && (!positive(input.line) || !positive(input.character))) {
        return failure(
          'invalid_position',
          `${operation} requires 1-based line and character.`,
          true
        )
      }

      const session = await this.acquire(workspaceRoot)
      try {
        let result: unknown
        if (operation !== 'workspaceSymbol' && filePath) {
          await this.openDocument(session, filePath)
        }
        switch (operation) {
          case 'goToDefinition':
            result = await this.positionRequest(session, 'textDocument/definition', filePath!, input)
            break
          case 'findReferences':
            result = await this.positionRequest(session, 'textDocument/references', filePath!, input, {
              context: { includeDeclaration: true }
            })
            break
          case 'hover':
            result = await this.positionRequest(session, 'textDocument/hover', filePath!, input)
            break
          case 'documentSymbol':
            result = await this.request(session, 'textDocument/documentSymbol', {
              textDocument: { uri: pathToFileURL(filePath!).href }
            })
            break
          case 'workspaceSymbol':
            result = await this.request(session, 'workspace/symbol', {
              query: input.query?.trim() ?? ''
            })
            break
          case 'goToImplementation':
            result = await this.positionRequest(session, 'textDocument/implementation', filePath!, input)
            break
          default:
            return failure('unsupported_operation', `Unsupported LSP operation: ${String(operation)}`, true)
        }
        return {
          ok: true,
          value: {
            operation,
            workspaceRoot,
            ...(filePath ? { filePath } : {}),
            result: simplifyResult(result)
          }
        }
      } finally {
        if (filePath) this.closeDocument(session, filePath)
        this.release(workspaceRoot)
      }
    } catch (error) {
      return failureFromError(error)
    }
  }

  shutdown(): void {
    for (const promise of this.sessions.values()) {
      void promise.then(killSession).catch(() => undefined)
    }
    this.sessions.clear()
  }

  private async acquire(workspaceRoot: string): Promise<LspSession> {
    const existing = this.sessions.get(workspaceRoot)
    if (existing) {
      const session = await existing
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer)
        session.cleanupTimer = null
      }
      session.refCount += 1
      await this.initialize(session)
      return session
    }

    const pending = this.createSession(workspaceRoot)
    this.sessions.set(workspaceRoot, pending)
    try {
      return await pending
    } catch (error) {
      this.sessions.delete(workspaceRoot)
      throw error
    }
  }

  private release(workspaceRoot: string): void {
    const pending = this.sessions.get(workspaceRoot)
    if (!pending) return
    void pending.then((session) => {
      session.refCount = Math.max(0, session.refCount - 1)
      if (session.refCount > 0 || session.cleanupTimer) return
      session.cleanupTimer = setTimeout(() => {
        if (session.refCount === 0) {
          killSession(session)
          if (this.sessions.get(workspaceRoot) === pending) this.sessions.delete(workspaceRoot)
        }
      }, CLEANUP_DELAY_MS)
    }).catch(() => undefined)
  }

  private async createSession(workspaceRoot: string): Promise<LspSession> {
    const command = await resolveTsLsCommand(workspaceRoot)
    if (!command) {
      throw Object.assign(
        new Error('typescript-language-server is not installed. Install it with `npm install -g typescript-language-server typescript` or add it to this workspace.'),
        { code: 'language_server_missing' }
      )
    }
    const child = spawn(command.command, command.args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const session: LspSession = {
      process: child,
      workspaceRoot,
      refCount: 1,
      cleanupTimer: null,
      stdoutBuffer: Buffer.alloc(0),
      pending: new Map(),
      nextId: 1,
      initialized: false,
      initPromise: null
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      session.stdoutBuffer = Buffer.concat([session.stdoutBuffer, chunk])
      processBuffer(session)
    })
    child.on('error', (error) => {
      for (const entry of session.pending.values()) entry.reject(error)
      session.pending.clear()
    })
    child.on('exit', () => {
      for (const entry of session.pending.values()) entry.reject(new Error('LSP session exited'))
      session.pending.clear()
    })
    await this.initialize(session)
    return session
  }

  private async initialize(session: LspSession): Promise<void> {
    if (session.initialized) return
    if (session.initPromise) return session.initPromise
    session.initPromise = (async () => {
      await this.request(session, 'initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(session.workspaceRoot).href,
        workspaceFolders: null,
        capabilities: {
          textDocument: {
            synchronization: { didOpen: true, didChange: false, willSave: false },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: false },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: false },
            implementation: {}
          },
          workspace: { symbol: {} }
        }
      })
      sendNotification(session, 'initialized', {})
      session.initialized = true
    })()
    return session.initPromise
  }

  private async openDocument(session: LspSession, filePath: string): Promise<void> {
    const text = await readFile(filePath, 'utf8')
    sendNotification(session, 'textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(filePath).href,
        languageId: languageId(filePath),
        version: 1,
        text
      }
    })
  }

  private closeDocument(session: LspSession, filePath: string): void {
    sendNotification(session, 'textDocument/didClose', {
      textDocument: { uri: pathToFileURL(filePath).href }
    })
  }

  private positionRequest(
    session: LspSession,
    method: string,
    filePath: string,
    input: AgentRuntimeCodeNavigationInput,
    extra?: Record<string, unknown>
  ): Promise<unknown> {
    return this.request(session, method, {
      textDocument: { uri: pathToFileURL(filePath).href },
      position: {
        line: Math.max(0, (input.line ?? 1) - 1),
        character: Math.max(0, (input.character ?? 1) - 1)
      },
      ...extra
    })
  }

  private request(session: LspSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(session.nextId++)
      const timer = setTimeout(() => {
        session.pending.delete(id)
        reject(new Error(`LSP request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`))
      }, REQUEST_TIMEOUT_MS)
      session.pending.set(id, { resolve, reject, timer })
      sendMessage(session, { jsonrpc: '2.0', id, method, params })
    })
  }
}

async function resolveTsLsCommand(workspaceRoot: string): Promise<LspCommand | null> {
  const localPath = join(workspaceRoot, 'node_modules', '.bin', executableName('typescript-language-server'))
  try {
    await access(localPath)
    return { command: localPath, args: ['--stdio'] }
  } catch {
    // Continue to PATH probe.
  }

  const pathResult = await probePath('typescript-language-server')
  return pathResult ? { command: pathResult, args: ['--stdio'] } : null
}

function probePath(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where.exe' : 'which', [binary], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: SERVER_PROBE_TIMEOUT_MS,
      windowsHide: true
    })
    let stdout = ''
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      const found = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      resolve(code === 0 && found ? found : null)
    })
  })
}

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function requiredFilePath(input: AgentRuntimeCodeNavigationInput): string {
  const filePath = input.filePath?.trim()
  if (!filePath) throw Object.assign(new Error('filePath is required for this code navigation operation.'), { code: 'file_path_required' })
  return filePath
}

function positive(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
}

function isTsJsFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot).toLowerCase() : ''
  return TS_JS_EXTENSIONS.has(ext)
}

function languageId(filePath: string): string {
  if (filePath.endsWith('.tsx')) return 'typescriptreact'
  if (filePath.endsWith('.ts') || filePath.endsWith('.mts') || filePath.endsWith('.cts')) return 'typescript'
  if (filePath.endsWith('.jsx')) return 'javascriptreact'
  return 'javascript'
}

function sendMessage(session: LspSession, message: Record<string, unknown>): void {
  const body = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
  session.process.stdin?.write(`${header}${body}`)
}

function sendNotification(session: LspSession, method: string, params: Record<string, unknown>): void {
  sendMessage(session, { jsonrpc: '2.0', method, params })
}

function processBuffer(session: LspSession): void {
  while (session.stdoutBuffer.length > 0) {
    const headerEnd = session.stdoutBuffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = session.stdoutBuffer.subarray(0, headerEnd).toString('utf8')
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      session.stdoutBuffer = session.stdoutBuffer.subarray(headerEnd + 4)
      continue
    }
    const length = Number(match[1])
    const bodyStart = headerEnd + 4
    if (session.stdoutBuffer.length < bodyStart + length) return
    const body = session.stdoutBuffer.subarray(bodyStart, bodyStart + length).toString('utf8')
    session.stdoutBuffer = session.stdoutBuffer.subarray(bodyStart + length)
    try {
      const message = JSON.parse(body) as Record<string, unknown>
      handleResponse(session, message)
    } catch {
      // Ignore malformed language-server output.
    }
  }
}

function handleResponse(session: LspSession, message: Record<string, unknown>): void {
  if (message.id === undefined || (message.result === undefined && message.error === undefined)) return
  const id = String(message.id)
  const pending = session.pending.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  session.pending.delete(id)
  if (message.error) {
    pending.reject(new Error(errorMessage(message.error)))
  } else {
    pending.resolve(message.result)
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return 'LSP request failed.'
}

function killSession(session: LspSession): void {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  for (const pending of session.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error('LSP session closed'))
  }
  session.pending.clear()
  try {
    session.process.kill('SIGTERM')
  } catch {
    // Process already exited.
  }
  const timer = setTimeout(() => {
    try {
      session.process.kill('SIGKILL')
    } catch {
      // Process already exited.
    }
  }, 2_000)
  timer.unref?.()
}

function simplifyResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(simplifyResult)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (typeof record.uri === 'string') {
    return {
      path: uriToPath(record.uri),
      range: simplifyResult(record.range)
    }
  }
  if (record.contents) {
    return {
      contents: hoverText(record.contents),
      ...(record.range ? { range: simplifyResult(record.range) } : {})
    }
  }
  if (record.name && (record.kind !== undefined || record.location !== undefined)) {
    const location = record.location as Record<string, unknown> | undefined
    return {
      name: record.name,
      kind: symbolKindName(record.kind),
      ...(record.detail ? { detail: record.detail } : {}),
      ...(record.range ? { range: simplifyResult(record.range) } : {}),
      ...(record.selectionRange ? { selectionRange: simplifyResult(record.selectionRange) } : {}),
      ...(location?.uri ? { path: uriToPath(location.uri) } : {}),
      ...(record.containerName ? { containerName: record.containerName } : {})
    }
  }
  if ('start' in record && 'end' in record) {
    return {
      start: position(record.start),
      end: position(record.end)
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, simplifyResult(entry)]))
}

function position(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return {
    line: (typeof record.line === 'number' ? record.line : 0) + 1,
    character: (typeof record.character === 'number' ? record.character : 0) + 1
  }
}

function hoverText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(hoverText).join('\n\n')
  if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
    return String((value as { value: unknown }).value)
  }
  return String(value)
}

function uriToPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    return isAbsolute(value) ? value : fileURLToPath(value)
  } catch {
    return value
  }
}

function symbolKindName(value: unknown): string {
  const kinds: Record<number, string> = {
    1: 'File', 2: 'Module', 3: 'Namespace', 4: 'Package', 5: 'Class',
    6: 'Method', 7: 'Property', 8: 'Field', 9: 'Constructor', 10: 'Enum',
    11: 'Interface', 12: 'Function', 13: 'Variable', 14: 'Constant', 15: 'String',
    16: 'Number', 17: 'Boolean', 18: 'Array', 19: 'Object', 20: 'Key',
    21: 'Null', 22: 'EnumMember', 23: 'Struct', 24: 'Event', 25: 'Operator',
    26: 'TypeParameter'
  }
  const key = typeof value === 'number' ? value : Number(value)
  return kinds[key] ?? String(value)
}

function failureFromError(error: unknown): AgentRuntimeResult<AgentRuntimeCodeNavigationOutput> {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : 'code_navigation_error'
  return failure(code, error instanceof Error ? error.message : String(error), code !== 'invalid_workspace')
}

function failure(
  code: string,
  message: string,
  recoverable: boolean,
  details?: unknown
): { ok: false; failure: AgentRuntimeFailure } {
  return {
    ok: false,
    failure: {
      code,
      message,
      recoverable,
      severity: recoverable ? 'warning' : 'error',
      ...(details !== undefined ? { details } : {})
    }
  }
}
