import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path'

import {
  ArtifactGetInputSchema,
  ArtifactIdSchema,
  ArtifactListInputSchema,
  ArtifactRecordSchema,
  ArtifactUpsertInputSchema,
  ClaimScopeSchema,
  DraftSyncInputSchema,
  EvidenceLevelSchema,
  FeedbackReadInputSchema,
  GithubCommentInputSchema,
  GithubCreatePrInputSchema,
  GithubIssueInputSchema,
  GithubPreparePrInputSchema,
  PolicyCheckInputSchema,
  RESEARCH_MEMORY_STATUS_HTML_PATH,
  RenderStatusHtmlInputSchema,
  ResearchMemoryStatusInputSchema,
  RiskLevelSchema,
  WriteDecisionRecordInputSchema,
  WriteExperimentCardInputSchema,
  type ArtifactIndexDocument,
  type ArtifactKind,
  type ArtifactRecord,
  type ArtifactUpsertInput,
  type ClaimScope,
  type DraftSyncInput,
  type EvidenceLevel,
  type FeedbackReadInput,
  type GithubCommentInput,
  type GithubCreatePrInput,
  type GithubIssueInput,
  type GithubPreparePrInput,
  type PolicyCheckInput,
  type PolicyCheckResult,
  type PolicyFinding,
  type RenderStatusHtmlInput,
  type ResearchMemoryErrorCode,
  type ResearchMemoryFailure,
  type ResearchMemoryStatusInput,
  type ResearchMemoryToolName,
  type RiskLevel,
  type WriteDecisionRecordInput,
  type WriteExperimentCardInput
} from './contract.js'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as {
  load(source: string): unknown
  dump(value: unknown, options?: Record<string, unknown>): string
}

const execFileAsync = promisify(execFile)

export type ResearchMemoryCommandResult = {
  stdout: string
  stderr: string
}

export type ResearchMemoryCommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    env: Record<string, string | undefined>
  }
) => Promise<ResearchMemoryCommandResult>

export type ResearchMemoryServiceOptions = {
  workspaceRoot?: string
  memoryRoot?: string
  nowIso?: () => string
  commandRunner?: ResearchMemoryCommandRunner
  timeoutMs?: number
  env?: Record<string, string | undefined>
}

type ResolvedWorkspace = {
  root: string
  artifactIndexPath: string
}

type GithubGuardInput = {
  tool: ResearchMemoryToolName
  artifactIds: string[]
  body: string
  confirmed?: boolean
  riskAcknowledged?: boolean
  dryRun?: boolean
  preview?: boolean
  evidenceLevel?: EvidenceLevel
  claimScope?: ClaimScope
  riskLevel?: RiskLevel
}

const DEFAULT_TIMEOUT_MS = 20_000

const GITHUB_FEEDBACK_LABELS = [
  'question',
  'suggestion',
  'experiment-request',
  'decision-needed',
  'needs-student-review',
  'risk-high'
]

