import type { WriteEditorSelectionState } from '../components/write/WriteMarkdownEditor'

export const WRITE_QUOTE_ORIGINAL_START = '[引用原文]'
export const WRITE_QUOTE_ORIGINAL_END = '[/引用原文]'
export const WRITE_CONTEXT_HEADING = '[写作上下文]'
export const WRITE_QUOTE_HEADING = '[引用片段]'

const WRITE_ASSISTANT_INTERACTION_RULE =
  '交互限制: 当前 GUI 无法提交 request_user_input 的 HTTP 响应；需要更多信息时，直接用普通文本向用户提问，不要调用 request_user_input。'

export type WriteQuotedSelectionSourceKind = 'text' | 'pdf'

export type WriteQuotedSelectionRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

type WriteQuotedSelectionRange = WriteEditorSelectionState['ranges'][number] & {
  page?: number
}

export type WriteQuotedSelectionInput = Omit<WriteEditorSelectionState, 'ranges'> & {
  ranges: WriteQuotedSelectionRange[]
  sourceKind?: WriteQuotedSelectionSourceKind
  pageStart?: number
  pageEnd?: number
  rects?: WriteQuotedSelectionRect[]
}

export type WriteQuotedSelection = {
  id: string
  text: string
  sourceKind?: WriteQuotedSelectionSourceKind
  sourceTitle: string
  sourceFilePath: string
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  rects?: WriteQuotedSelectionRect[]
  charCount: number
  createdAt: string
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

export function relativeWritePath(workspaceRoot: string, filePath: string): string {
  const root = normalizePath(workspaceRoot)
  const file = normalizePath(filePath)
  const prefix = `${root}/`
  if (root && file.startsWith(prefix)) return file.slice(prefix.length)
  return basenameFromPath(filePath)
}

function normalizedPositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) return undefined
  return Math.floor(number)
}

function normalizedFiniteNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : undefined
}

function normalizedPageRange(
  pageStart: number | undefined,
  pageEnd: number | undefined
): { pageStart?: number; pageEnd?: number } {
  if (pageStart == null && pageEnd == null) return {}
  const start = pageStart ?? pageEnd
  const end = pageEnd ?? pageStart
  if (start == null || end == null) return {}
  return {
    pageStart: Math.min(start, end),
    pageEnd: Math.max(start, end)
  }
}

function normalizeSelectionRects(rects: WriteQuotedSelectionRect[] | undefined): WriteQuotedSelectionRect[] {
  if (!rects?.length) return []
  const normalized: WriteQuotedSelectionRect[] = []
  for (const rect of rects) {
    const page = normalizedPositiveInteger(rect.page)
    const x = normalizedFiniteNumber(rect.x)
    const y = normalizedFiniteNumber(rect.y)
    const width = normalizedFiniteNumber(rect.width)
    const height = normalizedFiniteNumber(rect.height)
    if (page == null || x == null || y == null || width == null || height == null) continue
    if (width <= 0 || height <= 0) continue
    normalized.push({ page, x, y, width, height })
  }
  return normalized
}

function pageRangeFromRects(rects: WriteQuotedSelectionRect[]): { pageStart?: number; pageEnd?: number } {
  const pages = rects.map((rect) => rect.page).filter((page) => Number.isFinite(page) && page > 0)
  if (pages.length === 0) return {}
  return normalizedPageRange(Math.min(...pages), Math.max(...pages))
}

