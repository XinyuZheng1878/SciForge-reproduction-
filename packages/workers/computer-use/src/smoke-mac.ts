import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { createCompositeComputerUseBackend } from './backends/composite-backend.js'
import { ComputerUseActionBudget } from './budget.js'
import { ComputerUseService } from './service.js'
import type {
  ComputerUseListTargetsResult,
  ComputerUseServiceDiagnostic
} from './service.js'
import type {
  ComputerUseActionResult,
  ComputerUseBindResult
} from './contract.js'

const execFileAsync = promisify(execFile)

type StepResult = {
  ok: boolean
  summary: Record<string, unknown>
}

type SmokeResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  steps: Record<string, StepResult>
}

const REAL_MAC_ENV = 'SCIFORGE_COMPUTER_USE_REAL_MAC'

if (process.env[REAL_MAC_ENV] !== '1') {
  write({
    ok: true,
    skipped: true,
    reason: `set ${REAL_MAC_ENV}=1 to run the real macOS desktop smoke`,
    steps: {}
  })
} else if (process.platform !== 'darwin') {
  write({
    ok: false,
    reason: 'real macOS computer-use smoke can only run on darwin',
    steps: {}
  })
  process.exitCode = 1
} else {
  const result = await runSmoke()
  write(result)
  if (!result.ok) process.exitCode = 1
}

async function runSmoke(): Promise<SmokeResult> {
  const steps: SmokeResult['steps'] = {}
  let service: ComputerUseService | undefined
  let sessionId: string | undefined
  try {
    await prepareTextEdit()
    const bounds = await frontTextEditBounds()
    service = new ComputerUseService({
      backend: createCompositeComputerUseBackend({ maxImageDimension: 4096 }),
      sharedLeases: false,
      budget: new ComputerUseActionBudget({ maxActionsPerTurn: 20, maxActionsPerSession: 50 })
    })

    const listed = await service.listTargets()
    steps.listTargets = step(listed.diagnostics.available, {
      targetCount: listed.targets.length,
      diagnostics: sanitizeDiagnostics(listed.diagnostics)
    })
    const target = selectTextEditTarget(listed)
    if (!target) throw new Error('TextEdit target was not discovered by mac-app-scoped backend')

    const bind = await service.bindTarget({
      computerUseSessionId: 'smoke-mac-textedit',
      agentId: 'smoke-agent',
      threadId: 'smoke-thread',
      turnId: 'smoke-turn-1',
      backend: 'mac-app-scoped',
      targetId: target.id
    })
    sessionId = bind.session.computerUseSessionId
    steps.bindTarget = step(bind.ok, summarizeBind(bind))
    if (!bind.ok) throw new Error(bind.rejection.message)

    const screenshot = await service.executeAction({
      action: 'screenshot',
      computerUseSessionId: sessionId
    })
    steps.screenshot = step(screenshot.ok, summarizeAction(screenshot))
    if (!screenshot.ok) throw new Error(screenshot.rejection.message)

    const click = await service.executeAction({
      action: 'click',
      computerUseSessionId: sessionId,
      x: bounds.x + 120,
      y: bounds.y + 150
    })
    steps.click = step(click.ok, summarizeAction(click))
    if (!click.ok) throw new Error(click.rejection.message)

    const typed = await service.executeAction({
      action: 'type',
      computerUseSessionId: sessionId,
      text: `SciForge computer-use smoke ${new Date().toISOString()}\n`
    })
    steps.type = step(typed.ok, summarizeAction(typed))
    if (!typed.ok) throw new Error(typed.rejection.message)

    const scroll = await service.executeAction({
      action: 'scroll',
      computerUseSessionId: sessionId,
      x: bounds.x + 260,
      y: bounds.y + 260,
      scrollDirection: 'down',
      scrollAmount: 1
    })
    steps.scroll = step(scroll.ok, summarizeAction(scroll))
    if (!scroll.ok) throw new Error(scroll.rejection.message)

    const abortController = new AbortController()
    const waitPromise = service.executeAction({
      action: 'wait',
      computerUseSessionId: sessionId,
      durationMs: 5_000,
      signal: abortController.signal
    })
    setTimeout(() => abortController.abort(), 120)
    const stopped = await waitPromise
    steps.stopRun = step(!stopped.ok && stopped.rejection.code === 'aborted', summarizeAction(stopped))
    if (stopped.ok || stopped.rejection.code !== 'aborted') throw new Error('wait action was not aborted as expected')

    const rebound = await service.bindTarget({
      computerUseSessionId: sessionId,
      agentId: 'smoke-agent',
      threadId: 'smoke-thread',
      turnId: 'smoke-turn-2',
      backend: 'mac-app-scoped',
      targetId: target.id
    })
    steps.rebindAfterStop = step(rebound.ok, summarizeBind(rebound))
    if (!rebound.ok) throw new Error(rebound.rejection.message)

    const released = await service.releaseTarget(sessionId, 'agent_release')
    steps.releaseTarget = step(released?.leaseState === 'released', {
      leaseState: released?.leaseState,
      releaseReason: released?.releaseReason
    })

    const diagnostics = await service.diagnostics()
    steps.finalDiagnostics = step(!diagnostics.activeLeases.some((lease) => lease.computerUseSessionId === sessionId), {
      activeLeaseCount: diagnostics.activeLeases.length,
      sessions: diagnostics.sessions.map((session) => ({
        id: session.computerUseSessionId,
        leaseState: session.leaseState,
        releaseReason: session.releaseReason
      }))
    })

    return { ok: Object.values(steps).every((item) => item.ok), steps }
  } catch (error) {
    if (service && sessionId) {
      await service.releaseTarget(sessionId, 'unknown').catch(() => undefined)
    }
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      steps
    }
  } finally {
    await cleanupTextEdit().catch(() => undefined)
  }
}

