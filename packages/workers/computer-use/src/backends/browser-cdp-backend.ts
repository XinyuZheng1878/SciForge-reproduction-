import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

import type {
  ComputerUseActionOutput,
  ComputerUseActionRequest,
  ComputerUseActionResult,
  ComputerUseBackend,
  ComputerUseBackendDiagnostic,
  ComputerUseBackendKind,
  ComputerUseBindResult,
  ComputerUseMouseButton,
  ComputerUseScrollDirection,
  ComputerUseSession,
  ComputerUseTarget
} from '../contract.js'

type BrowserSession = {
  session: ComputerUseSession
  process: ChildProcess
  userDataDir: string
  port: number
  client: CdpClient
  cursor: { x: number; y: number }
}

type BrowserCdpOptions = {
  executablePath?: string
  headless?: boolean
  viewport?: { width: number; height: number }
  env?: Record<string, string | undefined>
}

type WebSocketLike = {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown; error?: unknown }) => void,
    options?: { once?: boolean }
  ): void
}

type WebSocketCtor = new (url: string) => WebSocketLike

const KIND: ComputerUseBackendKind = 'browser-cdp'
const TARGET_ID = 'browser-cdp:isolated-browser'
const DEFAULT_VIEWPORT = { width: 1280, height: 831 }
const BROWSER_PATH_ENV = 'SCIFORGE_COMPUTER_USE_BROWSER_PATH'
const BROWSER_NAVIGATION_PROTOCOLS = new Set(['http:', 'https:'])

export class BrowserCdpComputerUseBackend implements ComputerUseBackend {
  readonly kind = KIND

  private readonly executablePath?: string
  private readonly headless: boolean
  private readonly viewport: { width: number; height: number }
  private readonly env: Record<string, string | undefined>
  private readonly sessions = new Map<string, BrowserSession>()
  private recentError?: string

  constructor(options: BrowserCdpOptions = {}) {
    this.executablePath = options.executablePath
    this.headless = options.headless ?? true
    this.viewport = options.viewport ?? DEFAULT_VIEWPORT
    this.env = options.env ?? process.env
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    const executable = this.resolveExecutablePath()
    if (!executable) return []
    return [{
      id: TARGET_ID,
      kind: 'window',
      title: 'Isolated browser',
      appName: 'Browser CDP',
      backend: this.kind,
      inputIsolation: 'agent-isolated',
      affectsUserInput: false,
      requiresHostFocus: false,
      usesHostClipboard: false
    }]
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    if (targetId !== TARGET_ID) {
      return {
        ok: false,
        session: { ...session, targetId, backend: this.kind, leaseState: 'rejected' },
        rejection: {
          code: 'target_not_found',
          targetId,
          message: `browser-cdp target "${targetId}" was not found`
        }
      }
    }
    const executable = this.resolveExecutablePath()
    if (!executable) {
      const message = 'No isolated browser executable was found. Set SCIFORGE_COMPUTER_USE_BROWSER_PATH to Chrome, Chromium, or Edge.'
      return {
        ok: false,
        session: { ...session, targetId, backend: this.kind, leaseState: 'rejected' },
        rejection: { code: 'backend_unavailable', targetId, message }
      }
    }

    try {
      const bound = {
        ...session,
        targetId,
        backend: this.kind,
        leaseState: 'active' as const,
        cursor: session.cursor ?? { x: 0, y: 0 }
      }
      const browser = await this.launchBrowser(executable, bound)
      this.sessions.set(session.computerUseSessionId, browser)
      return {
        ok: true,
        session: bound,
        target: {
          id: targetId,
          kind: 'window',
          title: 'Isolated browser',
          appName: 'Browser CDP',
          backend: this.kind,
          inputIsolation: 'agent-isolated',
          affectsUserInput: false,
          requiresHostFocus: false,
          usesHostClipboard: false
        },
        lease: {
          leaseId: `browser_${session.computerUseSessionId}`,
          computerUseSessionId: session.computerUseSessionId,
          agentId: session.agentId,
          threadId: session.threadId,
          ...(session.turnId ? { turnId: session.turnId } : {}),
          targetId,
          backend: this.kind,
          inputIsolation: 'agent-isolated',
          affectsUserInput: false,
          requiresHostFocus: false,
          usesHostClipboard: false,
          acquiredAt: session.updatedAt,
          updatedAt: session.updatedAt
        }
      }
    } catch (error) {
      const message = errorMessage(error)
      this.recentError = message
      return {
        ok: false,
        session: { ...session, targetId, backend: this.kind, leaseState: 'rejected' },
        rejection: { code: 'backend_unavailable', targetId, message }
      }
    }
  }

