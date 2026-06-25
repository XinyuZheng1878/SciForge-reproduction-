/**
 * Main-process PTY lifecycle for the built-in terminal.
 *
 * The main process owns the node-pty pseudo-terminal, streams chunks to the
 * renderer over `terminal:data`, and reports exits over `terminal:exit`.
 * node-pty is loaded lazily so a missing native build disables the terminal
 * gracefully instead of crashing app startup.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, IpcMain, WebContents } from 'electron'
import type { IPty } from 'node-pty'
import {
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_MAX_SESSIONS,
  TERMINAL_RING_BUFFER_BYTES
} from '../../shared/terminal'
import {
  terminalCreatePayloadSchema,
  terminalResizePayloadSchema,
  terminalSessionIdSchema,
  terminalWritePayloadSchema
} from '../ipc/app-ipc-schemas'

type TerminalSession = {
  pty: IPty
  sender: WebContents
  ringBuffer: string
  exited: boolean
}

let nodePty: typeof import('node-pty') | null | undefined

async function loadNodePty(): Promise<typeof import('node-pty') | null> {
  if (nodePty !== undefined) return nodePty
  try {
    nodePty = await import('node-pty')
  } catch (error) {
    console.warn('[terminal] node-pty failed to load; built-in terminal disabled:', error)
    nodePty = null
  }
  return nodePty
}

function resolveDefaultShell(): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    const pwsh7 = join(programFiles, 'PowerShell', '7', 'pwsh.exe')
    if (existsSync(pwsh7)) return { file: pwsh7, args: ['-NoLogo'] }
    const windowsPwsh = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (existsSync(windowsPwsh)) return { file: windowsPwsh, args: ['-NoLogo'] }
    return { file: process.env.COMSPEC ?? 'cmd.exe', args: [] }
  }
  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  return { file: process.env.SHELL || fallback, args: [] }
}

function isUtf8Locale(value: string | undefined): value is string {
  if (!value) return false
  return /utf-?8/i.test(value)
}

function resolveLocale(): string {
  if (isUtf8Locale(process.env.LC_ALL)) return process.env.LC_ALL
  if (isUtf8Locale(process.env.LC_CTYPE)) return process.env.LC_CTYPE
  if (isUtf8Locale(process.env.LANG)) return process.env.LANG
  if (process.platform === 'darwin') return 'en_US.UTF-8'
  if (process.platform === 'win32') return 'C.UTF-8'
  return 'en_US.UTF-8'
}

function buildShellEnv(): NodeJS.ProcessEnv {
  const locale = resolveLocale()
  return {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: locale,
    LC_ALL: locale
  }
}

function pushToRingBuffer(session: TerminalSession, chunk: string): void {
  session.ringBuffer += chunk
  if (session.ringBuffer.length > TERMINAL_RING_BUFFER_BYTES) {
    session.ringBuffer = session.ringBuffer.slice(-TERMINAL_RING_BUFFER_BYTES)
  }
}

function sendToSender(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return
  sender.send(channel, payload)
}

export type RegisterTerminalPtyIpcOptions = {
  ipcMain: IpcMain
  getMainWindow: () => BrowserWindow | null
  logError: (category: string, message: string, detail?: unknown) => void
}

export function registerTerminalPtyIpc(options: RegisterTerminalPtyIpcOptions): void {
  const { ipcMain, getMainWindow, logError } = options
  const sessions = new Map<string, TerminalSession>()

  const disposeSession = (sessionId: string, killedByClient: boolean): boolean => {
    const session = sessions.get(sessionId)
    if (!session) return false
    try {
      session.pty.kill()
    } catch (error) {
      logError('terminal', 'Failed to kill PTY process', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    sessions.delete(sessionId)
    if (!killedByClient && !session.sender.isDestroyed()) {
      sendToSender(session.sender, 'terminal:exit', { sessionId, exitCode: null })
    }
    return true
  }

  const disposeForSender = (sender: WebContents): void => {
    for (const [sessionId, session] of sessions) {
      if (session.sender === sender) disposeSession(sessionId, true)
    }
  }

  const attachSenderCleanup = (sender: WebContents): void => {
    if (sender.isDestroyed()) {
      disposeForSender(sender)
      return
    }
    sender.once('destroyed', () => disposeForSender(sender))
  }

  ipcMain.handle('terminal:create', async (event, args: unknown) => {
    const request = terminalCreatePayloadSchema.parse(args)
    const existing = sessions.get(request.sessionId)
    if (existing && !existing.exited) {
      if (existing.ringBuffer) {
        sendToSender(event.sender, 'terminal:data', {
          sessionId: request.sessionId,
          data: existing.ringBuffer
        })
      }
      existing.sender = event.sender
      attachSenderCleanup(event.sender)
      return { ok: true as const, sessionId: request.sessionId, replayed: true }
    }
    if (existing && existing.exited) {
      disposeSession(request.sessionId, true)
    }

    if (sessions.size >= TERMINAL_MAX_SESSIONS) {
      return {
        ok: false as const,
        message: `Too many terminal sessions (limit ${TERMINAL_MAX_SESSIONS}).`
      }
    }

    const ptyModule = await loadNodePty()
    if (!ptyModule) {
      return {
        ok: false as const,
        message: 'The terminal backend (node-pty) is not available on this system.'
      }
    }

    const { file, args: shellArgs } = resolveDefaultShell()
    const cols = request.cols ?? TERMINAL_DEFAULT_COLS
    const rows = request.rows ?? TERMINAL_DEFAULT_ROWS
    const cwd = request.cwd && request.cwd.trim() ? request.cwd.trim() : homedir()

    try {
      const pty = ptyModule.spawn(file, shellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: buildShellEnv(),
        useConpty: true
      })

      const session: TerminalSession = {
        pty,
        sender: event.sender,
        ringBuffer: '',
        exited: false
      }
      sessions.set(request.sessionId, session)
      attachSenderCleanup(event.sender)

      pty.onData((data) => {
        if (session.exited) return
        pushToRingBuffer(session, data)
        sendToSender(session.sender, 'terminal:data', { sessionId: request.sessionId, data })
      })

      pty.onExit(({ exitCode }) => {
        session.exited = true
        sendToSender(session.sender, 'terminal:exit', { sessionId: request.sessionId, exitCode })
      })

      return { ok: true as const, sessionId: request.sessionId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('terminal', 'Failed to spawn PTY', { sessionId: request.sessionId, message })
      return { ok: false as const, message }
    }
  })

  ipcMain.handle('terminal:write', async (_event, args: unknown) => {
    const request = terminalWritePayloadSchema.parse(args)
    const session = sessions.get(request.sessionId)
    if (!session || session.exited) return false
    try {
      session.pty.write(request.data)
      return true
    } catch (error) {
      logError('terminal', 'Failed to write to PTY', {
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  })

  ipcMain.handle('terminal:resize', async (_event, args: unknown) => {
    const request = terminalResizePayloadSchema.parse(args)
    const session = sessions.get(request.sessionId)
    if (!session || session.exited) return false
    try {
      session.pty.resize(request.cols, request.rows)
      return true
    } catch (error) {
      logError('terminal', 'Failed to resize PTY', {
        sessionId: request.sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  })

  ipcMain.handle('terminal:dispose', async (_event, sessionId: unknown) => {
    const normalized = terminalSessionIdSchema.parse(sessionId)
    return disposeSession(normalized, true)
  })

  void import('electron').then(({ app }) => {
    app.on('before-quit', () => {
      for (const sessionId of Array.from(sessions.keys())) {
        disposeSession(sessionId, true)
      }
    })
  })

  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    attachSenderCleanup(mainWindow.webContents)
  }
}
