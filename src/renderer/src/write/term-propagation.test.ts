import { describe, expect, it } from 'vitest'
import {
  buildWriteCanonicalTermPropagationChanges,
  buildWriteTermPropagationChanges
} from './term-propagation'

function applyChanges(
  content: string,
  changes: Array<{ from: number; to: number; insert: string }>
): string {
  let next = content
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    next = `${next.slice(0, change.from)}${change.insert}${next.slice(change.to)}`
  }
  return next
}

describe('write term propagation', () => {
  it('propagates a case-only phrase replacement within the same paragraph', () => {
    const content = [
      'i build SciForge, li is amazing ui production.',
      'deepseek gui can write paper, also can code. deepseek gui is use',
      'deepseek api, but it not only that.',
      '',
      'deepseek gui in another paragraph stays untouched.'
    ].join('\n')
    const seedFrom = content.indexOf('SciForge')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'SciForge'.length,
      deletedText: 'deepseek gui',
      insertedText: 'SciForge'
    })

    expect(changes).toHaveLength(2)
    expect(applyChanges(content, changes)).toBe([
      'i build SciForge, li is amazing ui production.',
      'SciForge can write paper, also can code. SciForge is use',
      'deepseek api, but it not only that.',
      '',
      'deepseek gui in another paragraph stays untouched.'
    ].join('\n'))
  })

  it('propagates a term rename such as deepseek gui to DXGUI', () => {
    const content = 'DXGUI is here. deepseek gui is there. deepseek gui again.'
    const changes = buildWriteTermPropagationChanges(content, {
      from: 0,
      to: 'DXGUI'.length,
      deletedText: 'deepseek gui',
      insertedText: 'DXGUI'
    })

    expect(applyChanges(content, changes)).toBe('DXGUI is here. DXGUI is there. DXGUI again.')
  })

  it('does not replace partial word matches', () => {
    const content = 'SciForge works. mydeepseek gui should not. deepseek gui should.'
    const seedFrom = content.indexOf('SciForge')

    const changes = buildWriteTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 'SciForge'.length,
      deletedText: 'deepseek gui',
      insertedText: 'SciForge'
    })

    expect(applyChanges(content, changes)).toBe(
      'SciForge works. mydeepseek gui should not. SciForge should.'
    )
  })

  it('propagates canonical casing after an incremental case edit', () => {
    const content = 'SciForge works. sciforge should follow. deepseek api should not.'
    const seedFrom = content.indexOf('SciForge')

    const changes = buildWriteCanonicalTermPropagationChanges(content, {
      from: seedFrom,
      to: seedFrom + 1,
      deletedText: 's',
      insertedText: 'S'
    })

    expect(applyChanges(content, changes)).toBe(
      'SciForge works. SciForge should follow. deepseek api should not.'
    )
  })
})
