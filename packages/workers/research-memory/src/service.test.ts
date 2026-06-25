import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'

import { ArtifactIdSchema, type ArtifactRecord } from './contract.js'
import {
  createResearchMemoryService,
  type ResearchMemoryCommandRunner
} from './service.js'

const NOW = '2026-06-25T12:00:00.000Z'

test('upserts, lists, and gets artifacts through .agent/artifacts.yml', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-artifacts-')
  const service = createResearchMemoryService({
    workspaceRoot,
    nowIso: () => NOW
  })

  const upsert = await service.upsertArtifact({
    artifact: artifact('EXP-upsert-list-get', {
      title: 'Upsert/list/get experiment',
      tags: ['memory', 'upsert']
    })
  })

  assert.equal(upsert.ok, true)
  assert.equal(upsert.wrote, true)
  assert.equal(upsert.artifactIndexPath, '.agent/artifacts.yml')

  const indexText = await readFile(join(workspaceRoot, '.agent', 'artifacts.yml'), 'utf8')
  assert.match(indexText, /version: 1/)
  assert.match(indexText, /EXP-upsert-list-get/)
  assert.match(indexText, /Upsert\/list\/get experiment/)

  const list = await service.listArtifacts({ tag: 'memory' })
  assert.equal(list.ok, true)
  assert.equal(list.count, 1)
  assert.equal((list.artifacts as Array<{ id: string }>)[0]?.id, 'EXP-upsert-list-get')

  const get = await service.getArtifact({ id: 'EXP-upsert-list-get' })
  assert.equal(get.ok, true)
  assert.equal((get.artifact as { kind: string }).kind, 'experiment')
})

test('enforces artifact ID rules', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-id-rules-')
  const service = createResearchMemoryService({ workspaceRoot })

  for (const id of ['HYP-alpha', 'EXP-alpha', 'RUN-alpha', 'DEC-alpha', 'DOC-alpha', 'ART-alpha']) {
    assert.equal(ArtifactIdSchema.safeParse(id).success, true, id)
  }

  for (const id of ['BAD-alpha', 'EXP', 'EXP-', 'EXP alpha', 'EXP/alpha']) {
    assert.equal(ArtifactIdSchema.safeParse(id).success, false, id)
  }

  const invalid = await service.upsertArtifact({
    artifact: artifact('BAD-alpha')
  })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'invalid_request')

  await assert.rejects(access(join(workspaceRoot, '.agent', 'artifacts.yml')))
})

test('policy check detects local paths, secrets, server info, and high-risk public claims', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-policy-')
  const service = createResearchMemoryService({ workspaceRoot })

  const result = await service.policyCheck({
    text: [
      `Workspace path ${workspaceRoot}/private-note.md`,
      'authorization: sk-test-secret',
      'local server is localhost:3000',
      'This is ready for a public claim.'
    ].join('\n'),
    target: 'github',
    evidence_level: 'validated',
    claim_scope: 'public-claim',
    risk_level: 'high'
  })

  assert.equal(result.ok, true)
  assert.equal(result.allowed, false)
  assert.equal(result.requiresConfirmation, true)
  assert.deepEqual(
    new Set(result.findings.map((finding) => finding.code)),
    new Set(['local_absolute_path', 'secret', 'server_info', 'high_risk_claim'])
  )
  assert.match(result.sanitizedText ?? '', /<workspace>/)
  assert.match(result.sanitizedText ?? '', /<redacted-secret>/)
  assert.match(result.sanitizedText ?? '', /<server>/)
})

