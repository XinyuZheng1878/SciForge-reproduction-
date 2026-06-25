/**
 * Shared types and constants for the built-in terminal.
 *
 * The Electron main process owns the real pseudo-terminal via node-pty.
 * Renderers create/re-attach sessions over IPC, stream output into xterm.js,
 * and send user input back as raw terminal data.
 */

export const TERMINAL_MAX_SESSIONS = 8
export const TERMINAL_MAX_DATA_WRITE_BYTES = 1_000_000
export const TERMINAL_RING_BUFFER_BYTES = 64 * 1024
export const TERMINAL_MAX_SESSION_ID_LENGTH = 256
export const TERMINAL_MAX_CWD_LENGTH = 4_096
export const TERMINAL_DEFAULT_COLS = 80
export const TERMINAL_DEFAULT_ROWS = 24
export const TERMINAL_MAX_COLS = 500
export const TERMINAL_MAX_ROWS = 200

export type TerminalCreatePayload = {
  sessionId: string
  cwd?: string
  cols?: number
  rows?: number
}

export type TerminalWritePayload = {
  sessionId: string
  data: string
}

export type TerminalResizePayload = {
  sessionId: string
  cols: number
  rows: number
}

export type TerminalDataPayload = {
  sessionId: string
  data: string
}

export type TerminalExitPayload = {
  sessionId: string
  exitCode: number | null
}

export type TerminalCreateResult =
  | { ok: true; sessionId: string; replayed?: boolean }
  | { ok: false; message: string }
