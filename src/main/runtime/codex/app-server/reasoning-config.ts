export type CodexAppServerReasoningConfigInput = {
  reasoningEffort?: string | null
  reasoningSummary?: string | null
  showRawAgentReasoning?: boolean
}

export type CodexAppServerThreadReasoningConfig = {
  model_reasoning_effort: string
  show_raw_agent_reasoning: boolean
  model_reasoning_summary: string
}

export type CodexAppServerTurnReasoningParams = {
  effort: string
  summary: string
}

const DEFAULT_REASONING_EFFORT = 'medium'
const DEFAULT_REASONING_SUMMARY = 'auto'
const CODEX_APP_SERVER_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

export function codexAppServerThreadReasoningConfig(
  input: CodexAppServerReasoningConfigInput = {}
): CodexAppServerThreadReasoningConfig {
  return {
    model_reasoning_effort: normalizedReasoningEffort(input.reasoningEffort),
    show_raw_agent_reasoning: input.showRawAgentReasoning ?? true,
    model_reasoning_summary: normalizedReasoningValue(input.reasoningSummary, DEFAULT_REASONING_SUMMARY)
  }
}

export function codexAppServerTurnReasoningParams(
  input: CodexAppServerReasoningConfigInput = {}
): CodexAppServerTurnReasoningParams {
  return {
    effort: normalizedReasoningEffort(input.reasoningEffort),
    summary: normalizedReasoningValue(input.reasoningSummary, DEFAULT_REASONING_SUMMARY)
  }
}

function normalizedReasoningEffort(value: string | null | undefined): string {
  const normalized = normalizedReasoningValue(value, DEFAULT_REASONING_EFFORT).toLowerCase()
  switch (normalized) {
    case 'off':
      return 'none'
    case 'max':
      return 'xhigh'
    default:
      return CODEX_APP_SERVER_REASONING_EFFORTS.has(normalized) ? normalized : DEFAULT_REASONING_EFFORT
  }
}

function normalizedReasoningValue(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