const ABSOLUTE_PATH_PATTERN = /(?:\/(?:Users|Applications|Volumes|private|tmp|var|home|mnt|opt)\/[^\s'"<>)]*|[A-Za-z]:\\[^\s'"<>)]*)/g
const SECRET_PATTERN = /\b(?:authorization|api[-_\s]?key|token|secret|password|bearer)\b\s*[:=]\s*[^\s,;'"<>]+|\b(?:Bearer|Bot)\s+[A-Za-z0-9._~+/=-]+/gi
const SERVER_INFO_PATTERN = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?\b/gi
const SENSITIVE_PATTERN = /\b(?:private key|ssh-rsa|BEGIN [A-Z ]*PRIVATE KEY|session cookie|access token|refresh token|raw log|checkpoint|agent trajectory)\b/gi

export class ResearchMemoryService {
  private readonly workspaceRoot?: string
  private readonly memoryRoot?: string
  private readonly nowIso: () => string
  private readonly commandRunner: ResearchMemoryCommandRunner
  private readonly timeoutMs: number
  private readonly env: Record<string, string | undefined>

  constructor(options: ResearchMemoryServiceOptions = {}) {
    this.workspaceRoot = cleanString(options.workspaceRoot)
    this.memoryRoot = cleanString(options.memoryRoot)
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.commandRunner = options.commandRunner ?? defaultCommandRunner
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.env = options.env ?? process.env
  }

  async status(input: ResearchMemoryStatusInput = {}): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = ResearchMemoryStatusInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const index = await this.readArtifactIndex(workspace)
      return {
        ok: true,
        workspaceRoot: workspace.root,
        artifactIndexPath: workspaceRelative(workspace.root, workspace.artifactIndexPath),
        artifactCount: index.artifacts.length,
        statusHtmlPath: 'status.html',
        tools: {
          mcpFirst: true,
          extensionUi: false,
          localFactSource: '.agent/artifacts.yml',
          githubIsMemoryLayer: true
        }
      }
    })
  }

  async listArtifacts(input: unknown = {}): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = ArtifactListInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const index = await this.readArtifactIndex(workspace)
      const query = parsed.data.query?.toLowerCase()
      const artifacts = index.artifacts
        .filter((artifact) => !parsed.data.ids || parsed.data.ids.includes(artifact.id))
        .filter((artifact) => !parsed.data.kind || artifact.kind === parsed.data.kind)
        .filter((artifact) => !parsed.data.evidence_level || artifact.evidence_level === parsed.data.evidence_level)
        .filter((artifact) => !parsed.data.claim_scope || artifact.claim_scope === parsed.data.claim_scope)
        .filter((artifact) => !parsed.data.risk_level || artifact.risk_level === parsed.data.risk_level)
        .filter((artifact) => !parsed.data.tag || artifact.tags.includes(parsed.data.tag))
        .filter((artifact) => !query || [
          artifact.id,
          artifact.title,
          artifact.summary,
          artifact.status ?? '',
          ...artifact.tags
        ].join('\n').toLowerCase().includes(query))
        .slice(0, parsed.data.limit ?? 500)
      return {
        ok: true,
        workspaceRoot: workspace.root,
        artifactIndexPath: workspaceRelative(workspace.root, workspace.artifactIndexPath),
        artifacts,
        count: artifacts.length
      }
    })
  }

  async getArtifact(input: unknown): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = ArtifactGetInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = await this.requireArtifact(workspace, parsed.data.id)
      return {
        ok: true,
        artifact
      }
    })
  }

  async upsertArtifact(input: ArtifactUpsertInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = ArtifactUpsertInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = normalizeArtifact(parsed.data.artifact, this.nowIso())
      const index = await this.readArtifactIndex(workspace)
      const existingIndex = index.artifacts.findIndex((item) => item.id === artifact.id)
      const existing = existingIndex >= 0 ? index.artifacts[existingIndex] : undefined
      const nextArtifact = {
        ...artifact,
        created_at: existing?.created_at ?? artifact.created_at ?? this.nowIso(),
        updated_at: this.nowIso()
      }
      const nextIndex: ArtifactIndexDocument = {
        version: 1,
        artifacts: existingIndex >= 0
          ? index.artifacts.map((item, itemIndex) => itemIndex === existingIndex ? nextArtifact : item)
          : [...index.artifacts, nextArtifact]
      }
      const preview = parsed.data.dry_run === true || parsed.data.preview === true
      if (!preview) await this.writeArtifactIndex(workspace, nextIndex)
      return {
        ok: true,
        dryRun: parsed.data.dry_run === true,
        preview,
        wouldWrite: true,
        wrote: !preview,
        artifact: nextArtifact,
        artifactIndexPath: workspaceRelative(workspace.root, workspace.artifactIndexPath)
      }
    })
  }

  async policyCheck(input: PolicyCheckInput): Promise<PolicyCheckResult> {
    const parsed = PolicyCheckInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const textParts: string[] = []
      if (parsed.data.text) textParts.push(parsed.data.text)
      if (parsed.data.artifact) textParts.push(artifactPolicyText(parsed.data.artifact))
      if (parsed.data.artifact_ids?.length) {
        for (const id of parsed.data.artifact_ids) {
          textParts.push(artifactPolicyText(await this.requireArtifact(workspace, id)))
        }
      }
      const text = textParts.join('\n\n')
      const findings = policyFindings(text, {
        workspaceRoot: workspace.root,
        evidenceLevel: parsed.data.evidence_level ?? parsed.data.artifact?.evidence_level,
        claimScope: parsed.data.claim_scope ?? parsed.data.artifact?.claim_scope,
        riskLevel: parsed.data.risk_level ?? parsed.data.artifact?.risk_level,
        target: parsed.data.target
      })
      const sanitizedText = sanitizeGithubText(text, workspace.root)
      const requiresConfirmation = findings.some((finding) => finding.severity === 'medium' || finding.severity === 'high')
      return {
        ok: true,
        allowed: parsed.data.target === 'local'
          ? !findings.some((finding) => finding.severity === 'high' && finding.code === 'secret')
          : !findings.some((finding) => finding.severity === 'high'),
        target: parsed.data.target,
        findings,
        sanitizedText,
        requiresConfirmation
      }
    }) as Promise<PolicyCheckResult>
  }

  async draftSync(input: DraftSyncInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = DraftSyncInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifacts = await this.artifactsForDraft(workspace, parsed.data.artifact_id, parsed.data.artifact_ids)
      const draft = renderDraft(parsed.data, artifacts, workspace.root)
      const policy = await this.policyCheck({
        workspace_root: workspace.root,
        text: draft.body,
        target: parsed.data.draft_type.startsWith('github_') ? 'github' : 'local',
        artifact_ids: artifacts.map((artifact) => artifact.id)
      })
      if (!policy.ok) return policy
      const preview = parsed.data.dry_run === true || parsed.data.preview === true
      const path = join('.agent', 'research-memory', 'drafts', `${safeTimestamp(this.nowIso())}-${parsed.data.draft_type}.md`)
      if (!preview) await this.writeWorkspaceFile(workspace.root, path, `# ${draft.title}\n\n${draft.body}\n`)
      return {
        ok: true,
        dryRun: parsed.data.dry_run === true,
        preview,
        wrote: !preview,
        path: preview ? undefined : path,
        draft,
        policy
      }
    })
  }

  async writeExperimentCard(input: WriteExperimentCardInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = WriteExperimentCardInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = await this.requireArtifact(workspace, parsed.data.artifact_id)
      const title = parsed.data.title ?? artifact.title
      const content = renderExperimentCard(artifact, parsed.data, title)
      const path = join('.agent', 'research-memory', 'experiments', `${artifact.id}.md`)
      const preview = parsed.data.dry_run === true || parsed.data.preview === true
      if (!preview) {
        await this.writeWorkspaceFile(workspace.root, path, content)
        await this.addReferenceToArtifact(workspace, artifact.id, { label: 'Experiment card', path })
      }
      return {
        ok: true,
        dryRun: parsed.data.dry_run === true,
        preview,
        wrote: !preview,
        path,
        content
      }
    })
  }

  async writeDecisionRecord(input: WriteDecisionRecordInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = WriteDecisionRecordInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = await this.requireArtifact(workspace, parsed.data.artifact_id)
      const title = parsed.data.title ?? artifact.title
      const content = renderDecisionRecord(artifact, parsed.data, title)
      const path = join('.agent', 'research-memory', 'decisions', `${artifact.id}.md`)
      const preview = parsed.data.dry_run === true || parsed.data.preview === true
      if (!preview) {
        await this.writeWorkspaceFile(workspace.root, path, content)
        await this.addReferenceToArtifact(workspace, artifact.id, { label: 'Decision record', path })
      }
      return {
        ok: true,
        dryRun: parsed.data.dry_run === true,
        preview,
        wrote: !preview,
        path,
        content
      }
    })
  }

  async renderStatusHtml(input: RenderStatusHtmlInput = {}): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = RenderStatusHtmlInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const index = await this.readArtifactIndex(workspace)
      const html = renderStatusHtml(index.artifacts, workspace.root)
      const policy = await this.policyCheck({
        workspace_root: workspace.root,
        text: html,
        target: 'github'
      })
      if (!policy.ok) return policy
      if (!policy.allowed) {
        return failure(
          'policy_violation',
          'status.html contains content that is not safe for GitHub output.',
          false,
          'Remove local paths, secrets, server details, or high-risk public claims before rendering status.html.'
        )
      }
      const outputPath = RESEARCH_MEMORY_STATUS_HTML_PATH
      const preview = parsed.data.dry_run === true || parsed.data.preview === true
      if (!preview) await this.writeWorkspaceFile(workspace.root, outputPath, html)
      return {
        ok: true,
        dryRun: parsed.data.dry_run === true,
        preview,
        wrote: !preview,
        outputPath,
        html
      }
    })
  }

  async readFeedback(input: FeedbackReadInput = {}): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = FeedbackReadInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const labels = parsed.data.labels ?? GITHUB_FEEDBACK_LABELS
      const limit = parsed.data.limit ?? 20
      const items: Array<Record<string, unknown>> = []
      const warnings: string[] = []
      if (parsed.data.include_issues !== false) {
        const issues = await this.runGhJson(workspace.root, [
          'issue',
          'list',
          '--state',
          'open',
          '--limit',
          String(limit),
          '--json',
          'number,title,labels,url,updatedAt',
          ...labelArgs(labels)
        ])
        if (issues.ok) {
          const issueItems = asArray(issues.value)
            .map((issue): Record<string, unknown> => ({ type: 'issue', ...asRecord(issue) }))
          items.push(...issueItems)
          if (parsed.data.include_comments === true) {
            for (const issue of issueItems) {
              const number = String(issue.number ?? '')
              if (!number) continue
              const comments = await this.runGhJson(workspace.root, [
                'issue',
                'view',
                number,
                '--json',
                'comments,url'
              ])
              if (comments.ok) {
                const issueUrl = asRecord(comments.value).url
                for (const comment of asArray(asRecord(comments.value).comments)) {
                  items.push({ type: 'issue_comment', issue: number, issueUrl, ...asRecord(comment) })
                }
              } else {
                warnings.push(comments.error.message)
              }
            }
          }
        }
        else warnings.push(issues.error.message)
      }
      if (parsed.data.include_prs !== false) {
        const prs = await this.runGhJson(workspace.root, [
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          String(limit),
          '--json',
          'number,title,labels,url,updatedAt',
          ...labelArgs(labels)
        ])
        if (prs.ok) {
          const prItems = asArray(prs.value)
            .map((pr): Record<string, unknown> => ({ type: 'pr', ...asRecord(pr) }))
          items.push(...prItems)
          if (parsed.data.include_comments === true || parsed.data.include_review_comments === true) {
            for (const pr of prItems) {
              const number = String(pr.number ?? '')
              if (!number) continue
              const prDetails = await this.runGhJson(workspace.root, [
                'pr',
                'view',
                number,
                '--json',
                'comments,reviews,url'
              ])
              if (prDetails.ok) {
                const prUrl = asRecord(prDetails.value).url
                if (parsed.data.include_comments === true) {
                  for (const comment of asArray(asRecord(prDetails.value).comments)) {
                    items.push({ type: 'pr_comment', pr: number, prUrl, ...asRecord(comment) })
                  }
                }
                if (parsed.data.include_review_comments === true) {
                  for (const review of asArray(asRecord(prDetails.value).reviews)) {
                    items.push({ type: 'pr_review_comment', pr: number, prUrl, ...asRecord(review) })
                  }
                }
              } else {
                warnings.push(prDetails.error.message)
              }
            }
          }
        }
        else warnings.push(prs.error.message)
      }
      if (parsed.data.include_mentions === true) {
        const mentions = await this.runGhJson(workspace.root, [
          'api',
          'notifications',
          '--jq',
          '[.[] | select(.reason == "mention")]'
        ])
        if (mentions.ok) items.push(...asArray(mentions.value).map((mention) => ({ type: 'mention', ...asRecord(mention) })))
        else warnings.push(mentions.error.message)
      }
      return {
        ok: true,
        labels,
        count: items.length,
        items: items.slice(0, limit),
        warnings
      }
    })
  }

  async createIssue(input: GithubIssueInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = GithubIssueInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = await this.requireArtifact(workspace, parsed.data.artifact_id)
      const body = ensureGithubSummaryFields(parsed.data.body ?? artifact.summary, artifact, parsed.data)
      const guard = await this.guardGithubWrite(workspace, {
        tool: 'gui_research_memory_create_issue',
        artifactIds: [artifact.id],
        body,
        confirmed: parsed.data.confirmed,
        riskAcknowledged: parsed.data.risk_acknowledged,
        dryRun: parsed.data.dry_run,
        preview: parsed.data.preview,
        evidenceLevel: parsed.data.evidence_level ?? artifact.evidence_level,
        claimScope: parsed.data.claim_scope ?? artifact.claim_scope,
        riskLevel: parsed.data.risk_level ?? artifact.risk_level
      })
      if (!guard.ok) return guard
      if (guard.preview) {
        return {
          ok: true,
          preview: true,
          wouldCreateIssue: true,
          title: parsed.data.title,
          body,
          labels: parsed.data.labels ?? []
        }
      }
      const args = [
        'issue',
        'create',
        '--title',
        parsed.data.title,
        '--body',
        body,
        ...((parsed.data.labels ?? []).flatMap((label) => ['--label', label]))
      ]
      const output = await this.runCommand('gh', args, workspace.root)
      await this.addGithubReference(workspace, artifact.id, { issue: output.stdout.trim(), url: firstUrl(output.stdout) })
      return {
        ok: true,
        issue: output.stdout.trim()
      }
    })
  }

  async createComment(input: GithubCommentInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = GithubCommentInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifact = await this.requireArtifact(workspace, parsed.data.artifact_id)
      const body = ensureGithubSummaryFields(parsed.data.body, artifact, parsed.data)
      const guard = await this.guardGithubWrite(workspace, {
        tool: 'gui_research_memory_create_comment',
        artifactIds: [artifact.id],
        body,
        confirmed: parsed.data.confirmed,
        riskAcknowledged: parsed.data.risk_acknowledged,
        dryRun: parsed.data.dry_run,
        preview: parsed.data.preview,
        evidenceLevel: parsed.data.evidence_level ?? artifact.evidence_level,
        claimScope: parsed.data.claim_scope ?? artifact.claim_scope,
        riskLevel: parsed.data.risk_level ?? artifact.risk_level
      })
      if (!guard.ok) return guard
      if (guard.preview) {
        return {
          ok: true,
          preview: true,
          wouldCreateComment: true,
          issueOrPr: parsed.data.issue_or_pr,
          body
        }
      }
      const output = await this.runCommand('gh', ['issue', 'comment', parsed.data.issue_or_pr, '--body', body], workspace.root)
      await this.addGithubReference(workspace, artifact.id, { comment: parsed.data.issue_or_pr, url: firstUrl(output.stdout) })
      return {
        ok: true,
        comment: output.stdout.trim()
      }
    })
  }

  async preparePr(input: GithubPreparePrInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = GithubPreparePrInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifactIds = parsed.data.artifact_ids ?? (await this.readArtifactIndex(workspace)).artifacts.map((artifact) => artifact.id)
      const artifacts = await this.artifactsForDraft(workspace, undefined, artifactIds)
      const title = parsed.data.title ?? `Update research memory for ${artifactIds.join(', ')}`
      const body = ensurePrBody(parsed.data.body, artifacts, parsed.data)
      const guard = await this.guardGithubWrite(workspace, {
        tool: 'gui_research_memory_prepare_pr',
        artifactIds,
        body,
        confirmed: parsed.data.confirmed,
        riskAcknowledged: parsed.data.risk_acknowledged,
        dryRun: parsed.data.dry_run,
        preview: parsed.data.preview,
        evidenceLevel: parsed.data.evidence_level,
        claimScope: parsed.data.claim_scope,
        riskLevel: parsed.data.risk_level
      })
      if (!guard.ok) return guard
      const files = parsed.data.files ?? ['.agent/artifacts.yml', '.agent/research-memory', 'status.html']
      const branch = parsed.data.branch ?? `research-memory/${safeTimestamp(this.nowIso())}`
      if (guard.preview) {
        return {
          ok: true,
          preview: true,
          wouldCreateBranch: branch,
          wouldCommitFiles: files,
          title,
          body
        }
      }
      await this.runCommand('git', ['check-ref-format', '--branch', branch], workspace.root)
      await this.runCommand('git', ['switch', '-c', branch], workspace.root)
      await this.runCommand('git', ['add', '--', ...files], workspace.root)
      await this.runCommand('git', ['commit', '-m', title], workspace.root)
      return {
        ok: true,
        branch,
        committedFiles: files,
        title,
        body
      }
    })
  }

  async createPr(input: GithubCreatePrInput): Promise<Record<string, unknown> | ResearchMemoryFailure> {
    const parsed = GithubCreatePrInputSchema.safeParse(input)
    if (!parsed.success) return invalidRequest(parsed.error.message)
    return this.capture(async () => {
      const workspace = await this.resolveWorkspace(parsed.data.workspace_root)
      const artifacts = await this.artifactsForDraft(workspace, undefined, parsed.data.artifact_ids)
      const body = ensurePrBody(parsed.data.body, artifacts, parsed.data)
      const guard = await this.guardGithubWrite(workspace, {
        tool: 'gui_research_memory_create_pr',
        artifactIds: artifacts.map((artifact) => artifact.id),
        body,
        confirmed: parsed.data.confirmed,
        riskAcknowledged: parsed.data.risk_acknowledged,
        dryRun: parsed.data.dry_run,
        preview: parsed.data.preview,
        evidenceLevel: parsed.data.evidence_level,
        claimScope: parsed.data.claim_scope,
        riskLevel: parsed.data.risk_level
      })
      if (!guard.ok) return guard
      const args = [
        'pr',
        'create',
        '--title',
        parsed.data.title,
        '--body',
        body,
        ...(parsed.data.base ? ['--base', parsed.data.base] : []),
        ...(parsed.data.head ? ['--head', parsed.data.head] : []),
        ...(parsed.data.draft ? ['--draft'] : [])
      ]
      if (guard.preview) {
        return {
          ok: true,
          preview: true,
          wouldCreatePr: true,
          args,
          body
        }
      }
      const output = await this.runCommand('gh', args, workspace.root)
      const url = firstUrl(output.stdout) || output.stdout.trim()
      for (const artifact of artifacts) {
        await this.addGithubReference(workspace, artifact.id, { pr: url, url })
      }
      return {
        ok: true,
        pr: url
      }
    })
  }

  private async guardGithubWrite(
    workspace: ResolvedWorkspace,
    input: GithubGuardInput
  ): Promise<{ ok: true; preview: boolean } | ResearchMemoryFailure> {
    const preview = input.dryRun === true || input.preview === true
    const policy = await this.policyCheck({
      workspace_root: workspace.root,
      text: input.body,
      target: 'github',
      artifact_ids: input.artifactIds.length > 0 ? input.artifactIds : undefined,
      evidence_level: input.evidenceLevel,
      claim_scope: input.claimScope,
      risk_level: input.riskLevel
    })
    if (!policy.ok) return policy
    const highRisk = policy.requiresConfirmation ||
      input.evidenceLevel === 'validated' ||
      input.claimScope === 'public-claim' ||
      input.riskLevel === 'medium' ||
      input.riskLevel === 'high'
    if (preview) return { ok: true, preview: true }
    const blockingFinding = policy.findings.find((finding) =>
      finding.code === 'local_absolute_path' ||
      finding.code === 'secret'
    )
    if (blockingFinding) {
      return failure(
        'policy_violation',
        blockingFinding.message,
        false,
        'Remove local absolute paths and secrets before writing to GitHub.'
      )
    }
    if (input.confirmed !== true) {
      return confirmationRequired(input.tool, 'GitHub write tools require explicit confirmed: true.', ['confirmed'])
    }
    if (highRisk && input.riskAcknowledged !== true) {
      return confirmationRequired(
        input.tool,
        'Medium/high risk content, validated evidence, public claims, or policy findings require explicit risk acknowledgement.',
        ['confirmed', 'risk_acknowledged']
      )
    }
    if (!policy.allowed && input.riskAcknowledged !== true) {
      return failure(
        'policy_violation',
        'GitHub output failed policy checks.',
        false,
        'Remove local paths, secrets, server details, or sensitive information before writing to GitHub.'
      )
    }
    return { ok: true, preview: false }
  }

  private async artifactsForDraft(
    workspace: ResolvedWorkspace,
    artifactId?: string,
    artifactIds?: string[]
  ): Promise<ArtifactRecord[]> {
    const ids = artifactIds ?? (artifactId ? [artifactId] : [])
    if (ids.length > 0) {
      const artifacts: ArtifactRecord[] = []
      for (const id of ids) artifacts.push(await this.requireArtifact(workspace, id))
      return artifacts
    }
    return (await this.readArtifactIndex(workspace)).artifacts
  }

  private async requireArtifact(workspace: ResolvedWorkspace, id: string): Promise<ArtifactRecord> {
    const index = await this.readArtifactIndex(workspace)
    const artifact = index.artifacts.find((item) => item.id === id)
    if (!artifact) {
      throw serviceError('artifact_not_found', `Artifact not found: ${id}`, false, 'Create or upsert the artifact before referencing it.')
    }
    return artifact
  }

  private async addReferenceToArtifact(
    workspace: ResolvedWorkspace,
    artifactId: string,
    reference: ArtifactRecord['references'][number]
  ): Promise<void> {
    const index = await this.readArtifactIndex(workspace)
    const artifacts = index.artifacts.map((artifact) => {
      if (artifact.id !== artifactId) return artifact
      if (artifact.references.some((item) => item.path === reference.path && item.label === reference.label)) return artifact
      return {
        ...artifact,
        references: [...artifact.references, reference],
        updated_at: this.nowIso()
      }
    })
    await this.writeArtifactIndex(workspace, { version: 1, artifacts })
  }

  private async addGithubReference(
    workspace: ResolvedWorkspace,
    artifactId: string,
    github: NonNullable<ArtifactRecord['github']>
  ): Promise<void> {
    const index = await this.readArtifactIndex(workspace)
    const artifacts = index.artifacts.map((artifact) => artifact.id === artifactId
      ? {
          ...artifact,
          github: { ...(artifact.github ?? {}), ...compactObject(github) },
          updated_at: this.nowIso()
        }
      : artifact)
    await this.writeArtifactIndex(workspace, { version: 1, artifacts })
  }

  private async readArtifactIndex(workspace: ResolvedWorkspace): Promise<ArtifactIndexDocument> {
    const raw = await readFile(workspace.artifactIndexPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return ''
      throw serviceError('read_failed', `Unable to read .agent/artifacts.yml: ${error.message}`, false, 'Check file permissions.')
    })
    if (!raw.trim()) return { version: 1, artifacts: [] }
    const loaded = yaml.load(raw)
    const record = asRecord(loaded)
    const artifacts = asArray(record.artifacts)
      .map((item) => ArtifactRecordSchema.safeParse(item))
      .filter((result) => result.success)
      .map((result) => normalizeArtifact(result.data, this.nowIso()))
      .sort((left, right) => left.id.localeCompare(right.id))
    return { version: 1, artifacts }
  }

  private async writeArtifactIndex(workspace: ResolvedWorkspace, index: ArtifactIndexDocument): Promise<void> {
    await mkdir(dirname(workspace.artifactIndexPath), { recursive: true })
    const normalized: ArtifactIndexDocument = {
      version: 1,
      artifacts: [...index.artifacts].map((artifact) => normalizeArtifact(artifact, this.nowIso()))
        .sort((left, right) => left.id.localeCompare(right.id))
    }
    const text = yaml.dump(normalized, {
      lineWidth: 120,
      noRefs: true,
      sortKeys: false
    })
    await writeFile(workspace.artifactIndexPath, text, 'utf8').catch((error: Error) => {
      throw serviceError('write_failed', `Unable to write .agent/artifacts.yml: ${error.message}`, false, 'Check file permissions.')
    })
  }

  private async writeWorkspaceFile(workspaceRoot: string, relativePath: string, content: string): Promise<void> {
    const path = resolveWorkspaceRelativePath(workspaceRoot, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf8').catch((error: Error) => {
      throw serviceError('write_failed', `Unable to write ${relativePath}: ${error.message}`, false, 'Check file permissions.')
    })
  }

  private async resolveWorkspace(workspaceRoot?: string): Promise<ResolvedWorkspace> {
    const root = cleanString(workspaceRoot) ?? this.memoryRoot ?? this.workspaceRoot ?? cleanString(process.cwd())
    if (!root) {
      throw serviceError('workspace_root_required', 'A workspace root is required.', false, 'Pass workspace_root or configure the MCP launch with --workspace-root.')
    }
    const resolved = resolve(root)
    const stats = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw serviceError('workspace_root_not_found', `Workspace root does not exist: ${root}`, false, 'Choose an existing workspace directory.')
      }
      throw error
    })
    if (!stats.isDirectory()) {
      throw serviceError('workspace_root_not_found', `Workspace root is not a directory: ${root}`, false, 'Choose an existing workspace directory.')
    }
    return {
      root: resolved,
      artifactIndexPath: join(resolved, '.agent', 'artifacts.yml')
    }
  }

  private async runGhJson(cwd: string, args: string[]): Promise<{ ok: true; value: unknown } | ResearchMemoryFailure> {
    try {
      const result = await this.runCommand('gh', args, cwd)
      const output = result.stdout.trim()
      if (!output) return { ok: true, value: [] }
      return { ok: true, value: JSON.parse(output) as unknown }
    } catch (error) {
      return commandFailure(error, 'github_unavailable')
    }
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<ResearchMemoryCommandResult> {
    try {
      return await this.commandRunner(command, args, {
        cwd,
        timeoutMs: this.timeoutMs,
        env: this.env
      })
    } catch (error) {
      throw serviceError(command === 'gh' ? 'github_unavailable' : 'command_failed', commandErrorText(error), true, `Ensure ${command} is installed and authenticated, then retry.`)
    }
  }

  private async capture<T>(fn: () => Promise<T>): Promise<T | ResearchMemoryFailure> {
    try {
      return await fn()
    } catch (error) {
      if (isServiceError(error)) return failure(error.code, error.message, error.retryable, error.suggestedFix)
      return failure('read_failed', error instanceof Error ? error.message : String(error), false, 'Inspect the workspace and retry.')
    }
  }
}