  async releaseTarget(sessionId: string, reason = 'agent_release'): Promise<ComputerUseSession | null> {
    const browser = this.sessions.get(sessionId)
    if (!browser) return null
    this.sessions.delete(sessionId)
    await browser.client.close().catch(() => undefined)
    browser.process.kill('SIGTERM')
    await rm(browser.userDataDir, { recursive: true, force: true }).catch(() => undefined)
    return {
      ...browser.session,
      leaseState: 'released',
      releaseReason: reason,
      releasedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    const browser = this.sessions.get(session.computerUseSessionId)
    if (!browser) {
      return actionFailure(session, input, 'invalid_request', `browser-cdp session ${session.computerUseSessionId} is not active`)
    }
    try {
      return await this.executeBrowserAction(browser, session, input)
    } catch (error) {
      const message = errorMessage(error)
      this.recentError = message
      return actionFailure(session, input, 'invalid_request', message)
    }
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    const executable = this.resolveExecutablePath()
    return {
      backend: this.kind,
      available: Boolean(executable),
      platform: process.platform,
      inputIsolation: 'agent-isolated',
      affectsUserInput: false,
      requiresHostFocus: false,
      usesHostClipboard: false,
      ...(executable ? {} : { reason: 'No isolated browser executable was found.' }),
      activeLeases: [...this.sessions.values()].map((browser) => ({
        leaseId: `browser_${browser.session.computerUseSessionId}`,
        computerUseSessionId: browser.session.computerUseSessionId,
        agentId: browser.session.agentId,
        threadId: browser.session.threadId,
        ...(browser.session.turnId ? { turnId: browser.session.turnId } : {}),
        targetId: browser.session.targetId ?? TARGET_ID,
        backend: this.kind,
        inputIsolation: 'agent-isolated',
        affectsUserInput: false,
        requiresHostFocus: false,
        usesHostClipboard: false,
        acquiredAt: browser.session.createdAt,
        updatedAt: browser.session.updatedAt
      })),
      recentRejections: [],
      ...(this.recentError ? { recentError: this.recentError } : {})
    }
  }

  private async executeBrowserAction(
    browser: BrowserSession,
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    const client = browser.client
    switch (input.action) {
      case 'navigate': {
        const url = normalizeBrowserNavigationUrl(input.url ?? input.text)
        if (!url) throw new Error('navigate action requires url')
        await client.send('Page.navigate', { url })
        await waitForLoad(client, input.signal)
        return actionSuccess(session, input, { message: `browser navigated to ${url}` })
      }
      case 'screenshot': {
        const shot = await client.send<{ data: string }>('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        })
        return {
          ok: true,
          output: {
            kind: 'computer_screenshot',
            action: 'screenshot',
            screen: this.viewport,
            note:
              `Screenshot is ${this.viewport.width}x${this.viewport.height}px from an isolated browser session. ` +
              'Coordinates for the next action use this pixel space; top-left is 0,0.',
            images: [{
              mime_type: 'image/png',
              data_base64: shot.data,
              width: this.viewport.width,
              height: this.viewport.height
            }],
            computerUseSessionId: session.computerUseSessionId,
            targetId: session.targetId
          }
        }
      }
      case 'cursor_position':
        return actionSuccess(session, input, {
          cursor: [browser.cursor.x, browser.cursor.y],
          screen: this.viewport
        })
      case 'mouse_move': {
        const point = requiredPoint(input, 'mouse_move')
        browser.cursor = point
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        return actionSuccess(session, input, { cursor: [point.x, point.y], screen: this.viewport })
      }
      case 'click': {
        const point = typeof input.x === 'number' && typeof input.y === 'number'
          ? { x: input.x, y: input.y }
          : browser.cursor
        browser.cursor = point
        const button = cdpMouseButton(input.button)
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
        await client.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: point.x,
          y: point.y,
          button,
          clickCount: input.clickCount ?? 1
        })
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: point.x,
          y: point.y,
          button,
          clickCount: input.clickCount ?? 1
        })
        return actionSuccess(session, input, { cursor: [point.x, point.y], screen: this.viewport })
      }
      case 'drag': {
        const start = requiredStartPoint(input, 'drag')
        const end = requiredPoint(input, 'drag')
        browser.cursor = end
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y })
        await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 })
        await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: end.x, y: end.y, button: 'left' })
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 })
        return actionSuccess(session, input, { cursor: [end.x, end.y], screen: this.viewport })
      }
      case 'scroll': {
        const point = typeof input.x === 'number' && typeof input.y === 'number'
          ? { x: input.x, y: input.y }
          : browser.cursor
        const delta = scrollDelta(requiredScrollDirection(input.scrollDirection), input.scrollAmount ?? 3)
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: point.x,
          y: point.y,
          deltaX: delta.x,
          deltaY: delta.y
        })
        return actionSuccess(session, input, { cursor: [point.x, point.y], screen: this.viewport })
      }
      case 'type':
        await client.send('Input.insertText', { text: input.text ?? '' })
        return actionSuccess(session, input, { cursor: [browser.cursor.x, browser.cursor.y], screen: this.viewport })
      case 'key': {
        const key = normalizeKey(input.key ?? input.text ?? '')
        if (!key) throw new Error('key action requires key')
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: virtualKeyCode(key) })
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: virtualKeyCode(key) })
        return actionSuccess(session, input, { cursor: [browser.cursor.x, browser.cursor.y], screen: this.viewport })
      }
      case 'wait':
        await wait(input.durationMs ?? 1000, input.signal)
        return actionSuccess(session, input, { cursor: [browser.cursor.x, browser.cursor.y], screen: this.viewport })
    }
  }

  private async launchBrowser(executable: string, session: ComputerUseSession): Promise<BrowserSession> {
    const port = await getFreePort()
    const userDataDir = await mkdtemp(join(tmpdir(), 'sciforge-computer-use-browser-'))
    await mkdir(userDataDir, { recursive: true })
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      `--window-size=${this.viewport.width},${this.viewport.height}`,
      ...(this.headless ? ['--headless=new'] : []),
      'about:blank'
    ]
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...this.env }
    })
    child.stderr.on('data', (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
      if (/error|failed/i.test(text)) this.recentError = text.trim().slice(0, 500)
    })
    child.once('exit', () => {
      void rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
    })
    const target = await waitForPageTarget(port)
    const client = await CdpClient.connect(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    })
    return {
      session,
      process: child,
      userDataDir,
      port,
      client,
      cursor: { x: 0, y: 0 }
    }
  }

  private resolveExecutablePath(): string | undefined {
    return this.executablePath || this.env[BROWSER_PATH_ENV] || defaultBrowserExecutable()
  }
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  private constructor(private readonly socket: WebSocketLike) {
    socket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : Buffer.isBuffer(event.data) ? event.data.toString('utf8') : ''
      if (!raw) return
      const message = JSON.parse(raw) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof message.id !== 'number') return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message ?? 'CDP request failed'))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'))
      this.pending.clear()
    })
  }

  static async connect(url: string): Promise<CdpClient> {
    const WebSocketImpl = (globalThis as unknown as { WebSocket?: WebSocketCtor }).WebSocket
    if (!WebSocketImpl) throw new Error('global WebSocket is not available in this runtime')
    const socket = new WebSocketImpl(url)
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('failed to connect to browser CDP websocket')), { once: true })
    })
    return new CdpClient(socket)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    const payload = JSON.stringify({ id, method, params })
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      })
      this.socket.send(payload)
    })
  }

  async close(): Promise<void> {
    this.socket.close()
  }
}

