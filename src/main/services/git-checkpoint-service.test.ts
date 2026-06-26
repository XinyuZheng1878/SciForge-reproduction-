import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { GitCheckpointService } from './git-checkpoint-service'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' }
  })
  return String(stdout)
}

async function createRepo(): Promise<string> {
  const repo = await tempDir('dsgui-checkpoint-repo-')
  await git(repo, ['init'])
  await git(repo, ['config', 'user.email', 'test@example.com'])
  await git(repo, ['config', 'user.name', 'Test User'])
  await writeFile(join(repo, 'tracked.txt'), 'base\n', 'utf8')
  await git(repo, ['add', 'tracked.txt'])
  await git(repo, ['commit', '-m', 'initial'])
  return repo
}

function checkpointRoot(dataDir: string): string {
  return join(dataDir, 'git-checkpoints')
}

function checkpointDir(dataDir: string, checkpointId: string): string {
  return join(checkpointRoot(dataDir), checkpointId)
}

function checkpointMetadataPath(dataDir: string, checkpointId: string): string {
  return join(checkpointDir(dataDir, checkpointId), 'metadata.json')
}

async function readCheckpointMetadata(dataDir: string, checkpointId: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(checkpointMetadataPath(dataDir, checkpointId), 'utf8')) as Record<string, unknown>
}

async function writeCheckpointMetadata(
  dataDir: string,
  checkpointId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await writeFile(checkpointMetadataPath(dataDir, checkpointId), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

async function symlinkDirectory(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('GitCheckpointService', () => {
  it('creates a checkpoint, previews patches, blocks dirty restore, and force restores', async () => {
    const repo = await createRepo()
    const dataDir = await tempDir('dsgui-checkpoint-data-')
    const service = new GitCheckpointService(dataDir)

    await writeFile(join(repo, 'tracked.txt'), 'before turn\n', 'utf8')
    await writeFile(join(repo, 'untracked.txt'), 'new file\n', 'utf8')
    const created = await service.create({
      workspaceRoot: repo,
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1'
    })

    expect(created.ok).toBe(true)
    if (!created.ok) return
    const preview = await service.preview(created.value.checkpointId)
    expect(preview.ok).toBe(true)
    if (preview.ok) {
      expect(preview.value.unstagedPatch).toContain('before turn')
      expect(preview.value.untrackedFiles).toEqual(['untracked.txt'])
    }

    await writeFile(join(repo, 'tracked.txt'), 'after turn\n', 'utf8')
    const blocked = await service.restore({ checkpointId: created.value.checkpointId })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toBe('dirty_worktree')

    const restored = await service.restore({ checkpointId: created.value.checkpointId, force: true })
    expect(restored.ok).toBe(true)
    await expect(readFile(join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('before turn\n')
    await expect(readFile(join(repo, 'untracked.txt'), 'utf8')).resolves.toBe('new file\n')
  })

  it('refuses to create checkpoints through a symlinked app data checkpoint root', async () => {
    const repo = await createRepo()
    const dataDir = await tempDir('dsgui-checkpoint-data-')
    const outside = await tempDir('dsgui-checkpoint-outside-')
    await symlinkDirectory(outside, checkpointRoot(dataDir))
    const service = new GitCheckpointService(dataDir)

    await writeFile(join(repo, 'tracked.txt'), 'before turn\n', 'utf8')
    const created = await service.create({
      workspaceRoot: repo,
      runtimeId: 'codex',
      threadId: 'thread-1'
    })

    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.message).toContain('checkpoint root')
    await expect(readdir(outside)).resolves.toEqual([])
  })

  it('does not follow symlinked checkpoint directories or metadata files', async () => {
    const dataDir = await tempDir('dsgui-checkpoint-data-')
    const outside = await tempDir('dsgui-checkpoint-outside-')
    const service = new GitCheckpointService(dataDir)
    await mkdir(checkpointRoot(dataDir))
    await writeFile(join(outside, 'metadata.json'), '{"checkpointId":"linked"}\n', 'utf8')
    await symlinkDirectory(outside, checkpointDir(dataDir, 'linked'))

    const linkedPreview = await service.preview('linked')
    expect(linkedPreview.ok).toBe(false)
    if (!linkedPreview.ok) expect(linkedPreview.reason).toBe('not_found')

    const repo = await createRepo()
    await writeFile(join(repo, 'tracked.txt'), 'before turn\n', 'utf8')
    const created = await service.create({
      workspaceRoot: repo,
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const outsideMetadata = join(outside, 'outside-metadata.json')
    await writeFile(outsideMetadata, await readFile(checkpointMetadataPath(dataDir, created.value.checkpointId), 'utf8'), 'utf8')
    await rm(checkpointMetadataPath(dataDir, created.value.checkpointId), { force: true })
    await symlink(outsideMetadata, checkpointMetadataPath(dataDir, created.value.checkpointId), 'file')

    const preview = await service.preview(created.value.checkpointId)
    expect(preview.ok).toBe(false)
    if (!preview.ok) expect(preview.reason).toBe('not_found')
  })

  it('rejects checkpoint metadata with escaping untracked paths before restore', async () => {
    const repo = await createRepo()
    const dataDir = await tempDir('dsgui-checkpoint-data-')
    const service = new GitCheckpointService(dataDir)

    await writeFile(join(repo, 'untracked.txt'), 'new file\n', 'utf8')
    const created = await service.create({
      workspaceRoot: repo,
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const metadata = await readCheckpointMetadata(dataDir, created.value.checkpointId)
    await writeCheckpointMetadata(dataDir, created.value.checkpointId, {
      ...metadata,
      untrackedFiles: ['../escape.txt']
    })

    const restored = await service.restore({ checkpointId: created.value.checkpointId, force: true })
    expect(restored.ok).toBe(false)
    if (!restored.ok) expect(restored.message).toContain('relative path')
  })

  it('rejects untracked restore targets that would cross a repository symlink parent', async () => {
    const repo = await createRepo()
    const dataDir = await tempDir('dsgui-checkpoint-data-')
    const outside = await tempDir('dsgui-checkpoint-outside-')
    const service = new GitCheckpointService(dataDir)

    await symlinkDirectory(outside, join(repo, 'link-out'))
    await git(repo, ['add', 'link-out'])
    await git(repo, ['commit', '-m', 'track symlink'])
    await writeFile(join(repo, 'untracked.txt'), 'new file\n', 'utf8')

    const created = await service.create({
      workspaceRoot: repo,
      runtimeId: 'codex',
      threadId: 'thread-1'
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const metadata = await readCheckpointMetadata(dataDir, created.value.checkpointId)
    await writeCheckpointMetadata(dataDir, created.value.checkpointId, {
      ...metadata,
      untrackedFiles: ['link-out/restored.txt']
    })
    const maliciousSourceDir = join(checkpointDir(dataDir, created.value.checkpointId), 'untracked', 'link-out')
    await mkdir(maliciousSourceDir, { recursive: true })
    await writeFile(join(maliciousSourceDir, 'restored.txt'), 'escape\n', 'utf8')

    const restored = await service.restore({ checkpointId: created.value.checkpointId, force: true })
    expect(restored.ok).toBe(false)
    if (!restored.ok) expect(restored.message).toContain('symlink')
    await expect(readFile(join(outside, 'restored.txt'), 'utf8')).rejects.toThrow()
  })
})