export function createResearchMemoryService(options: ResearchMemoryServiceOptions = {}): ResearchMemoryService {
  return new ResearchMemoryService(options)
}

export function researchMemoryConfigFromEnv(env: Record<string, string | undefined> = process.env): ResearchMemoryServiceOptions {
  return {
    workspaceRoot: cleanString(env.SCIFORGE_RESEARCH_MEMORY_WORKSPACE_ROOT ?? env.GUI_RESEARCH_MEMORY_WORKSPACE_ROOT),
    memoryRoot: cleanString(env.SCIFORGE_RESEARCH_MEMORY_ROOT ?? env.GUI_RESEARCH_MEMORY_ROOT),
    timeoutMs: parsePositiveInt(env.SCIFORGE_RESEARCH_MEMORY_TIMEOUT_MS ?? env.GUI_RESEARCH_MEMORY_TIMEOUT_MS)
  }
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    env: Record<string, string | undefined>
  }
): Promise<ResearchMemoryCommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...options.env, LC_ALL: 'C', LANG: 'C', GIT_OPTIONAL_LOCKS: '0' }
  })
  return {
    stdout: String(stdout),
    stderr: String(stderr)
  }
}

function normalizeArtifact(input: ArtifactRecord, nowIso: string): ArtifactRecord {
  const parsed = ArtifactRecordSchema.parse({
    ...input,
    kind: input.kind ?? kindFromArtifactId(input.id),
    evidence_level: input.evidence_level ?? 'observation',
    claim_scope: input.claim_scope ?? 'local-note',
    risk_level: input.risk_level ?? 'low',
    references: input.references ?? [],
    tags: uniqueStrings(input.tags ?? []),
    created_at: input.created_at ?? nowIso,
    updated_at: input.updated_at ?? nowIso
  })
  return parsed
}

