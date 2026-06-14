import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type RefObject
} from 'react'
import { ChevronLeft, ChevronRight, FileText, Loader2, Minus, Plus, Quote, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type TextContentItem
} from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_MIN_SCALE = 0.65
const PDF_MAX_SCALE = 2.4
const PDF_SCALE_STEP = 0.1
const DEFAULT_PDF_SCALE = 1.15
const MAX_SELECTION_FRAGMENT_RECTS = 6000
const LINE_MERGE_WINDOW = 6

type PageText = {
  page: number
  text: string
}

type ViewportRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type WritePdfSelectionAnchorRect = {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}

export type WritePdfSelectionPageRect = {
  page: number
  x: number
  y: number
  width: number
  height: number
}

export type WritePdfSelectionRange = {
  from: number
  to: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  text: string
  charCount: number
  page: number
}

export type WritePdfSelectionMetadata = {
  sourceKind: 'pdf'
  filePath: string
  sourceTitle: string
  mimeType: string
  size?: number
  mtimeMs?: number
  pageStart?: number
  pageEnd?: number
  pageCount?: number
  rects: WritePdfSelectionPageRect[]
}

export type WritePdfSelection = {
  text: string
  ranges: WritePdfSelectionRange[]
  charCount: number
  sourceKind: 'pdf'
  pageStart?: number
  pageEnd?: number
  anchorRect?: WritePdfSelectionAnchorRect
  rects?: WritePdfSelectionPageRect[]
  metadata: WritePdfSelectionMetadata
}

export type WritePdfViewerProps = {
  filePath: string
  dataBase64?: string
  data?: Uint8Array | ArrayBuffer
  sourceUrl?: string
  mimeType?: string
  size?: number
  mtimeMs?: number
  workspaceRoot?: string
  className?: string
  viewerRef?: RefObject<HTMLDivElement | null>
  initialPage?: number
  initialScale?: number
  onSelectionChange?: (selection: WritePdfSelection) => void
  onQuoteSelection?: (selection: WritePdfSelection) => void
}

type PdfSelectionContext = {
  filePath: string
  sourceTitle: string
  mimeType: string
  size?: number
  mtimeMs?: number
  pageCount?: number
}

