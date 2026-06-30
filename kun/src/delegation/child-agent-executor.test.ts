import { describe, expect, it } from 'vitest'
import { isBlockedChildFinalText, isPrematureChildClarification } from './child-agent-executor.js'

describe('child agent final response classification', () => {
  it('flags delegated-task clarification endings as premature instead of successful work', () => {
    expect(isPrematureChildClarification([
      '我已经完整阅读了这篇手稿。',
      '',
      '请问你需要我对这份手稿做什么？例如：润色修改、补充某个章节、检查一致性。'
    ].join('\n'))).toBe(true)

    expect(isPrematureChildClarification(
      'I read the draft. What would you like me to do next? For example, I can edit, add citations, or check consistency.'
    )).toBe(true)

    expect(isPrematureChildClarification(
      '我已经阅读了所有材料。请告诉我你想要我做什么？'
    )).toBe(true)
  })

  it('does not flag normal completion summaries that report verified outputs', () => {
    expect(isPrematureChildClarification([
      'Completed the delegated task.',
      '',
      'Verified outputs:',
      '- outputs/stage9/literature_audit.md',
      '- outputs/stage9/triage_table.tsv'
    ].join('\n'))).toBe(false)
  })

  it('recognizes explicit child-agent blockers', () => {
    expect(isBlockedChildFinalText('CHILD_AGENT_BLOCKED: required input file is missing.')).toBe(true)
    expect(isPrematureChildClarification('CHILD_AGENT_BLOCKED: should I continue after the file appears?')).toBe(false)
  })
})
