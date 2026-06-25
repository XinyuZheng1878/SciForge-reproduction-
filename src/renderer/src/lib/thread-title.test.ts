import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { getDialogThreadTitle, getDisplayThreadTitle } from './thread-title'

function thread(overrides: Partial<NormalizedThread>): NormalizedThread {
  return {
    id: 'thread-1',
    title: 'Untitled Thread',
    updatedAt: '2026-06-24T00:00:00.000Z',
    model: 'auto',
    mode: 'agent',
    ...overrides
  }
}

describe('thread-title', () => {
  it('falls back to preview text when a runtime prompt leaks into the thread title', () => {
    const leakedTitle = [
      '<sciforge_runtime_instruction>',
      'When an advertised specialized MCP tool directly matches the user request, use that tool first.',
      '</sciforge_runtime_instruction>'
    ].join('\n')

    expect(
      getDisplayThreadTitle(thread({
        title: leakedTitle,
        preview: '帮我启动项目服务，然后替换 README 里的 gif'
      }))
    ).toBe('帮我启动项目服务，然后替换 README 里的 gif')
  })

  it('keeps confirmation titles single-line and bounded', () => {
    const title = getDialogThreadTitle(thread({
      title: '这是一个很长的会话标题\n第二行还包含更多内容 '.repeat(8)
    }))

    expect(title).not.toContain('\n')
    expect(title.length).toBeLessThanOrEqual(83)
    expect(title.endsWith('...')).toBe(true)
  })
})
