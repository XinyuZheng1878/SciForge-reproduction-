import type { ChatBlock, NormalizedThread } from '../agent/types'
import { isRemoteChannelManagedBy } from '../agent/types'
import {
  deriveThreadTitleFromPrompt,
  hasInternalPromptThreadTitle,
  hasThreadIdFallbackTitle,
  hasPlaceholderThreadTitle,
  isInternalPlaceholderThreadTitle
} from './thread-title'

type ThreadDetailReader = {
  getThreadDetail: (threadId: string) => Promise<{ blocks: ChatBlock[] }>
}

export function shouldHideThreadFromSidebarByTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'>
): boolean {
  return isInternalPlaceholderThreadTitle(thread.title)
}

export function shouldInspectThreadForSidebarVisibility(
  thread: Pick<NormalizedThread, 'id' | 'title'>
): boolean {
  return !shouldHideThreadFromSidebarByTitle(thread) &&
    (
      hasThreadIdFallbackTitle(thread) ||
      hasPlaceholderThreadTitle(thread.title) ||
      hasInternalPromptThreadTitle(thread.title)
    )
}

export function shouldHideThreadFromSidebarByBlocks(blocks: ChatBlock[]): boolean {
  return blocks.length === 0 ||
    blocks.some((block) => block.kind === 'user' && isRemoteChannelManagedBy(block.managedBy))
}

export function filterThreadsForSidebarSummary(
  threads: NormalizedThread[]
): NormalizedThread[] {
  return threads.filter(
    (thread) =>
      !shouldHideThreadFromSidebarByTitle(thread) &&
      !shouldInspectThreadForSidebarVisibility(thread)
  )
}

export function hasThreadsRequiringSidebarVisibilityInspection(
  threads: NormalizedThread[]
): boolean {
  return threads.some((thread) =>
    !shouldHideThreadFromSidebarByTitle(thread) &&
    shouldInspectThreadForSidebarVisibility(thread)
  )
}

function titleFromThreadBlocks(blocks: ChatBlock[]): string | null {
  const userBlock = blocks.find((block) => {
    if (block.kind !== 'user' || isRemoteChannelManagedBy(block.managedBy)) return false
    const text = block.meta?.displayText?.trim() || block.text.trim()
    return Boolean(text) && !hasInternalPromptThreadTitle(text)
  })
  if (!userBlock || userBlock.kind !== 'user') return null
  const text = userBlock.meta?.displayText?.trim() || userBlock.text.trim()
  if (!text) return null
  const title = deriveThreadTitleFromPrompt(text)
  return hasPlaceholderThreadTitle(title) || hasInternalPromptThreadTitle(title) ? null : title
}

function needsRealDerivedTitle(thread: Pick<NormalizedThread, 'id' | 'title'>): boolean {
  return hasThreadIdFallbackTitle(thread) ||
    hasPlaceholderThreadTitle(thread.title) ||
    hasInternalPromptThreadTitle(thread.title)
}

export async function filterThreadsForSidebar(
  threads: NormalizedThread[],
  reader: ThreadDetailReader
): Promise<NormalizedThread[]> {
  const hiddenIds = new Set(
    threads.filter((thread) => shouldHideThreadFromSidebarByTitle(thread)).map((thread) => thread.id)
  )
  const derivedTitles = new Map<string, string>()
  const suspiciousThreads = threads.filter(
    (thread) =>
      !hiddenIds.has(thread.id) && shouldInspectThreadForSidebarVisibility(thread)
  )
  for (const thread of suspiciousThreads) {
    hiddenIds.add(thread.id)
  }

  if (suspiciousThreads.length > 0) {
    const results = await Promise.allSettled(
      suspiciousThreads.map(async (thread) => {
        const detail = await reader.getThreadDetail(thread.id)
        const title = titleFromThreadBlocks(detail.blocks)
        return {
          threadId: thread.id,
          hide: shouldHideThreadFromSidebarByBlocks(detail.blocks) ||
            (needsRealDerivedTitle(thread) && !title),
          title
        }
      })
    )

    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      if (result.value.hide) {
        hiddenIds.add(result.value.threadId)
      } else {
        hiddenIds.delete(result.value.threadId)
        if (result.value.title) derivedTitles.set(result.value.threadId, result.value.title)
      }
    }
  }

  if (hiddenIds.size === 0 && derivedTitles.size === 0) return threads
  return threads
    .filter((thread) => !hiddenIds.has(thread.id))
    .map((thread) => {
      const title = derivedTitles.get(thread.id)
      return title ? { ...thread, title } : thread
    })
}
