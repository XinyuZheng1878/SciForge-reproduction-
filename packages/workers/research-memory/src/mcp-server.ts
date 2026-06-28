import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  ArtifactGetInputSchema,
  ArtifactListInputSchema,
  ArtifactUpsertInputSchema,
  DraftSyncInputSchema,
  FeedbackReadInputSchema,
  GithubCommentInputSchema,
  GithubCreatePrInputSchema,
  GithubIssueInputSchema,
  GithubPreparePrInputSchema,
  PolicyCheckInputSchema,
  RESEARCH_MEMORY_ARTIFACT_RESOURCE_URI_TEMPLATE,
  RESEARCH_MEMORY_ARTIFACTS_RESOURCE_URI,
  RESEARCH_MEMORY_STATUS_RESOURCE_URI,
  RESEARCH_MEMORY_TOOL_CONTRACTS,
  RenderStatusHtmlInputSchema,
  ResearchMemoryStatusInputSchema,
  WriteDecisionRecordInputSchema,
  WriteExperimentCardInputSchema,
  type ResearchMemoryFailure
} from './contract.js'
import {
  createResearchMemoryService,
  type ResearchMemoryService
} from './service.js'

type McpResearchMemoryToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
  isError?: true
}

export type StartResearchMemoryMcpServerOptions = {
  transport?: Transport
}

