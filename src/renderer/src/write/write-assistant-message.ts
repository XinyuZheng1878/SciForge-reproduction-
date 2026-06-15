import type {
  WriteRetrievalContext,
  WriteRetrievalRequest,
  WriteRetrievalResult
} from '@shared/write-retrieval'
import { composeWritePrompt, type WriteQuotedSelection } from './quoted-selection'

export type WriteAssistantPromptState = {
  workspaceRoot?: string
  fallbackWorkspaceRoot?: string
  activeFilePath?: string | null
  quotedSelections: WriteQuotedSelection[]
}

export type WriteAssistantRetrievalBridge = (
  payload: WriteRetrievalRequest
) => Promise<WriteRetrievalResult>

export type WriteAssistantLogError = (
  category: string,
  message: string,
  detail?: unknown
) => Promise<void> | void

export type PrepareWriteAssistantPromptOptions = {
  retrieveWriteContext?: WriteAssistantRetrievalBridge
  logError?: WriteAssistantLogError
  maxSnippets?: number
}

export type PreparedWriteAssistantPrompt = {
  prompt: string
  displayText: string
  retrieval: WriteRetrievalContext | null
  retrievalQuery: string
  workspaceRoot?: string
}

export type WriteAssistantRuntimePayload = {
  text: string
  displayText: string
}

function composeRetrievalQuery(input: string, selections: WriteQuotedSelection[]): string {
  return [
    ...selections.map((selection) => selection.text),
    input
  ].join('\n\n').trim()
}

export async function prepareWriteAssistantPrompt(
  input: string,
  state: WriteAssistantPromptState,
  options: PrepareWriteAssistantPromptOptions = {}
): Promise<PreparedWriteAssistantPrompt> {
  const displayText = input.trim()
  const workspaceRoot = state.workspaceRoot || state.fallbackWorkspaceRoot
  const retrievalQuery = composeRetrievalQuery(displayText, state.quotedSelections)
  let retrieval: WriteRetrievalContext | null = null

  if (retrievalQuery && typeof options.retrieveWriteContext === 'function') {
    try {
      const result = await options.retrieveWriteContext({
        workspaceRoot,
        currentFilePath: state.activeFilePath ?? undefined,
        query: retrievalQuery,
        maxSnippets: options.maxSnippets ?? 4,
        includeCurrentFile: true
      })
      if (result.ok) retrieval = result.context
    } catch (error) {
      void options.logError?.('write-retrieval', 'Failed to retrieve write context', {
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    prompt: composeWritePrompt(displayText, state.quotedSelections, {
      workspaceRoot,
      activeFilePath: state.activeFilePath,
      retrieval
    }),
    displayText,
    retrieval,
    retrievalQuery,
    ...(workspaceRoot ? { workspaceRoot } : {})
  }
}

export function writeAssistantRuntimePayload(
  prepared: PreparedWriteAssistantPrompt
): WriteAssistantRuntimePayload {
  return {
    text: prepared.prompt,
    displayText: prepared.displayText
  }
}
