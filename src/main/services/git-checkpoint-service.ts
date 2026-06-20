import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentRuntimeGitCheckpoint,
  AgentRuntimeId
} from '../../shared/agent-runtime-contract'
import { resolveGitCwd, runGit } from './git-service'

export type GitCheckpointCreateInput = {
  workspaceRoot: string
  runtimeId: AgentRuntimeId
  threadId: string
  turnId?: string
}

export type GitCheckpointRestoreInput = {
  checkpointId: string
  force?: boolean
}

export type GitCheckpointResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string; details?: unknown }

type GitCheckpointMetadata = AgentRuntimeGitCheckpoint & {
  checkpointRef: string
  untrackedFiles: string[]
}

export class GitCheckpointService {
  constructor(private readonly dataDir: string) {}

  async create(input: GitCheckpointCreateInput): Promise<GitCheckpointResult<AgentRuntimeGitCheckpoint>> {
    const workspaceRoot = input.workspaceRoot.trim()
    if (!workspaceRoot) return fail('no_workspace', 'No working directory selected.')
    try {
      const repositoryRoot = await resolveRepositoryRoot(workspaceRoot)
      if (!repositoryRoot) return fail('not_git_repo', 'The working directory is not a Git repository.')
      await assertNoUnmerged(repositoryRoot)

      const checkpointId = `turn_${Date.now()}_${randomUUID()}`
      const dir = checkpointDir(this.dataDir, checkpointId)
      const ref = checkpointRef(checkpointId)
      await rm(dir, { recursive: true, force: true })
      await mkdir(join(dir, 'untracked'), { recursive: true })

      const head = (await runGit(repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      await runGit(repositoryRoot, ['update-ref', ref, head])
      const branchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
      const branch = branchRaw || null
      const diffStat = (await runGit(repositoryRoot, ['diff', '--stat'])).stdout.trim()
      const untrackedFiles = splitNul(
        (await runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
      )

      await writePatch(repositoryRoot, ['diff', '--binary'], join(dir, 'unstaged.patch'))
      await writePatch(repositoryRoot, ['diff', '--cached', '--binary'], join(dir, 'staged.patch'))
      for (const relativePath of untrackedFiles) {
        const from = join(repositoryRoot, relativePath)
        const to = join(dir, 'untracked', relativePath)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to, { recursive: true, force: true, errorOnExist: false })
      }

      const checkpoint: GitCheckpointMetadata = {
        checkpointId,
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        workspaceRoot,
        repositoryRoot,
        branch,
        head,
        checkpointRef: ref,
        createdAt: new Date().toISOString(),
        diffStat,
        status: 'available',
        untrackedFiles
      }
      await writeFile(metadataPath(this.dataDir, checkpointId), JSON.stringify(checkpoint, null, 2), 'utf8')
      return { ok: true, value: publicCheckpoint(checkpoint) }
    } catch (error) {
      return gitFailure(error)
    }
  }

  async list(input?: {
    runtimeId?: AgentRuntimeId
    threadId?: string
    workspaceRoot?: string
  }): Promise<AgentRuntimeGitCheckpoint[]> {
    const root = rootDir(this.dataDir)
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const checkpoints: AgentRuntimeGitCheckpoint[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metadata = await readMetadata(this.dataDir, entry.name)
      if (!metadata) continue
      if (input?.runtimeId && metadata.runtimeId !== input.runtimeId) continue
      if (input?.threadId && metadata.threadId !== input.threadId) continue
      if (input?.workspaceRoot && metadata.workspaceRoot !== input.workspaceRoot) continue
      checkpoints.push(publicCheckpoint(metadata))
    }
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async preview(checkpointId: string): Promise<GitCheckpointResult<{
    checkpoint: AgentRuntimeGitCheckpoint
    stagedPatch: string
    unstagedPatch: string
    untrackedFiles: string[]
  }>> {
    checkpointId = safeCheckpointId(checkpointId)
    const metadata = await readMetadata(this.dataDir, checkpointId)
    if (!metadata) return fail('not_found', `Git checkpoint not found: ${checkpointId}`)
    return {
      ok: true,
      value: {
        checkpoint: publicCheckpoint(metadata),
        stagedPatch: await readText(join(checkpointDir(this.dataDir, checkpointId), 'staged.patch')),
        unstagedPatch: await readText(join(checkpointDir(this.dataDir, checkpointId), 'unstaged.patch')),
        untrackedFiles: metadata.untrackedFiles
      }
    }
  }

  async restore(input: GitCheckpointRestoreInput): Promise<GitCheckpointResult<AgentRuntimeGitCheckpoint & {
    rescueCheckpointId?: string
  }>> {
    const checkpointId = safeCheckpointId(input.checkpointId)
    const metadata = await readMetadata(this.dataDir, checkpointId)
    if (!metadata) return fail('not_found', `Git checkpoint not found: ${checkpointId}`)
    try {
      const repositoryRoot = metadata.repositoryRoot
      await assertNoUnmerged(repositoryRoot)
      const currentBranchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
      const currentBranch = currentBranchRaw || null
      if (!input.force && currentBranch !== metadata.branch) {
        return fail('branch_changed', 'The current branch differs from the checkpoint branch.', {
          currentBranch,
          checkpointBranch: metadata.branch
        })
      }
      const dirty = await dirtyStatus(repositoryRoot)
      if (!input.force && dirty.length > 0) {
        return fail('dirty_worktree', 'The working tree has changes. Preview or commit/stash them before restoring.', {
          dirty
        })
      }

      const rescue = await this.create({
        workspaceRoot: repositoryRoot,
        runtimeId: metadata.runtimeId,
        threadId: `${metadata.threadId}:restore-rescue`,
        turnId: metadata.turnId
      })
      const rescueCheckpointId = rescue.ok ? rescue.value.checkpointId : undefined
      await runGit(repositoryRoot, ['reset', '--hard', metadata.checkpointRef], 30_000)
      await runGit(repositoryRoot, ['clean', '-fd'], 30_000)

      const dir = checkpointDir(this.dataDir, checkpointId)
      await applyPatchIfPresent(repositoryRoot, join(dir, 'staged.patch'), true)
      await applyPatchIfPresent(repositoryRoot, join(dir, 'unstaged.patch'), false)
      for (const relativePath of metadata.untrackedFiles) {
        const from = join(dir, 'untracked', relativePath)
        if (!(await fileExists(from))) continue
        const to = join(repositoryRoot, relativePath)
        await mkdir(dirname(to), { recursive: true })
        await cp(from, to, { recursive: true, force: true, errorOnExist: false })
      }

      const restored: GitCheckpointMetadata = {
        ...metadata,
        status: 'restored',
        restoreStatus: new Date().toISOString()
      }
      await writeFile(metadataPath(this.dataDir, checkpointId), JSON.stringify(restored, null, 2), 'utf8')
      return {
        ok: true,
        value: {
          ...publicCheckpoint(restored),
          ...(rescueCheckpointId ? { rescueCheckpointId } : {})
        }
      }
    } catch (error) {
      return gitFailure(error)
    }
  }
}

async function resolveRepositoryRoot(workspaceRoot: string): Promise<string | null> {
  const cwd = await resolveGitCwd(workspaceRoot)
  if (!cwd) return null
  return (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
}

function rootDir(dataDir: string): string {
  return join(resolve(dataDir), 'git-checkpoints')
}

function checkpointDir(dataDir: string, checkpointId: string): string {
  return join(rootDir(dataDir), checkpointId)
}

function metadataPath(dataDir: string, checkpointId: string): string {
  return join(checkpointDir(dataDir, checkpointId), 'metadata.json')
}

function checkpointRef(checkpointId: string): string {
  return `refs/deepseek-gui/checkpoints/${checkpointId.replace(/[^A-Za-z0-9._-]/g, '_')}`
}

function safeCheckpointId(raw: string): string {
  const value = raw.trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(value)) {
    throw Object.assign(new Error('Invalid git checkpoint id.'), { code: 'invalid_checkpoint_id' })
  }
  return value
}

async function readMetadata(dataDir: string, checkpointId: string): Promise<GitCheckpointMetadata | null> {
  try {
    return JSON.parse(await readFile(metadataPath(dataDir, checkpointId), 'utf8')) as GitCheckpointMetadata
  } catch {
    return null
  }
}

async function writePatch(repositoryRoot: string, args: string[], path: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, args, 30_000)
  await writeFile(path, stdout, 'utf8')
}

async function applyPatchIfPresent(repositoryRoot: string, path: string, cached: boolean): Promise<void> {
  const info = await stat(path).catch(() => null)
  if (!info || info.size === 0) return
  await runGit(repositoryRoot, ['apply', '--binary', ...(cached ? ['--index'] : []), path], 30_000)
}

async function assertNoUnmerged(repositoryRoot: string): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, ['diff', '--name-only', '--diff-filter=U'])
  const conflicted = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  if (conflicted.length > 0) {
    throw Object.assign(new Error(`Cannot use checkpoints while ${conflicted.length} files have merge conflicts.`), {
      code: 'conflict'
    })
  }
}

async function dirtyStatus(repositoryRoot: string): Promise<string[]> {
  return (await runGit(repositoryRoot, ['status', '--porcelain=v1'])).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

async function readText(path: string): Promise<string> {
  return readFile(path, 'utf8').catch(() => '')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function splitNul(stdout: string): string[] {
  return stdout.split('\0').map((entry) => entry.trim()).filter(Boolean)
}

function publicCheckpoint(metadata: GitCheckpointMetadata): AgentRuntimeGitCheckpoint {
  const { checkpointRef: _checkpointRef, untrackedFiles: _untrackedFiles, ...checkpoint } = metadata
  return checkpoint
}

function gitFailure(error: unknown): GitCheckpointResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : ''
  if (code === 'conflict' || /merge conflicts/i.test(message)) return fail('conflict', message)
  if (/not a git repository/i.test(message)) return fail('not_git_repo', 'The working directory is not a Git repository.')
  if (/ENOENT/i.test(message) || /spawn git/i.test(message)) return fail('git_unavailable', 'Git executable was not found.')
  return fail('error', message)
}

function fail(reason: string, message: string, details?: unknown): GitCheckpointResult<never> {
  return { ok: false, reason, message, ...(details !== undefined ? { details } : {}) }
}
