import { execFile, spawn } from 'node:child_process'
import type { GitHubRef, ResearchArtifact as ResearchArtifactType } from './types.js'

// ── Types ─────────────────────────────────────────────────────

export type GitHubIssueDraft = {
  title: string
  body: string
  labels?: string[]
  assignees?: string[]
  milestone?: string
}

export type GitHubIssueComment = {
  issueNumber: number
  body: string
}

export type GitHubPRDraft = {
  title: string
  body: string
  head: string
  base?: string
  draft?: boolean
}

export type GitHubSyncResult = {
  action: 'issue_created' | 'issue_commented' | 'pr_created' | 'pr_updated'
  url: string
  number: number
}

export type GitHubFeedbackItem = {
  kind: 'issue' | 'pr' | 'comment' | 'review'
  number: number
  title?: string
  body?: string
  author: string
  createdAt: string
  url: string
  labels: string[]
}

export type GitHubRepo = {
  owner: string
  repo: string
}

// ── GitHub Adapter Interface ──────────────────────────────────

export interface GitHubAdapter {
  /** Check if gh CLI is available */
  isAvailable(): Promise<boolean>

  /** Resolve owner/repo from current directory */
  resolveRepo(): Promise<GitHubRepo>

  /** Create a GitHub issue */
  createIssue(draft: GitHubIssueDraft): Promise<GitHubSyncResult>

  /** Comment on an existing issue */
  commentOnIssue(draft: GitHubIssueComment): Promise<GitHubSyncResult>

  /** Create a pull request */
  createPR(draft: GitHubPRDraft): Promise<GitHubSyncResult>

  /** List issues with optional labels */
  listIssues(labels?: string[]): Promise<GitHubFeedbackItem[]>

  /** Get issue or PR comments */
  getComments(number: number): Promise<GitHubFeedbackItem[]>

  /** List open pull requests */
  listPRs(): Promise<GitHubFeedbackItem[]>

  /** Get repo info for URL construction */
  getRepo(): Promise<GitHubRepo>

  /** Sync artifact state to GitHub (create issue/PR as appropriate) */
  syncArtifact(
    artifact: ResearchArtifactType,
    action: 'create_issue' | 'create_pr' | 'update_status',
    draftTitle?: string,
    draftBody?: string
  ): Promise<GitHubSyncResult | null>
}

// ── Implementation ────────────────────────────────────────────

export class GhCliGitHubAdapter implements GitHubAdapter {
  private resolvedRepo: GitHubRepo | null = null

  constructor(
    private readonly options: {
      cwd?: string
      ghPath?: string
    } = {}
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await this.exec(['--version'])
      return true
    } catch {
      return false
    }
  }

  async resolveRepo(): Promise<GitHubRepo> {
    if (this.resolvedRepo) return this.resolvedRepo
    const stdout = await this.exec(['repo', 'view', '--json', 'owner,name', '--jq', '.owner.login + "/" + .name'])
    const [owner, repo] = stdout.trim().split('/')
    if (!owner || !repo) throw new Error(`Could not resolve GitHub repo from: ${stdout}`)
    this.resolvedRepo = { owner, repo }
    return this.resolvedRepo
  }

  async getRepo(): Promise<GitHubRepo> {
    return this.resolveRepo()
  }

  async createIssue(draft: GitHubIssueDraft): Promise<GitHubSyncResult> {
    const repo = await this.resolveRepo()
    const args = ['issue', 'create', '--repo', `${repo.owner}/${repo.repo}`, '--title', draft.title, '--body', draft.body]
    if (draft.labels?.length) args.push('--label', draft.labels.join(','))
    if (draft.assignees?.length) args.push('--assignee', draft.assignees.join(','))
    if (draft.milestone) args.push('--milestone', draft.milestone)

    const stdout = await this.exec(args)
    const number = parseIssueNumber(stdout)
    return {
      action: 'issue_created',
      url: stdout.trim().split('\n').pop() ?? `https://github.com/${repo.owner}/${repo.repo}/issues/${number}`,
      number
    }
  }

  async commentOnIssue(draft: GitHubIssueComment): Promise<GitHubSyncResult> {
    const repo = await this.resolveRepo()
    const args = ['issue', 'comment', `${draft.issueNumber}`, '--repo', `${repo.owner}/${repo.repo}`, '--body', draft.body]
    const stdout = await this.exec(args)
    return {
      action: 'issue_commented',
      url: `https://github.com/${repo.owner}/${repo.repo}/issues/${draft.issueNumber}#issuecomment-new`,
      number: draft.issueNumber
    }
  }

  async createPR(draft: GitHubPRDraft): Promise<GitHubSyncResult> {
    const repo = await this.resolveRepo()
    const args = [
      'pr', 'create', '--repo', `${repo.owner}/${repo.repo}`,
      '--title', draft.title, '--body', draft.body,
      '--head', draft.head, '--base', draft.base ?? 'main'
    ]
    if (draft.draft) args.push('--draft')

    const stdout = await this.exec(args)
    const number = parseIssueNumber(stdout)
    return {
      action: 'pr_created',
      url: stdout.trim().split('\n').pop() ?? `https://github.com/${repo.owner}/${repo.repo}/pull/${number}`,
      number
    }
  }

  async listIssues(labels?: string[]): Promise<GitHubFeedbackItem[]> {
    const repo = await this.resolveRepo()
    const args = ['issue', 'list', '--repo', `${repo.owner}/${repo.repo}`, '--json', 'number,title,body,author,createdAt,url,labels', '--state', 'open']
    if (labels?.length) args.push('--label', labels.join(','))
    args.push('--limit', '50')

    const stdout = await this.exec(args)
    return parseJsonArray(stdout).map(parseFeedbackItem)
  }

  async getComments(number: number): Promise<GitHubFeedbackItem[]> {
    const repo = await this.resolveRepo()
    const args = ['issue', 'view', `${number}`, '--repo', `${repo.owner}/${repo.repo}`, '--json', 'comments', '--jq', '.comments']
    const stdout = await this.exec(args)
    return parseJsonArray(stdout).map((c: Record<string, unknown>) => parseFeedbackItem({
      ...c,
      number,
      kind: 'comment',
      labels: []
    }))
  }

  async listPRs(): Promise<GitHubFeedbackItem[]> {
    const repo = await this.resolveRepo()
    const args = ['pr', 'list', '--repo', `${repo.owner}/${repo.repo}`, '--json', 'number,title,body,author,createdAt,url,labels', '--state', 'open', '--limit', '30']
    const stdout = await this.exec(args)
    return parseJsonArray(stdout).map((item: Record<string, unknown>) => parseFeedbackItem({ ...item, kind: 'pr' }))
  }

  async syncArtifact(
    artifact: ResearchArtifactType,
    action: 'create_issue' | 'create_pr' | 'update_status',
    draftTitle?: string,
    draftBody?: string
  ): Promise<GitHubSyncResult | null> {
    if (artifact.visibility === 'local-only') return null

    const title = draftTitle ?? `[Artifact] ${artifact.id}: ${artifact.title}`
    const body = draftBody ?? buildArtifactBody(artifact)

    switch (action) {
      case 'create_issue':
        return this.createIssue({
          title,
          body,
          labels: [
            'agent-draft',
            `risk-${artifact.riskLevel}`,
            `evidence-${artifact.evidenceLevel}`
          ]
        })

      case 'create_pr':
        return this.createPR({
          title,
          body: `${body}\n\n## Checks\n\n- [ ] Contains artifact ID: ${artifact.id}\n- [ ] No exposed local paths, keys, or server info\n- [ ] Evidence level is reasonable\n- [ ] Claims are not overstated\n- [ ] Understandable without local context`,
          head: `research-memory/${artifact.id.toLowerCase()}`,
          draft: artifact.riskLevel === 'high'
        })

      case 'update_status':
        // Update via a new PR that modifies status.html
        return this.createPR({
          title: `Update project status: ${artifact.id} — ${artifact.title}`,
          body: `${body}\n\n---\nAuto-drafted by Research Memory Skill.\nArtifact: ${artifact.id}\nEvidence level: ${artifact.evidenceLevel}\nRisk level: ${artifact.riskLevel}`,
          head: `research-memory/status-${artifact.id.toLowerCase()}`,
          draft: artifact.riskLevel === 'high'
        })

      default:
        return null
    }
  }

  // ── private ──────────────────────────────────────────────

  private exec(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ghPath = this.options.ghPath ?? 'gh'
      const child = execFile(
        ghPath,
        args,
        {
          cwd: this.options.cwd ?? process.cwd(),
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8'
        },
        (error, stdout, stderr) => {
          if (error) {
            const msg = stderr?.trim() || error.message
            reject(new Error(`gh ${args[0]} failed: ${msg}`))
            return
          }
          resolve(stdout)
        }
      )
      if (input && child.stdin) {
        child.stdin.end(input)
      }
    })
  }
}

