import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { CodexEventStore } from './codex-event-store'
import { CodexThreadStore } from './codex-thread-store'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'deepseek-gui-codex-store-'))
}

describe('CodexThreadStore', () => {
  it('persists Codex thread mappings without using Kun ids or paths', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    const created = await store.upsert({
      codexThreadId: 'codex-thread-1',
      workspace: '/tmp/workspace',
      title: 'Codex work'
    })

    expect(created).toMatchObject({
      guiThreadId: 'codex-thread-1',
      codexThreadId: 'codex-thread-1',
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: 'Codex work',
      archived: false,
      latestSeq: 0
    })

    await store.upsert({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      latestSeq: 7,
      latestTurnId: 'turn-1'
    })

    expect(await store.get('gui-thread-1')).toMatchObject({
      guiThreadId: 'gui-thread-1',
      codexThreadId: 'codex-thread-1',
      latestSeq: 7,
      latestTurnId: 'turn-1'
    })
    expect(await store.getByCodexThreadId('codex-thread-1')).toMatchObject({
      guiThreadId: 'gui-thread-1'
    })
  })

  it('normalizes malformed persisted thread records and filters archived lists', async () => {
    const rootDir = await tempRoot()
    await writeFile(join(rootDir, 'threads.json'), JSON.stringify({
      version: 1,
      threads: [
        { codexThreadId: 'codex-live', title: 'Live' },
        { codexThreadId: 'codex-archived', archived: true },
        { guiThreadId: 'missing-codex-id' }
      ]
    }), 'utf8')
    const store = new CodexThreadStore({ rootDir })

    expect((await store.list()).map((thread) => thread.codexThreadId)).toEqual(['codex-live'])
    expect((await store.list({ includeArchived: true })).map((thread) => thread.codexThreadId).sort()).toEqual([
      'codex-archived',
      'codex-live'
    ])
  })

  it('preserves explicit runtime updatedAt values during upsert', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({
      rootDir,
      now: () => new Date('2026-06-10T10:00:00.000Z')
    })

    await store.upsert({
      codexThreadId: 'older-live-thread',
      title: 'Older',
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
    await store.upsert({
      codexThreadId: 'newer-live-thread',
      title: 'Newer',
      updatedAt: '2026-06-02T00:00:00.000Z'
    })

    const threads = await store.list()

    expect(threads.map((thread) => thread.codexThreadId)).toEqual([
      'newer-live-thread',
      'older-live-thread'
    ])
    expect(await store.get('older-live-thread')).toMatchObject({
      updatedAt: '2026-06-01T00:00:00.000Z'
    })
  })

  it('recovers a valid threads snapshot when a corrupted tail is present', async () => {
    const rootDir = await tempRoot()
    await writeFile(join(rootDir, 'threads.json'), `${JSON.stringify({
      version: 1,
      threads: [{ codexThreadId: 'codex-live', title: 'Live' }]
    }, null, 2)}\nnot-json-tail`, 'utf8')
    const store = new CodexThreadStore({ rootDir })

    expect((await store.list()).map((thread) => thread.codexThreadId)).toEqual(['codex-live'])
  })

  it('serializes concurrent upserts into one valid snapshot', async () => {
    const rootDir = await tempRoot()
    const store = new CodexThreadStore({ rootDir })

    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.upsert({
        codexThreadId: `codex-thread-${index}`,
        title: `Thread ${index}`
      })
    ))

    const raw = await readFile(join(rootDir, 'threads.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect((await store.list()).map((thread) => thread.codexThreadId).sort()).toEqual(
      Array.from({ length: 20 }, (_, index) => `codex-thread-${index}`).sort()
    )
  })
})

describe('CodexEventStore', () => {
  it('appends normalized events with GUI-owned seq values', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({
      rootDir,
      now: () => new Date('2026-06-10T11:00:00.000Z')
    })

    const first = await store.append('codex/thread:1', {
      threadId: 'codex/thread:1',
      deltas: [{ kind: 'agent_message', text: 'Hello' }]
    })
    const second = await store.append('codex/thread:1', {
      threadId: 'codex/thread:1',
      turnComplete: true
    })

    expect(first.seq).toBe(1)
    expect(first.event.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(await store.latestSeq('codex/thread:1')).toBe(2)
    expect((await store.read('codex/thread:1', { sinceSeq: 1 })).map((event) => event.seq)).toEqual([2])
  })

  it('serializes concurrent appends for one thread into unique monotonic seq values', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    await store.append('thread-1', { threadId: 'thread-1', deltas: [{ kind: 'agent_message', text: 'seed' }] })

    const appended = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      store.append('thread-1', {
        threadId: 'thread-1',
        deltas: [{ kind: 'agent_message', text: `message ${index}` }]
      })
    ))

    expect(appended.map((event) => event.seq)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 2)
    )
    expect((await store.read('thread-1')).map((event) => event.seq)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 1)
    )
  })

  it('ignores malformed JSONL rows when replaying events', async () => {
    const rootDir = await tempRoot()
    const store = new CodexEventStore({ rootDir })
    await store.append('thread-1', { threadId: 'thread-1', turnComplete: true })
    const eventFiles = await readFile(join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`), 'utf8')
    await writeFile(
      join(rootDir, 'events', `${Buffer.from('thread-1').toString('base64url')}.jsonl`),
      `${eventFiles}{bad json\n${JSON.stringify({ seq: 2, threadId: 'other', event: { threadId: 'other' } })}\n`,
      'utf8'
    )

    expect((await store.read('thread-1')).map((event) => event.seq)).toEqual([1])
  })
})
