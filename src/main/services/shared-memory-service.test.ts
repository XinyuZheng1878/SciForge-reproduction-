import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SharedMemoryService } from './shared-memory-service'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsgui-memory-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('SharedMemoryService', () => {
  it('creates, searches, updates, and soft-deletes shared memory records', async () => {
    const dataDir = await tempDir()
    const workspaceA = await tempDir()
    const workspaceB = await tempDir()
    const service = new SharedMemoryService(dataDir)

    const userMemory = await service.create({
      text: '用户喜欢咖啡',
      scope: 'user',
      tags: ['Profile']
    })
    await service.create({
      text: 'workspace A uses pnpm',
      scope: 'workspace',
      workspace: workspaceA
    })

    expect((await service.retrieveForTurn({
      workspace: workspaceB,
      prompt: '今天的天气怎么样？'
    })).map((record) => record.id)).toContain(userMemory.id)
    expect((await service.list({
      workspace: workspaceB,
      query: 'pnpm'
    })).map((record) => record.text)).not.toContain('workspace A uses pnpm')

    const updated = await service.update({
      memoryId: userMemory.id,
      patch: { text: '用户喜欢茶', tags: ['profile', 'drink'] }
    })
    expect(updated.tags).toEqual(['profile', 'drink'])
    expect((await service.list({ query: '茶' })).map((record) => record.id)).toContain(userMemory.id)

    const deleted = await service.delete(userMemory.id)
    expect(deleted.deleted).toBe(true)
    expect(await service.list({ includeDeleted: false })).toHaveLength(1)
  })

  it('does not follow a symlinked app-data memory store target', async () => {
    const dataDir = await tempDir()
    const outsideDir = await tempDir()
    const outsideFile = join(outsideDir, 'memories.json')
    await mkdir(join(dataDir, 'shared-memory'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(dataDir, 'shared-memory', 'memories.json'))

    await expect(new SharedMemoryService(dataDir).create({
      text: 'keep writes inside app data'
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