test('writes experiment cards, decision records, and status.html with dry-run support', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-local-writes-')
  const service = createResearchMemoryService({
    workspaceRoot,
    nowIso: () => NOW
  })
  await service.upsertArtifact({
    artifact: artifact('EXP-local-write', {
      title: 'Local write coverage',
      summary: 'A local low-risk artifact for generated Research Memory files.'
    })
  })

  const experimentDryRun = await service.writeExperimentCard({
    artifact_id: 'EXP-local-write',
    objective: 'Check dry-run rendering.',
    dry_run: true
  })
  assert.equal(experimentDryRun.ok, true)
  assert.equal(experimentDryRun.preview, true)
  assert.equal(experimentDryRun.wrote, false)
  await assert.rejects(stat(join(workspaceRoot, '.agent', 'research-memory', 'experiments', 'EXP-local-write.md')))

  const experimentWrite = await service.writeExperimentCard({
    artifact_id: 'EXP-local-write',
    result: 'The experiment card was written.',
    next_steps: ['Review the generated card.']
  })
  assert.equal(experimentWrite.ok, true)
  assert.equal(experimentWrite.wrote, true)
  assert.match(
    await readFile(join(workspaceRoot, '.agent', 'research-memory', 'experiments', 'EXP-local-write.md'), 'utf8'),
    /Experiment Card: Local write coverage/
  )

  const decisionDryRun = await service.writeDecisionRecord({
    artifact_id: 'EXP-local-write',
    decision: 'Keep the current behavior.',
    dry_run: true
  })
  assert.equal(decisionDryRun.ok, true)
  assert.equal(decisionDryRun.preview, true)

  const decisionWrite = await service.writeDecisionRecord({
    artifact_id: 'EXP-local-write',
    context: 'The service needs a decision record.',
    decision: 'Record the decision locally.'
  })
  assert.equal(decisionWrite.ok, true)
  assert.equal(decisionWrite.wrote, true)
  assert.match(
    await readFile(join(workspaceRoot, '.agent', 'research-memory', 'decisions', 'EXP-local-write.md'), 'utf8'),
    /Decision Record: Local write coverage/
  )

  const statusDryRun = await service.renderStatusHtml({ dry_run: true })
  assert.equal(statusDryRun.ok, true)
  assert.equal(statusDryRun.preview, true)
  assert.equal(statusDryRun.wrote, false)
  await assert.rejects(stat(join(workspaceRoot, 'status.html')))

  const statusWrite = await service.renderStatusHtml({})
  assert.equal(statusWrite.ok, true)
  assert.equal(statusWrite.wrote, true)
  const statusHtml = await readFile(join(workspaceRoot, 'status.html'), 'utf8')
  assert.match(statusHtml, /Research Memory Status/)
  assert.match(statusHtml, /EXP-local-write/)

  const indexText = await readFile(join(workspaceRoot, '.agent', 'artifacts.yml'), 'utf8')
  assert.match(indexText, /Experiment card/)
  assert.match(indexText, /Decision record/)
})

test('generates draft sync content and stable status.html snapshots', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-draft-html-')
  const service = createResearchMemoryService({
    workspaceRoot,
    nowIso: () => NOW
  })
  await service.upsertArtifact({
    artifact: artifact('EXP-draft-html', {
      title: 'Draft and HTML snapshot',
      summary: 'A stable summary for draft and status rendering.',
      evidence_level: 'preliminary',
      claim_scope: 'internal-summary',
      risk_level: 'low',
      tags: ['draft']
    })
  })

  const draft = await service.draftSync({
    artifact_id: 'EXP-draft-html',
    draft_type: 'github_pr',
    preview: true
  })
  assert.equal(draft.ok, true)
  assert.equal(draft.preview, true)
  assert.match((draft.draft as { body: string }).body, /Artifact ID: EXP-draft-html/)
  assert.match((draft.draft as { body: string }).body, /Evidence level: preliminary/)
  assert.match((draft.policy as { allowed: boolean }).allowed ? 'allowed' : 'blocked', /allowed/)

  const firstHtml = await service.renderStatusHtml({ preview: true })
  const secondHtml = await service.renderStatusHtml({ preview: true })
  assert.equal(firstHtml.ok, true)
  assert.equal(secondHtml.ok, true)
  assert.equal(firstHtml.html, secondHtml.html)
  assert.match(String(firstHtml.html), /<!doctype html>/)
  assert.match(String(firstHtml.html), /<td>EXP-draft-html<\/td>/)
  assert.doesNotMatch(String(firstHtml.html), /<script/i)
  assert.doesNotMatch(String(firstHtml.html), /2026-06-25T12:00:00.000Z/)
})