export function createBrowserCdpComputerUseBackend(options: BrowserCdpOptions = {}): BrowserCdpComputerUseBackend {
  return new BrowserCdpComputerUseBackend(options)
}

function actionSuccess(
  session: ComputerUseSession,
  input: ComputerUseActionRequest,
  patch: Partial<ComputerUseActionOutput> = {}
): ComputerUseActionResult {
  return {
    ok: true,
    output: {
      kind: 'computer_action',
      action: input.action,
      ok: true,
      computerUseSessionId: session.computerUseSessionId,
      targetId: session.targetId,
      ...patch
    }
  }
}

function actionFailure(
  session: ComputerUseSession,
  input: ComputerUseActionRequest,
  code: 'backend_unavailable' | 'invalid_request',
  message: string
): ComputerUseActionResult {
  return {
    ok: false,
    output: {
      kind: 'computer_action',
      action: input.action,
      ok: false,
      message,
      computerUseSessionId: session.computerUseSessionId,
      targetId: session.targetId ?? input.targetId
    },
    rejection: {
      code,
      targetId: session.targetId ?? input.targetId,
      message
    }
  }
}

function requiredPoint(input: ComputerUseActionRequest, action: string): { x: number; y: number } {
  if (typeof input.x !== 'number' || typeof input.y !== 'number') {
    throw new Error(`${action} requires x and y`)
  }
  return { x: input.x, y: input.y }
}

