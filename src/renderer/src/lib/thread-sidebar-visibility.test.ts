import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, NormalizedThread } from '../agent/types'
import {
  filterThreadsForSidebar,
  shouldHideThreadFromSidebarByBlocks,
  shouldHideThreadFromSidebarByTitle,
  shouldInspectThreadForSidebarVisibility
} from './thread-sidebar-visibility'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'title'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title,
    updatedAt: overrides.updatedAt ?? '2026-05-25T00:00:00.000Z',
    model: overrides.model ?? 'auto',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/Users/zxy/workspace',
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {})
  }
}

function userBlock(text = 'hello', managedBy?: 'claw'): ChatBlock {
  return {
    kind: 'user',
    id: 'u-1',
    text,
    ...(managedBy ? { managedBy } : {})
  }
}

describe('thread-sidebar-visibility', () => {
  it('hides codex internal placeholder titles immediately', () => {
    expect(
      shouldHideThreadFromSidebarByTitle(
        thread({ id: 'thr_internal01', title: '__codex_parent_title__' })
      )
    ).toBe(true)
  })

  it('inspects fallback thread titles before hiding them', () => {
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: 'thr_279f' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_279f3fef', title: '新会话' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_codex', title: 'Codex thread' })
      )
    ).toBe(true)
    expect(
      shouldInspectThreadForSidebarVisibility(
        thread({ id: 'thr_prompt', title: '<sciforge_runtime_instruction>\nUse tools.' })
      )
    ).toBe(true)
  })

  it('treats only empty threads as hidden fallback entries', () => {
    expect(shouldHideThreadFromSidebarByBlocks([])).toBe(true)
    expect(shouldHideThreadFromSidebarByBlocks([userBlock()])).toBe(false)
  })

  it('hides fallback entries whose raw prompt came from Claw', () => {
    expect(shouldHideThreadFromSidebarByBlocks([userBlock('现在时间是23:50', 'claw')])).toBe(true)
  })

  it('filters internal placeholder and empty fallback threads while keeping real threads', async () => {
    const threads = [
      thread({ id: 'thr_internal01', title: '__codex_parent_title__' }),
      thread({ id: 'thr_279f3fef', title: 'thr_279f' }),
      thread({ id: 'thr_gui0001', title: '新会话' }),
      thread({ id: 'thr_real0001', title: '修一下侧边栏 bug' })
    ]
    const getThreadDetail = vi.fn(async (threadId: string) => {
      if (threadId === 'thr_279f3fef') return { blocks: [] }
      if (threadId === 'thr_gui0001') return { blocks: [] }
      return { blocks: [userBlock()] }
    })

    const visible = await filterThreadsForSidebar(threads, { getThreadDetail })

    expect(visible.map((thread) => thread.id)).toEqual(['thr_real0001'])
    expect(getThreadDetail).toHaveBeenCalledTimes(2)
    expect(getThreadDetail).toHaveBeenCalledWith('thr_279f3fef')
    expect(getThreadDetail).toHaveBeenCalledWith('thr_gui0001')
  })

  it('derives display titles for fallback titled threads when detail shows real content', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('real content')] })
    })

    expect(visible).toEqual([{ ...fallbackThread, title: 'real content' }])
  })

  it('derives display titles for placeholder titled threads with real content', async () => {
    const placeholderThread = thread({ id: 'thr_placeholder', title: 'New Thread' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('fix the sidebar session bug')] })
    })

    expect(visible).toEqual([{ ...placeholderThread, title: 'fix the sidebar session bug' }])
  })

  it('hides empty Codex runtime placeholder threads', async () => {
    const placeholderThread = thread({ id: 'thr_codex_empty', title: 'Codex thread' })

    const visible = await filterThreadsForSidebar([placeholderThread], {
      getThreadDetail: async () => ({ blocks: [] })
    })

    expect(visible).toEqual([])
  })

  it('derives display titles for leaked runtime prompt titles with real content', async () => {
    const leakedThread = thread({
      id: 'thr_leaked_prompt',
      title: '<sciforge_runtime_instruction>\nUse tools.\n</sciforge_runtime_instruction>'
    })

    const visible = await filterThreadsForSidebar([leakedThread], {
      getThreadDetail: async () => ({
        blocks: [
          userBlock('<sciforge_runtime_instruction>\nUse tools.\n</sciforge_runtime_instruction>'),
          userBlock('继续完成 session 修复')
        ]
      })
    })

    expect(visible).toEqual([{ ...leakedThread, title: '继续完成 session 修复' }])
  })

  it('hides leaked runtime prompt titled threads without a real user message', async () => {
    const leakedThread = thread({
      id: 'thr_internal_only',
      title: '<sciforge_runtime_instruction>\nUse tools.\n</sciforge_runtime_instruction>'
    })

    const visible = await filterThreadsForSidebar([leakedThread], {
      getThreadDetail: async () => ({
        blocks: [userBlock('<sciforge_runtime_instruction>\nUse tools.\n</sciforge_runtime_instruction>')]
      })
    })

    expect(visible).toEqual([])
  })

  it('filters fallback titled CodeWhale Claw sessions after inspecting detail', async () => {
    const fallbackThread = thread({ id: 'thr_20be8f66', title: 'thr_20be' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => ({ blocks: [userBlock('现在时间是23:50', 'claw')] })
    })

    expect(visible).toEqual([])
  })

  it('hides fallback titled threads when detail loading fails', async () => {
    const fallbackThread = thread({ id: 'thr_997f4104', title: 'thr_997f' })

    const visible = await filterThreadsForSidebar([fallbackThread], {
      getThreadDetail: async () => {
        throw new Error('detail unavailable')
      }
    })

    expect(visible).toEqual([])
  })
})
