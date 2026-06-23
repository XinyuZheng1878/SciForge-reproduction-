import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'

import {
  createComputerUseService,
  type ComputerUseService
} from './service.js'
import type {
  ComputerUseActionRequest,
  ComputerUseBackendKind,
  ComputerUseImage,
  ComputerUseMouseButton,
  ComputerUseReleaseReason,
  ComputerUseRiskCategory,
  ComputerUseScrollDirection,
  ComputerUseScreenshotOutput
} from './contract.js'

type McpTextToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

const COMPUTER_USE_DEFAULT_AGENT_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_AGENT_ID'
const COMPUTER_USE_DEFAULT_THREAD_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_THREAD_ID'
const COMPUTER_USE_DEFAULT_TURN_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_TURN_ID'
const COMPUTER_USE_DEFAULT_SESSION_ID_ENV = 'SCIFORGE_COMPUTER_USE_DEFAULT_SESSION_ID'

export type ComputerUseMcpLifecycleProcess = Pick<NodeJS.Process, 'once' | 'off' | 'exit'>

export type StartComputerUseMcpServerOptions = {
  transport?: Transport
  lifecycleProcess?: ComputerUseMcpLifecycleProcess
  exitOnSignal?: boolean
}

const computerUseActionSchema = z.enum([
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
])

const backendSchema = z.enum(['global-native', 'mac-app-scoped'])
const mouseButtonSchema = z.enum(['left', 'right', 'middle'])
const scrollDirectionSchema = z.enum(['up', 'down', 'left', 'right'])
const riskCategorySchema = z.enum([
  'delete',
  'upload',
  'send_message',
  'submit_form',
  'system_settings',
  'transaction',
  'sensitive_data_transfer'
])