function kindFromArtifactId(id: string): ArtifactKind {
  const prefix = ArtifactIdSchema.parse(id).split('-', 1)[0]
  switch (prefix) {
    case 'HYP': return 'hypothesis'
    case 'EXP': return 'experiment'
    case 'RUN': return 'run'
    case 'DEC': return 'decision'
    case 'DOC': return 'document'
    case 'ART': return 'artifact'
    default: return 'artifact'
  }
}

function policyFindings(text: string, options: {
  workspaceRoot: string
  evidenceLevel?: EvidenceLevel
  claimScope?: ClaimScope
  riskLevel?: RiskLevel
  target: 'local' | 'github'
}): PolicyFinding[] {
  const findings: PolicyFinding[] = []
  const workspaceRoot = options.workspaceRoot
  const sensitiveValues = uniqueStrings([workspaceRoot, homedir()].filter(Boolean))
  for (const value of sensitiveValues) {
    if (value && text.includes(value)) {
      findings.push({
        code: 'local_absolute_path',
        severity: 'high',
        message: 'GitHub output must not include a local absolute path.',
        excerpt: value
      })
    }
  }
  collectMatches(text, ABSOLUTE_PATH_PATTERN, (match) => ({
    code: 'local_absolute_path',
    severity: 'high',
    message: 'GitHub output must not include local absolute paths.',
    excerpt: match
  }), findings)
  collectMatches(text, SECRET_PATTERN, (match) => ({
    code: 'secret',
    severity: 'high',
    message: 'Secret-like content must not be synchronized.',
    excerpt: match.slice(0, 120)
  }), findings)
  collectMatches(text, SERVER_INFO_PATTERN, (match) => ({
    code: 'server_info',
    severity: 'medium',
    message: 'Server or private network details require review before GitHub sync.',
    excerpt: match
  }), findings)
  collectMatches(text, SENSITIVE_PATTERN, (match) => ({
    code: 'sensitive_info',
    severity: 'medium',
    message: 'Sensitive research operation details require review before GitHub sync.',
    excerpt: match.slice(0, 120)
  }), findings)
  if (options.target === 'github' && (
    options.evidenceLevel === 'validated' ||
    options.claimScope === 'public-claim' ||
    options.riskLevel === 'medium' ||
    options.riskLevel === 'high'
  )) {
    findings.push({
      code: 'high_risk_claim',
      severity: options.riskLevel === 'high' || options.claimScope === 'public-claim' ? 'high' : 'medium',
      message: 'Validated evidence, public claims, and medium/high risk content require human confirmation before GitHub sync.'
    })
  }
  return dedupeFindings(findings)
}

