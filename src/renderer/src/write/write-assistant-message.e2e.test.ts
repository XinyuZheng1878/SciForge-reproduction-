import { describe, expect, it, vi } from 'vitest'
import type { WriteRetrievalRequest } from '@shared/write-retrieval'
import type { WriteQuotedSelection } from './quoted-selection'
import { parseWritePromptForDisplay } from './quoted-selection'
import {
  prepareWriteAssistantPrompt,
  writeAssistantRuntimePayload
} from './write-assistant-message'

describe('write assistant message flow', () => {
  it('prepares retrieval-backed runtime input without falling back to full-file injection', async () => {
    const quote: WriteQuotedSelection = {
      id: 'quote-outline',
      text: '国内外发展现状与趋势需要围绕复杂推理能力分层展开。',
      sourceKind: 'text',
      sourceTitle: '科学复杂推理.md',
      sourceFilePath: '/tmp/write-workspace/科学复杂推理.md',
      lineStart: 1,
      lineEnd: 2,
      charCount: 27,
      createdAt: '2026-06-15T00:00:00.000Z'
    }
    const retrieveWriteContext = vi.fn(async (payload: WriteRetrievalRequest) => ({
      ok: true as const,
      context: {
        source: 'bm25-keyword' as const,
        query: payload.query,
        keywords: ['复杂推理', '科学场景'],
        indexedFiles: 1,
        indexedChunks: 2,
        snippets: [{
          path: '科学复杂推理.md',
          title: '国内外发展现状与趋势',
          text: '科学场景中的复杂推理应从知识、求解、执行和发现四个层级组织综述。',
          score: 2.4,
          keywords: ['复杂推理', '科学场景'],
          location: { kind: 'text' as const, lineStart: 3, lineEnd: 8 },
          lineStart: 3,
          lineEnd: 8
        }]
      }
    }))

    const prepared = await prepareWriteAssistantPrompt(
      '帮我提供点建议',
      {
        workspaceRoot: '/tmp/write-workspace',
        fallbackWorkspaceRoot: '/tmp/fallback-workspace',
        activeFilePath: '/tmp/write-workspace/科学复杂推理.md',
        quotedSelections: [quote]
      },
      { retrieveWriteContext }
    )
    const runtimePayload = writeAssistantRuntimePayload(prepared)
    const sendMessage = vi.fn(async (
      _text: string,
      _mode: 'agent' | 'plan',
      _options: { displayText?: string }
    ) => true)
    await sendMessage(runtimePayload.text, 'agent', { displayText: runtimePayload.displayText })

    expect(retrieveWriteContext).toHaveBeenCalledWith({
      workspaceRoot: '/tmp/write-workspace',
      currentFilePath: '/tmp/write-workspace/科学复杂推理.md',
      query: expect.stringContaining('帮我提供点建议'),
      maxSnippets: 4,
      includeCurrentFile: true
    })
    expect(retrieveWriteContext.mock.calls[0]?.[0].query).toContain(quote.text)
    expect(runtimePayload.displayText).toBe('帮我提供点建议')
    expect(runtimePayload.text).not.toBe(runtimePayload.displayText)
    expect(runtimePayload.text).toContain('[写作上下文]')
    expect(runtimePayload.text).toContain('[引用片段]')
    expect(runtimePayload.text).toContain('[相关文献上下文]')
    expect(runtimePayload.text).toContain('科学复杂推理.md:3-8')
    expect(runtimePayload.text).toContain('不要为了读取、确认或补全当前写作文件而调用 shell')
    expect(runtimePayload.text).not.toContain('<workspace_file')
    expect(runtimePayload.text).not.toContain('当前文件引用:')
    expect(runtimePayload.text).not.toContain('当前文件绝对路径:')
    expect(sendMessage).toHaveBeenCalledWith(runtimePayload.text, 'agent', {
      displayText: '帮我提供点建议'
    })

    const display = parseWritePromptForDisplay(runtimePayload.text)
    expect(display?.userInput).toBe('帮我提供点建议')
    expect(display?.context?.activeFile).toBe('科学复杂推理.md')
    expect(display?.quotes).toHaveLength(1)
    expect(display?.retrieval?.snippets[0]).toMatchObject({
      location: '科学复杂推理.md:3-8',
      title: '国内外发展现状与趋势'
    })
  })

  it('keeps the same safe prompt shape when retrieval is unavailable', async () => {
    const logError = vi.fn()
    const prepared = await prepareWriteAssistantPrompt(
      '继续整理这个章节',
      {
        fallbackWorkspaceRoot: '/tmp/write-workspace',
        activeFilePath: '/tmp/write-workspace/chapter.md',
        quotedSelections: []
      },
      {
        retrieveWriteContext: async () => {
          throw new Error('retrieval offline')
        },
        logError
      }
    )

    expect(prepared.retrieval).toBeNull()
    expect(prepared.prompt).toContain('当前文件: chapter.md')
    expect(prepared.prompt).toContain('不要为了读取、确认或补全当前写作文件而调用 shell')
    expect(prepared.prompt).not.toContain('<workspace_file')
    expect(prepared.displayText).toBe('继续整理这个章节')
    expect(logError).toHaveBeenCalledWith('write-retrieval', 'Failed to retrieve write context', {
      message: 'retrieval offline'
    })
  })
})