test('GitHub writes support dry-run and preview, and require confirmation for real writes', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-github-')
  const calls: Array<{ command: string; args: string[] }> = []
  const commandRunner: ResearchMemoryCommandRunner = async (command, args) => {
    calls.push({ command, args })
    return { stdout: 'https://github.example/pr/1\n', stderr: '' }
  }
  const service = createResearchMemoryService({
    workspaceRoot,
    commandRunner,
    nowIso: () => NOW
  })
  await service.upsertArtifact({
    artifact: artifact('EXP-github-write', {
      summary: 'Safe GitHub body content.',
      evidence_level: 'observation',
      claim_scope: 'local-note',
      risk_level: 'low'
    })
  })

  const issueDryRun = await service.createIssue({
    artifact_id: 'EXP-github-write',
    title: 'Dry-run issue',
    dry_run: true
  })
  assert.equal(issueDryRun.ok, true)
  assert.equal(issueDryRun.preview, true)
  assert.equal(issueDryRun.wouldCreateIssue, true)

  const prPreview = await service.createPr({
    artifact_ids: ['EXP-github-write'],
    title: 'Preview PR',
    preview: true
  })
  assert.equal(prPreview.ok, true)
  assert.equal(prPreview.preview, true)
  assert.equal(prPreview.wouldCreatePr, true)

  const unconfirmed = await service.createComment({
    artifact_id: 'EXP-github-write',
    issue_or_pr: '12',
    body: 'Safe comment body for review.'
  })
  assert.equal(unconfirmed.ok, false)
  assert.equal(unconfirmed.error.code, 'confirmation_required')
  assert.deepEqual(unconfirmed.error.confirmationRequired?.requiredFields, ['confirmed'])
  assert.deepEqual(calls, [])
})

test('reads GitHub feedback with labels, comments, PR reviews, and mentions through gh', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-feedback-')
  const calls: Array<{ command: string; args: string[] }> = []
  const commandRunner: ResearchMemoryCommandRunner = async (command, args) => {
    calls.push({ command, args })
    const commandText = args.join(' ')
    if (commandText.startsWith('issue list')) {
      return {
        stdout: JSON.stringify([{
          number: 12,
          title: 'Question on experiment',
          labels: [{ name: 'question' }],
          url: 'https://github.example/issues/12',
          updatedAt: NOW
        }]),
        stderr: ''
      }
    }
    if (commandText.startsWith('issue view 12')) {
      return {
        stdout: JSON.stringify({
          url: 'https://github.example/issues/12',
          comments: [{ body: 'Please explain EXP-feedback.', author: { login: 'reviewer' } }]
        }),
        stderr: ''
      }
    }
    if (commandText.startsWith('pr list')) {
      return {
        stdout: JSON.stringify([{
          number: 5,
          title: 'Research memory PR',
          labels: [{ name: 'needs-student-review' }],
          url: 'https://github.example/pull/5',
          updatedAt: NOW
        }]),
        stderr: ''
      }
    }
    if (commandText.startsWith('pr view 5')) {
      return {
        stdout: JSON.stringify({
          url: 'https://github.example/pull/5',
          comments: [{ body: 'PR comment.' }],
          reviews: [{ body: 'Review comment.', state: 'COMMENTED' }]
        }),
        stderr: ''
      }
    }
    if (commandText.startsWith('api notifications')) {
      return {
        stdout: JSON.stringify([{ reason: 'mention', subject: { title: 'Mentioned feedback' } }]),
        stderr: ''
      }
    }
    return { stdout: '[]', stderr: '' }
  }
  const service = createResearchMemoryService({
    workspaceRoot,
    commandRunner,
    nowIso: () => NOW
  })

  const feedback = await service.readFeedback({
    labels: ['question', 'needs-student-review'],
    include_comments: true,
    include_review_comments: true,
    include_mentions: true,
    limit: 20
  })

  assert.equal(feedback.ok, true)
  assert.equal(feedback.count, 6)
  assert.deepEqual((feedback.items as Array<{ type: string }>).map((item) => item.type), [
    'issue',
    'issue_comment',
    'pr',
    'pr_comment',
    'pr_review_comment',
    'mention'
  ])
  assert.ok(calls.some((call) => call.args.includes('--label') && call.args.includes('question')))
  assert.ok(calls.some((call) => call.args.join(' ') === 'issue view 12 --json comments,url'))
  assert.ok(calls.some((call) => call.args.join(' ') === 'pr view 5 --json comments,reviews,url'))
})