function collectMatches(
  text: string,
  pattern: RegExp,
  create: (match: string) => PolicyFinding,
  findings: PolicyFinding[]
): void {
  pattern.lastIndex = 0
  for (const match of text.matchAll(pattern)) {
    if (match[0]) findings.push(create(match[0]))
  }
}

function sanitizeGithubText(text: string, workspaceRoot: string): string {
  return text
    .replaceAll(workspaceRoot, '<workspace>')
    .replaceAll(homedir(), '<home>')
    .replace(ABSOLUTE_PATH_PATTERN, '<local-path>')
    .replace(SECRET_PATTERN, '<redacted-secret>')
    .replace(SERVER_INFO_PATTERN, '<server>')
}

function renderDraft(input: DraftSyncInput, artifacts: ArtifactRecord[], workspaceRoot: string): { title: string; body: string } {
  const title = input.title ?? defaultDraftTitle(input.draft_type, artifacts)
  const artifactLines = artifacts.map((artifact) => [
    `- Artifact ID: ${artifact.id}`,
    `  Evidence level: ${artifact.evidence_level}`,
    `  Claim scope: ${artifact.claim_scope}`,
    `  Risk level: ${artifact.risk_level}`,
    `  Summary: ${sanitizeGithubText(artifact.summary, workspaceRoot)}`
  ].join('\n')).join('\n')
  const body = input.body ?? [
    `Artifact ID: ${artifacts.map((artifact) => artifact.id).join(', ') || 'N/A'}`,
    `Evidence level: ${dominantEvidenceLevel(artifacts)}`,
    '',
    '## Summary',
    artifactLines || 'No artifact selected.',
    '',
    '## Review Checklist',
    '- [ ] Artifact ID is present.',
    '- [ ] Evidence level is present.',
    '- [ ] Medium/high risk or public claims have explicit human confirmation.',
    '- [ ] status.html is generated by MCP, not hand-authored.'
  ].join('\n')
  return { title, body: sanitizeGithubText(body, workspaceRoot) }
}