const PDF_VIEWER_CSS = `
.write-pdf-viewer {
  user-select: text;
  -webkit-user-select: text;
}

.write-pdf-icon-button {
  display: inline-flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--ds-muted);
  transition: background 0.12s ease, color 0.12s ease, opacity 0.12s ease;
}

.write-pdf-icon-button:hover:not(:disabled) {
  background: var(--ds-hover);
  color: var(--ds-ink);
}

.write-pdf-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.write-pdf-page-input {
  width: 44px;
  border: 0;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.72);
  padding: 3px 6px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-ink);
  outline: none;
}

[data-theme='dark'] .write-pdf-page-input {
  background: rgba(255, 255, 255, 0.08);
}

.write-pdf-page {
  position: relative;
  overflow: hidden;
  border-radius: 6px;
  background: #fff;
  user-select: text;
  -webkit-user-select: text;
  box-shadow:
    0 18px 50px rgba(20, 47, 95, 0.14),
    0 0 0 1px rgba(15, 23, 42, 0.08);
}

.write-pdf-canvas,
.write-pdf-text-layer,
.write-pdf-overlay-layer {
  position: absolute;
  inset: 0;
}

.write-pdf-canvas {
  display: block;
}

.write-pdf-text-layer {
  z-index: 1;
  overflow: hidden;
  opacity: 1;
  pointer-events: auto;
  line-height: 1;
  text-align: initial;
  caret-color: var(--ds-ink);
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  user-select: text;
  -webkit-user-select: text;
}

.write-pdf-text-layer :is(span, br) {
  color: rgba(0, 0, 0, 0.01);
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
  -webkit-user-select: text;
  z-index: 1;
}

.write-pdf-text-layer span.markedContent {
  top: 0;
  height: 0;
}

.write-pdf-text-layer span[role='img'] {
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.write-pdf-text-layer ::selection {
  background: var(--write-selection-bg, var(--ds-selection));
}

.write-pdf-text-layer br::selection,
.write-pdf-text-layer .write-pdf-text-ws::selection {
  background: transparent;
}

.write-pdf-text-layer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}

.write-pdf-overlay-layer {
  z-index: 2;
  pointer-events: none;
}

.write-pdf-selection-rect {
  position: absolute;
  border-radius: 3px;
  background: var(--write-selection-bg, var(--ds-selection));
}

.write-pdf-viewer[data-live-selection] .write-pdf-selection-rect {
  opacity: 0;
}
`

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function basenameFromPath(value: string): string {
  const normalized = normalizePath(value)
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

function relativeToWorkspace(workspaceRoot: string | undefined, filePath: string): string {
  const root = normalizePath(workspaceRoot ?? '')
  const file = normalizePath(filePath)
  const prefix = `${root}/`
  if (root && file.startsWith(prefix)) return file.slice(prefix.length)
  return basenameFromPath(filePath)
}

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function nextScale(value: number, direction: 1 | -1): number {
  return clamp(Number((value + direction * PDF_SCALE_STEP).toFixed(2)), PDF_MIN_SCALE, PDF_MAX_SCALE)
}

function bytesFromBase64(base64: string): Uint8Array {
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const binary = window.atob(payload.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function clonePdfData(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data)
  return new Uint8Array(data.slice(0))
}

function documentSourceFromProps({
  data,
  dataBase64,
  sourceUrl
}: Pick<WritePdfViewerProps, 'data' | 'dataBase64' | 'sourceUrl'>): unknown {
  if (data) {
    return {
      data: clonePdfData(data),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  if (dataBase64?.trim()) {
    return {
      data: bytesFromBase64(dataBase64),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  if (sourceUrl?.trim()) {
    return {
      url: sourceUrl.trim(),
      isEvalSupported: false,
      useSystemFonts: true
    }
  }
  throw new Error('No PDF data source was provided.')
}

function unionRects(rects: DOMRect[]): WritePdfSelectionAnchorRect | undefined {
  if (rects.length === 0) return undefined
  let left = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    left = Math.min(left, rect.left)
    right = Math.max(right, rect.right)
    top = Math.min(top, rect.top)
    bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left) || !Number.isFinite(right) || !Number.isFinite(top) || !Number.isFinite(bottom)) {
    return undefined
  }
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top
  }
}

function anchorRectFromDomRect(rect: DOMRect): WritePdfSelectionAnchorRect | undefined {
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0 || rect.height <= 0) {
    return undefined
  }
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  }
}

function isSelectionBackward(selection: Selection): boolean {
  const anchor = selection.anchorNode
  const focus = selection.focusNode
  if (!anchor || !focus) return false
  if (anchor === focus) return selection.anchorOffset > selection.focusOffset
  return Boolean(anchor.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_PRECEDING)
}

function intersects(a: ViewportRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function collectRangeTextRects(range: Range): DOMRect[] {
  const doc = range.startContainer.ownerDocument ?? window.document
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  const probe = doc.createRange()
  const rects: DOMRect[] = []

  let node: Node | null
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    walker.currentNode = range.startContainer
    node = range.startContainer
  } else {
    walker.currentNode = range.startContainer
    node = walker.nextNode()
  }

  while (node && rects.length < MAX_SELECTION_FRAGMENT_RECTS) {
    if (range.comparePoint(node, 0) > 0) break
    const text = node as Text
    if (text.data.trim() && range.intersectsNode(text)) {
      probe.selectNodeContents(text)
      if (text === range.startContainer) probe.setStart(text, range.startOffset)
      if (text === range.endContainer) probe.setEnd(text, range.endOffset)
      for (const rect of probe.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) rects.push(rect)
      }
    }
    if (text === range.endContainer) break
    node = walker.nextNode()
  }
  probe.detach()
  return rects
}

function mergeRectsIntoLineBars(rects: DOMRect[]): ViewportRect[] {
  if (rects.length === 0) return []
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  type LineBucket = { top: number; bottom: number; segments: Array<{ left: number; right: number }> }
  const lines: LineBucket[] = []

  for (const rect of sorted) {
    let target: LineBucket | null = null
    for (let index = lines.length - 1; index >= 0 && index >= lines.length - LINE_MERGE_WINDOW; index -= 1) {
      const line = lines[index]
      const overlap = Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top)
      if (overlap > 0 && overlap >= Math.min(line.bottom - line.top, rect.height) * 0.45) {
        target = line
        break
      }
    }
    if (target) {
      target.top = Math.min(target.top, rect.top)
      target.bottom = Math.max(target.bottom, rect.bottom)
      target.segments.push({ left: rect.left, right: rect.right })
    } else {
      lines.push({ top: rect.top, bottom: rect.bottom, segments: [{ left: rect.left, right: rect.right }] })
    }
  }

  const bars: ViewportRect[] = []
  for (const line of lines) {
    const gapLimit = Math.max(10, (line.bottom - line.top) * 0.85)
    const segments = [...line.segments].sort((a, b) => a.left - b.left)
    let current = { ...segments[0] }
    for (let index = 1; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment.left - current.right <= gapLimit) {
        current.right = Math.max(current.right, segment.right)
      } else {
        bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
        current = { ...segment }
      }
    }
    bars.push({ left: current.left, right: current.right, top: line.top, bottom: line.bottom })
  }
  return bars
}

