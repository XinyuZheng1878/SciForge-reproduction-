import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  WORKFLOW_CALLABLE_RESOURCE_URI,
  WORKFLOW_RUN_RESOURCE_URI_TEMPLATE,
  WORKFLOW_SCHEMA_RESOURCE_URI_TEMPLATE,
  WORKFLOW_TOOL_CONTRACTS,
  WorkflowExportInputSchema,
  WorkflowImportInputSchema,
  WorkflowListInputSchema,
  WorkflowRunInputSchema,
  WorkflowStatusInputSchema,
  WorkflowStopInputSchema,
  WorkflowValidateInputSchema,
  type WorkflowFacadeFailure,
  type WorkflowFacadeResult
} from './contract.js'
import { createWorkflowService, type WorkflowService } from './service.js'

type McpWorkflowToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartWorkflowMcpServerOptions = {
  transport?: Transport
}

export function createWorkflowMcpServer(service: WorkflowService = createWorkflowService()): McpServer {
  const server = new McpServer(
    { name: 'sciforge-workflow', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_workflow_list', {
    description: 'List enabled workflows that the SciForge workflow runtime exposes to agents.',
    inputSchema: WorkflowListInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_list.annotations
  }, async (args, extra) => resultToToolResult(await service.list(args, extra.signal), 'workflow list'))

  server.registerTool('gui_workflow_run', {
    description: [
      'Run an agent-callable SciForge workflow by id or name through the existing workflow runtime.',
      'Use dry_run or preview to validate inputs and inspect what would run without invoking the runtime.',
      'Code nodes, approvals, loops, webhooks, and cron behavior remain owned by the runtime.'
    ].join(' '),
    inputSchema: WorkflowRunInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_run.annotations
  }, async (args, extra) => resultToToolResult(await service.run(args, extra.signal), 'workflow run'))

  server.registerTool('gui_workflow_status', {
    description: 'Read workflow runtime or run status through the SciForge workflow runtime facade.',
    inputSchema: WorkflowStatusInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_status.annotations
  }, async (args, extra) => resultToToolResult(await service.status(args, extra.signal), 'workflow status'))

  server.registerTool('gui_workflow_stop', {
    description: 'Request that the SciForge workflow runtime stop a running workflow. Use dry_run or preview to inspect the stop target first.',
    inputSchema: WorkflowStopInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_stop.annotations
  }, async (args, extra) => resultToToolResult(await service.stop(args, extra.signal), 'workflow stop'))

  server.registerTool('gui_workflow_validate', {
    description: 'Validate a workflow import document or validate input against a callable workflow schema.',
    inputSchema: WorkflowValidateInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_validate.annotations
  }, async (args, extra) => resultToToolResult(await service.validate(args, extra.signal), 'workflow validate'))

  server.registerTool('gui_workflow_import', {
    description: 'Import a workflow document into SciForge. Use dry_run or preview to validate the document without writing.',
    inputSchema: WorkflowImportInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_import.annotations
  }, async (args, extra) => resultToToolResult(await service.importWorkflow(args, extra.signal), 'workflow import'))

  server.registerTool('gui_workflow_export', {
    description: 'Export a workflow document from SciForge. Use preview to return export metadata without the full workflow payload.',
    inputSchema: WorkflowExportInputSchema,
    annotations: WORKFLOW_TOOL_CONTRACTS.gui_workflow_export.annotations
  }, async (args, extra) => resultToToolResult(await service.exportWorkflow(args, extra.signal), 'workflow export'))

  server.registerResource('workflow_callable', WORKFLOW_CALLABLE_RESOURCE_URI, {
    title: 'Callable SciForge workflows',
    description: 'Enabled workflows that may be invoked by agents.',
    mimeType: 'application/json'
  }, async (uri, extra) => resourceJson(uri.toString(), await service.list({}, extra.signal)))

  server.registerResource('workflow_run', new ResourceTemplate(WORKFLOW_RUN_RESOURCE_URI_TEMPLATE, { list: undefined }), {
    title: 'SciForge workflow run',
    description: 'Workflow run status and runtime details by run id.',
    mimeType: 'application/json'
  }, async (uri, variables, extra) => {
    const runId = firstVariable(variables.runId)
    return resourceJson(uri.toString(), await service.status({ run_id: runId }, extra.signal))
  })

  server.registerResource('workflow_schema', new ResourceTemplate(WORKFLOW_SCHEMA_RESOURCE_URI_TEMPLATE, { list: undefined }), {
    title: 'SciForge workflow input schema',
    description: 'Input schema for one callable workflow.',
    mimeType: 'application/json'
  }, async (uri, variables, extra) => {
    const workflowId = firstVariable(variables.workflowId)
    return resourceJson(uri.toString(), await service.schema({ workflow_id: workflowId }, extra.signal))
  })

  return server
}

export async function startWorkflowMcpServer(
  service: WorkflowService = createWorkflowService(),
  options: StartWorkflowMcpServerOptions = {}
): Promise<void> {
  const server = createWorkflowMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function resultToToolResult(result: WorkflowFacadeResult, label: string): McpWorkflowToolResult {
  if (!result.ok) return errorToolResult(result, label)
  return {
    content: [{ type: 'text', text: renderSuccessSummary(result, label) }],
    structuredContent: result as unknown as Record<string, unknown>
  }
}

function errorToolResult(result: WorkflowFacadeFailure, label: string): McpWorkflowToolResult {
  const { error } = result
  const text = `${label} failed (${error.code}): ${error.reason} Suggestion: ${error.suggestion}`
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      ...result,
      ...(error.confirmationRequired ? { confirmationRequired: error.confirmationRequired } : {})
    },
    isError: true
  }
}

function renderSuccessSummary(result: Exclude<WorkflowFacadeResult, WorkflowFacadeFailure>, label: string): string {
  if ('workflows' in result) return `Found ${result.workflows.length} callable workflow(s).`
  if ('valid' in result) return result.valid ? 'Workflow validation passed.' : `Workflow validation found ${result.issues.length} issue(s).`
  if ('wouldRun' in result) return `Workflow run preview ready for ${result.workflow?.name ?? result.workflow?.id ?? 'workflow'}.`
  if ('wouldStop' in result) return 'Workflow stop preview ready.'
  if ('wouldImport' in result) return 'Workflow import preview ready.'
  if ('workflow' in result && 'inputSchema' in result) return `Workflow schema loaded for ${result.workflow.name}.`
  if ('includeRuns' in result) return result.preview ? 'Workflow export preview ready.' : 'Workflow exported.'
  return `${label} completed.`
}

function resourceJson(uri: string, result: WorkflowFacadeResult) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result, null, 2)
    }]
  }
}

function firstVariable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}