async function prepareTextEdit(): Promise<void> {
  await execFileAsync('osascript', ['-e', `
tell application "TextEdit"
  activate
  make new document with properties {text:"SciForge computer-use smoke target\\n\\n"}
end tell
tell application "System Events"
  tell process "TextEdit"
    set frontmost to true
    try
      set position of front window to {90, 90}
      set size of front window to {720, 520}
    end try
  end tell
end tell
`], { timeout: 5_000, maxBuffer: 200_000 })
}

async function frontTextEditBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
  const { stdout } = await execFileAsync('osascript', ['-e', `
tell application "System Events"
  tell process "TextEdit"
    set p to position of front window
    set s to size of front window
    return (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
  end tell
end tell
`], { timeout: 5_000, maxBuffer: 20_000 })
  const [x, y, width, height] = stdout.trim().split(',').map((value) => Number(value))
  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    throw new Error(`could not read TextEdit bounds: ${stdout.trim()}`)
  }
  return { x: x!, y: y!, width: width!, height: height! }
}

async function cleanupTextEdit(): Promise<void> {
  await execFileAsync('osascript', ['-e', `
tell application "TextEdit"
  try
    close front document saving no
  end try
end tell
`], { timeout: 5_000, maxBuffer: 20_000 })
}

function selectTextEditTarget(result: ComputerUseListTargetsResult) {
  return result.targets.find((target) =>
    target.backend === 'mac-app-scoped' &&
    target.kind === 'window' &&
    target.appName === 'TextEdit'
  ) ?? result.targets.find((target) =>
    target.backend === 'mac-app-scoped' &&
    target.kind === 'app' &&
    target.appName === 'TextEdit'
  )
}

function step(ok: boolean, summary: Record<string, unknown>): StepResult {
  return { ok, summary }
}

function summarizeBind(result: ComputerUseBindResult): Record<string, unknown> {
  return result.ok
    ? {
        sessionId: result.session.computerUseSessionId,
        targetId: result.target.id,
        targetKind: result.target.kind,
        leaseState: result.session.leaseState
      }
    : {
        sessionId: result.session.computerUseSessionId,
        rejectionCode: result.rejection.code,
        message: result.rejection.message
      }
}

function summarizeAction(result: ComputerUseActionResult): Record<string, unknown> {
  if (!result.ok) {
    return {
      rejectionCode: result.rejection.code,
      message: result.rejection.message
    }
  }
  if (result.output.kind === 'computer_screenshot') {
    return {
      kind: result.output.kind,
      screen: result.output.screen,
      imageCount: result.output.images.length,
      images: result.output.images.map((image) => ({
        mime_type: image.mime_type,
        width: image.width,
        height: image.height,
        base64Chars: image.data_base64.length
      }))
    }
  }
  return {
    kind: result.output.kind,
    action: result.output.action,
    ok: result.output.ok,
    cursor: result.output.cursor
  }
}

function sanitizeDiagnostics(diagnostics: ComputerUseServiceDiagnostic | ComputerUseListTargetsResult['diagnostics']) {
  return {
    backend: diagnostics.backend,
    available: diagnostics.available,
    platform: diagnostics.platform,
    reason: diagnostics.reason,
    activeLeaseCount: diagnostics.activeLeases.length,
    recentRejectionCount: diagnostics.recentRejections.length
  }
}

function write(result: SmokeResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}