function defaultDraftTitle(type: DraftSyncInput['draft_type'], artifacts: ArtifactRecord[]): string {
  const suffix = artifacts.length > 0 ? artifacts.map((artifact) => artifact.id).join(', ') : 'research memory'
  return `${type.replace(/_/g, ' ')} draft for ${suffix}`
}

function renderExperimentCard(
  artifact: ArtifactRecord,
  input: WriteExperimentCardInput,
  title: string
): string {
  return [
    `# Experiment Card: ${title}`,
    '',
    `Artifact ID: ${artifact.id}`,
    `Evidence level: ${artifact.evidence_level}`,
    `Claim scope: ${artifact.claim_scope}`,
    `Risk level: ${artifact.risk_level}`,
    '',
    '## Objective',
    input.objective || artifact.summary,
    '',
    '## Method',
    input.method || 'TBD',
    '',
    '## Result',
    input.result || artifact.summary,
    '',
    '## Next Steps',
    ...(input.next_steps?.length ? input.next_steps.map((step) => `- ${step}`) : ['- TBD'])
  ].join('\n')
}

function renderDecisionRecord(
  artifact: ArtifactRecord,
  input: WriteDecisionRecordInput,
  title: string
): string {
  return [
    `# Decision Record: ${title}`,
    '',
    `Artifact ID: ${artifact.id}`,
    `Evidence level: ${artifact.evidence_level}`,
    `Claim scope: ${artifact.claim_scope}`,
    `Risk level: ${artifact.risk_level}`,
    '',
    '## Context',
    input.context || artifact.summary,
    '',
    '## Decision',
    input.decision || 'TBD',
    '',
    '## Consequences',
    input.consequences || 'TBD'
  ].join('\n')
}

