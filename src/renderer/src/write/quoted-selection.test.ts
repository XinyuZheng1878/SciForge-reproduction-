import { describe, expect, it, vi } from 'vitest'
import { harden } from 'rehype-harden'
import {
  resolveWriteMarkdownResource,
  resolveWriteMarkdownResourcePath,
  writePathToFileUrl,
  writeMarkdownHardenOptions
} from '../components/write/WriteMarkdownPreview'
import {
  WRITE_QUOTE_ORIGINAL_END,
  WRITE_QUOTE_ORIGINAL_START,
  composeWritePrompt,
  formatWriteQuotedSelectionForPrompt,
  parseWritePromptForDisplay,
  quotedSelectionFromEditor
} from './quoted-selection'

describe('write quoted selections', () => {
  it('formats selected text with file and line context', () => {
    const quote = {
      id: 'quote-1',
      text: 'Selected paragraph',
      sourceKind: 'text' as const,
      sourceTitle: 'notes/draft.md',
      sourceFilePath: '/tmp/workspace/notes/draft.md',
      lineStart: 3,
      lineEnd: 5,
      charCount: 18,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第3-5行')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_START)
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain(WRITE_QUOTE_ORIGINAL_END)
  })

  it('formats and parses PDF selected text with page context', () => {
    const quote = {
      id: 'quote-pdf-1',
      text: 'Important PDF passage',
      sourceKind: 'pdf' as const,
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 2,
      pageEnd: 4,
      rects: [{ page: 2, x: 10.5, y: 20, width: 120, height: 14 }],
      charCount: 21,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = composeWritePrompt('总结这段', [quote])

    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('第2-4页')
    expect(formatWriteQuotedSelectionForPrompt(quote)).toContain('位置: p.2 x=10.5 y=20 w=120 h=14')
    const parsed = parseWritePromptForDisplay(prompt)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceKind: 'pdf',
      sourceTitle: 'papers/study.pdf',
      sourceFilePath: '/tmp/workspace/papers/study.pdf',
      pageStart: 2,
      pageEnd: 4,
      position: 'p.2 x=10.5 y=20 w=120 h=14',
      charCount: 21,
      text: 'Important PDF passage'
    })
  })

  it('creates PDF quotes from page-aware selections', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2)
    const quote = quotedSelectionFromEditor({
      text: 'PDF passage',
      ranges: [{
        from: 0,
        to: 11,
        startLine: 2,
        startColumn: 1,
        endLine: 3,
        endColumn: 12,
        text: 'PDF passage',
        charCount: 11,
        page: 2
      }],
      sourceKind: 'pdf',
      pageStart: 2,
      pageEnd: 3,
      rects: [{ page: 2, x: 10, y: 20, width: 30, height: 12 }],
      charCount: 11
    }, '/tmp/workspace/papers/study.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      sourceTitle: 'papers/study.pdf',
      pageStart: 2,
      pageEnd: 3,
      rects: [{ page: 2, x: 10, y: 20, width: 30, height: 12 }]
    })
    vi.restoreAllMocks()
  })

  it('derives PDF page context from rect metadata when page fields are missing', () => {
    const quote = {
      id: 'quote-pdf-rect-only',
      text: 'Rect only passage',
      sourceKind: 'pdf' as const,
      sourceTitle: 'paper.pdf',
      sourceFilePath: '/tmp/workspace/paper.pdf',
      rects: [
        { page: 8, x: 10, y: 20, width: 30, height: 12 },
        { page: 7, x: 12, y: 40, width: 28, height: 10 }
      ],
      charCount: 17,
      createdAt: '2026-05-24T00:00:00.000Z'
    }

    const prompt = formatWriteQuotedSelectionForPrompt(quote)

    expect(prompt).toContain('第7-8页')
    expect(prompt).toContain('等2处')
  })

  it('ignores invalid PDF rect metadata without dropping the quote', () => {
    const quote = quotedSelectionFromEditor({
      text: 'PDF passage',
      ranges: [{
        from: 0,
        to: 11,
        startLine: 5,
        startColumn: 1,
        endLine: 5,
        endColumn: 12,
        text: 'PDF passage',
        charCount: 11,
        page: 5
      }],
      sourceKind: 'pdf',
      pageStart: 6,
      pageEnd: 5,
      rects: [
        { page: 5, x: 10, y: 20, width: 0, height: 12 },
        { page: 5, x: Number.NaN, y: 20, width: 30, height: 12 }
      ],
      charCount: 11
    }, '/tmp/workspace/papers/study.pdf', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).toMatchObject({
      sourceKind: 'pdf',
      pageStart: 5,
      pageEnd: 6
    })
    expect(quote?.rects).toBeUndefined()
  })

  it('does not create a quote for empty selections', () => {
    expect(quotedSelectionFromEditor({
      text: '   ',
      ranges: [],
      charCount: 0
    }, '/tmp/workspace/notes.md', '/tmp/workspace')).toBeNull()
  })

  it('composes prompt with committed quote context first', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    const quote = quotedSelectionFromEditor({
      text: 'A useful quote',
      ranges: [{
        from: 0,
        to: 14,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 14,
        text: 'A useful quote',
        charCount: 14
      }],
      charCount: 14
    }, '/tmp/workspace/a.md', '/tmp/workspace', Date.parse('2026-05-24T00:00:00.000Z'))

    expect(quote).not.toBeNull()
    const prompt = composeWritePrompt('Please revise it.', quote ? [quote] : [])
    expect(prompt.startsWith('[写作上下文]')).toBe(true)
    expect(prompt).toContain('不要调用 request_user_input')
    expect(prompt.indexOf('[引用片段] a.md')).toBeGreaterThan(prompt.indexOf('[写作上下文]'))
    expect(prompt.endsWith('Please revise it.')).toBe(true)
    vi.restoreAllMocks()
  })

  it('parses write prompt metadata for compact timeline display', () => {
    const prompt = composeWritePrompt(
      '帮我改成中文',
      [{
        id: 'quote-1',
        text: "Hi, I'm zxy. Glad to meet you.",
        sourceKind: 'text',
        sourceTitle: 'welcome.md',
        sourceFilePath: '/tmp/workspace/welcome.md',
        lineStart: 10,
        lineEnd: 10,
        charCount: 31,
        createdAt: '2026-05-24T00:00:00.000Z'
      }],
      {
        workspaceRoot: '/tmp/workspace',
        activeFilePath: '/tmp/workspace/welcome.md'
      }
    )

    const parsed = parseWritePromptForDisplay(prompt)

    expect(parsed?.userInput).toBe('帮我改成中文')
    expect(parsed?.context?.workspaceRoot).toBe('/tmp/workspace')
    expect(parsed?.context?.activeFile).toBe('welcome.md')
    expect(parsed?.context?.lines.some((line) => line.includes('不要调用 request_user_input'))).toBe(true)
    expect(parsed?.quotes).toHaveLength(1)
    expect(parsed?.quotes[0]).toMatchObject({
      sourceTitle: 'welcome.md',
      sourceFilePath: '/tmp/workspace/welcome.md',
      lineStart: 10,
      lineEnd: 10,
      charCount: 31,
      text: "Hi, I'm zxy. Glad to meet you."
    })
  })
})

describe('write markdown preview resources', () => {
  it('uses a rehype-harden config that can initialize without crashing preview', () => {
    expect(() => harden(writeMarkdownHardenOptions)).not.toThrow()
  })

  it('resolves relative image paths from the current markdown file', () => {
    const resolved = resolveWriteMarkdownResource('../assets/hero image.png', '/tmp/workspace/docs/draft.md')
    expect(resolved).toBe('file:///tmp/workspace/assets/hero%20image.png')
    expect(resolveWriteMarkdownResourcePath('../assets/hero image.png', '/tmp/workspace/docs/draft.md')).toBe(
      '/tmp/workspace/assets/hero image.png'
    )
  })

  it('keeps explicit external URLs unchanged', () => {
    expect(resolveWriteMarkdownResource('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBe('https://example.com/a.png')
    expect(resolveWriteMarkdownResourcePath('https://example.com/a.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
  })

  it('does not pass through explicit file URLs from markdown content', () => {
    expect(resolveWriteMarkdownResource('file:///tmp/secret.png', '/tmp/workspace/docs/draft.md')).toBeUndefined()
    expect(writePathToFileUrl('/tmp/workspace/assets/hero image.png')).toBe('file:///tmp/workspace/assets/hero%20image.png')
  })
})
