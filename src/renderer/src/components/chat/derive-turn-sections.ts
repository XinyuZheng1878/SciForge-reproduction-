import type { ChatBlock, RuntimeDisclosureMetadata, ToolBlock } from '../../agent/types'
import {
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay,
} from '../../lib/diff-stats'
import {
  findTrailingAssistantContentStart,
  isProcessBlock,
  splitThink,
  type Turn
} from './message-timeline-turns'

export type TurnAssistantBlock = Extract<ChatBlock, { kind: 'assistant' }>

export type TurnSections = {
  processBlocks: ChatBlock[]
  assistantContentBlocks: TurnAssistantBlock[]
  turnFileChanges: ToolBlock[]
}

type ResolvedFileChangeBlock = ToolBlock & {
  detail: string
  filePath: string
}

type DeriveTurnSectionsInput = {
  turn: Turn
  isProcessing: boolean
  liveProcessText: string
  liveProcessMeta?: RuntimeDisclosureMetadata | null
  liveContent: string
  workspaceRoot: string
}

function fileChangeGroupKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function mergeFileChangeBlocks(changes: ResolvedFileChangeBlock[]): ToolBlock[] {
  const merged: ResolvedFileChangeBlock[] = []
  const indexByPath = new Map<string, number>()

  for (const change of changes) {
    const key = fileChangeGroupKey(change.filePath)
    const existingIndex = indexByPath.get(key)
    if (existingIndex === undefined) {
      indexByPath.set(key, merged.length)
      merged.push(change)
      continue
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...existing,
      detail: [existing.detail, change.detail].filter(Boolean).join('\n\n')
    }
  }

  return merged
}

/**
 * Pure derivation of a turn's three view slices:
 *  - `processBlocks`: chronological reasoning/tool/compaction/approval
 *    trace, including in-flight assistant output while a turn is processing.
 *  - `assistantContentBlocks`: assistant content that should render as the
 *    visible message body once it is no longer part of the active work timeline.
 *  - `turnFileChanges`: successful file_change tool blocks whose detail
 *    is a unified diff, with paths normalised for display.
 *
 * Pulled out of `MessageTurn` so the derivation is testable in isolation
 * and the component body stays focused on rendering.
 */
export function deriveTurnSections({
  turn,
  isProcessing,
  liveProcessText,
  liveProcessMeta,
  liveContent,
  workspaceRoot
}: DeriveTurnSectionsInput): TurnSections {
  const processBlocks: ChatBlock[] = []
  const assistantContentBlocks: TurnAssistantBlock[] = []
  let latestAssistantContentBlock: TurnAssistantBlock | null = null
  const trailingAssistantStart = isProcessing ? turn.blocks.length : findTrailingAssistantContentStart(turn.blocks)
  const fallbackFinalAssistantId = !isProcessing && trailingAssistantStart === turn.blocks.length
    ? [...turn.blocks].reverse().find((block) => block.kind === 'assistant' && splitThink(block.text).content.trim())?.id
    : undefined

  for (const [index, block] of turn.blocks.entries()) {
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think) {
        processBlocks.push({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        latestAssistantContentBlock = contentBlock
        if (isProcessing || (index < trailingAssistantStart && block.id !== fallbackFinalAssistantId)) {
          processBlocks.push(contentBlock)
        } else {
          assistantContentBlocks.push(contentBlock)
        }
      }
      continue
    }
    if (isProcessBlock(block)) {
      processBlocks.push(block)
    }
  }

  if (!isProcessing && assistantContentBlocks.length === 0 && latestAssistantContentBlock) {
    assistantContentBlocks.push(latestAssistantContentBlock)
  }

  if (liveProcessText.trim()) {
    processBlocks.push({
      kind: 'reasoning',
      id: 'live-reasoning',
      text: liveProcessText,
      ...(liveProcessMeta ? { meta: liveProcessMeta } : {})
    })
  }

  const turnFileChanges: ToolBlock[] = isProcessing
    ? []
    : mergeFileChangeBlocks(turn.blocks.flatMap((block): ResolvedFileChangeBlock[] => {
        if (
          !(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')
        ) {
          return []
        }

        const detailText = extractUnifiedDiffText(block.detail)
        if (!detailText) return []

        const resolvedFilePath = formatFilePathForDisplay(
          extractDiffFilePath(detailText, block.filePath),
          workspaceRoot
        )
        if (!resolvedFilePath) return []

        return [{ ...block, detail: detailText, filePath: resolvedFilePath }]
      }))

  return { processBlocks, assistantContentBlocks, turnFileChanges }
}