function renderStatusHtml(artifacts: ArtifactRecord[], workspaceRoot: string): string {
  const rows = artifacts.map((artifact) => [
    '<tr>',
    `<td>${escapeHtml(artifact.id)}</td>`,
    `<td>${escapeHtml(artifact.title)}</td>`,
    `<td>${escapeHtml(artifact.evidence_level)}</td>`,
    `<td>${escapeHtml(artifact.claim_scope)}</td>`,
    `<td>${escapeHtml(artifact.risk_level)}</td>`,
    `<td>${escapeHtml(sanitizeGithubText(artifact.summary, workspaceRoot))}</td>`,
    '</tr>'
  ].join('')).join('\n')
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Research Memory Status</title>',
    '<style>',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#111827;background:#ffffff;}',
    'h1{font-size:28px;margin:0 0 8px;}',
    'p{color:#4b5563;}',
    'table{border-collapse:collapse;width:100%;font-size:14px;}',
    'th,td{border:1px solid #d1d5db;padding:8px;text-align:left;vertical-align:top;}',
    'th{background:#f3f4f6;}',
    '</style>',
    '</head>',
    '<body>',
    '<h1>Research Memory Status</h1>',
    '<p>Generated by SciForge Research Memory MCP. Local workspace and .agent/artifacts.yml remain the fact source.</p>',
    '<table>',
    '<thead><tr><th>Artifact ID</th><th>Title</th><th>Evidence</th><th>Claim Scope</th><th>Risk</th><th>Summary</th></tr></thead>',
    `<tbody>${rows || '<tr><td colspan="6">No artifacts recorded.</td></tr>'}</tbody>`,
    '</table>',
    '</body>',
    '</html>',
    ''
  ].join('\n')
}