export function createResearchMemoryMcpServer(
  service: ResearchMemoryService = createResearchMemoryService()
): McpServer {
  const server = new McpServer(
    { name: 'sciforge-research-memory', version: '0.1.0' },
    { capabilities: { logging: {} } }
  )

  server.registerTool('gui_research_memory_status', {
    description: 'Read Research Memory worker status and local artifact index metadata.',
    inputSchema: ResearchMemoryStatusInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_status.annotations
  }, async (args) => resultToToolResult(await service.status(args), 'research memory status'))

  server.registerTool('gui_research_memory_artifact_list', {
    description: 'List artifacts from .agent/artifacts.yml with optional filtering.',
    inputSchema: ArtifactListInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_artifact_list.annotations
  }, async (args) => resultToToolResult(await service.listArtifacts(args), 'artifact list'))

  server.registerTool('gui_research_memory_artifact_get', {
    description: 'Read one artifact from .agent/artifacts.yml by HYP/EXP/RUN/DEC/DOC/ART id.',
    inputSchema: ArtifactGetInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_artifact_get.annotations
  }, async (args) => resultToToolResult(await service.getArtifact(args), 'artifact get'))

  server.registerTool('gui_research_memory_feedback_read', {
    description: 'Read GitHub issue, PR, and optional mention feedback for research-memory labels through the configured gh CLI auth.',
    inputSchema: FeedbackReadInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_feedback_read.annotations
  }, async (args) => resultToToolResult(await service.readFeedback(args), 'feedback read'))

  server.registerTool('gui_research_memory_policy_check', {
    description: 'Check local or GitHub-bound research-memory text for local paths, secrets, server details, sensitive content, and high-risk claims.',
    inputSchema: PolicyCheckInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_policy_check.annotations
  }, async (args) => resultToToolResult(await service.policyCheck(args), 'policy check'))

  server.registerTool('gui_research_memory_artifact_upsert', {
    description: 'Create or update an artifact in .agent/artifacts.yml. Supports dry_run or preview.',
    inputSchema: ArtifactUpsertInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_artifact_upsert.annotations
  }, async (args) => resultToToolResult(await service.upsertArtifact(args), 'artifact upsert'))

  server.registerTool('gui_research_memory_draft_sync', {
    description: 'Generate a local research-memory sync draft for GitHub issue/comment/PR, experiment card, decision record, or status.html. Supports dry_run or preview.',
    inputSchema: DraftSyncInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_draft_sync.annotations
  }, async (args) => resultToToolResult(await service.draftSync(args), 'draft sync'))

  server.registerTool('gui_research_memory_write_experiment_card', {
    description: 'Write an experiment card under .agent/research-memory/experiments. Supports dry_run or preview.',
    inputSchema: WriteExperimentCardInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_write_experiment_card.annotations
  }, async (args) => resultToToolResult(await service.writeExperimentCard(args), 'write experiment card'))

  server.registerTool('gui_research_memory_write_decision_record', {
    description: 'Write a decision record under .agent/research-memory/decisions. Supports dry_run or preview.',
    inputSchema: WriteDecisionRecordInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_write_decision_record.annotations
  }, async (args) => resultToToolResult(await service.writeDecisionRecord(args), 'write decision record'))

  server.registerTool('gui_research_memory_render_status_html', {
    description: 'Render stable static status.html from .agent/artifacts.yml. The MVP output uses no JavaScript and only small inline CSS. Supports dry_run or preview.',
    inputSchema: RenderStatusHtmlInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_render_status_html.annotations
  }, async (args) => resultToToolResult(await service.renderStatusHtml(args), 'render status.html'))

  server.registerTool('gui_research_memory_create_issue', {
    description: 'Create a GitHub issue from a Research Memory artifact. Supports dry_run/preview and requires confirmed: true for real writes.',
    inputSchema: GithubIssueInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_create_issue.annotations
  }, async (args) => resultToToolResult(await service.createIssue(args), 'create GitHub issue'))

  server.registerTool('gui_research_memory_create_comment', {
    description: 'Create a GitHub issue or PR comment from a Research Memory artifact. Supports dry_run/preview and requires confirmed: true for real writes.',
    inputSchema: GithubCommentInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_create_comment.annotations
  }, async (args) => resultToToolResult(await service.createComment(args), 'create GitHub comment'))

  server.registerTool('gui_research_memory_prepare_pr', {
    description: 'Prepare a local branch and commit for Research Memory files. Supports dry_run/preview and requires confirmed: true for real writes.',
    inputSchema: GithubPreparePrInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_prepare_pr.annotations
  }, async (args) => resultToToolResult(await service.preparePr(args), 'prepare GitHub PR'))

  server.registerTool('gui_research_memory_create_pr', {
    description: 'Open a GitHub PR for Research Memory changes. Supports dry_run/preview and requires confirmed: true for real writes.',
    inputSchema: GithubCreatePrInputSchema,
    annotations: RESEARCH_MEMORY_TOOL_CONTRACTS.gui_research_memory_create_pr.annotations
  }, async (args) => resultToToolResult(await service.createPr(args), 'create GitHub PR'))

  server.registerResource('research-memory-artifacts', RESEARCH_MEMORY_ARTIFACTS_RESOURCE_URI, {
    title: 'Research Memory Artifacts',
    description: 'Artifact index loaded from .agent/artifacts.yml.',
    mimeType: 'application/json'
  }, async () => resourceJson(RESEARCH_MEMORY_ARTIFACTS_RESOURCE_URI, await service.listArtifacts({})))

  server.registerResource('research-memory-status', RESEARCH_MEMORY_STATUS_RESOURCE_URI, {
    title: 'Research Memory Status',
    description: 'Research Memory worker status and local index metadata.',
    mimeType: 'application/json'
  }, async () => resourceJson(RESEARCH_MEMORY_STATUS_RESOURCE_URI, await service.status({})))

  server.registerResource('research-memory-artifact', new ResourceTemplate(RESEARCH_MEMORY_ARTIFACT_RESOURCE_URI_TEMPLATE, {
    list: undefined
  }), {
    title: 'Research Memory Artifact',
    description: 'One artifact from .agent/artifacts.yml.',
    mimeType: 'application/json'
  }, async (uri, variables) => {
    const rawId = Array.isArray(variables.artifactId) ? variables.artifactId[0] : variables.artifactId
    const id = decodeURIComponent(rawId ?? '')
    return resourceJson(uri.toString(), await service.getArtifact({ id }))
  })

  return server
}

