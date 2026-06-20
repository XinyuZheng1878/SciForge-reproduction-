import { execFile } from 'node:child_process'
import { readFile, rm, writeFile, mkdtemp } from 'node:fs/promises'
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
})