function ensureGithubSummaryFields(
  body: string,
  artifact: ArtifactRecord,
  input: {
    evidence_level?: EvidenceLevel
    claim_scope?: ClaimScope
    risk_level?: RiskLevel
  }
): string {
  const evidenceLevel = EvidenceLevelSchema.parse(input.evidence_level ?? artifact.evidence_level)
  const claimScope = ClaimScopeSchema.parse(input.claim_scope ?? artifact.claim_scope)
  const riskLevel = RiskLevelSchema.parse(input.risk_level ?? artifact.risk_level)
  const header = [
    `Artifact ID: ${artifact.id}`,
    `Evidence level: ${evidenceLevel}`,
    `Claim scope: ${claimScope}`,
    `Risk level: ${riskLevel}`
  ].join('\n')
  const hasArtifact = body.includes(`Artifact ID: ${artifact.id}`)
  const hasEvidence = /Evidence level:/i.test(body)
  return [hasArtifact && hasEvidence ? '' : header, body].filter(Boolean).join('\n\n')
}

function ensurePrBody(
  body: string | undefined,
  artifacts: ArtifactRecord[],
  input: {
    evidence_level?: EvidenceLevel
    claim_scope?: ClaimScope
    risk_level?: RiskLevel
  }
): string {
  const artifactLines = artifacts.map((artifact) => {
    const evidenceLevel = input.evidence_level ?? artifact.evidence_level
    const claimScope = input.claim_scope ?? artifact.claim_scope
    const riskLevel = input.risk_level ?? artifact.risk_level
    return `- Artifact ID: ${artifact.id}; evidence level: ${evidenceLevel}; claim scope: ${claimScope}; risk level: ${riskLevel}`
  }).join('\n')
  return [
    body?.trim() || 'Research memory update prepared by SciForge Research Memory MCP.',
    '',
    '## Artifacts',
    artifactLines || '- Artifact ID: N/A; evidence level: observation; claim scope: local-note; risk level: low',
    '',
    '## Checklist',
    '- [ ] Artifact ID is included for every GitHub-facing summary.',
    '- [ ] Evidence level is included for every GitHub-facing summary.',
    '- [ ] Medium/high risk, validated evidence, and public claims have explicit human confirmation.',
    '- [ ] status.html was generated by MCP.',
    '- [ ] GitHub PR carries review; status.html is only a generated status view.'
  ].join('\n')
}

function artifactPolicyText(artifact: ArtifactRecord): string {
  return [
    artifact.id,
    artifact.title,
    artifact.summary,
    artifact.evidence_level,
    artifact.claim_scope,
    artifact.risk_level,
    JSON.stringify(artifact.references),
    JSON.stringify(artifact.github)
  ].join('\n')
}

function resolveWorkspaceRelativePath(workspaceRoot: string, path: string): string {
  if (isAbsolute(path)) {
    throw serviceError('invalid_request', 'Workspace output paths must be relative.', false, 'Use a repository-relative path such as status.html.')
  }
  const resolved = resolve(workspaceRoot, path)
  const rel = relative(workspaceRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw serviceError('invalid_request', `Path escapes workspace: ${path}`, false, 'Choose a path inside the workspace.')
  }
  return resolved
}

function workspaceRelative(workspaceRoot: string, path: string): string {
  const rel = relative(workspaceRoot, path)
  return rel || basename(path)
}

function labelArgs(labels: readonly string[]): string[] {
  return labels.flatMap((label) => ['--label', label])
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== '')) as Partial<T>
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function dominantEvidenceLevel(artifacts: ArtifactRecord[]): EvidenceLevel {
  if (artifacts.some((artifact) => artifact.evidence_level === 'validated')) return 'validated'
  if (artifacts.some((artifact) => artifact.evidence_level === 'reproduced')) return 'reproduced'
  if (artifacts.some((artifact) => artifact.evidence_level === 'preliminary')) return 'preliminary'
  return 'observation'
}

function safeTimestamp(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/\S+/)?.[0]
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function dedupeFindings(findings: PolicyFinding[]): PolicyFinding[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.severity}:${finding.excerpt ?? finding.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function commandFailure(error: unknown, code: ResearchMemoryErrorCode): ResearchMemoryFailure {
  return failure(code, commandErrorText(error), true, 'Ensure the command is installed, authenticated, and run from a GitHub repository.')
}

function commandErrorText(error: unknown): string {
  const details: string[] = []
  if (error instanceof Error) details.push(error.message)
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === 'string') details.push(stderr)
  if (Buffer.isBuffer(stderr)) details.push(stderr.toString('utf8'))
  return details.filter(Boolean).join('\n') || String(error)
}

function invalidRequest(message: string): ResearchMemoryFailure {
  return failure('invalid_request', message, false, 'Fix the input parameters and retry.')
}

function confirmationRequired(
  tool: ResearchMemoryToolName,
  reason: string,
  requiredFields: string[]
): ResearchMemoryFailure {
  return failure('confirmation_required', reason, false, 'Show the draft to the user and retry only after explicit confirmation.', {
    tool,
    reason,
    requiredFields
  })
}

function failure(
  code: ResearchMemoryErrorCode,
  message: string,
  retryable: boolean,
  suggestedFix: string,
  confirmationRequired?: ResearchMemoryFailure['error']['confirmationRequired']
): ResearchMemoryFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      suggestedFix,
      ...(confirmationRequired ? { confirmationRequired } : {})
    }
  }
}

type ServiceError = Error & {
  code: ResearchMemoryErrorCode
  retryable: boolean
  suggestedFix: string
}

function serviceError(
  code: ResearchMemoryErrorCode,
  message: string,
  retryable: boolean,
  suggestedFix: string
): ServiceError {
  return Object.assign(new Error(message), { code, retryable, suggestedFix })
}

function isServiceError(error: unknown): error is ServiceError {
  return error instanceof Error && typeof (error as ServiceError).code === 'string'
}
