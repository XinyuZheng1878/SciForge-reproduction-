import { describe, expect, it } from 'vitest'
import {
  codexAppServerThreadReasoningConfig,
  codexAppServerTurnReasoningParams
} from './reasoning-config'

describe('Codex app-server reasoning config', () => {
  it('builds thread/start config with explicit effort, summary, and raw reasoning visibility', () => {
    expect(codexAppServerThreadReasoningConfig({ reasoningEffort: 'high' })).toEqual({
      model_reasoning_effort: 'high',
      show_raw_agent_reasoning: true,
      model_reasoning_summary: 'detailed'
    })
  })

  it('builds turn/start params with explicit effort and summary without inventing reasoning text', () => {
    const params = codexAppServerTurnReasoningParams({ reasoningEffort: 'low' })

    expect(params).toEqual({
      effort: 'low',
      summary: 'detailed'
    })
    expect(params).not.toHaveProperty('text')
    expect(params).not.toHaveProperty('reasoning_text')
    expect(params).not.toHaveProperty('show_raw_agent_reasoning')
  })

  it('normalizes blank reasoning options to app-server defaults', () => {
    expect(codexAppServerThreadReasoningConfig({
      reasoningEffort: ' ',
      reasoningSummary: '',
      showRawAgentReasoning: false
    })).toEqual({
      model_reasoning_effort: 'medium',
      show_raw_agent_reasoning: false,
      model_reasoning_summary: 'detailed'
    })
    expect(codexAppServerTurnReasoningParams({
      reasoningEffort: null,
      reasoningSummary: ' '
    })).toEqual({
      effort: 'medium',
      summary: 'detailed'
    })
  })

  it('normalizes cross-runtime reasoning aliases to app-server enum values', () => {
    expect(codexAppServerThreadReasoningConfig({ reasoningEffort: 'max' })).toMatchObject({
      model_reasoning_effort: 'xhigh'
    })
    expect(codexAppServerTurnReasoningParams({ reasoningEffort: ' max ' })).toMatchObject({
      effort: 'xhigh'
    })

    expect(codexAppServerThreadReasoningConfig({ reasoningEffort: 'off' })).toMatchObject({
      model_reasoning_effort: 'none'
    })
    expect(codexAppServerTurnReasoningParams({ reasoningEffort: ' off ' })).toMatchObject({
      effort: 'none'
    })
  })
})