test('confirmed GitHub writes run gh/git commands and update artifact GitHub references', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-github-confirmed-')
  const calls: Array<{ command: string; args: string[] }> = []
  const commandRunner: ResearchMemoryCommandRunner = async (command, args) => {
    calls.push({ command, args })
    if (command === 'gh' && args[0] === 'issue' && args[1] === 'create') {
      return { stdout: 'https://github.example/issues/22\n', stderr: '' }
    }
    if (command === 'gh' && args[0] === 'issue' && args[1] === 'comment') {
      return { stdout: 'https://github.example/issues/22#issuecomment-1\n', stderr: '' }
    }
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      return { stdout: 'https://github.example/pull/44\n', stderr: '' }
    }
    return { stdout: '', stderr: '' }
  }
  const service = createResearchMemoryService({
    workspaceRoot,
    commandRunner,
    nowIso: () => NOW
  })
  await service.upsertArtifact({
    artifact: artifact('EXP-confirmed-github', {
      title: 'Confirmed GitHub write',
      summary: 'Safe summary for confirmed GitHub writes.'
    })
  })

  const issue = await service.createIssue({
    artifact_id: 'EXP-confirmed-github',
    title: 'Confirmed issue',
    body: 'Safe confirmed issue body.',
    confirmed: true
  })
  assert.equal(issue.ok, true)
  assert.equal(issue.issue, 'https://github.example/issues/22')

  const comment = await service.createComment({
    artifact_id: 'EXP-confirmed-github',
    issue_or_pr: '22',
    body: 'Safe confirmed comment body.',
    confirmed: true
  })
  assert.equal(comment.ok, true)
  assert.equal(comment.comment, 'https://github.example/issues/22#issuecomment-1')

  const pr = await service.createPr({
    artifact_ids: ['EXP-confirmed-github'],
    title: 'Confirmed PR',
    body: 'Safe confirmed PR body.',
    confirmed: true
  })
  assert.equal(pr.ok, true)
  assert.equal(pr.pr, 'https://github.example/pull/44')

  const stored = await service.getArtifact({ id: 'EXP-confirmed-github' })
  assert.equal(stored.ok, true)
  const github = (stored.artifact as ArtifactRecord).github
  assert.equal(github?.issue, 'https://github.example/issues/22')
  assert.equal(github?.comment, '22')
  assert.equal(github?.pr, 'https://github.example/pull/44')
  assert.ok(calls.some((call) => call.command === 'gh' && call.args[0] === 'issue' && call.args[1] === 'create'))
  assert.ok(calls.some((call) => call.command === 'gh' && call.args[0] === 'issue' && call.args[1] === 'comment'))
  assert.ok(calls.some((call) => call.command === 'gh' && call.args[0] === 'pr' && call.args[1] === 'create'))
})

test('prepare PR creates branch, stages memory files, and commits after confirmation', async (t) => {
  const workspaceRoot = await makeWorkspace(t, 'research-memory-prepare-pr-')
  const calls: Array<{ command: string; args: string[] }> = []
  const commandRunner: ResearchMemoryCommandRunner = async (command, args) => {
    calls.push({ command, args })
    return { stdout: '', stderr: '' }
  }
  const service = createResearchMemoryService({
    workspaceRoot,
    commandRunner,
    nowIso: () => NOW
  })
  await service.upsertArtifact({
    artifact: artifact('EXP-prepare-pr', {
      title: 'Prepare PR',
      summary: 'Safe summary for prepare PR.'
    })
  })

  const result = await service.preparePr({
    artifact_ids: ['EXP-prepare-pr'],
    branch: 'research-memory/test-branch',
    title: 'Prepare research memory PR',
    files: ['.agent/artifacts.yml', 'status.html'],
    confirmed: true
  })

  assert.equal(result.ok, true)
  assert.equal(result.branch, 'research-memory/test-branch')
  assert.deepEqual(calls.map((call) => [call.command, ...call.args]), [
    ['git', 'check-ref-format', '--branch', 'research-memory/test-branch'],
    ['git', 'switch', '-c', 'research-memory/test-branch'],
    ['git', 'add', '--', '.agent/artifacts.yml', 'status.html'],
    ['git', 'commit', '-m', 'Prepare research memory PR']
  ])
})

test('real GitHub network adapter test is skipped by default', { skip: 'Requires a real repository and explicit GitHub credentials.' }, () => {
  // Real gh CLI network coverage is intentionally opt-in. Unit tests use a fake command runner.
})

async function makeWorkspace(t: TestContext, prefix: string): Promise<string> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), prefix))
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })
  return workspaceRoot
}

function artifact(
  id: string,
  overrides: Partial<ArtifactRecord> = {}
): ArtifactRecord {
  return {
    id,
    title: 'Research artifact',
    summary: 'A concise research memory artifact for tests.',
    evidence_level: 'observation',
    claim_scope: 'local-note',
    risk_level: 'low',
    references: [],
    tags: [],
    ...overrides
  }
}
