import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readlink, readdir, realpath, rename, rm, symlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
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
      const dir = await createCheckpointDir(this.dataDir, checkpointId)
      const ref = checkpointRef(checkpointId)

      const head = (await runGit(repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim()
      await runGit(repositoryRoot, ['update-ref', ref, head])
      const branchRaw = (await runGit(repositoryRoot, ['branch', '--show-current'])).stdout.trim()
      const branch = branchRaw || null
      const diffStat = (await runGit(repositoryRoot, ['diff', '--stat'])).stdout.trim()
      const untrackedFiles = splitNul(
        (await runGit(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).stdout
      ).map((entry) => safeRelativePath(entry))

      await writePatch(this.dataDir, checkpointId, repositoryRoot, ['diff', '--binary'], 'unstaged.patch')
      await writePatch(this.dataDir, checkpointId, repositoryRoot, ['diff', '--cached', '--binary'], 'staged.patch')
      const untrackedRoot = safeJoin(dir, 'untracked')
      for (const relativePath of untrackedFiles) {
        const from = safeJoin(repositoryRoot, relativePath)
        const to = safeJoin(untrackedRoot, relativePath)
        await copyTreeNoFollow(from, repositoryRoot, to, untrackedRoot)
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
      await atomicWriteCheckpointText(this.dataDir, checkpointId, 'metadata.json', `${JSON.stringify(checkpoint, null, 2)}\n`)
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
    const root = await checkpointRoot(this.dataDir).catch(() => null)
    if (!root) return []
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
    let untrackedFiles: string[]
    try {
      untrackedFiles = metadata.untrackedFiles.map((entry) => safeRelativePath(entry))
    } catch (error) {
      return gitFailure(error)
    }
    return {
      ok: true,
      value: {
        checkpoint: publicCheckpoint(metadata),
        stagedPatch: await readCheckpointText(this.dataDir, checkpointId, 'staged.patch').catch(() => ''),
        unstagedPatch: await readCheckpointText(this.dataDir, checkpointId, 'unstaged.patch').catch(() => ''),
        untrackedFiles
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
      const repositoryRoot = await resolveRepositoryRootForRestore(metadata.repositoryRoot)
      const untrackedFiles = metadata.untrackedFiles.map((entry) => safeRelativePath(entry))
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

      const dir = await existingCheckpointDir(this.dataDir, checkpointId)
      const untrackedRoot = safeJoin(dir, 'untracked')
      await applyPatchIfPresent(this.dataDir, checkpointId, repositoryRoot, 'staged.patch', true)
      await applyPatchIfPresent(this.dataDir, checkpointId, repositoryRoot, 'unstaged.patch', false)
      for (const relativePath of untrackedFiles) {
        const from = safeJoin(untrackedRoot, relativePath)
        if (!(await fileExistsNoFollow(from))) continue
        const to = safeJoin(repositoryRoot, relativePath)
        await copyTreeNoFollow(from, untrackedRoot, to, repositoryRoot)
      }

      const restored: GitCheckpointMetadata = {
        ...metadata,
        repositoryRoot,
        untrackedFiles,
        status: 'restored',
        restoreStatus: new Date().toISOString()
      }
      await atomicWriteCheckpointText(this.dataDir, checkpointId, 'metadata.json', `${JSON.stringify(restored, null, 2)}\n`)
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
  const root = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).stdout.trim()
  return realpath(root)
}

async function resolveRepositoryRootForRestore(rawRepositoryRoot: string): Promise<string> {
  const rawRoot = typeof rawRepositoryRoot === 'string' ? rawRepositoryRoot.trim() : ''
  if (!rawRoot) {
    throw Object.assign(new Error('Checkpoint metadata does not include a repository root.'), {
      code: 'invalid_checkpoint_metadata'
    })
  }
  const canonicalRoot = await realpath(rawRoot)
  const gitRoot = await resolveRepositoryRoot(canonicalRoot)
  if (!gitRoot || gitRoot !== canonicalRoot) {
    throw Object.assign(new Error('Checkpoint repository root no longer resolves to the same Git root.'), {
      code: 'invalid_checkpoint_metadata'
    })
  }
  return canonicalRoot
}

function checkpointRef(checkpointId: string): string {
  return `refs/sciforge/checkpoints/${checkpointId.replace(/[^A-Za-z0-9._-]/g, '_')}`
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
    const id = safeCheckpointId(checkpointId)
    const metadata = JSON.parse(await readCheckpointText(dataDir, id, 'metadata.json')) as GitCheckpointMetadata
    if (metadata.checkpointId !== id) return null
    if (!Array.isArray(metadata.untrackedFiles)) return null
    return {
      ...metadata,
      untrackedFiles: metadata.untrackedFiles.map((entry) => {
        if (typeof entry !== 'string') throw new Error('Invalid checkpoint metadata.')
        return entry
      })
    }
  } catch {
    return null
  }
}

async function writePatch(
  dataDir: string,
  checkpointId: string,
  repositoryRoot: string,
  args: string[],
  fileName: CheckpointFileName
): Promise<void> {
  const { stdout } = await runGit(repositoryRoot, args, 30_000)
  await atomicWriteCheckpointText(dataDir, checkpointId, fileName, stdout)
}

async function applyPatchIfPresent(
  dataDir: string,
  checkpointId: string,
  repositoryRoot: string,
  fileName: CheckpointFileName,
  cached: boolean
): Promise<void> {
  const path = await checkpointFilePath(dataDir, checkpointId, fileName)
  const info = await lstat(path).catch(() => null)
  if (!info || info.size === 0) return
  if (info.isSymbolicLink() || !info.isFile()) {
    throw Object.assign(new Error('Checkpoint patch file must not be a symlink.'), {
      code: 'invalid_checkpoint_metadata'
    })
  }
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

type CheckpointFileName = 'metadata.json' | 'staged.patch' | 'unstaged.patch'

async function checkpointRoot(dataDir: string): Promise<string> {
  const dataRoot = resolve(dataDir)
  await mkdir(dataRoot, { recursive: true })
  const dataRootReal = await realpath(dataRoot)
  const root = join(dataRootReal, 'git-checkpoints')
  const info = await lstatIfExists(root)
  if (info) {
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw Object.assign(new Error('Git checkpoint root must be a real directory.'), {
        code: 'invalid_checkpoint_path'
      })
    }
  } else {
    await mkdir(root)
  }
  const rootReal = await realpath(root)
  if (!isPathInside(dataRootReal, rootReal)) {
    throw Object.assign(new Error('Git checkpoint root must stay inside app data.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  return rootReal
}

async function createCheckpointDir(dataDir: string, checkpointId: string): Promise<string> {
  const root = await checkpointRoot(dataDir)
  const dir = safeJoin(root, safeCheckpointId(checkpointId))
  if (await lstatIfExists(dir)) {
    throw Object.assign(new Error('Git checkpoint already exists.'), { code: 'invalid_checkpoint_path' })
  }
  await mkdir(dir)
  await mkdir(safeJoin(dir, 'untracked'))
  return realpath(dir)
}

async function existingCheckpointDir(dataDir: string, checkpointId: string): Promise<string> {
  const root = await checkpointRoot(dataDir)
  const dir = safeJoin(root, safeCheckpointId(checkpointId))
  const info = await lstatIfExists(dir)
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    throw Object.assign(new Error('Git checkpoint directory was not found or is unsafe.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  const dirReal = await realpath(dir)
  if (!isPathInside(root, dirReal)) {
    throw Object.assign(new Error('Git checkpoint directory must stay inside app data.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  return dirReal
}

async function checkpointFilePath(dataDir: string, checkpointId: string, fileName: CheckpointFileName): Promise<string> {
  const dir = await existingCheckpointDir(dataDir, checkpointId)
  return safeJoin(dir, fileName)
}

async function readCheckpointText(dataDir: string, checkpointId: string, fileName: CheckpointFileName): Promise<string> {
  const path = await checkpointFilePath(dataDir, checkpointId, fileName)
  return readFileNoFollow(path, 'utf8')
}

async function atomicWriteCheckpointText(
  dataDir: string,
  checkpointId: string,
  fileName: CheckpointFileName,
  content: string
): Promise<void> {
  const dir = await existingCheckpointDir(dataDir, checkpointId)
  const target = safeJoin(dir, fileName)
  const tmp = safeJoin(dir, `.${fileName}.${randomUUID()}.tmp`)
  try {
    await writeFileNoFollow(tmp, content, { encoding: 'utf8', exclusive: true })
    await rename(tmp, target)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

async function copyTreeNoFollow(
  sourcePath: string,
  sourceRoot: string,
  targetPath: string,
  targetRoot: string
): Promise<void> {
  assertLexicalPathInside(sourceRoot, sourcePath)
  assertLexicalPathInside(targetRoot, targetPath)
  await assertSafeParent(sourceRoot, sourcePath)
  const sourceInfo = await lstat(sourcePath)
  if (sourceInfo.isSymbolicLink()) {
    const linkTarget = await readSafeSymlinkTarget(sourcePath, sourceRoot)
    await symlinkSafe(linkTarget, targetPath, targetRoot)
    return
  }
  const sourceReal = await realpath(sourcePath)
  if (!isPathInside(sourceRoot, sourceReal)) {
    throw Object.assign(new Error('Checkpoint source path must stay inside its root.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  if (sourceInfo.isDirectory()) {
    await ensureSafeDirectory(targetRoot, targetPath)
    const entries = await readdir(sourcePath, { withFileTypes: true })
    for (const entry of entries) {
      const name = safePathSegment(entry.name)
      await copyTreeNoFollow(safeJoin(sourcePath, name), sourceRoot, safeJoin(targetPath, name), targetRoot)
    }
    return
  }
  if (!sourceInfo.isFile()) {
    throw Object.assign(new Error('Checkpoint only supports regular files, directories, and safe symlinks.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  await ensureSafeDirectory(targetRoot, dirname(targetPath))
  const bytes = await readFileNoFollow(sourcePath)
  await writeFileNoFollow(targetPath, bytes, { exclusive: true })
}

async function symlinkSafe(linkTarget: string, targetPath: string, targetRoot: string): Promise<void> {
  if (isAbsolute(linkTarget) || linkTarget.includes('\0')) {
    throw Object.assign(new Error('Checkpoint symlink targets must be relative and safe.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  const resolvedLinkTarget = resolve(dirname(targetPath), linkTarget)
  if (!isPathInside(targetRoot, resolvedLinkTarget)) {
    throw Object.assign(new Error('Checkpoint symlink targets must stay inside the target root.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  await ensureSafeDirectory(targetRoot, dirname(targetPath))
  if (await lstatIfExists(targetPath)) {
    throw Object.assign(new Error('Checkpoint restore target already exists.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  await symlink(linkTarget, targetPath)
}

async function readSafeSymlinkTarget(sourcePath: string, sourceRoot: string): Promise<string> {
  const linkTarget = await readlink(sourcePath)
  if (isAbsolute(linkTarget) || linkTarget.includes('\0')) {
    throw Object.assign(new Error('Checkpoint symlink targets must be relative and safe.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  const resolvedLinkTarget = resolve(dirname(sourcePath), linkTarget)
  if (!isPathInside(sourceRoot, resolvedLinkTarget)) {
    throw Object.assign(new Error('Checkpoint symlink targets must stay inside the source root.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  return linkTarget
}

async function ensureSafeDirectory(root: string, targetPath: string): Promise<void> {
  assertLexicalPathInside(root, targetPath)
  const segments = relative(root, targetPath).split(/[\\/]/).filter(Boolean)
  let current = root
  for (const segment of segments) {
    current = safeJoin(current, safePathSegment(segment))
    const info = await lstatIfExists(current)
    if (!info) {
      await mkdir(current)
      continue
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw Object.assign(new Error('Checkpoint target directory must not cross a symlink.'), {
        code: 'invalid_checkpoint_path'
      })
    }
    const currentReal = await realpath(current)
    if (!isPathInside(root, currentReal)) {
      throw Object.assign(new Error('Checkpoint target directory must stay inside its root.'), {
        code: 'invalid_checkpoint_path'
      })
    }
  }
}

async function assertSafeParent(root: string, targetPath: string): Promise<void> {
  const parentPath = dirname(targetPath)
  assertLexicalPathInside(root, parentPath)
  const parentReal = await realpath(parentPath)
  if (!isPathInside(root, parentReal)) {
    throw Object.assign(new Error('Checkpoint path parent must stay inside its root.'), {
      code: 'invalid_checkpoint_path'
    })
  }
}

async function readFileNoFollow(path: string, encoding: 'utf8'): Promise<string>
async function readFileNoFollow(path: string): Promise<Buffer>
async function readFileNoFollow(path: string, encoding?: 'utf8'): Promise<string | Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    return encoding ? handle.readFile({ encoding }) : handle.readFile()
  } finally {
    await handle.close()
  }
}

async function writeFileNoFollow(
  path: string,
  content: string | Uint8Array,
  options?: { encoding?: BufferEncoding; exclusive?: boolean }
): Promise<void> {
  const flags = constants.O_WRONLY |
    constants.O_CREAT |
    (options?.exclusive ? constants.O_EXCL : constants.O_TRUNC) |
    (constants.O_NOFOLLOW ?? 0)
  const handle = await open(path, flags, 0o600)
  try {
    if (typeof content === 'string') {
      await handle.writeFile(content, options?.encoding ?? 'utf8')
    } else {
      await handle.writeFile(content)
    }
  } finally {
    await handle.close()
  }
}

async function lstatIfExists(path: string): Promise<Stats | null> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

async function fileExistsNoFollow(path: string): Promise<boolean> {
  return Boolean(await lstatIfExists(path))
}

function safeRelativePath(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0') || isAbsolute(raw)) {
    throw Object.assign(new Error('Checkpoint relative path is invalid.'), { code: 'invalid_checkpoint_path' })
  }
  const value = normalize(raw)
  if (value === '.' || value === '..' || value.startsWith(`..${/^[A-Za-z]:/.test(value) ? '\\' : '/'}`)) {
    throw Object.assign(new Error('Checkpoint relative path must stay inside its root.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  const segments = value.split(/[\\/]/)
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw Object.assign(new Error('Checkpoint relative path must use safe path segments.'), {
      code: 'invalid_checkpoint_path'
    })
  }
  return value
}

function safePathSegment(raw: string): string {
  if (!raw || raw.includes('\0') || raw.includes('/') || raw.includes('\\') || raw === '.' || raw === '..') {
    throw Object.assign(new Error('Checkpoint path segment is invalid.'), { code: 'invalid_checkpoint_path' })
  }
  return raw
}

function safeJoin(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments)
  assertLexicalPathInside(root, target)
  return target
}

function assertLexicalPathInside(root: string, target: string): void {
  if (!isPathInside(root, resolve(target))) {
    throw Object.assign(new Error('Checkpoint path must stay inside its root.'), { code: 'invalid_checkpoint_path' })
  }
}

function isPathInside(root: string, target: string): boolean {
  const relativePath = relative(resolve(root), resolve(target))
  return relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT'
}

function splitNul(stdout: string): string[] {
  return stdout.split('\0').filter(Boolean)
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
