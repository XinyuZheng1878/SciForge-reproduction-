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
import { HostController, type HostControllerOptions } from './host-control.js'

export type GlobalNativeComputerUseBackendOptions = HostControllerOptions & {
  controller?: HostController
}

const DESKTOP_TARGET_ID = 'desktop:global'

export class GlobalNativeComputerUseBackend implements ComputerUseBackend {
  readonly kind: ComputerUseBackendKind = 'global-native'

  private readonly controller: HostController
  private actionQueue: Promise<void> = Promise.resolve()
  private recentError?: string

  constructor(options: GlobalNativeComputerUseBackendOptions = {}) {
    this.controller = options.controller ?? new HostController(options)
  }

  async listTargets(): Promise<ComputerUseTarget[]> {
    const ready = await this.controller.ensureReady()
    if (!ready.available) return []
    return [{
      id: DESKTOP_TARGET_ID,
      kind: 'desktop',
      title: 'Host desktop',
      backend: this.kind,
      inputIsolation: 'host-global',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true
    }]
  }

  async bindTarget(session: ComputerUseSession, targetId: string): Promise<ComputerUseBindResult> {
    const ready = await this.controller.ensureReady()
    if (!ready.available) {
      return {
        ok: false,
        session: { ...session, targetId, leaseState: 'rejected' },
        rejection: {
          code: 'backend_unavailable',
          targetId,
          message: ready.reason ?? 'computer-use backend is unavailable'
        }
      }
    }
    return {
      ok: true,
      session,
      target: {
        id: targetId,
        kind: 'desktop',
        title: 'Host desktop',
        backend: this.kind,
        inputIsolation: 'host-global',
        affectsUserInput: true,
        requiresHostFocus: true,
        usesHostClipboard: true
      },
      lease: {
        leaseId: `backend_${session.computerUseSessionId}`,
        computerUseSessionId: session.computerUseSessionId,
        agentId: session.agentId,
        threadId: session.threadId,
        ...(session.turnId ? { turnId: session.turnId } : {}),
        targetId,
        backend: this.kind,
        inputIsolation: 'host-global',
        affectsUserInput: true,
        requiresHostFocus: true,
        usesHostClipboard: true,
        acquiredAt: session.updatedAt,
        updatedAt: session.updatedAt
      }
    }
  }

  async releaseTarget(sessionId: string): Promise<ComputerUseSession | null> {
    void sessionId
    return null
  }

  async executeAction(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    const ready = await this.controller.ensureReady()
    if (!ready.available) {
      const message = ready.reason ?? 'computer-use backend is unavailable'
      return actionFailure(session, input, 'backend_unavailable', message)
    }

    try {
      return await this.withActionLock(() => this.executeActionNow(session, input))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recentError = message
      return actionFailure(session, input, 'invalid_request', message)
    }
  }

  async diagnostics(): Promise<ComputerUseBackendDiagnostic> {
    const ready = await this.controller.ensureReady()
    return {
      backend: this.kind,
      available: ready.available,
      platform: process.platform,
      inputIsolation: 'host-global',
      affectsUserInput: true,
      requiresHostFocus: true,
      usesHostClipboard: true,
      ...(ready.reason ? { reason: ready.reason } : {}),
      activeLeases: [],
      recentRejections: [],
      ...(this.recentError ? { recentError: this.recentError } : {})
    }
  }

  private async executeActionNow(
    session: ComputerUseSession,
    input: ComputerUseActionRequest
  ): Promise<ComputerUseActionResult> {
    switch (input.action) {
      case 'navigate':
        return actionFailure(session, input, 'invalid_request', 'global-native computer use does not support isolated navigation')

      case 'screenshot': {
        const shot = await this.controller.capture()
        return {
          ok: true,
          output: {
            kind: 'computer_screenshot',
            action: input.action,
            screen: { width: shot.width, height: shot.height },
            note:
              `Screenshot is ${shot.width}x${shot.height}px. ` +
              'Coordinates for the next action use this pixel space; top-left is 0,0.',
            images: [{
              mime_type: shot.mimeType,
              data_base64: shot.dataBase64,
              width: shot.width,
              height: shot.height
            }],
            computerUseSessionId: session.computerUseSessionId,
            targetId: session.targetId
          }
        }
      }

      case 'cursor_position': {
        const cursor = await this.controller.cursorPosition()
        const screen = await this.controller.screenSize()
        return actionSuccess(session, input, {
          cursor: [cursor.x, cursor.y],
          screen
        })
      }

      case 'mouse_move': {
        const point = requiredPoint(input, 'mouse_move')
        await this.controller.moveTo(point.x, point.y)
        return actionSuccess(session, input, { cursor: [point.x, point.y] })
      }

      case 'click': {
        await this.controller.click(
          input.x,
          input.y,
          input.button ?? 'left',
          input.clickCount ?? 1,
          input.modifiers ?? []
        )
        return actionSuccess(session, input)
      }

      case 'drag': {
        const start = requiredStartPoint(input, 'drag')
        const end = requiredPoint(input, 'drag')
        await this.controller.drag(start.x, start.y, end.x, end.y)
        return actionSuccess(session, input, { cursor: [end.x, end.y] })
      }

      case 'scroll': {
        await this.controller.scroll(
          input.x,
          input.y,
          requiredScrollDirection(input.scrollDirection),
          input.scrollAmount ?? 3
        )
        return actionSuccess(session, input)
      }

      case 'type': {
        await this.controller.typeText(input.text ?? '')
        return actionSuccess(session, input)
      }

      case 'key': {
        if (!input.text) throw new Error('key action requires text')
        await this.controller.pressHotkey(input.text)
        return actionSuccess(session, input)
      }

      case 'wait': {
        await this.controller.wait(input.durationMs ?? 1000, input.signal)
        return actionSuccess(session, input)
      }
    }
  }

  private async withActionLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.actionQueue
    let release!: () => void
    this.actionQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

export function createGlobalNativeComputerUseBackend(
  options: GlobalNativeComputerUseBackendOptions = {}
): GlobalNativeComputerUseBackend {
  return new GlobalNativeComputerUseBackend(options)
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
  return { x: Math.round(input.x), y: Math.round(input.y) }
}

function requiredStartPoint(input: ComputerUseActionRequest, action: string): { x: number; y: number } {
  if (typeof input.startX !== 'number' || typeof input.startY !== 'number') {
    throw new Error(`${action} requires startX and startY`)
  }
  return { x: Math.round(input.startX), y: Math.round(input.startY) }
}

function requiredScrollDirection(value: ComputerUseScrollDirection | undefined): ComputerUseScrollDirection {
  if (value === 'up' || value === 'down' || value === 'left' || value === 'right') return value
  return 'down'
}

export type { ComputerUseMouseButton, ComputerUseScrollDirection }