function pageRectsFromViewportRects(root: HTMLElement, rects: ViewportRect[]): WritePdfSelectionPageRect[] {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-write-pdf-page]'))
    .map((element) => ({
      element,
      page: Number(element.dataset.writePdfPage ?? ''),
      rect: element.getBoundingClientRect()
    }))
    .filter((page) => Number.isFinite(page.page) && page.page > 0)
  const out: WritePdfSelectionPageRect[] = []

  for (const rect of rects) {
    const page = pages.find((item) => intersects(rect, item.rect))
    if (!page) continue
    const left = Math.max(rect.left, page.rect.left)
    const right = Math.min(rect.right, page.rect.right)
    const top = Math.max(rect.top, page.rect.top)
    const bottom = Math.min(rect.bottom, page.rect.bottom)
    if (right <= left || bottom <= top) continue
    out.push({
      page: page.page,
      x: left - page.rect.left,
      y: top - page.rect.top,
      width: right - left,
      height: bottom - top
    })
  }
  return out
}

function pageFromNode(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement
  const pageElement = element?.closest<HTMLElement>('[data-write-pdf-page]')
  const page = Number(pageElement?.dataset.writePdfPage ?? '')
  return Number.isFinite(page) && page > 0 ? page : null
}

function pageRangeFromSelection(
  selection: Selection,
  pageRects: WritePdfSelectionPageRect[]
): { pageStart: number; pageEnd: number } {
  const rectPages = pageRects.map((rect) => rect.page).filter((page) => Number.isFinite(page) && page > 0)
  if (rectPages.length > 0) {
    return {
      pageStart: Math.min(...rectPages),
      pageEnd: Math.max(...rectPages)
    }
  }
  const pageA = pageFromNode(selection.anchorNode)
  const pageB = pageFromNode(selection.focusNode)
  const pageStart = Math.min(pageA ?? pageB ?? 1, pageB ?? pageA ?? 1)
  const pageEnd = Math.max(pageA ?? pageB ?? pageStart, pageB ?? pageA ?? pageStart)
  return { pageStart, pageEnd }
}

function emptyPdfSelection(context: PdfSelectionContext): WritePdfSelection {
  return {
    text: '',
    ranges: [],
    charCount: 0,
    sourceKind: 'pdf',
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageCount: context.pageCount,
      rects: []
    }
  }
}

function selectionFromPdf(root: HTMLElement, context: PdfSelectionContext): WritePdfSelection {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return emptyPdfSelection(context)
  const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
  const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
  if (!anchorInside || !focusInside) return emptyPdfSelection(context)

  const text = selection.toString().trim()
  if (!text) return emptyPdfSelection(context)
  const range = selection.getRangeAt(0)
  const textRects = collectRangeTextRects(range)
  const rects = pageRectsFromViewportRects(root, mergeRectsIntoLineBars(textRects))
  const { pageStart, pageEnd } = pageRangeFromSelection(selection, rects)
  const backward = isSelectionBackward(selection)
  const focusRect = textRects.length > 0
    ? textRects[backward ? 0 : textRects.length - 1]
    : null
  const anchorRect = (focusRect ? anchorRectFromDomRect(focusRect) : undefined)
    ?? unionRects(textRects)
    ?? anchorRectFromDomRect(range.getBoundingClientRect())

  return {
    text,
    ranges: [{
      from: 0,
      to: text.length,
      startLine: pageStart,
      startColumn: 1,
      endLine: pageEnd,
      endColumn: text.length + 1,
      text,
      charCount: text.length,
      page: pageStart
    }],
    charCount: text.length,
    sourceKind: 'pdf',
    pageStart,
    pageEnd,
    anchorRect,
    rects,
    metadata: {
      sourceKind: 'pdf',
      filePath: context.filePath,
      sourceTitle: context.sourceTitle,
      mimeType: context.mimeType,
      size: context.size,
      mtimeMs: context.mtimeMs,
      pageStart,
      pageEnd,
      pageCount: context.pageCount,
      rects
    }
  }
}