export async function startResearchMemoryMcpServer(
  service: ResearchMemoryService = createResearchMemoryService(),
  options: StartResearchMemoryMcpServerOptions = {}
): Promise<void> {
  const server = createResearchMemoryMcpServer(service)
  const transport = options.transport ?? new StdioServerTransport()
  await server.connect(transport)
}

function resultToToolResult(result: Record<string, unknown> | ResearchMemoryFailure, label: string): McpResearchMemoryToolResult {
  if (isFailure(result)) {
    return {
      content: [{
        type: 'text',
        text: `${label} failed (${result.error.code}): ${result.error.message} Suggestion: ${result.error.suggestedFix}`
      }],
      structuredContent: result,
      isError: true
    }
  }
  return {
    content: [{ type: 'text', text: successSummary(result, label) }],
    structuredContent: compactStructuredContent(result, label)
  }
}

function isFailure(result: Record<string, unknown> | ResearchMemoryFailure): result is ResearchMemoryFailure {
  return result.ok === false
}

function successSummary(result: Record<string, unknown>, label: string): string {
  if (typeof result.count === 'number') return `${label} completed with ${result.count} item(s).`
  if (result.preview === true) return `${label} preview generated.`
  if (result.wrote === true) return `${label} wrote local Research Memory output.`
  return `${label} completed.`
}

const COMPACT_STRUCTURED_RESULT_LABELS = new Set([
  'artifact upsert',
  'draft sync',
  'write experiment card',
  'write decision record',
  'render status.html',
  'create GitHub issue',
  'create GitHub comment',
  'prepare GitHub PR',
  'create GitHub PR'
])

function compactStructuredContent(result: Record<string, unknown>, label: string): Record<string, unknown> {
  if (!COMPACT_STRUCTURED_RESULT_LABELS.has(label)) return result

  const compact: Record<string, unknown> = {}
  copyFields(result, compact, [
    'ok',
    'dryRun',
    'preview',
    'wouldWrite',
    'wrote',
    'wouldCreateIssue',
    'wouldCreateComment',
    'wouldCreatePr',
    'issue',
    'comment',
    'pr',
    'url',
    'path',
    'outputPath',
    'artifactIndexPath',
    'branch',
    'committedFiles',
    'title',
    'labels'
  ])

  const artifact = asRecord(result.artifact)
  if (artifact) {
    compact.artifact = pickPresent(artifact, [
      'id',
      'kind',
      'evidence_level',
      'claim_scope',
      'risk_level',
      'status',
      'tags',
      'created_at',
      'updated_at'
    ])
  }

  const draft = asRecord(result.draft)
  if (draft) {
    compact.draft = {
      ...pickPresent(draft, ['title']),
      bodyPreview: previewText(draft.body),
      bodyBytes: textBytes(draft.body)
    }
  }

  const policy = asRecord(result.policy)
  if (policy) {
    const findings = Array.isArray(policy.findings) ? policy.findings : []
    compact.policy = {
      ...pickPresent(policy, ['ok', 'allowed', 'target', 'requiresConfirmation']),
      findingCount: findings.length,
      findings
    }
  }

  copyLargeTextMetadata(result, compact, 'body')
  copyLargeTextMetadata(result, compact, 'content')
  copyLargeTextMetadata(result, compact, 'html')
  return compact
}

function copyFields(source: Record<string, unknown>, target: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    if (source[field] !== undefined) target[field] = source[field]
  }
}

function pickPresent(source: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  copyFields(source, picked, fields)
  return picked
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function copyLargeTextMetadata(source: Record<string, unknown>, target: Record<string, unknown>, field: string): void {
  if (typeof source[field] !== 'string') return
  target[`${field}Preview`] = previewText(source[field])
  target[`${field}Bytes`] = textBytes(source[field])
}

function previewText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > 240 ? `${value.slice(0, 240)}...` : value
}

function textBytes(value: unknown): number | undefined {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : undefined
}

function resourceJson(uri: string, value: unknown): { contents: Array<{ uri: string; text: string; mimeType: string }> } {
  return {
    contents: [{
      uri,
      text: JSON.stringify(value, null, 2),
      mimeType: 'application/json'
    }]
  }
}