function requiredStartPoint(input: ComputerUseActionRequest, action: string): { x: number; y: number } {
  if (typeof input.startX !== 'number' || typeof input.startY !== 'number') {
    throw new Error(`${action} requires startX and startY`)
  }
  return { x: input.startX, y: input.startY }
}

function requiredScrollDirection(value: ComputerUseScrollDirection | undefined): ComputerUseScrollDirection {
  if (value === 'up' || value === 'down' || value === 'left' || value === 'right') return value
  return 'down'
}

function scrollDelta(direction: ComputerUseScrollDirection, amount: number): { x: number; y: number } {
  const pixels = Math.max(1, Math.round(amount)) * 120
  switch (direction) {
    case 'up':
      return { x: 0, y: -pixels }
    case 'down':
      return { x: 0, y: pixels }
    case 'left':
      return { x: -pixels, y: 0 }
    case 'right':
      return { x: pixels, y: 0 }
  }
}

function cdpMouseButton(button: ComputerUseMouseButton | undefined): string {
  if (button === 'right') return 'right'
  if (button === 'middle') return 'middle'
  return 'left'
}

function normalizeKey(value: string): string {
  const key = value.trim()
  const lower = key.toLowerCase()
  if (lower === 'return') return 'Enter'
  if (lower === 'esc') return 'Escape'
  if (lower === 'space') return ' '
  return key
}

function virtualKeyCode(key: string): number | undefined {
  if (key === 'Enter') return 13
  if (key === 'Escape') return 27
  if (key === 'Backspace') return 8
  if (key === 'Tab') return 9
  if (key === ' ') return 32
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : undefined
}

export function normalizeBrowserNavigationUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('navigate action requires a valid http or https url')
  }
  if (!BROWSER_NAVIGATION_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`navigate action blocked unsupported url scheme: ${parsed.protocol}`)
  }
  return parsed.toString()
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  const clamped = Math.max(0, Math.min(ms, 60_000))
  if (clamped === 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      resolve()
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, clamped)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function waitForLoad(client: CdpClient, signal?: AbortSignal): Promise<void> {
  await wait(1_000, signal)
  await client.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }).catch(() => undefined)
}

async function getFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!port) throw new Error('failed to allocate browser CDP port')
  return port
}

async function waitForPageTarget(port: number): Promise<{ webSocketDebuggerUrl: string }> {
  const deadline = Date.now() + 10_000
  let lastError = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json() as Array<{ type?: string; webSocketDebuggerUrl?: string }>
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page?.webSocketDebuggerUrl) return { webSocketDebuggerUrl: page.webSocketDebuggerUrl }
    } catch (error) {
      lastError = errorMessage(error)
    }
    await wait(100)
  }
  throw new Error(`browser CDP page target did not become available${lastError ? `: ${lastError}` : ''}`)
}

function defaultBrowserExecutable(): string | undefined {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      ]
    : process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge'
        ]
  return candidates.find((candidate) => {
    try {
      return Boolean(candidate && requireExists(candidate))
    } catch {
      return false
    }
  })
}

function requireExists(path: string): boolean {
  return existsSync(path)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