function WritePdfPage({
  document,
  pageNumber,
  scale,
  selectionRects,
  onPageText
}: {
  document: PDFDocumentProxy
  pageNumber: number
  scale: number
  selectionRects: WritePdfSelectionPageRect[]
  onPageText: (page: PageText) => void
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null

    const renderPage = async (): Promise<void> => {
      const canvas = canvasRef.current
      const textLayer = textLayerRef.current
      if (!canvas || !textLayer) return
      textLayer.replaceChildren()
      const page: PDFPageProxy = await document.getPage(pageNumber)
      if (cancelled) {
        page.cleanup()
        return
      }
      const viewport = page.getViewport({ scale })
      const outputScale = Math.max(1, window.devicePixelRatio || 1)
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setPageSize({ width: viewport.width, height: viewport.height })

      const context = canvas.getContext('2d')
      if (!context) {
        page.cleanup()
        return
      }
      context.setTransform(outputScale, 0, 0, outputScale, 0, 0)
      const task = page.render({ canvasContext: context, viewport })
      renderTask = task
      await task.promise
      if (cancelled) {
        page.cleanup()
        return
      }

      const textContent = await page.getTextContent()
      const textLayerRenderer = new TextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport
      })
      await textLayerRenderer.render()
      if (!cancelled) {
        for (const span of Array.from(textLayer.querySelectorAll<HTMLElement>('span'))) {
          if (!(span.textContent ?? '').trim()) span.classList.add('write-pdf-text-ws')
        }
        const pageText = textContent.items
          .map((item: TextContentItem) => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .trim()
        onPageText({ page: pageNumber, text: pageText })
      }
      page.cleanup()
    }

    void renderPage().catch(() => undefined)
    return () => {
      cancelled = true
      try {
        renderTask?.cancel()
      } catch {
        // pdf.js can throw when a completed render task is cancelled during cleanup.
      }
    }
  }, [document, onPageText, pageNumber, scale])

  return (
    <div
      className="write-pdf-page"
      data-write-pdf-page={pageNumber}
      style={pageSize ? { width: pageSize.width, height: pageSize.height } : undefined}
    >
      <canvas ref={canvasRef} className="write-pdf-canvas" />
      <div ref={textLayerRef} className="write-pdf-text-layer textLayer" />
      <div className="write-pdf-overlay-layer" aria-hidden="true">
        {selectionRects.map((rect, index) => (
          <span
            key={`${pageNumber}-${index}-${rect.x}-${rect.y}`}
            className="write-pdf-selection-rect"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function WritePdfViewer({
  filePath,
  dataBase64,
  data,
  sourceUrl,
  mimeType = 'application/pdf',
  size,
  mtimeMs,
  workspaceRoot,
  className,
  viewerRef,
  initialPage = 1,
  initialScale = DEFAULT_PDF_SCALE,
  onSelectionChange,
  onQuoteSelection
}: WritePdfViewerProps): ReactElement {
  const { t } = useTranslation('common')
  const localViewerRef = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const selectionSyncTimerRef = useRef<number | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onQuoteSelectionRef = useRef(onQuoteSelection)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(() => clamp(initialScale, PDF_MIN_SCALE, PDF_MAX_SCALE))
  const [pageInput, setPageInput] = useState(String(Math.max(1, Math.round(initialPage))))
  const [currentPage, setCurrentPage] = useState(Math.max(1, Math.round(initialPage)))
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [pageTexts, setPageTexts] = useState<PageText[]>([])
  const [committedSelection, setCommittedSelection] = useState<WritePdfSelection | null>(null)
  const [committedSelectionRects, setCommittedSelectionRects] = useState<WritePdfSelectionPageRect[]>([])
  const [liveSelection, setLiveSelection] = useState(false)
  const rootRef = viewerRef ?? localViewerRef
  const pageCount = pdfDocument?.numPages ?? 0
  const sourceTitle = useMemo(() => relativeToWorkspace(workspaceRoot, filePath), [filePath, workspaceRoot])
  const fileName = useMemo(() => basenameFromPath(filePath), [filePath])
  const fileSizeLabel = formatBytes(size)
  const selectionContext = useMemo<PdfSelectionContext>(() => ({
    filePath,
    sourceTitle,
    mimeType,
    size,
    mtimeMs,
    pageCount
  }), [filePath, mimeType, mtimeMs, pageCount, size, sourceTitle])

  const label = useCallback((key: string, fallback: string, options: Record<string, unknown> = {}): string => {
    return t(key, { defaultValue: fallback, ...options })
  }, [t])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    onQuoteSelectionRef.current = onQuoteSelection
  }, [onQuoteSelection])

  const emitSelection = useCallback((selection: WritePdfSelection): void => {
    onSelectionChangeRef.current?.(selection)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setPdfDocument(null)
    setPageTexts([])
    setCommittedSelection(null)
    setCommittedSelectionRects([])
    setLiveSelection(false)
    emitSelection(emptyPdfSelection({
      filePath,
      sourceTitle,
      mimeType,
      size,
      mtimeMs
    }))

    let task: ReturnType<typeof getDocument>
    try {
      task = getDocument(documentSourceFromProps({ data, dataBase64, sourceUrl }))
    } catch (reason) {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
      return () => {
        cancelled = true
      }
    }

    void task.promise.then((pdf) => {
      if (cancelled) {
        void pdf.destroy()
        return
      }
      const targetPage = clamp(Math.round(initialPage), 1, pdf.numPages || 1)
      setPdfDocument(pdf)
      setCurrentPage(targetPage)
      setPageInput(String(targetPage))
      setLoading(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data, dataBase64, emitSelection, filePath, initialPage, mimeType, mtimeMs, size, sourceTitle, sourceUrl])

  useEffect(() => {
    setScale(clamp(initialScale, PDF_MIN_SCALE, PDF_MAX_SCALE))
  }, [filePath, initialScale, mtimeMs])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
      if (selectionSyncTimerRef.current != null) {
        window.clearTimeout(selectionSyncTimerRef.current)
        selectionSyncTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const empty = emptyPdfSelection(selectionContext)
    setCommittedSelection(null)
    setCommittedSelectionRects([])
    setLiveSelection(false)
    emitSelection(empty)
  }, [emitSelection, scale, selectionContext])

  const updatePageText = useCallback((page: PageText): void => {
    setPageTexts((current) => {
      const existing = current.find((item) => item.page === page.page)
      if (existing?.text === page.text) return current
      const next = current.filter((item) => item.page !== page.page)
      next.push(page)
      return next.sort((a, b) => a.page - b.page)
    })
  }, [])

  const scrollToPage = useCallback((page: number): void => {
    const clamped = clamp(Math.round(page), 1, pageCount || 1)
    setCurrentPage(clamped)
    setPageInput(String(clamped))
    pageRefs.current.get(clamped)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [pageCount])

  const updateCurrentPageFromScroll = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller || pageRefs.current.size === 0) return
    const scrollerRect = scroller.getBoundingClientRect()
    const targetY = scrollerRect.top + scrollerRect.height * 0.42
    let bestPage = 1
    let bestDistance = Number.POSITIVE_INFINITY

    pageRefs.current.forEach((node, page) => {
      const rect = node.getBoundingClientRect()
      const distance = targetY >= rect.top && targetY <= rect.bottom
        ? 0
        : Math.min(Math.abs(targetY - rect.top), Math.abs(targetY - rect.bottom))
      if (distance < bestDistance) {
        bestDistance = distance
        bestPage = page
      }
    })

    setCurrentPage((value) => value === bestPage ? value : bestPage)
    setPageInput((value) => value === String(bestPage) ? value : String(bestPage))
  }, [])

  const schedulePageSync = useCallback((): void => {
    if (scrollRafRef.current != null) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      updateCurrentPageFromScroll()
    })
  }, [updateCurrentPageFromScroll])

  const searchMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return []
    return pageTexts
      .filter((page) => page.text.toLowerCase().includes(query))
      .map((page) => page.page)
      .sort((a, b) => a - b)
  }, [pageTexts, searchQuery])
  const firstSearchPage = searchMatches[0] ?? null
  const allPageTextLoaded = pageCount > 0 && pageTexts.length >= pageCount
  const pdfHasText = pageTexts.some((page) => page.text.trim().length > 0)
  const committedRectsByPage = useMemo(() => {
    const byPage = new Map<number, WritePdfSelectionPageRect[]>()
    for (const rect of committedSelectionRects) {
      const pageRects = byPage.get(rect.page)
      if (pageRects) pageRects.push(rect)
      else byPage.set(rect.page, [rect])
    }
    return byPage
  }, [committedSelectionRects])

  useEffect(() => {
    setSearchIndex(0)
    if (firstSearchPage != null) scrollToPage(firstSearchPage)
  }, [firstSearchPage, scrollToPage, searchQuery])

  const jumpSearch = useCallback((direction: 1 | -1): void => {
    if (searchMatches.length === 0) return
    const nextIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
    setSearchIndex(nextIndex)
    scrollToPage(searchMatches[nextIndex])
  }, [scrollToPage, searchIndex, searchMatches])

  const syncSelection = useCallback((): void => {
    const root = rootRef.current
    if (!root) return
    const next = selectionFromPdf(root, selectionContext)
    emitSelection(next)
    if (next.text.trim()) {
      setCommittedSelection(next)
      setCommittedSelectionRects(next.rects ?? [])
      setLiveSelection(true)
    } else {
      setCommittedSelection(null)
      setCommittedSelectionRects([])
      setLiveSelection(false)
    }
  }, [emitSelection, rootRef, selectionContext])

  const syncSelectionSoon = useCallback((): void => {
    if (selectionSyncTimerRef.current != null) {
      window.clearTimeout(selectionSyncTimerRef.current)
    }
    selectionSyncTimerRef.current = window.setTimeout(() => {
      selectionSyncTimerRef.current = null
      syncSelection()
    }, 0)
  }, [syncSelection])

  useEffect(() => {
    const handleSelectionChange = (): void => {
      const root = rootRef.current
      const selection = window.getSelection()
      if (!root) return
      if (!selection || selection.rangeCount === 0) {
        setLiveSelection(false)
        return
      }
      const anchorInside = selection.anchorNode ? root.contains(selection.anchorNode) : false
      const focusInside = selection.focusNode ? root.contains(selection.focusNode) : false
      if (anchorInside || focusInside) {
        syncSelectionSoon()
      } else {
        setLiveSelection(false)
      }
    }
    window.document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      window.document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [rootRef, syncSelectionSoon])

  const beginPdfSelection = useCallback((): void => {
    const empty = emptyPdfSelection(selectionContext)
    setCommittedSelection(null)
    setCommittedSelectionRects([])
    setLiveSelection(false)
    emitSelection(empty)
  }, [emitSelection, selectionContext])

  const quoteButtonStyle = useMemo<CSSProperties | undefined>(() => {
    const rect = committedSelection?.anchorRect
    if (!rect) return undefined
    const width = 122
    const left = clamp(rect.left + rect.width / 2 - width / 2, 12, window.innerWidth - width - 12)
    const top = clamp(rect.bottom + 8, 12, window.innerHeight - 44)
    return { left, top, width }
  }, [committedSelection])

  const submitQuoteSelection = useCallback((): void => {
    if (!committedSelection?.text.trim()) return
    onQuoteSelectionRef.current?.(committedSelection)
  }, [committedSelection])

  const matchLabel = searchQuery.trim()
    ? `${searchMatches.length ? Math.min(searchIndex + 1, searchMatches.length) : 0}/${searchMatches.length}`
    : ''

  return (
    <div
      ref={rootRef}
      className={`write-pdf-viewer flex h-full min-h-0 min-w-0 flex-col ${className ?? ''}`}
      data-live-selection={liveSelection ? '' : undefined}
    >
      <style>{PDF_VIEWER_CSS}</style>
      <div className="shrink-0 border-b border-ds-border-muted bg-white/88 px-3 py-2 backdrop-blur-xl dark:bg-ds-card/95">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-[180px] flex-1 items-center gap-2 overflow-hidden">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-700 dark:text-red-300">
              <FileText className="h-4 w-4" strokeWidth={1.85} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-ds-ink" title={filePath}>
                {fileName}
              </div>
              <div className="truncate text-[11.5px] text-ds-faint" title={sourceTitle}>
                {[fileSizeLabel, sourceTitle].filter(Boolean).join(' · ')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfZoomOut', 'Zoom PDF out')}
              aria-label={label('writePdfZoomOut', 'Zoom PDF out')}
              onClick={() => setScale((value) => nextScale(value, -1))}
            >
              <Minus className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <span className="min-w-[52px] text-center text-[12px] font-semibold text-ds-muted">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfZoomIn', 'Zoom PDF in')}
              aria-label={label('writePdfZoomIn', 'Zoom PDF in')}
              onClick={() => setScale((value) => nextScale(value, 1))}
            >
              <Plus className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle p-1 dark:bg-white/6">
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfPrevPage', 'Previous page')}
              aria-label={label('writePdfPrevPage', 'Previous page')}
              onClick={() => scrollToPage(currentPage - 1)}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                scrollToPage(Number(pageInput))
              }}
            >
              <input
                className="write-pdf-page-input"
                value={pageInput}
                aria-label={label('writePdfPageInput', 'PDF page')}
                onChange={(event) => setPageInput(event.target.value)}
              />
              <span className="text-[12px] text-ds-faint">/ {pageCount || '-'}</span>
            </form>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfNextPage', 'Next page')}
              aria-label={label('writePdfNextPage', 'Next page')}
              onClick={() => scrollToPage(currentPage + 1)}
              disabled={!pageCount || currentPage >= pageCount}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>

          <div className="flex min-w-[190px] flex-1 items-center gap-1 rounded-lg border border-ds-border-muted bg-ds-surface-subtle px-2 py-1 dark:bg-white/6 sm:max-w-[280px]">
            <Search className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />
            <input
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none placeholder:text-ds-faint"
              value={searchQuery}
              placeholder={label('writePdfSearchPlaceholder', 'Search PDF')}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <span className="min-w-[42px] shrink-0 text-right text-[11px] text-ds-faint">
              {matchLabel}
            </span>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfPrevMatch', 'Previous match')}
              aria-label={label('writePdfPrevMatch', 'Previous match')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(-1)}
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="write-pdf-icon-button"
              title={label('writePdfNextMatch', 'Next match')}
              aria-label={label('writePdfNextMatch', 'Next match')}
              disabled={searchMatches.length === 0}
              onClick={() => jumpSearch(1)}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-auto bg-ds-main/55 px-4 py-5 dark:bg-black/20"
        onPointerDown={beginPdfSelection}
        onPointerUp={syncSelectionSoon}
        onMouseUp={syncSelectionSoon}
        onKeyUp={syncSelectionSoon}
        onScroll={schedulePageSync}
      >
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center gap-2 text-[13px] text-ds-muted">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            {label('writePdfLoading', 'Opening PDF...')}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-[13px] leading-6 text-red-600 dark:text-red-300">
            {label('writePdfLoadFailed', 'PDF failed to open: {{message}}', { message: error })}
          </div>
        ) : pdfDocument ? (
          <div className="mx-auto flex w-max max-w-full flex-col items-center gap-5">
            {allPageTextLoaded && !pdfHasText ? (
              <div className="max-w-[560px] rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/36 dark:text-amber-100">
                {label(
                  'writePdfNoTextLayer',
                  'This PDF has no extractable text layer. The page image remains readable.'
                )}
              </div>
            ) : null}
            {Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1).map((pageNumber) => (
              <div
                key={pageNumber}
                ref={(node) => {
                  if (node) pageRefs.current.set(pageNumber, node)
                  else pageRefs.current.delete(pageNumber)
                }}
              >
                <WritePdfPage
                  document={pdfDocument}
                  pageNumber={pageNumber}
                  scale={scale}
                  selectionRects={committedRectsByPage.get(pageNumber) ?? []}
                  onPageText={updatePageText}
                />
                <div className="mt-1 text-center text-[11px] text-ds-faint">
                  {label('writePdfPageLabel', 'Page {{page}}', { page: pageNumber })}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {onQuoteSelection && committedSelection?.text.trim() && quoteButtonStyle ? (
        <button
          type="button"
          data-selection-ignore="true"
          className="fixed z-50 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-semibold text-ds-ink shadow-[0_14px_34px_rgba(15,23,42,0.16)] transition hover:bg-ds-hover"
          style={quoteButtonStyle}
          onMouseDown={(event) => event.preventDefault()}
          onClick={submitQuoteSelection}
        >
          <Quote className="h-3.5 w-3.5" strokeWidth={2} />
          {label('writeSelectionQuote', 'Add quote')}
        </button>
      ) : null}
    </div>
  )
}
