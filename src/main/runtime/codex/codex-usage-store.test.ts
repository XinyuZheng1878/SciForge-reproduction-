import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexUsageStore } from './codex-usage-store'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-codex-usage-'))
}

describe('CodexUsageStore', () => {
  it('deduplicates turn updates and groups Codex cache telemetry by day, model, and thread', async () => {
    const rootDir = await tempRoot()
    const store = new CodexUsageStore({ rootDir })

    await store.record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        reasoningTokens: 5,
        totalTokens: 115,
        cacheReadTokens: 60,
        cacheWriteTokens: 40
      }
    })
    await store.record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: 120,
        outputTokens: 20,
        reasoningTokens: 5,
        totalTokens: 145,
        cacheReadTokens: 90,
        cacheWriteTokens: 30
      }
    })
    await store.record({
      threadId: 'thread-2',
      turnId: 'turn-2',
      createdAt: '2026-06-11T01:00:00.000Z',
      model: 'gpt-5-mini',
      usage: {
        inputTokens: 80,
        outputTokens: 10,
        totalTokens: 90,
        cacheReadTokens: 20,
        cacheWriteTokens: 60
      }
    })

    await expect(store.summary({
      groupBy: 'day',
      from: '2026-06-10',
      to: '2026-06-11',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'day',
      buckets: [
        {
          date: '2026-06-10',
          inputTokens: 120,
          outputTokens: 20,
          reasoningTokens: 5,
          cachedTokens: 90,
          cacheMissTokens: 30,
          totalTokens: 145,
          turns: 1,
          threadCount: 1,
          cacheHitRate: 0.75
        },
        {
          date: '2026-06-11',
          inputTokens: 80,
          cachedTokens: 20,
          cacheMissTokens: 60,
          totalTokens: 90,
          turns: 1,
          threadCount: 1,
          cacheHitRate: 0.25
        }
      ],
      totals: {
        inputTokens: 200,
        cachedTokens: 110,
        cacheMissTokens: 90,
        totalTokens: 235,
        turns: 2,
        threadCount: 2,
        cacheHitRate: 0.55,
        days: 2,
        activeDays: 2
      }
    })

    await expect(store.summary({
      groupBy: 'model',
      from: '2026-06-10',
      to: '2026-06-11',
      timezone: 'UTC'
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'model',
      buckets: [
        { model: 'gpt-5-codex', totalTokens: 145, turns: 1 },
        { model: 'gpt-5-mini', totalTokens: 90, turns: 1 }
      ],
      days: [
        { date: '2026-06-10', totalTokens: 145 },
        { date: '2026-06-11', totalTokens: 90 }
      ]
    })

    await expect(store.summary({
      groupBy: 'thread',
      threadId: 'thread-1',
      timezone: 'UTC'
    }, {
      threads: [{ guiThreadId: 'thread-1', title: 'One' }]
    })).resolves.toMatchObject({
      supported: true,
      groupBy: 'thread',
      buckets: [{
        threadId: 'thread-1',
        title: 'One',
        totalTokens: 145,
        cachedTokens: 90,
        cacheMissTokens: 30,
        turns: 1
      }]
    })
  })

  it('serializes concurrent usage appends without losing JSONL rows', async () => {
    const rootDir = await tempRoot()
    const store = new CodexUsageStore({ rootDir })

    await Promise.all(Array.from({ length: 30 }, (_, index) => store.record({
      threadId: 'thread-1',
      turnId: `turn-${index}`,
      createdAt: '2026-06-10T01:00:00.000Z',
      model: 'gpt-5-codex',
      usage: {
        inputTokens: index + 1,
        outputTokens: 1,
        totalTokens: index + 2
      }
    })))

    const raw = await readFile(join(rootDir, 'usage', 'codex-usage.jsonl'), 'utf8')
    const rows = raw.trim().split('\n').map((line) => JSON.parse(line) as { turnId: string })
    expect(rows).toHaveLength(30)
    expect(new Set(rows.map((row) => row.turnId)).size).toBe(30)
    await expect(store.summary({ groupBy: 'thread', timezone: 'UTC' })).resolves.toMatchObject({
      totals: { turns: 30, threadCount: 1 }
    })
  })

  it('rejects symlinked usage append parents and targets', async () => {
    const parentRoot = await tempRoot()
    await symlink(await tempRoot(), join(parentRoot, 'usage'))
    await expect(new CodexUsageStore({ rootDir: parentRoot }).record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })).rejects.toThrow(/must not cross a symlink/)

    const targetRoot = await tempRoot()
    const outsideFile = join(await tempRoot(), 'codex-usage.jsonl')
    await mkdir(join(targetRoot, 'usage'))
    await writeFile(outsideFile, 'outside', 'utf8')
    await symlink(outsideFile, join(targetRoot, 'usage', 'codex-usage.jsonl'))

    await expect(new CodexUsageStore({ rootDir: targetRoot }).record({
      threadId: 'thread-1',
      turnId: 'turn-1',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })).rejects.toThrow(/not a symlink|regular file/)
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside')
  })
})
