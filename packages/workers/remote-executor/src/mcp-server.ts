import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import {
  REMOTE_EXECUTOR_MCP_SERVER_NAME,
  REMOTE_EXECUTOR_MCP_SERVER_VERSION,
  REMOTE_EXECUTOR_TOOL_SIDE_EFFECTS,
  RemoteExecutorWorkerError,
  remoteCancelJobInputSchema,
  remoteDeployWorkerInputSchema,
  remoteExecutorErrorPayloadFromUnknown,
  remoteJobStatusInputSchema,
  remoteListTargetsInputSchema,
  remotePollInputSchema,
  remoteProbeTargetInputSchema,
  remoteReadOutputInputSchema,
  remoteRunInputSchema,
  remoteStopInputSchema,
  remoteSubmitJobInputSchema,
  remoteWriteInputSchema,
  type RemoteExecutorErrorPayload,
  type RemoteExecutorToolName
} from './contract.js'
import {
  createRemoteExecutorService,
  remoteExecutorConfigFromEnv,
  type RemoteCancelJobResult,
  type RemoteDeployWorkerResult,
  type RemoteExecutorService,
  type RemoteJobStatusResult,
  type RemoteListTargetsResult,
  type RemotePollResult,
  type RemoteProbeTargetResult,
  type RemoteReadOutputResult,
  type RemoteRunResult,
  type RemoteStopResult,
  type RemoteSubmitJobResult,
  type RemoteWriteResult
} from './service.js'

type RemoteExecutorToolResult = CallToolResult & {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartRemoteExecutorMcpServerOptions = {
  transport?: Transport
}

export const GUI_REMOTE_EXECUTOR_MCP_LAUNCH_FLAG = '--gui-remote-executor-mcp-server'

export async function runRemoteExecutorMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_REMOTE_EXECUTOR_MCP_LAUNCH_FLAG)) return false
  await startRemoteExecutorMcpServer(createRemoteExecutorService(remoteExecutorConfigFromEnv()))
  return true
}

export function createRemoteExecutorMcpServer(
  service: RemoteExecutorService = createRemoteExecutorService()
): McpServer {
  const server = new McpServer(
    { name: REMOTE_EXECUTOR_MCP_SERVER_NAME, version: REMOTE_EXECUTOR_MCP_SERVER_VERSION },
    { capabilities: { logging: {} } }
  )

  server.registerTool('remote_list_targets', {
    description: 'List configured remote execution targets. Secrets are never returned.',
    inputSchema: remoteListTargetsInputSchema,
    annotations: toolAnnotations('remote_list_targets', 'List remote targets', true)
  }, async (args) => toolCall(() => service.listTargets(args), renderListTargets))

  server.registerTool('remote_probe_target', {
    description: 'Probe whether a configured remote target is reachable. The MVP service returns mock availability.',
    inputSchema: remoteProbeTargetInputSchema,
    annotations: toolAnnotations('remote_probe_target', 'Probe remote target', true)
  }, async (args) => toolCall(() => service.probeTarget(args), renderProbeTarget))

  server.registerTool('remote_deploy_worker', {
    description: 'Deploy or preview deployment of the Python remote_worker.py protocol skeleton to a target.',
    inputSchema: remoteDeployWorkerInputSchema,
    annotations: toolAnnotations('remote_deploy_worker', 'Deploy remote worker', false)
  }, async (args) => toolCall(() => service.deployWorker(args), renderDeployWorker))

  server.registerTool('remote_run', {
    description: 'Start a remote command through the remote worker protocol. The MVP service records a mock run and does not execute shell commands.',
    inputSchema: remoteRunInputSchema,
    annotations: toolAnnotations('remote_run', 'Start remote run', false)
  }, async (args) => toolCall(() => service.run(args), renderRun))

  server.registerTool('remote_poll', {
    description: 'Poll a remote run by id and return current status plus bounded output.',
    inputSchema: remotePollInputSchema,
    annotations: toolAnnotations('remote_poll', 'Poll remote run', true)
  }, async (args) => toolCall(() => service.poll(args), renderRun))

  server.registerTool('remote_write', {
    description: 'Write stdin bytes to an active remote run. The MVP service stores the write in memory.',
    inputSchema: remoteWriteInputSchema,
    annotations: toolAnnotations('remote_write', 'Write remote stdin', false)
  }, async (args) => toolCall(() => service.write(args), renderWrite))

  server.registerTool('remote_stop', {
    description: 'Stop an active remote run.',
    inputSchema: remoteStopInputSchema,
    annotations: toolAnnotations('remote_stop', 'Stop remote run', false)
  }, async (args) => toolCall(() => service.stop(args), renderStop))

  server.registerTool('remote_submit_job', {
    description: 'Submit or preview a scheduler job. V1 defines Slurm protocol shape with mock storage.',
    inputSchema: remoteSubmitJobInputSchema,
    annotations: toolAnnotations('remote_submit_job', 'Submit remote job', false)
  }, async (args) => toolCall(() => service.submitJob(args), renderSubmitJob))

  server.registerTool('remote_job_status', {
    description: 'Read remote scheduler job status and normalized Slurm state.',
    inputSchema: remoteJobStatusInputSchema,
    annotations: toolAnnotations('remote_job_status', 'Read remote job status', true)
  }, async (args) => toolCall(() => service.jobStatus(args), renderJobStatus))

  server.registerTool('remote_cancel_job', {
    description: 'Cancel a remote scheduler job.',
    inputSchema: remoteCancelJobInputSchema,
    annotations: toolAnnotations('remote_cancel_job', 'Cancel remote job', false)
  }, async (args) => toolCall(() => service.cancelJob(args), renderCancelJob))

  server.registerTool('remote_read_output', {
    description: 'Read bounded stdout, stderr, or combined output from a remote run or job.',
    inputSchema: remoteReadOutputInputSchema,
    annotations: toolAnnotations('remote_read_output', 'Read remote output', true)
  }, async (args) => toolCall(() => service.readOutput(args), renderReadOutput))

  return server
}

