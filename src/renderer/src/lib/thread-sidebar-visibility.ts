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

type SidebarVisibilityFilterOptions = {
  maxDetailInspections?: number
  hiddenThreadIds?: Iterable<string>
}

export const SIDEBAR_VISIBILITY_INSPECTION_LIMIT = 20

type SidebarThreadShape = Pick<NormalizedThread, 'id' | 'title'> &
  Partial<Pick<NormalizedThread, 'relation' | 'parentThreadId'>>

export function shouldHideThreadFromSidebarByTitle(
  thread: Pick<NormalizedThread, 'id' | 'title'>
): boolean {
  return isInternalPlaceholderThreadTitle(thread.title)
}

export function shouldHideThreadFromSidebarByLineage(
  thread: Pick<NormalizedThread, 'id'> & Partial<Pick<NormalizedThread, 'relation' | 'parentThreadId'>>
): boolean {
  if (thread.relation === 'side') return true
  if (thread.relation === 'primary' || thread.relation === 'fork') return false
  const parentThreadId = thread.parentThreadId?.trim() ?? ''
  return Boolean(parentThreadId && parentThreadId !== thread.id.trim())
}

export function shouldHideThreadFromSidebarByDefault(thread: SidebarThreadShape): boolean {
  return shouldHideThreadFromSidebarByTitle(thread) ||
    shouldHideThreadFromSidebarByLineage(thread)
}

export function shouldInspectThreadForSidebarVisibility(
  thread: SidebarThreadShape
): boolean {
  return !shouldHideThreadFromSidebarByDefault(thread) &&
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
      !shouldHideThreadFromSidebarByDefault(thread) &&
      !shouldInspectThreadForSidebarVisibility(thread)
  )
}

export function hasThreadsRequiringSidebarVisibilityInspection(
  threads: NormalizedThread[]
): boolean {
  return threads.some((thread) =>
    !shouldHideThreadFromSidebarByDefault(thread) &&
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

function titleFromThreadSummary(thread: Pick<NormalizedThread, 'preview'>): string | null {
  const preview = thread.preview?.trim() ?? ''
  if (!preview || hasInternalPromptThreadTitle(preview)) return null
  const title = deriveThreadTitleFromPrompt(preview)
  return hasPlaceholderThreadTitle(title) || hasInternalPromptThreadTitle(title) ? null : title
}

function needsRealDerivedTitle(thread: Pick<NormalizedThread, 'id' | 'title'>): boolean {
  return hasThreadIdFallbackTitle(thread) ||
    hasPlaceholderThreadTitle(thread.title) ||
    hasInternalPromptThreadTitle(thread.title)
}

function threadUpdatedAtMs(thread: Pick<NormalizedThread, 'updatedAt'>): number {
  const parsed = Date.parse(thread.updatedAt)
  return Number.isFinite(parsed) ? parsed : 0
}

function prioritizeThreadsForVisibilityInspection(
  threads: NormalizedThread[]
): NormalizedThread[] {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((a, b) => {
      const newestFirst = threadUpdatedAtMs(b.thread) - threadUpdatedAtMs(a.thread)
      return newestFirst || a.index - b.index
    })
    .map(({ thread }) => thread)
}

function normalizeHiddenThreadIds(ids: Iterable<string> | undefined): Set<string> {
  const normalized = new Set<string>()
  for (const id of ids ?? []) {
    const threadId = id.trim()
    if (threadId) normalized.add(threadId)
  }
  return normalized
}

export async function filterThreadsForSidebar(
  threads: NormalizedThread[],
  reader: ThreadDetailReader,
  options: SidebarVisibilityFilterOptions = {}
): Promise<NormalizedThread[]> {
  const hiddenThreadIds = normalizeHiddenThreadIds(options.hiddenThreadIds)
  const hiddenIds = new Set(
    threads
      .filter((thread) =>
        shouldHideThreadFromSidebarByDefault(thread) ||
        hiddenThreadIds.has(thread.id.trim())
      )
      .map((thread) => thread.id)
  )
  const derivedTitles = new Map<string, string>()
  const maxDetailInspections = Math.max(
    0,
    Math.floor(options.maxDetailInspections ?? SIDEBAR_VISIBILITY_INSPECTION_LIMIT)
  )
  const suspiciousThreads = prioritizeThreadsForVisibilityInspection(
    threads.filter(
      (thread) =>
        !hiddenIds.has(thread.id) && shouldInspectThreadForSidebarVisibility(thread)
    )
  )
  const threadsToInspect: NormalizedThread[] = []
  for (const thread of suspiciousThreads) {
    const title = titleFromThreadSummary(thread)
    if (title) {
      derivedTitles.set(thread.id, title)
      continue
    }
    if (threadsToInspect.length < maxDetailInspections) {
      threadsToInspect.push(thread)
      hiddenIds.add(thread.id)
      continue
    }
    if (!thread.preview?.trim() && !thread.latestTurnId?.trim()) {
      hiddenIds.add(thread.id)
    }
  }

  if (threadsToInspect.length > 0) {
    const results = await Promise.allSettled(
      threadsToInspect.map(async (thread) => {
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