// ── Helpers ────────────────────────────────────────────────────

function parseIssueNumber(stdout: string): number {
  const lines = stdout.trim().split('\n')
  const lastLine = lines[lines.length - 1] ?? ''
  const match = lastLine.match(/(\d+)$/)
  if (match) return parseInt(match[1], 10)
  // Try to extract from URL
  const urlMatch = lastLine.match(/\/(\d+)$/)
  if (urlMatch) return parseInt(urlMatch[1], 10)
  return 0
}

function parseJsonArray(stdout: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(stdout)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseFeedbackItem(raw: Record<string, unknown>): GitHubFeedbackItem {
  const url = typeof raw.url === 'string' ? raw.url : ''
  const number = typeof raw.number === 'number' ? raw.number : 0
  return {
    kind: (typeof raw.kind === 'string' ? raw.kind : 'issue') as GitHubFeedbackItem['kind'],
    number,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    body: typeof raw.body === 'string' ? raw.body : undefined,
    author: typeof raw.author === 'object' && raw.author
      ? (raw.author as Record<string, unknown>).login as string ?? 'unknown'
      : 'unknown',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    url: url || `https://github.com/unknown/issues/${number}`,
    labels: Array.isArray(raw.labels)
      ? raw.labels.map((l: unknown) =>
          typeof l === 'object' && l ? (l as Record<string, unknown>).name as string ?? '' : String(l)
        ).filter(Boolean)
      : []
  }
}

function buildArtifactBody(artifact: ResearchArtifactType): string {
  return [
    `## Summary`,
    '',
    artifact.summary,
    '',
    `## Artifact Reference`,
    '',
    `- **Artifact ID:** ${artifact.id}`,
    `- **Evidence level:** ${artifact.evidenceLevel}`,
    `- **Claim scope:** ${artifact.claimScope}`,
    `- **Risk level:** ${artifact.riskLevel}`,
    `- **Status:** ${artifact.status}`,
    '',
    artifact.interpretation ? `## Interpretation\n\n${artifact.interpretation}\n` : '',
    artifact.limitations.length ? `## Limitations\n\n${artifact.limitations.map((l) => `- ${l}`).join('\n')}\n` : '',
    artifact.nextActions.length ? `## Next Actions\n\n${artifact.nextActions.map((a) => `- [ ] ${a}`).join('\n')}\n` : '',
    '---',
    `Created: ${artifact.createdAt}`,
    artifact.confirmedAt ? `Confirmed: ${artifact.confirmedAt}` : '_Awaiting confirmation_'
  ].filter(Boolean).join('\n')
}
