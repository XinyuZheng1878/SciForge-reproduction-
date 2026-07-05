import { describe, expect, it } from 'vitest'
import { harden } from 'rehype-harden'
import {
  STREAMDOWN_CONTROLS,
  STREAMDOWN_HARDEN_OPTIONS,
  shouldAnimateStreamingText
} from './StreamdownAssistant'

describe('STREAMDOWN_CONTROLS', () => {
  it('keeps final-answer tables static in chat rendering', () => {
    expect(STREAMDOWN_CONTROLS).toEqual({ table: false })
  })
})

describe('STREAMDOWN_HARDEN_OPTIONS', () => {
  it('initializes rehype-harden when chat links are restricted', () => {
    expect(() => harden(STREAMDOWN_HARDEN_OPTIONS)).not.toThrow()
    expect(STREAMDOWN_HARDEN_OPTIONS.defaultOrigin).toBe('https://sciforge.local')
  })
})

describe('shouldAnimateStreamingText', () => {
  it('keeps the lightweight reveal for short single-line text', () => {
    expect(shouldAnimateStreamingText('正在检查配置。')).toBe(true)
    expect(shouldAnimateStreamingText('Checking the CSS variables.')).toBe(true)
  })

  it('lets multiline streaming render from the actual SSE sequence', () => {
    expect(shouldAnimateStreamingText('First line\nSecond line')).toBe(false)
    expect(shouldAnimateStreamingText('First paragraph\n\nSecond paragraph')).toBe(false)
  })

  it('does not animate structured markdown while it is still streaming', () => {
    expect(shouldAnimateStreamingText('- one\n- two')).toBe(false)
    expect(shouldAnimateStreamingText('Use `npm test` next.')).toBe(false)
  })

  it('does not animate markdown image syntax while streaming', () => {
    expect(shouldAnimateStreamingText('![plot](plot.png)')).toBe(false)
    expect(shouldAnimateStreamingText('![plot](data:image/png;base64,abc)')).toBe(false)
  })
})