export async function startRemoteExecutorMcpServer(
  service: RemoteExecutorService = createRemoteExecutorService(),
  options: StartRemoteExecutorMcpServerOptions = {}
): Promise<void> {
  const server = createRemoteExecutorMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

async function toolCall<T extends { ok: true }>(
  run: () => Promise<T>,
  render: (result: T) => string
): Promise<RemoteExecutorToolResult> {
  try {
    const result = await run()
    return textAndStructured(render(result), result as unknown as Record<string, unknown>)
  } catch (error) {
    return toolError(error)
  }
}

function toolAnnotations(name: RemoteExecutorToolName, title: string, idempotentHint: boolean): {
  title: string
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: false
} {
  const sideEffect = REMOTE_EXECUTOR_TOOL_SIDE_EFFECTS[name]
  return {
    title,
    readOnlyHint: sideEffect.effect === 'read-only',
    destructiveHint: sideEffect.destructive,
    idempotentHint,
    openWorldHint: false
  }
}

function textAndStructured(text: string, structuredContent: Record<string, unknown>): RemoteExecutorToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

function toolError(error: unknown): RemoteExecutorToolResult {
  const payload = remoteExecutorErrorPayloadFromUnknown(error, {
    reason: 'Remote executor tool failed.',
    retryable: error instanceof RemoteExecutorWorkerError ? error.retryable : false,
    suggestion: 'Check the remote executor target, tool arguments, and worker state.'
  })
  return remoteExecutorToolError(payload)
}

function remoteExecutorToolError(payload: RemoteExecutorErrorPayload): RemoteExecutorToolResult {
  return {
    content: [{ type: 'text', text: `${payload.code}: ${payload.reason}` }],
    isError: true,
    structuredContent: {
      ok: false,
      code: payload.code,
      reason: payload.reason,
      retryable: payload.retryable,
      suggestion: payload.suggestion,
      ...(payload.targetId ? { targetId: payload.targetId } : {}),
      ...(payload.details !== undefined ? { details: payload.details } : {}),
      error: payload
    }
  }
}

function renderListTargets(result: RemoteListTargetsResult): string {
  return result.count > 0
    ? `Found ${result.count} remote target(s).`
    : 'No remote targets are configured.'
}

function renderProbeTarget(result: RemoteProbeTargetResult): string {
  return result.message
}

function renderDeployWorker(result: RemoteDeployWorkerResult): string {
  return result.dryRun
    ? `Dry run: would deploy ${result.manifest.entrypoint} to ${result.targetId}:${result.remotePath}.`
    : `Remote worker deployed to ${result.targetId}:${result.remotePath}.`
}

function renderRun(result: RemoteRunResult | RemotePollResult): string {
  return `Remote run ${result.run.runId} is ${result.run.status}.`
}

function renderWrite(result: RemoteWriteResult): string {
  return `Accepted ${result.acceptedBytes} stdin byte(s) for ${result.runId}.`
}

function renderStop(result: RemoteStopResult): string {
  return result.stopped
    ? `Remote run ${result.run.runId} stopped.`
    : `Remote run ${result.run.runId} was already ${result.run.status}.`
}

function renderSubmitJob(result: RemoteSubmitJobResult): string {
  return result.dryRun
    ? `Dry run: Slurm job script has ${result.scriptBytes} byte(s).`
    : `Remote Slurm job submitted: ${result.job.jobId}.`
}

function renderJobStatus(result: RemoteJobStatusResult): string {
  return `Remote job ${result.job.jobId} is ${result.job.status.state} (${result.job.status.slurmState}).`
}

function renderCancelJob(result: RemoteCancelJobResult): string {
  return result.cancelled
    ? `Remote job ${result.job.jobId} cancelled.`
    : `Remote job ${result.job.jobId} was already ${result.job.status.state}.`
}

function renderReadOutput(result: RemoteReadOutputResult): string {
  return `Read ${result.output.bytesRead} byte(s) from ${result.stream}.`
}
