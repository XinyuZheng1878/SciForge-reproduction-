import type { IpcMain, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerTerminalPtyIpc } from './terminal-pty-ipc'

type TerminalCreateOk = {
  ok: true
  sessionId: string
  ownerToken: string
  replayed?: boolean
}

type SentMessage = {
  channel: string
  payload: unknown
}

type MockSender = {
  webContents: WebContents
  sent: SentMessage[]
  destroy: () => void
}

const electronMock = vi.hoisted(() => ({
  appOn: vi.fn()
}))

const ptyMock = vi.hoisted(() => {
  const spawned: Array<{
    pty: {
      write: ReturnType<typeof vi.fn>
      resize: ReturnType<typeof vi.fn>
      kill: ReturnType<typeof vi.fn>
      onData: ReturnType<typeof vi.fn>
      onExit: ReturnType<typeof vi.fn>
    }
    dataHandlers: Array<(data: string) => void>
    exitHandlers: Array<(event: { exitCode: number }) => void>
  }> = []

  const spawn = vi.fn(() => {
    const dataHandlers: Array<(data: string) => void> = []
    const exitHandlers: Array<(event: { exitCode: number }) => void> = []
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn((handler: (data: string) => void) => {
        dataHandlers.push(handler)
        return { dispose: vi.fn() }
      }),
      onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
        exitHandlers.push(handler)
        return { dispose: vi.fn() }
      })
    }
    spawned.push({ pty, dataHandlers, exitHandlers })
    return pty
  })

  return { spawn, spawned }
})

vi.mock('electron', () => ({
  app: {
    on: electronMock.appOn
  }
}))

vi.mock('node-pty', () => ({
  spawn: ptyMock.spawn
}))

function createSender(): MockSender {
  const sent: SentMessage[] = []
  const destroyedHandlers: Array<() => void> = []
  let destroyed = false
  let webContents: WebContents
  webContents = {
    isDestroyed: () => destroyed,
    send: (channel: string, payload: unknown) => {
      sent.push({ channel, payload })
    },
    once: (event: string, handler: () => void) => {
      if (event === 'destroyed') destroyedHandlers.push(handler)
      return webContents
    }
  } as unknown as WebContents

  return {
    webContents,
    sent,
    destroy: () => {
      destroyed = true
      for (const handler of destroyedHandlers) handler()
    }
  }
}

function createHarness(): {
  invoke: (channel: string, sender: MockSender, payload?: unknown) => Promise<unknown>
} {
  const bridge = registerTerminalPtyIpc({
    ipcMain: { handle: vi.fn() } as unknown as IpcMain,
    getMainWindow: () => null,
    logError: vi.fn()
  })

  return {
    invoke: async (channel, sender, payload) => {
      if (channel === 'terminal:create') return bridge.create(sender.webContents, payload)
      if (channel === 'terminal:write') return bridge.write(sender.webContents, payload)
      if (channel === 'terminal:resize') return bridge.resize(sender.webContents, payload)
      if (channel === 'terminal:dispose') return bridge.dispose(sender.webContents, payload)
      throw new Error(`Missing bridge method: ${channel}`)
    }
  }
}

function expectCreateOk(result: unknown): TerminalCreateOk {
  expect(result).toMatchObject({ ok: true })
  const ok = result as TerminalCreateOk
  expect(ok.ownerToken).toMatch(/^[A-Za-z0-9_-]+$/)
  return ok
}

describe('registerTerminalPtyIpc ownership', () => {
  beforeEach(() => {
    electronMock.appOn.mockClear()
    ptyMock.spawn.mockClear()
    ptyMock.spawned.length = 0
  })

  it('blocks a second sender from rebinding or controlling a predictable session id', async () => {
    const harness = createHarness()
    const owner = createSender()
    const attacker = createSender()
    const sessionId = 'terminal:predictable:main'

    const created = expectCreateOk(await harness.invoke('terminal:create', owner, {
      sessionId,
      cwd: '/tmp/project'
    }))
    expect(created.sessionId).toBe(sessionId)
    expect(ptyMock.spawn).toHaveBeenCalledTimes(1)

    await expect(harness.invoke('terminal:create', attacker, { sessionId })).resolves.toEqual({
      ok: false,
      message: 'Terminal session is already owned by another renderer.'
    })
    expect(ptyMock.spawn).toHaveBeenCalledTimes(1)
    expect(attacker.sent).toEqual([])

    const pty = ptyMock.spawned[0]?.pty
    expect(pty).toBeDefined()

    await expect(harness.invoke('terminal:write', attacker, {
      sessionId,
      data: 'whoami\n'
    })).resolves.toBe(false)
    expect(pty.write).not.toHaveBeenCalled()

    await expect(harness.invoke('terminal:resize', attacker, {
      sessionId,
      cols: 120,
      rows: 40
    })).resolves.toBe(false)
    expect(pty.resize).not.toHaveBeenCalled()

    await expect(harness.invoke('terminal:dispose', attacker, sessionId)).resolves.toBe(false)
    expect(pty.kill).not.toHaveBeenCalled()

    await expect(harness.invoke('terminal:write', owner, {
      sessionId,
      data: 'pwd\n'
    })).resolves.toBe(true)
    expect(pty.write).toHaveBeenCalledWith('pwd\n')

    await expect(harness.invoke('terminal:dispose', owner, sessionId)).resolves.toBe(true)
    expect(pty.kill).toHaveBeenCalledTimes(1)
  })

  it('allows token-authenticated reconnect while moving ownership to the new sender', async () => {
    const harness = createHarness()
    const owner = createSender()
    const reconnecting = createSender()
    const sessionId = 'terminal:predictable:main'

    const created = expectCreateOk(await harness.invoke('terminal:create', owner, { sessionId }))
    const ptyRecord = ptyMock.spawned[0]
    expect(ptyRecord).toBeDefined()

    ptyRecord.dataHandlers[0]?.('first chunk')
    expect(owner.sent).toEqual([
      {
        channel: 'terminal:data',
        payload: { sessionId, data: 'first chunk' }
      }
    ])

    const reconnected = expectCreateOk(await harness.invoke('terminal:create', reconnecting, {
      sessionId,
      ownerToken: created.ownerToken
    }))
    expect(reconnected).toMatchObject({
      sessionId,
      ownerToken: created.ownerToken,
      replayed: true
    })
    expect(reconnecting.sent).toEqual([
      {
        channel: 'terminal:data',
        payload: { sessionId, data: 'first chunk' }
      }
    ])

    ptyRecord.dataHandlers[0]?.('second chunk')
    expect(owner.sent).toHaveLength(1)
    expect(reconnecting.sent.at(-1)).toEqual({
      channel: 'terminal:data',
      payload: { sessionId, data: 'second chunk' }
    })

    await expect(harness.invoke('terminal:write', owner, {
      sessionId,
      data: 'stale\n'
    })).resolves.toBe(false)
    await expect(harness.invoke('terminal:write', reconnecting, {
      sessionId,
      data: 'current\n'
    })).resolves.toBe(true)
    expect(ptyRecord.pty.write).toHaveBeenCalledTimes(1)
    expect(ptyRecord.pty.write).toHaveBeenCalledWith('current\n')
  })
})