export function createComputerUseMcpServer(
  service: ComputerUseService = createComputerUseService()
): McpServer {
  const server = new McpServer(
    { name: 'sciforge-computer-use', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('computer_use', {
    description: [
      'Shared SciForge computer-use extension for host UI control.',
      'Use list_targets before binding. Use bind_target to acquire an app/window/desktop lease.',
      'If a target is already leased by another agent, the request is rejected with target_in_use instead of queued or preempted.',
      'All runtimes should use this single MCP tool instead of implementing parallel computer-use paths.'
    ].join(' '),
    inputSchema: {
      action: computerUseActionSchema,
      computerUseSessionId: z.string().min(1).optional(),
      agentId: z.string().min(1).optional(),
      threadId: z.string().min(1).optional(),
      turnId: z.string().min(1).optional(),
      backend: backendSchema.optional(),
      targetId: z.string().min(1).optional(),
      reason: z.string().min(1).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      startX: z.number().optional(),
      startY: z.number().optional(),
      button: mouseButtonSchema.optional(),
      clickCount: z.number().int().min(1).max(2).optional(),
      modifiers: z.array(z.string().min(1)).optional(),
      scrollDirection: scrollDirectionSchema.optional(),
      scrollAmount: z.number().optional(),
      text: z.string().optional(),
      durationMs: z.number().int().min(0).max(60_000).optional(),
      riskIntent: z.string().min(1).optional(),
      riskCategories: z.array(riskCategorySchema).optional()
    }
  }, async (args) => {
    try {
      const defaultContext = defaultComputerUseContext()
      switch (args.action) {
        case 'list_targets': {
          const result = await service.listTargets()
          return textAndStructured(renderListTargets(result), result)
        }
        case 'bind_target': {
          if (!args.targetId) return toolError('bind_target requires targetId')
          const trustedContext = computerUseContextForArgs(args, defaultContext)
          const result = await service.bindTarget({
            computerUseSessionId: trustedContext.computerUseSessionId,
            agentId: trustedContext.agentId,
            threadId: trustedContext.threadId,
            turnId: trustedContext.turnId,
            backend: (args.backend ?? 'global-native') as ComputerUseBackendKind,
            targetId: args.targetId
          })
          return textAndStructured(result.ok ? 'computer_use target bound' : result.rejection.message, result, !result.ok)
        }
        case 'release_target': {
          if (!args.computerUseSessionId) return toolError('release_target requires computerUseSessionId')
          const result = await service.releaseTarget(
            args.computerUseSessionId,
            args.reason as ComputerUseReleaseReason | undefined
          )
          return textAndStructured(result ? 'computer_use target released' : 'computer_use session not found', { session: result })
        }
        case 'diagnostics': {
          const result = await service.diagnostics()
          return textAndStructured(renderDiagnostics(result), result, !result.available)
        }
        case 'screenshot':
        case 'cursor_position':
        case 'mouse_move':
        case 'click':
        case 'drag':
        case 'scroll':
        case 'type':
        case 'key':
        case 'wait': {
          const trustedContext = computerUseContextForArgs(args, defaultContext)
          const computerUseSessionId = trustedContext.computerUseSessionId
          if (!computerUseSessionId) return toolError(`${args.action} requires computerUseSessionId`)
          const result = await service.executeAction({
            action: args.action,
            computerUseSessionId,
            targetId: args.targetId,
            x: args.x,
            y: args.y,
            startX: args.startX,
            startY: args.startY,
            button: args.button as ComputerUseMouseButton | undefined,
            clickCount: args.clickCount === 2 ? 2 : 1,
            modifiers: args.modifiers,
            scrollDirection: args.scrollDirection as ComputerUseScrollDirection | undefined,
            scrollAmount: args.scrollAmount,
            text: args.text,
            durationMs: args.durationMs,
            agentId: trustedContext.agentId,
            threadId: trustedContext.threadId,
            turnId: trustedContext.turnId,
            riskIntent: args.riskIntent,
            riskCategories: args.riskCategories as ComputerUseRiskCategory[] | undefined
          } satisfies ComputerUseActionRequest)
          return actionResultToMcpToolResult(result)
        }
      }
    } catch (error) {
      return toolError(`computer_use failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  return server
}

export async function startComputerUseMcpServer(
  service: ComputerUseService = createComputerUseService(),
  options: StartComputerUseMcpServerOptions = {}
): Promise<void> {
  const server = createComputerUseMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  const disposeShutdownHooks = installComputerUseShutdownReleaseHooks({
    service,
    transport,
    lifecycleProcess: options.lifecycleProcess,
    exitOnSignal: options.exitOnSignal
  })
  try {
    await server.connect(transport)
  } catch (error) {
    disposeShutdownHooks()
    await releaseAllTargetsBestEffort(service, 'service_shutdown')
    throw error
  }
}

export function installComputerUseShutdownReleaseHooks(options: {
  service: Pick<ComputerUseService, 'releaseAllTargets'>
  transport: Pick<Transport, 'onclose'>
  lifecycleProcess?: ComputerUseMcpLifecycleProcess
  exitOnSignal?: boolean
}): () => void {
  const lifecycleProcess = options.lifecycleProcess ?? process
  const exitOnSignal = options.exitOnSignal ?? true
  const releaseReason: ComputerUseReleaseReason = 'service_shutdown'
  const previousOnClose = options.transport.onclose
  let disposed = false
  let releasePromise: Promise<void> | null = null

  const releaseOnce = (): Promise<void> => {
    releasePromise ??= releaseAllTargetsBestEffort(options.service, releaseReason)
    return releasePromise
  }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    if (options.transport.onclose === onTransportClose) {
      options.transport.onclose = previousOnClose
    }
    lifecycleProcess.off('SIGINT', onSigint)
    lifecycleProcess.off('SIGTERM', onSigterm)
    lifecycleProcess.off('beforeExit', onBeforeExit)
    lifecycleProcess.off('exit', onExit)
  }
  const releaseAndDispose = (): void => {
    void releaseOnce().finally(dispose)
  }
  const exitAfterRelease = (code: number): void => {
    void releaseOnce().finally(() => {
      dispose()
      if (exitOnSignal) lifecycleProcess.exit(code)
    })
  }
  function onTransportClose(): void {
    try {
      previousOnClose?.()
    } finally {
      releaseAndDispose()
    }
  }
  function onSigint(): void {
    exitAfterRelease(130)
  }
  function onSigterm(): void {
    exitAfterRelease(143)
  }
  function onBeforeExit(): void {
    releaseAndDispose()
  }
  function onExit(): void {
    void releaseOnce()
  }

  options.transport.onclose = onTransportClose
  lifecycleProcess.once('SIGINT', onSigint)
  lifecycleProcess.once('SIGTERM', onSigterm)
  lifecycleProcess.once('beforeExit', onBeforeExit)
  lifecycleProcess.once('exit', onExit)
  return dispose
}

function textAndStructured(
  text: string,
  structuredContent: Record<string, unknown>,
  isError = false
): McpTextToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    ...(isError ? { isError: true as const } : {})
  }
}

function toolError(text: string): McpTextToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}

function defaultComputerUseContext(): {
  agentId: string
  threadId: string
  turnId?: string
  computerUseSessionId?: string
  trustedIdentity: boolean
} {
  const agentId = nonEmptyEnv(COMPUTER_USE_DEFAULT_AGENT_ID_ENV)
  const threadId = nonEmptyEnv(COMPUTER_USE_DEFAULT_THREAD_ID_ENV)
  const turnId = nonEmptyEnv(COMPUTER_USE_DEFAULT_TURN_ID_ENV)
  const computerUseSessionId = nonEmptyEnv(COMPUTER_USE_DEFAULT_SESSION_ID_ENV)
  const trustedIdentity = Boolean(agentId || threadId || turnId || computerUseSessionId)
  return {
    agentId: agentId ?? 'agent',
    threadId: threadId ?? 'thread',
    ...(turnId ? { turnId } : {}),
    ...(computerUseSessionId || agentId ? { computerUseSessionId: computerUseSessionId ?? agentId } : {}),
    trustedIdentity
  }
}

function computerUseContextForArgs(
  args: {
    agentId?: string
    threadId?: string
    turnId?: string
    computerUseSessionId?: string
  },
  defaultContext: ReturnType<typeof defaultComputerUseContext>
): {
  agentId: string
  threadId: string
  turnId?: string
  computerUseSessionId?: string
} {
  if (defaultContext.trustedIdentity) {
    return {
      agentId: defaultContext.agentId,
      threadId: defaultContext.threadId,
      ...(defaultContext.turnId ? { turnId: defaultContext.turnId } : {}),
      ...(defaultContext.computerUseSessionId ? { computerUseSessionId: defaultContext.computerUseSessionId } : {})
    }
  }
  const turnId = args.turnId ?? defaultContext.turnId
  const computerUseSessionId = args.computerUseSessionId ?? defaultContext.computerUseSessionId
  return {
    agentId: args.agentId ?? defaultContext.agentId,
    threadId: args.threadId ?? defaultContext.threadId,
    ...(turnId ? { turnId } : {}),
    ...(computerUseSessionId ? { computerUseSessionId } : {})
  }
}

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]
  return value?.trim() ? value : undefined
}

function actionResultToMcpToolResult(
  result: Awaited<ReturnType<ComputerUseService['executeAction']>>
): McpTextToolResult {
  const output = result.output
  if (output.kind === 'computer_screenshot') {
    return {
      content: [
        { type: 'text', text: output.note },
        ...output.images.map((image) => mcpImageContent(image))
      ],
      structuredContent: sanitizeScreenshotOutput(output),
      ...(result.ok ? {} : { isError: true as const })
    }
  }
  return {
    content: [{
      type: 'text',
      text: output.message ?? `computer_use ${output.action} ${output.ok ? 'completed' : 'failed'}`
    }],
    structuredContent: output,
    ...(result.ok ? {} : { isError: true as const })
  }
}

function mcpImageContent(image: ComputerUseImage): { type: 'image'; data: string; mimeType: string } {
  return {
    type: 'image',
    data: image.data_base64,
    mimeType: image.mime_type
  }
}

function sanitizeScreenshotOutput(output: ComputerUseScreenshotOutput): Record<string, unknown> {
  return {
    ...output,
    images: output.images.map(({ data_base64: _dataBase64, ...image }) => image),
    images_omitted: output.images.length
  }
}

function renderListTargets(result: Awaited<ReturnType<ComputerUseService['listTargets']>>): string {
  return result.targets.length > 0
    ? `Found ${result.targets.length} computer-use target(s).`
    : `No computer-use targets available: ${result.diagnostics.reason ?? 'backend unavailable'}`
}

function renderDiagnostics(result: Awaited<ReturnType<ComputerUseService['diagnostics']>>): string {
  return [
    `Computer Use backend ${result.backend}: ${result.available ? 'available' : 'unavailable'}.`,
    result.reason ? `Reason: ${result.reason}` : '',
    `Active leases: ${result.activeLeases.length}.`
  ].filter(Boolean).join(' ')
}

async function releaseAllTargetsBestEffort(
  service: Pick<ComputerUseService, 'releaseAllTargets'>,
  reason: ComputerUseReleaseReason
): Promise<void> {
  try {
    await service.releaseAllTargets(reason)
  } catch (error) {
    console.error(`[sciforge-computer-use] failed to release active leases during shutdown: ${
      error instanceof Error ? error.message : String(error)
    }`)
  }
}
