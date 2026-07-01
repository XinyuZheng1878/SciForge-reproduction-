import { useMemo } from 'react'
import { useChatStore } from '../../store/chat-store'
import type { ClawImChannelV1 } from '@shared/app-settings'
import type { NormalizedThread } from '../../agent/types'

/**
 * Snapshot of chat-store fields that `MessageTimeline` needs. Co-locates
 * the (many) `useChatStore` selectors in one place so adding a new field
 * to the timeline only touches this hook + the consuming component.
 */
export type TimelineStores = {
  workspaceRoot: string
  chooseWorkspace: () => Promise<string | null>
  remoteChannels: ClawImChannelV1[]
  activeRemoteChannel: ClawImChannelV1 | null
  busy: boolean
  currentTurnUserId: string | null
  turnStartedAtByUserId: Record<string, number>
  turnDurationByUserId: Record<string, number>
  turnReasoningFirstAtByUserId: Record<string, number>
  turnReasoningLastAtByUserId: Record<string, number>
  activeThread: NormalizedThread | null
}

export function useTimelineStores(activeThreadId: string | null): TimelineStores {
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const remoteChannels = useChatStore((s) => s.remoteChannels)
  const activeRemoteChannelId = useChatStore((s) => s.activeRemoteChannelId)
  const busy = useChatStore((s) => s.busy)
  const currentTurnUserId = useChatStore((s) => s.currentTurnUserId)
  const turnStartedAtByUserId = useChatStore((s) => s.turnStartedAtByUserId)
  const turnDurationByUserId = useChatStore((s) => s.turnDurationByUserId)
  const turnReasoningFirstAtByUserId = useChatStore((s) => s.turnReasoningFirstAtByUserId)
  const turnReasoningLastAtByUserId = useChatStore((s) => s.turnReasoningLastAtByUserId)
  const activeThread = useChatStore((s) =>
    activeThreadId ? s.threads.find((thread) => thread.id === activeThreadId) ?? null : null
  )
  const activeRemoteChannel = useMemo(
    () => remoteChannels.find((channel) => channel.id === activeRemoteChannelId) ?? null,
    [activeRemoteChannelId, remoteChannels]
  )

  return {
    workspaceRoot,
    chooseWorkspace,
    remoteChannels,
    activeRemoteChannel,
    busy,
    currentTurnUserId,
    turnStartedAtByUserId,
    turnDurationByUserId,
    turnReasoningFirstAtByUserId,
    turnReasoningLastAtByUserId,
    activeThread
  }
}