function formatCoordinate(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function pageLabel(pageStart: number, pageEnd: number): string {
  return pageStart === pageEnd ? `第${pageStart}页` : `第${pageStart}-${pageEnd}页`
}

export function formatWriteQuotedSelectionPosition(selection: Pick<WriteQuotedSelection, 'rects'>): string | undefined {
  const rects = normalizeSelectionRects(selection.rects)
  const first = rects[0]
  if (!first) return undefined
  const firstRect = [
    `p.${first.page}`,
    `x=${formatCoordinate(first.x)}`,
    `y=${formatCoordinate(first.y)}`,
    `w=${formatCoordinate(first.width)}`,
    `h=${formatCoordinate(first.height)}`
  ].join(' ')
  return rects.length > 1 ? `${firstRect} 等${rects.length}处` : firstRect
}

export function quotedSelectionFromEditor(
  selection: WriteQuotedSelectionInput,
  filePath: string,
  workspaceRoot: string,
  now = Date.now()
): WriteQuotedSelection | null {
  const text = selection.text.trim()
  if (!text || selection.charCount <= 0) return null
  const first = selection.ranges[0]
  const last = selection.ranges[selection.ranges.length - 1]
  const sourceKind: WriteQuotedSelectionSourceKind = selection.sourceKind === 'pdf' ? 'pdf' : 'text'
  const rects = normalizeSelectionRects(selection.rects)
  const explicitPageRange = normalizedPageRange(
    normalizedPositiveInteger(selection.pageStart ?? first?.page),
    normalizedPositiveInteger(selection.pageEnd ?? last?.page ?? selection.pageStart ?? first?.page)
  )
  const rectPageRange = pageRangeFromRects(rects)
  const pageRange = explicitPageRange.pageStart != null ? explicitPageRange : rectPageRange
  return {
    id: `quote-${now}-${Math.random().toString(36).slice(2)}`,
    text,
    sourceKind,
    sourceTitle: relativeWritePath(workspaceRoot, filePath),
    sourceFilePath: filePath,
    ...(sourceKind === 'pdf'
      ? {
          ...pageRange,
          ...(rects.length ? { rects } : {})
        }
      : {
          ...(first ? { lineStart: first.startLine } : {}),
          ...(last ? { lineEnd: last.endLine } : {})
        }),
    charCount: selection.charCount,
    createdAt: new Date(now).toISOString()
  }
}

export function formatWriteQuotedSelectionForPrompt(selection: WriteQuotedSelection): string {
  const rects = normalizeSelectionRects(selection.rects)
  const explicitPageRange = normalizedPageRange(
    normalizedPositiveInteger(selection.pageStart),
    normalizedPositiveInteger(selection.pageEnd ?? selection.pageStart)
  )
  const rectPageRange = pageRangeFromRects(rects)
  const pdfPageRange = explicitPageRange.pageStart != null ? explicitPageRange : rectPageRange
  if (selection.sourceKind === 'pdf' && pdfPageRange.pageStart != null && pdfPageRange.pageEnd != null) {
    const position = formatWriteQuotedSelectionPosition(selection)
    const metadata = [
      pageLabel(pdfPageRange.pageStart, pdfPageRange.pageEnd),
      ...(position ? [`位置: ${position}`] : []),
      `共${selection.charCount}字`
    ].join('，')
    return [
      `[引用片段] ${selection.sourceTitle}（${metadata}）路径: ${selection.sourceFilePath}`,
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  if (selection.lineStart != null && selection.lineEnd != null) {
    return [
      `[引用片段] ${selection.sourceTitle}（第${selection.lineStart}-${selection.lineEnd}行，共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
      WRITE_QUOTE_ORIGINAL_START,
      selection.text,
      WRITE_QUOTE_ORIGINAL_END
    ].join('\n')
  }
  return [
    `[引用片段] ${selection.sourceTitle}（共${selection.charCount}字）路径: ${selection.sourceFilePath}`,
    WRITE_QUOTE_ORIGINAL_START,
    selection.text,
    WRITE_QUOTE_ORIGINAL_END
  ].join('\n')
}

type WritePromptContext = {
  workspaceRoot?: string
  activeFilePath?: string | null
}

export type WritePromptDisplayContext = {
  workspaceRoot?: string
  activeFile?: string
  lines: string[]
}

export type WritePromptDisplayQuote = {
  sourceTitle: string
  sourceFilePath?: string
  sourceKind?: WriteQuotedSelectionSourceKind
  lineStart?: number
  lineEnd?: number
  pageStart?: number
  pageEnd?: number
  position?: string
  charCount?: number
  text: string
}

export type WritePromptDisplay = {
  userInput: string
  context: WritePromptDisplayContext | null
  quotes: WritePromptDisplayQuote[]
}

export function composeWritePrompt(
  input: string,
  selections: WriteQuotedSelection[],
  context: WritePromptContext = {}
): string {
  const body = input.trim()
  const contextLines: string[] = []
  contextLines.push(WRITE_ASSISTANT_INTERACTION_RULE)
  if (context.workspaceRoot?.trim()) {
    contextLines.push(`工作空间: ${context.workspaceRoot.trim()}`)
  }
  if (context.activeFilePath?.trim()) {
    contextLines.push(`当前文件: ${relativeWritePath(context.workspaceRoot ?? '', context.activeFilePath)}`)
  }
  const contextText = contextLines.length > 0
    ? `[写作上下文]\n${contextLines.join('\n')}`
    : ''
  const quoteText = selections.map(formatWriteQuotedSelectionForPrompt).join('\n\n')
  return [contextText, quoteText, body].filter(Boolean).join('\n\n')
}

function parseContextBlock(text: string): WritePromptDisplayContext {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  let workspaceRoot: string | undefined
  let activeFile: string | undefined

  for (const line of lines) {
    const workspaceMatch = line.match(/^工作空间:\s*(.+)$/)
    if (workspaceMatch?.[1]) {
      workspaceRoot = workspaceMatch[1].trim()
      continue
    }
    const fileMatch = line.match(/^当前文件:\s*(.+)$/)
    if (fileMatch?.[1]) {
      activeFile = fileMatch[1].trim()
    }
  }

  return {
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(activeFile ? { activeFile } : {}),
    lines
  }
}

function splitFirstSection(text: string): { head: string; rest: string } {
  const separator = text.search(/\n{2,}/)
  if (separator < 0) return { head: text.trim(), rest: '' }
  return {
    head: text.slice(0, separator).trim(),
    rest: text.slice(separator).trimStart()
  }
}

function parseQuoteHeader(header: string): Omit<WritePromptDisplayQuote, 'text'> {
  const body = header.replace(WRITE_QUOTE_HEADING, '').trim()
  const pathSplit = body.match(/^(.*?)\s*路径:\s*(.+)$/)
  const titleAndMeta = (pathSplit?.[1] ?? body).trim()
  const sourceFilePath = pathSplit?.[2]?.trim()
  const pdfMetaMatch = titleAndMeta.match(/^(.*?)（第(\d+)(?:[-–—](\d+))?页(?:，位置:\s*([^，]+))?，共(\d+)字）$/)
  if (pdfMetaMatch) {
    const pageStart = Number.parseInt(pdfMetaMatch[2] ?? '', 10)
    const pageEnd = Number.parseInt(pdfMetaMatch[3] ?? pdfMetaMatch[2] ?? '', 10)
    const position = pdfMetaMatch[4]?.trim()
    const charCount = Number.parseInt(pdfMetaMatch[5] ?? '', 10)
    return {
      sourceTitle: (pdfMetaMatch[1] ?? titleAndMeta).trim(),
      sourceKind: 'pdf',
      ...(sourceFilePath ? { sourceFilePath } : {}),
      ...(Number.isFinite(pageStart) ? { pageStart } : {}),
      ...(Number.isFinite(pageEnd) ? { pageEnd } : {}),
      ...(position ? { position } : {}),
      ...(Number.isFinite(charCount) ? { charCount } : {})
    }
  }

  const metaMatch = titleAndMeta.match(/^(.*?)（(?:第(\d+)[-–—](\d+)行，)?共(\d+)字）$/)
  const sourceTitle = (metaMatch?.[1] ?? titleAndMeta).trim()
  const lineStart = metaMatch?.[2] ? Number.parseInt(metaMatch[2], 10) : undefined
  const lineEnd = metaMatch?.[3] ? Number.parseInt(metaMatch[3], 10) : undefined
  const charCount = metaMatch?.[4] ? Number.parseInt(metaMatch[4], 10) : undefined

  return {
    sourceTitle,
    sourceKind: 'text',
    ...(sourceFilePath ? { sourceFilePath } : {}),
    ...(Number.isFinite(lineStart) ? { lineStart } : {}),
    ...(Number.isFinite(lineEnd) ? { lineEnd } : {}),
    ...(Number.isFinite(charCount) ? { charCount } : {})
  }
}

function consumeQuoteSection(text: string): { quote: WritePromptDisplayQuote | null; rest: string } {
  if (!text.startsWith(WRITE_QUOTE_HEADING)) return { quote: null, rest: text }
  const firstLineEnd = text.indexOf('\n')
  if (firstLineEnd < 0) return { quote: null, rest: text }

  const header = text.slice(0, firstLineEnd).trim()
  let rest = text.slice(firstLineEnd + 1).trimStart()
  if (!rest.startsWith(WRITE_QUOTE_ORIGINAL_START)) {
    return { quote: null, rest: text }
  }

  rest = rest.slice(WRITE_QUOTE_ORIGINAL_START.length).trimStart()
  const originalEnd = rest.indexOf(WRITE_QUOTE_ORIGINAL_END)
  if (originalEnd < 0) return { quote: null, rest: text }

  const quotedText = rest.slice(0, originalEnd).trim()
  const afterQuote = rest.slice(originalEnd + WRITE_QUOTE_ORIGINAL_END.length).trimStart()
  return {
    quote: {
      ...parseQuoteHeader(header),
      text: quotedText
    },
    rest: afterQuote
  }
}

export function parseWritePromptForDisplay(text: string): WritePromptDisplay | null {
  const normalized = text.replace(/\r\n?/g, '\n').trim()
  if (!normalized.includes(WRITE_CONTEXT_HEADING) && !normalized.includes(WRITE_QUOTE_HEADING)) {
    return null
  }

  let rest = normalized
  let context: WritePromptDisplayContext | null = null
  const quotes: WritePromptDisplayQuote[] = []

  if (rest.startsWith(WRITE_CONTEXT_HEADING)) {
    rest = rest.slice(WRITE_CONTEXT_HEADING.length).trimStart()
    const contextSection = splitFirstSection(rest)
    context = parseContextBlock(contextSection.head)
    rest = contextSection.rest
  }

  while (rest.startsWith(WRITE_QUOTE_HEADING)) {
    const consumed = consumeQuoteSection(rest)
    if (!consumed.quote) break
    quotes.push(consumed.quote)
    rest = consumed.rest
  }

  if (!context && quotes.length === 0) return null

  return {
    userInput: rest.trim(),
    context,
    quotes
  }
}
