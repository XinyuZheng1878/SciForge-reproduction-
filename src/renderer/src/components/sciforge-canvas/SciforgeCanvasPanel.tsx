import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AllSelection } from '@tiptap/pm/state'
import type {
  SciforgeCanvasOpenResult,
  SciforgeCanvasReviewPacketResult,
  SciforgeCanvasReviewPacketModificationSuggestion,
  SciforgeCanvasSelectedShape,
  SciforgeCanvasSelectionState
} from '@shared/sciforge-canvas'
import {
  Download,
  Frame,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  Send,
  RefreshCw,
  Square,
  Upload,
  X
} from 'lucide-react'
import {
  DefaultColorStyle,
  Tldraw,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  startEditingShapeWithRichText,
  toRichText,
  type Editor,
  type TLComponents,
  type TLShapeId
} from 'tldraw'
import 'tldraw/tldraw.css'
import './SciforgeCanvasPanel.css'

type Props = {
  workspaceRoot: string
  canvasId?: string
  className?: string
  onCollapse?: () => void
  variant?: 'standalone' | 'embedded'
  onSendReviewRequest?: (text: string) => void
}

type CanvasSnapshot = Extract<SciforgeCanvasOpenResult, { ok: true }>['snapshot']
type SelectedAnnotation = {
  id: string
  text: string
  kind: AnnotationMode
}
type TldrawShape = NonNullable<ReturnType<Editor['getShape']>>
type AnnotationMode = 'arrow' | 'box'
type AnnotationToolPickerProps = {
  activeMode: AnnotationMode | null
  variant: 'toolbar' | 'floating'
  onSelect: (mode: AnnotationMode) => void
}
type AnnotationDragState = {
  shapeId: TLShapeId
  mode: AnnotationMode
  markId: string
  origin: { x: number; y: number }
}

const DEFAULT_CANVAS_ID = 'default'
const DEFAULT_PAGE_ID = 'page:sciforge-canvas'
const DEFAULT_PAGE_NAME = 'SciForge Canvas'
const DEFAULT_PAGE_INDEX = 'a1'
const AI_IMAGE_HOLDER_LABEL = '占位框'
const AI_IMAGE_HOLDER_TITLE = '创建一个目标区域，用于定位后续生成图、科研图或 PPT 修订图；它不是新页面，也不会生成图片'
const AI_IMAGE_HOLDER_DEFAULT_W = 320
const AI_IMAGE_HOLDER_DEFAULT_H = 220
const ANNOTATION_ARROW_LABEL = '箭头'
const ANNOTATION_BOX_LABEL = '范围框'
const ANNOTATION_TOOL_LABEL = '批注'
const ANNOTATION_DEFAULT_TEXT = '批注'
const ANNOTATION_DEFAULT_COLOR = 'blue'
const ANNOTATION_COMPATIBLE_COLORS = new Set([ANNOTATION_DEFAULT_COLOR, 'red'])
const ANNOTATION_MIN_LENGTH = 8
const ANNOTATION_BEND_RATIO = 0.12
const ANNOTATION_MIN_BEND = 16
const ANNOTATION_MAX_BEND = 48
const ANNOTATION_LABEL_POSITION = 0
const ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS = 8
const ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS = 4
const MAX_SELECTION_ASSET_SRC_LENGTH = 512
const IMPORT_RECENT_TIMEOUT_MS = 25_000
const CURRENT_CANVAS_IMPORT_MAX_AGE_MS = 2 * 60 * 60 * 1000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

const SCIFORGE_CANVAS_TLDRAW_COMPONENTS: TLComponents = {
  ActionsMenu: null,
  HelpMenu: null,
  MainMenu: null,
  NavigationPanel: null,
  PageMenu: null,
  QuickActions: null,
  StylePanel: null,
  Toolbar: null,
  ZoomMenu: null
}

function createCurrentTldrawCanvasSnapshot(): CanvasSnapshot {
  const store = createTLStore({
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils
  })
  try {
    const snapshot = store.getStoreSnapshot() as { schema: unknown }
    return {
      schema: structuredClone(snapshot.schema),
      store: {
        [DEFAULT_PAGE_ID]: {
          id: DEFAULT_PAGE_ID,
          typeName: 'page',
          name: DEFAULT_PAGE_NAME,
          index: DEFAULT_PAGE_INDEX,
          meta: {
            sciforgeCanvas: true
          }
        }
      }
    }
  } finally {
    store.dispose()
  }
}

function validateCanvasSnapshotForTldraw(snapshot: unknown): { ok: true } | { ok: false; message: string } {
  let store: ReturnType<typeof createTLStore> | null = null
  try {
    store = createTLStore({
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      snapshot: snapshot as never
    })
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    store?.dispose()
  }
}

function cloneCanvasSnapshot(snapshot: unknown): CanvasSnapshot {
  return structuredClone(snapshot) as CanvasSnapshot
}

function dehydrateCanvasSnapshotForSave(snapshot: unknown): CanvasSnapshot {
  const next = cloneCanvasSnapshot(snapshot)
  const store = (next as { store?: Record<string, unknown> }).store
  if (!store) return next

  for (const record of Object.values(store)) {
    const asset = record as {
      typeName?: string
      type?: string
      props?: Record<string, unknown>
      meta?: Record<string, unknown>
    }
    if (asset.typeName !== 'asset' || asset.type !== 'image' || !asset.props) continue
    const src = asset.props.src
    if (typeof src !== 'string' || !src.startsWith('data:')) continue
    asset.props.src = ''
    asset.meta = {
      ...(asset.meta ?? {}),
      sciforgeCanvasDataUrlStripped: true
    }
  }

  return next
}

async function hydrateCanvasSnapshotForTldraw(snapshot: unknown, workspaceRoot: string): Promise<CanvasSnapshot> {
  const next = cloneCanvasSnapshot(snapshot)
  const store = (next as { store?: Record<string, unknown> }).store
  if (!store || typeof window.sciforge?.readWorkspaceImage !== 'function') return next

  await Promise.all(Object.values(store).map(async (record) => {
    const asset = record as {
      typeName?: string
      type?: string
      props?: Record<string, unknown>
      meta?: Record<string, unknown>
    }
    if (asset.typeName !== 'asset' || asset.type !== 'image' || !asset.props) return
    if (typeof asset.props.src === 'string' && asset.props.src.startsWith('data:')) return
    const assetPath = canvasAssetFilePath(asset.meta) || canvasAssetSourcePath(asset.meta)
    if (!assetPath) return
    const result = await window.sciforge.readWorkspaceImage({ workspaceRoot, path: assetPath })
    if (!result.ok) return
    asset.props.src = result.dataUrl
    if (!asset.props.mimeType) asset.props.mimeType = result.mimeType
    if (!asset.props.fileSize) asset.props.fileSize = result.size
  }))

  return next
}

function canvasAssetFilePath(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.sciforgeCanvasAssetFile
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function canvasAssetSourcePath(meta: Record<string, unknown> | undefined): string | null {
  const value = meta?.sciforgeCanvasSourcePath
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type AiImageHolderShapeOverrides = {
  x?: number
  y?: number
  meta?: Record<string, unknown>
  props?: Record<string, unknown>
}

function getAiImageHolderMeta(): Record<string, unknown> {
  return {
    cowartAiImageHolder: true,
    cowartAiImageHolderVersion: 1,
    sciforgeCanvasAiImageHolder: true
  }
}

function createAiImageHolderShape(
  editor: Editor,
  id: TLShapeId,
  shapeOverrides: AiImageHolderShapeOverrides = {}
): void {
  const scale = editor.getResizeScaleFactor()
  const frameProps = { ...(shapeOverrides.props ?? {}) }
  delete frameProps.scale

  editor.createShape({
    id,
    type: 'frame',
    ...(typeof shapeOverrides.x === 'number' ? { x: shapeOverrides.x } : {}),
    ...(typeof shapeOverrides.y === 'number' ? { y: shapeOverrides.y } : {}),
    meta: {
      ...getAiImageHolderMeta(),
      ...(shapeOverrides.meta ?? {})
    },
    props: {
      w: AI_IMAGE_HOLDER_DEFAULT_W * scale,
      h: AI_IMAGE_HOLDER_DEFAULT_H * scale,
      name: AI_IMAGE_HOLDER_LABEL,
      color: 'blue',
      ...frameProps
    }
  } as never)
}

function createAiImageHolderAtViewportCenter(editor: Editor): TLShapeId {
  const scale = editor.getResizeScaleFactor()
  const w = AI_IMAGE_HOLDER_DEFAULT_W * scale
  const h = AI_IMAGE_HOLDER_DEFAULT_H * scale
  const center = editor.getViewportPageBounds().center
  const id = createShapeId()

  createAiImageHolderShape(editor, id, {
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { w, h }
  })
  editor.select(id)
  editor.setCurrentTool('select.idle')
  return id
}

function startEditingAnnotationArrowLabel(editor: Editor, arrowId: TLShapeId): void {
  const shape = editor.getShape(arrowId)
  if (!shape || !editor.canEditShape(shape)) return

  editor.select(arrowId)
  startEditingShapeWithRichText(editor, arrowId, { selectAll: true })
  pinAnnotationArrowLabelPosition(editor, arrowId)
  selectAnnotationTextWhenReady(editor, arrowId)
}

function startEditingAnnotationBoxLabel(editor: Editor, boxId: TLShapeId): void {
  const shape = editor.getShape(boxId)
  if (!shape || !editor.canEditShape(shape)) return

  editor.select(boxId)
  startEditingShapeWithRichText(editor, boxId, { selectAll: true })
  selectAnnotationTextWhenReady(editor, boxId)
}

function startEditingAnnotationLabel(editor: Editor, shapeId: TLShapeId): void {
  const shape = editor.getShape(shapeId)
  if (!shape) return
  if (isAnnotationArrowShape(shape)) {
    startEditingAnnotationArrowLabel(editor, shapeId)
  } else if (isAnnotationBoxShape(shape)) {
    startEditingAnnotationBoxLabel(editor, shapeId)
  }
}

function pinAnnotationArrowLabelPosition(editor: Editor, arrowId: TLShapeId, attempt = 0): void {
  editor.timers.setTimeout(() => {
    const shape = editor.getShape(arrowId)
    if (!shape || !isAnnotationArrowShape(shape)) return
    const props = shape.props as Record<string, unknown>
    if (props.labelPosition !== ANNOTATION_LABEL_POSITION) {
      editor.updateShapes([
        {
          id: arrowId,
          type: 'arrow',
          props: {
            labelPosition: ANNOTATION_LABEL_POSITION
          }
        }
      ] as never)
    }

    if (attempt < 2 && editor.getEditingShapeId() === arrowId) {
      pinAnnotationArrowLabelPosition(editor, arrowId, attempt + 1)
    }
  }, 16)
}

function unlockGlobalToolLock(editor: Editor): void {
  if (!editor.getInstanceState().isToolLocked) return
  editor.updateInstanceState({ isToolLocked: false })
}

function selectAnnotationTextWhenReady(editor: Editor, arrowId: TLShapeId, attempt = 0): void {
  editor.timers.setTimeout(() => {
    if (editor.getEditingShapeId() !== arrowId) return

    const textEditor = editor.getRichTextEditor()
    if (textEditor) {
      textEditor.view.focus()
      textEditor.view.dispatch(
        textEditor.state.tr.setSelection(new AllSelection(textEditor.state.doc)).scrollIntoView()
      )
    }

    const didSelectText = selectAnnotationTextRange(editor, arrowId)
    if (didSelectText && attempt >= ANNOTATION_SELECT_TEXT_SETTLE_ATTEMPTS) return

    if (attempt < ANNOTATION_SELECT_TEXT_MAX_ATTEMPTS) {
      selectAnnotationTextWhenReady(editor, arrowId, attempt + 1)
    }
  }, 16)
}

function selectAnnotationTextRange(editor: Editor, arrowId: TLShapeId): boolean {
  const doc = editor.getContainer().ownerDocument
  const shapeElement = Array.from(doc.querySelectorAll('[data-shape-id]')).find(
    (element) => element.getAttribute('data-shape-id') === arrowId
  )
  const editable = shapeElement?.querySelector('[contenteditable="true"]')

  if (!(editable instanceof HTMLElement)) return false

  editable.focus()
  const textNodes = getTextNodes(editable)
  if (textNodes.length === 0) {
    return doc.activeElement === editable || editable.contains(doc.activeElement)
  }

  const range = doc.createRange()
  const firstTextNode = textNodes[0]
  const lastTextNode = textNodes[textNodes.length - 1]
  range.setStart(firstTextNode, 0)
  range.setEnd(lastTextNode, lastTextNode.textContent?.length ?? 0)

  const selection = doc.getSelection()
  if (!selection) return false

  selection.removeAllRanges()
  selection.addRange(range)
  doc.execCommand?.('selectAll')

  return selection.rangeCount > 0 && selection.toString() === editable.textContent
}

function getTextNodes(node: Node, textNodes: Text[] = []): Text[] {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE && child.textContent) {
      textNodes.push(child as Text)
    } else {
      getTextNodes(child, textNodes)
    }
  })
  return textNodes
}

function getDefaultAnnotationArrowBend(dx: number, dy: number, scale: number): number {
  const length = Math.hypot(dx, dy)
  if (length === 0) return 0

  const bend = Math.min(
    Math.max(length * ANNOTATION_BEND_RATIO, ANNOTATION_MIN_BEND * scale),
    ANNOTATION_MAX_BEND * scale
  )

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? -bend : bend
  }

  return bend
}

function getAnnotationColor(editor: Editor): string {
  const color = editor.getStyleForNextShape(DefaultColorStyle)
  return color === DefaultColorStyle.defaultValue ? ANNOTATION_DEFAULT_COLOR : String(color)
}

function isAnnotationColorToken(value: unknown): boolean {
  return typeof value === 'string' && ANNOTATION_COMPATIBLE_COLORS.has(value)
}

function AnnotationToolPicker({
  activeMode,
  variant,
  onSelect
}: AnnotationToolPickerProps): ReactElement {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const isFloating = variant === 'floating'
  const active = activeMode === 'arrow' || activeMode === 'box'
  const triggerClassName = isFloating
    ? `sciforge-canvas-cowart-tool ${active ? 'is-active' : ''}`
    : `inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover ${active ? 'bg-ds-hover' : ''}`
  const menuClassName = isFloating
    ? 'absolute bottom-full left-0 z-20 mb-2 min-w-[172px] rounded-lg border border-ds-border bg-ds-bg-elevated p-1 shadow-lg'
    : 'absolute left-0 top-full z-20 mt-1 min-w-[172px] rounded-lg border border-ds-border bg-ds-bg-elevated p-1 shadow-lg'

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  const selectMode = (mode: AnnotationMode): void => {
    setOpen(false)
    onSelect(mode)
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-flex"
      onPointerDown={(event) => {
        if (isFloating) event.stopPropagation()
      }}
    >
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active}
        title="选择批注工具"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <MessageSquarePlus className={isFloating ? 'sciforge-canvas-cowart-tool-icon' : 'h-3.5 w-3.5'} aria-hidden="true" />
        <span>{ANNOTATION_TOOL_LABEL}</span>
        <ChevronDown className={isFloating ? 'h-3 w-3 opacity-70' : 'h-3 w-3 text-ds-muted'} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className={menuClassName}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ds-text hover:bg-ds-hover"
            role="menuitem"
            onClick={() => selectMode('arrow')}
          >
            <MessageSquarePlus className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-medium">{ANNOTATION_ARROW_LABEL}</span>
              <span className="block text-[11px] text-ds-muted">指出方向或具体点位</span>
            </span>
          </button>
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ds-text hover:bg-ds-hover"
            role="menuitem"
            onClick={() => selectMode('box')}
          >
            <Square className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-medium">{ANNOTATION_BOX_LABEL}</span>
              <span className="block text-[11px] text-ds-muted">圈定一块需要修改的区域</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function SciforgeCanvasPanel({
  workspaceRoot,
  canvasId = DEFAULT_CANVAS_ID,
  className = '',
  onCollapse,
  variant = 'standalone',
  onSendReviewRequest
}: Props): ReactElement {
  const [snapshot, setSnapshot] = useState<CanvasSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [importingRecent, setImportingRecent] = useState(false)
  const [sendingReviewRequest, setSendingReviewRequest] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [packetPath, setPacketPath] = useState<string | null>(null)
  const [packetSuggestions, setPacketSuggestions] = useState<SciforgeCanvasReviewPacketModificationSuggestion[]>([])
  const [selectedCount, setSelectedCount] = useState(0)
  const [selectedAnnotation, setSelectedAnnotation] = useState<SelectedAnnotation | null>(null)
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [annotationCaptureMode, setAnnotationCaptureMode] = useState<AnnotationMode | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const annotationInputRef = useRef<HTMLInputElement | null>(null)
  const annotationDraftEditingRef = useRef(false)
  const annotationDragRef = useRef<AnnotationDragState | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSelectionRef = useRef('')
  const annotationCaptureActive = annotationCaptureMode !== null

  const loadCanvas = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    if (!workspaceRoot.trim()) {
      setMessage('请先打开一个工作区，然后再使用画布审改。')
      setSnapshot(null)
      setLoading(false)
      return
    }
    try {
      const result = await window.sciforge.openSciforgeCanvas({ workspaceRoot, canvasId })
      if (!result.ok) {
        setMessage(result.message)
        setSnapshot(null)
        return
      }
      const hydratedSnapshot = await hydrateCanvasSnapshotForTldraw(result.snapshot, workspaceRoot)
      const validation = validateCanvasSnapshotForTldraw(hydratedSnapshot)
      if (!validation.ok) {
        setMessage(`画布快照无法被当前 tldraw 版本加载：${validation.message}`)
        setSnapshot(null)
        return
      }
      setSnapshot(hydratedSnapshot)
      setSelectedCount(result.selection.selectedShapes.length)
      setSelectedAnnotation(null)
      setAnnotationDraft('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [canvasId, workspaceRoot])

  useEffect(() => {
    void loadCanvas()
  }, [loadCanvas])

  const saveCanvasNow = useCallback(async (editor: Editor): Promise<boolean> => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    setSaving(true)
    try {
      const result = await window.sciforge.saveSciforgeCanvas({
        workspaceRoot,
        canvasId,
        snapshot: dehydrateCanvasSnapshotForSave(editor.store.getStoreSnapshot())
      })
      if (!result.ok) {
        setMessage(result.message)
        return false
      }
      return true
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSaving(false)
    }
  }, [canvasId, workspaceRoot])

  const saveCanvas = useCallback((editor: Editor) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveCanvasNow(editor)
    }, 450)
  }, [saveCanvasNow])

  const saveSelection = useCallback(async (editor: Editor, force = false): Promise<SciforgeCanvasSelectionState> => {
    const selection = getSelectionSnapshot(editor)
    const next = JSON.stringify(selection)
    if (next === lastSelectionRef.current && !force) return selection
    lastSelectionRef.current = next
    setSelectedCount(selection.selectedShapes.length)
    const nextAnnotation = getSelectedAnnotation(editor)
    setSelectedAnnotation((current) => keepStableSelectedAnnotation(current, nextAnnotation))
    if (!annotationDraftEditingRef.current) setAnnotationDraft(nextAnnotation?.text ?? '')
    await window.sciforge.saveSciforgeCanvasSelection({
      workspaceRoot,
      canvasId,
      selection
    })
    return selection
  }, [canvasId, workspaceRoot])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    let isSyncingAnnotationRecords = false
    const saveInitial = window.setTimeout(() => saveCanvas(editor), 120)
    const selectionTimer = window.setInterval(() => {
      void saveSelection(editor)
    }, 300)
    const unsubscribeDocument = editor.store.listen(
      () => saveCanvas(editor),
      { source: 'user', scope: 'document' }
    )
    const unsubscribeSession = editor.store.listen(
      () => saveSelection(editor),
      { source: 'all', scope: 'session' }
    )
    const unsubscribeAnnotationShapeSync = editor.store.listen(
      ({ changes }) => {
        if (isSyncingAnnotationRecords) return
        const updates = annotationShapeUpdatesForStoreChanges(changes)
        if (!updates.length) return
        isSyncingAnnotationRecords = true
        try {
          editor.updateShapes(updates as never)
        } finally {
          isSyncingAnnotationRecords = false
        }
      },
      { source: 'all', scope: 'document' }
    )
    void saveSelection(editor)
    return () => {
      window.clearTimeout(saveInitial)
      window.clearInterval(selectionTimer)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      unsubscribeDocument()
      unsubscribeSession()
      unsubscribeAnnotationShapeSync()
      void saveCanvasNow(editor)
      void saveSelection(editor, true)
      if (editorRef.current === editor) editorRef.current = null
    }
  }, [saveCanvas, saveCanvasNow, saveSelection])

  const cancelAnnotationCapture = useCallback((messageText = '批注已取消。') => {
    const editor = editorRef.current
    const drag = annotationDragRef.current
    if (editor && drag) editor.bailToMark(drag.markId)
    annotationDragRef.current = null
    setAnnotationCaptureMode(null)
    setMessage(messageText)
  }, [])

  const activateFreeformAnnotation = useCallback((mode: AnnotationMode = 'arrow') => {
    const editor = editorRef.current
    if (!editor) {
      setMessage('Canvas is still loading.')
      return
    }
    unlockGlobalToolLock(editor)
    editor.setCurrentTool('select')
    annotationDragRef.current = null
    setAnnotationCaptureMode(mode)
    setPacketPath(null)
    setPacketSuggestions([])
    setMessage(mode === 'box'
      ? '在画布上拖拽创建范围框，松开后直接输入批注文字。'
      : '在画布上拖拽创建批注箭头，松开后直接输入批注文字。')
  }, [])

  useEffect(() => {
    if (!annotationCaptureActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelAnnotationCapture()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [annotationCaptureActive, cancelAnnotationCapture])

  const handleAnnotationCapturePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const editor = editorRef.current
    const mode = annotationCaptureMode
    if (!editor || !mode) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const origin = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const scale = editor.getResizeScaleFactor()
    const color = getAnnotationColor(editor)
    const shapeId = createShapeId()
    const selectedShapeIds = editor.getSelectedShapeIds()
    const sourceShapeId = selectedShapeIds.length === 1 ? String(selectedShapeIds[0]) : undefined
    const markId = editor.markHistoryStoppingPoint(`sciforge_annotation_capture:${shapeId}`)

    annotationDragRef.current = {
      shapeId,
      mode,
      markId,
      origin: { x: origin.x, y: origin.y }
    }
    if (mode === 'box') {
      editor.createShape({
        id: shapeId,
        type: 'geo',
        x: origin.x,
        y: origin.y,
        meta: {
          sciforgeCanvasAnnotation: true,
          sciforgeCanvasAnnotationBox: true,
          ...(sourceShapeId ? { cowartAnnotationSourceShapeId: sourceShapeId } : {})
        },
        props: {
          w: 1,
          h: 1,
          geo: 'rectangle',
          dash: 'draw',
          fill: 'none',
          color,
          labelColor: color,
          size: 'm',
          font: 'draw',
          align: 'middle',
          verticalAlign: 'middle',
          richText: toRichText(''),
          growY: 0,
          url: '',
          scale
        }
      } as never)
      return
    }

    editor.createShape({
      id: shapeId,
      type: 'arrow',
      x: origin.x,
      y: origin.y,
      meta: {
        cowartAnnotationArrow: true,
        sciforgeCanvasAnnotation: true,
        ...(sourceShapeId ? { cowartAnnotationSourceShapeId: sourceShapeId } : {})
      },
      props: {
        kind: 'arc',
        dash: 'draw',
        size: 'm',
        fill: 'none',
        color,
        labelColor: color,
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        richText: toRichText(''),
        labelPosition: ANNOTATION_LABEL_POSITION,
        font: 'draw',
        scale,
        elbowMidPoint: 0.5
      }
    } as never)
  }, [annotationCaptureMode])

  const handleAnnotationCapturePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    const drag = annotationDragRef.current
    if (!editor || !drag) return
    event.preventDefault()
    event.stopPropagation()
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
    if (drag.mode === 'box') {
      const x = Math.min(drag.origin.x, point.x)
      const y = Math.min(drag.origin.y, point.y)
      editor.updateShapes([
        {
          id: drag.shapeId,
          type: 'geo',
          x,
          y,
          props: {
            w: Math.max(1, Math.abs(point.x - drag.origin.x)),
            h: Math.max(1, Math.abs(point.y - drag.origin.y))
          }
        }
      ] as never)
      return
    }
    editor.updateShapes([
      {
        id: drag.shapeId,
        type: 'arrow',
        props: {
          end: {
            x: point.x - drag.origin.x,
            y: point.y - drag.origin.y
          }
        }
      }
    ] as never)
  }, [])

  const handleAnnotationCapturePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current
    const drag = annotationDragRef.current
    if (!editor || !drag) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    const point = editor.screenToPage({ x: event.clientX, y: event.clientY })
    const dx = point.x - drag.origin.x
    const dy = point.y - drag.origin.y
    if (Math.hypot(dx, dy) < ANNOTATION_MIN_LENGTH / editor.getZoomLevel()) {
      editor.bailToMark(drag.markId)
      annotationDragRef.current = null
      setMessage('拖拽距离太短，继续拖拽创建批注。')
      return
    }

    if (drag.mode === 'box') {
      const x = Math.min(drag.origin.x, point.x)
      const y = Math.min(drag.origin.y, point.y)
      editor.updateShapes([
        {
          id: drag.shapeId,
          type: 'geo',
          x,
          y,
          props: {
            w: Math.max(1, Math.abs(dx)),
            h: Math.max(1, Math.abs(dy))
          }
        }
      ] as never)
    } else {
      editor.updateShapes([
        {
          id: drag.shapeId,
          type: 'arrow',
          props: {
            end: { x: dx, y: dy },
            bend: getDefaultAnnotationArrowBend(dx, dy, editor.getResizeScaleFactor())
          }
        }
      ] as never)
    }
    annotationDragRef.current = null
    setAnnotationCaptureMode(null)
    setPacketPath(null)
    setPacketSuggestions([])
    setMessage('批注已创建，可直接在画布内输入文字。')
    editor.timers.setTimeout(() => startEditingAnnotationLabel(editor, drag.shapeId), 16)
    void saveCanvasNow(editor)
    void saveSelection(editor, true)
  }, [saveCanvasNow, saveSelection])

  const handleAnnotationCapturePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    cancelAnnotationCapture()
  }, [cancelAnnotationCapture])

  const createAiHolder = useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      setMessage('Canvas is still loading.')
      return
    }
    const drag = annotationDragRef.current
    if (drag) editor.bailToMark(drag.markId)
    annotationDragRef.current = null
    setAnnotationCaptureMode(null)
    createAiImageHolderAtViewportCenter(editor)
    setPacketPath(null)
    setPacketSuggestions([])
    setMessage('占位框已创建。它只是修订图/生成图的落点，不会新建页面，也不会生成空白图片。')
    void saveCanvasNow(editor)
    void saveSelection(editor, true)
  }, [saveCanvasNow, saveSelection])

  const importRecentArtifacts = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setMessage('请先打开一个工作区，然后再导入产物。')
      return
    }
    const editor = editorRef.current
    setImportingRecent(true)
    setMessage('正在导入当前对话画布最近 2 小时生成的 SciForge 产物...')
    setPacketPath(null)
    setPacketSuggestions([])
    try {
      if (editor) {
        await saveCanvasNow(editor)
        await saveSelection(editor, true)
      }
      const result = await withTimeout(
        window.sciforge.importRecentSciforgeCanvasArtifacts({
          workspaceRoot,
          canvasId,
          scope: 'current_canvas',
          limit: 8,
          maxAgeMs: CURRENT_CANVAS_IMPORT_MAX_AGE_MS
        }),
        IMPORT_RECENT_TIMEOUT_MS,
        '导入产物超时。已保留当前画布；可以刷新后重试，或检查 workspace 里是否有特别大的 PPTX/图片。'
      )
      if (!result.ok) {
        setMessage(result.message)
        return
      }
      await loadCanvas()
      const imported = result.imported
      if (imported > 0) {
        const warning = result.warnings[0] ? ` ${result.warnings[0]}` : ''
        setMessage(`已扫描 ${result.scanned} 个当前对话产物记录，导入 ${imported} 个产物到当前画布。${warning}`)
      } else {
        setMessage(`已扫描 ${result.scanned} 个当前对话产物记录，没有找到可导入的新图片、SVG 或 PPTX 产物。`)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setImportingRecent(false)
    }
  }, [canvasId, loadCanvas, saveCanvasNow, saveSelection, workspaceRoot])

  const startAnnotation = useCallback((mode: AnnotationMode = 'arrow') => {
    const editor = editorRef.current
    if (!editor) {
      setMessage('Canvas is still loading.')
      return
    }
    const annotation = getSelectedAnnotation(editor)
    if (annotation) {
      setSelectedAnnotation(annotation)
      setAnnotationDraft(annotation.text)
      setMessage('Edit the selected annotation text below.')
      window.setTimeout(() => {
        annotationInputRef.current?.focus()
        annotationInputRef.current?.select()
      }, 0)
      return
    }
    if (hasAnnotatableSelection(editor)) {
      if (createAnnotationForSelectedShape(editor, '', mode)) {
        const nextAnnotation = getSelectedAnnotation(editor)
        setSelectedAnnotation(nextAnnotation)
        setAnnotationDraft(nextAnnotation?.text ?? '')
        setPacketPath(null)
        setPacketSuggestions([])
        setMessage('批注已创建，可直接在画布内输入文字。')
        void saveCanvasNow(editor)
        void saveSelection(editor, true)
        return
      }
    }
    activateFreeformAnnotation(mode)
  }, [activateFreeformAnnotation, saveCanvasNow, saveSelection])

  const commitSelectedAnnotationText = useCallback((value = annotationDraft) => {
    const editor = editorRef.current
    if (!editor) {
      setMessage('Canvas is still loading.')
      return
    }
    const nextText = value.trim() || ANNOTATION_DEFAULT_TEXT
    if (!setSelectedAnnotationText(editor, nextText)) {
      setMessage('请先选中一个批注。')
      return
    }
    const nextAnnotation = getSelectedAnnotation(editor)
    setPacketPath(null)
    setPacketSuggestions([])
    setSelectedAnnotation((current) => keepStableSelectedAnnotation(current, nextAnnotation))
    setAnnotationDraft(nextAnnotation?.text ?? nextText)
    setMessage('批注文字已更新。')
    void saveCanvasNow(editor)
    void saveSelection(editor, true)
  }, [annotationDraft, saveCanvasNow, saveSelection])

  const exportReviewPacketNow = useCallback(async (): Promise<SciforgeCanvasReviewPacketResult | null> => {
    if (!workspaceRoot.trim()) {
      setMessage('请先打开一个工作区，然后再导出审改包。')
      return null
    }
    try {
      setMessage(null)
      setPacketSuggestions([])
      const editor = editorRef.current
      if (editor) {
        const activeAnnotation = getSelectedAnnotation(editor)
        if (activeAnnotation) {
          const nextText = annotationDraft.trim() || activeAnnotation.text.trim() || ANNOTATION_DEFAULT_TEXT
          if (setSelectedAnnotationText(editor, nextText)) {
            const nextAnnotation = getSelectedAnnotation(editor)
            setSelectedAnnotation((current) => keepStableSelectedAnnotation(current, nextAnnotation))
            setAnnotationDraft(nextAnnotation?.text ?? nextText)
          }
        }
        await saveCanvasNow(editor)
        await saveSelection(editor, true)
      }
      const result = await window.sciforge.exportSciforgeCanvasReviewPacket({
        workspaceRoot,
        canvasId,
        title: 'SciForge Canvas Review'
      })
      if (result.ok) {
        setPacketPath(result.packetPath)
        setPacketSuggestions(result.packet.modificationSuggestions)
        setMessage(`Review packet exported with ${result.packet.modificationSuggestions.length} suggestion(s).`)
      } else {
        setMessage(result.message)
      }
      return result
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [annotationDraft, canvasId, saveCanvasNow, saveSelection, workspaceRoot])

  const exportReviewPacket = useCallback(async () => {
    await exportReviewPacketNow()
  }, [exportReviewPacketNow])

  const sendReviewRequestToChat = useCallback(async () => {
    if (sendingReviewRequest) return
    if (!onSendReviewRequest) {
      setMessage('当前界面暂不支持把审改请求发送到对话框。')
      return
    }
    setSendingReviewRequest(true)
    try {
      const result = await exportReviewPacketNow()
      if (!result?.ok) return
      onSendReviewRequest([
        '按照当前画布标注修改生成结果，生成新版本并插入回当前画布。',
        `画布 ID：${canvasId}`,
        `审改包：${result.packetPath}`
      ].join('\n'))
      setMessage('已把审改请求写入对话框。发送后，智能体会读取当前对话画布和审改包来修改。')
    } finally {
      setSendingReviewRequest(false)
    }
  }, [exportReviewPacketNow, onSendReviewRequest, sendingReviewRequest])

  const resetCanvas = useCallback(async () => {
    if (!workspaceRoot.trim()) {
      setMessage('请先打开一个工作区，然后再重建画布。')
      return
    }
    setLoading(true)
    setMessage(null)
    setPacketPath(null)
    setPacketSuggestions([])
    setSelectedAnnotation(null)
    setAnnotationDraft('')
    try {
      const result = await window.sciforge.saveSciforgeCanvas({
        workspaceRoot,
        canvasId,
        snapshot: createCurrentTldrawCanvasSnapshot()
      })
      if (!result.ok) {
        setMessage(result.message)
        setSnapshot(null)
        return
      }
      await loadCanvas()
      setMessage('画布已重建为空白审改画布。')
    } catch (error) {
      setSnapshot(null)
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [canvasId, loadCanvas, workspaceRoot])

  const embedded = variant === 'embedded'

  return (
    <aside className={`flex h-full min-h-0 w-full flex-col bg-ds-sidebar ${embedded ? '' : 'border-l border-ds-border'} ${className}`}>
      {!embedded ? (
        <header className="flex shrink-0 items-center gap-2 border-b border-ds-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ds-text">SciForge Canvas</div>
            <div className="truncate text-[11px] text-ds-muted">
              {saving ? 'Saving' : `${selectedCount} selected`}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
            title="Reload"
            onClick={() => void loadCanvas()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
            title="Collapse"
            onClick={onCollapse}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
      ) : null}
      <div className="flex shrink-0 items-center gap-1 border-b border-ds-border px-2 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover"
          title={AI_IMAGE_HOLDER_TITLE}
          onClick={createAiHolder}
        >
          <Frame className="h-3.5 w-3.5" />
          {AI_IMAGE_HOLDER_LABEL}
        </button>
        <AnnotationToolPicker
          activeMode={annotationCaptureMode}
          variant="toolbar"
          onSelect={startAnnotation}
        />
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void importRecentArtifacts()}
          disabled={importingRecent}
          title="导入当前对话画布最近生成的 PNG、SVG 或 PPTX 产物"
        >
          {importingRecent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          导入产物
        </button>
        {embedded ? (
          <div className="ml-auto truncate px-2 text-[11px] text-ds-muted">
            {saving ? 'Saving' : `${selectedCount} selected`}
          </div>
        ) : null}
        {embedded ? (
          <button
            type="button"
            className="rounded-md p-1.5 text-ds-muted hover:bg-ds-hover hover:text-ds-text"
            title="Reload"
            onClick={() => void loadCanvas()}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          className={`${embedded ? '' : 'ml-auto'} inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover`}
          onClick={() => void exportReviewPacket()}
        >
          <Download className="h-3.5 w-3.5" />
          审改包
        </button>
        {onSendReviewRequest ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => void sendReviewRequestToChat()}
            disabled={sendingReviewRequest}
            title="把当前画布标注发送到对话框，交给智能体生成修订版本"
          >
            {sendingReviewRequest ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sendingReviewRequest ? '发送中' : '发送修改'}
          </button>
        ) : null}
      </div>
      {message || packetPath ? (
        <div className="shrink-0 border-b border-ds-border px-3 py-2 text-xs text-ds-muted">
          {message ? <div>{message}</div> : null}
          {packetPath ? <div className="mt-1 truncate font-mono">{packetPath}</div> : null}
          {packetSuggestions.length ? (
            <div className="mt-2 space-y-1">
              {packetSuggestions.slice(0, 3).map((suggestion, index) => (
                <div key={`${suggestion.annotationShapeId ?? 'suggestion'}-${index}`} className="rounded border border-ds-border bg-ds-bg px-2 py-1">
                  <div className="font-medium text-ds-text">
                    {suggestion.artifactKind ?? 'canvas'} {'->'} {suggestion.nextControlledTool}
                  </div>
                  <div className="mt-0.5">{suggestion.instruction}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {selectedAnnotation ? (
        <div className="shrink-0 border-b border-ds-border px-3 py-2">
          <label className="block text-[11px] font-medium text-ds-muted" htmlFor="sciforge-canvas-annotation-text">
            批注文字
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={annotationInputRef}
              id="sciforge-canvas-annotation-text"
              type="text"
              className="min-w-0 flex-1 rounded-md border border-ds-border bg-ds-bg px-2 py-1 text-xs text-ds-text outline-none focus:border-ds-accent"
              value={annotationDraft}
              onFocus={() => {
                annotationDraftEditingRef.current = true
              }}
              onBlur={() => {
                annotationDraftEditingRef.current = false
                commitSelectedAnnotationText()
              }}
              onChange={(event) => setAnnotationDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  annotationDraftEditingRef.current = false
                  commitSelectedAnnotationText(event.currentTarget.value)
                  event.currentTarget.blur()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  annotationDraftEditingRef.current = false
                  setAnnotationDraft(selectedAnnotation.text)
                  event.currentTarget.blur()
                }
              }}
            />
            <button
              type="button"
              className="rounded-md border border-ds-border px-2 py-1 text-xs font-medium text-ds-text hover:bg-ds-hover"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitSelectedAnnotationText()}
            >
              Save
            </button>
          </div>
        </div>
      ) : null}
      <div className="sciforge-canvas-tldraw-surface min-h-0 flex-1 bg-white">
        {loading ? (
          <div className="flex h-full items-center justify-center text-ds-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : snapshot ? (
          <>
            <Tldraw
              key={`${workspaceRoot}::${canvasId}`}
              snapshot={snapshot as never}
              onMount={handleMount}
              components={SCIFORGE_CANVAS_TLDRAW_COMPONENTS}
            />
            {annotationCaptureActive ? (
              <div
                className="sciforge-canvas-annotation-capture"
                onPointerDown={handleAnnotationCapturePointerDown}
                onPointerMove={handleAnnotationCapturePointerMove}
                onPointerUp={handleAnnotationCapturePointerUp}
                onPointerCancel={handleAnnotationCapturePointerCancel}
              >
                <div className="sciforge-canvas-annotation-capture-hint">
                  {annotationCaptureMode === 'box' ? '拖拽圈定范围，Esc 取消' : '拖拽创建箭头批注，Esc 取消'}
                </div>
              </div>
            ) : null}
            <div className="sciforge-canvas-cowart-toolbar" aria-label="SciForge Canvas tools">
              <AnnotationToolPicker
                activeMode={annotationCaptureMode}
                variant="floating"
                onSelect={activateFreeformAnnotation}
              />
              <div aria-orientation="vertical" className="sciforge-canvas-cowart-toolbar-divider" role="separator" />
              <button
                type="button"
                className="sciforge-canvas-cowart-tool"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void importRecentArtifacts()
                }}
                onPointerDown={(event) => event.stopPropagation()}
                disabled={importingRecent}
                title="导入当前对话画布最近生成的图片、科研图或 PPTX"
              >
                {importingRecent
                  ? <Loader2 className="sciforge-canvas-cowart-tool-icon animate-spin" aria-hidden="true" />
                  : <Upload className="sciforge-canvas-cowart-tool-icon" aria-hidden="true" />}
                <span>导入</span>
              </button>
              <div aria-orientation="vertical" className="sciforge-canvas-cowart-toolbar-divider" role="separator" />
              <button
                type="button"
                className="sciforge-canvas-cowart-tool"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  createAiHolder()
                }}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={AI_IMAGE_HOLDER_TITLE}
                title={AI_IMAGE_HOLDER_TITLE}
              >
                <Frame className="sciforge-canvas-cowart-tool-icon" aria-hidden="true" />
                <span>{AI_IMAGE_HOLDER_LABEL}</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-ds-muted">
            <div className="max-w-[340px] space-y-3">
              <div>{message || 'Canvas unavailable.'}</div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-ds-border px-2.5 py-1.5 text-xs font-medium text-ds-text hover:bg-ds-hover"
                  onClick={() => void loadCanvas()}
                >
                  重新打开
                </button>
                {workspaceRoot.trim() ? (
                  <button
                    type="button"
                    className="rounded-md border border-ds-border px-2.5 py-1.5 text-xs font-medium text-ds-text hover:bg-ds-hover"
                    onClick={() => void resetCanvas()}
                  >
                    重建空画布
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

function getSelectionSnapshot(editor: Editor): SciforgeCanvasSelectionState {
  const selectedShapes = editor.getSelectedShapeIds().map((id) => {
    const shape = editor.getShape(id)
    const assetId = shape && 'assetId' in shape.props ? shape.props.assetId : null
    const asset = typeof assetId === 'string' ? editor.getAsset(assetId) : null
    const assetProps = asset?.props as Record<string, unknown> | undefined
    const bounds = shape ? editor.getShapePageBounds(shape) : null
    return {
      id: String(id),
      type: shape?.type,
      parentId: shape?.parentId ? String(shape.parentId) : undefined,
      x: shape?.x,
      y: shape?.y,
      rotation: shape?.rotation,
      meta: shape?.meta as Record<string, unknown> | undefined,
      props: shape?.props as Record<string, unknown> | undefined,
      asset: asset
        ? {
            id: String(asset.id),
            type: asset.type,
            name: typeof assetProps?.name === 'string' ? assetProps.name : undefined,
            src: summarizeSelectionAssetSrc(assetProps?.src),
            w: typeof assetProps?.w === 'number' ? assetProps.w : undefined,
            h: typeof assetProps?.h === 'number' ? assetProps.h : undefined,
            mimeType: typeof assetProps?.mimeType === 'string' ? assetProps.mimeType : undefined,
            fileSize: typeof assetProps?.fileSize === 'number' ? assetProps.fileSize : undefined
          }
        : null,
      bounds: bounds
        ? {
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h
          }
        : null,
      isAiImageHolder: shape?.meta?.cowartAiImageHolder === true
    } satisfies SciforgeCanvasSelectedShape
  })
  return {
    selectedShapes,
    updatedAt: new Date().toISOString()
  }
}

function summarizeSelectionAssetSrc(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined
  if (!value.startsWith('data:') && value.length <= MAX_SELECTION_ASSET_SRC_LENGTH) return value
  if (!value.startsWith('data:')) return `${value.slice(0, MAX_SELECTION_ASSET_SRC_LENGTH)}...`
  const commaIndex = value.indexOf(',')
  const prefix = commaIndex >= 0 ? value.slice(0, commaIndex + 1) : value.slice(0, 80)
  return `${prefix}<base64 omitted>`
}

function keepStableSelectedAnnotation(
  current: SelectedAnnotation | null,
  next: SelectedAnnotation | null
): SelectedAnnotation | null {
  if (!current && !next) return current
  if (current && next && current.id === next.id && current.text === next.text && current.kind === next.kind) return current
  return next
}

function getSelectedAnnotation(editor: Editor): SelectedAnnotation | null {
  const selectedShapeIds = editor.getSelectedShapeIds()
  if (selectedShapeIds.length !== 1) return null
  const shape = editor.getShape(selectedShapeIds[0])
  if (!shape || !isAnnotationShape(shape)) return null
  return {
    id: String(shape.id),
    text: annotationTextFromShape(shape),
    kind: isAnnotationBoxShape(shape) ? 'box' : 'arrow'
  }
}

function setSelectedAnnotationText(editor: Editor, text: string): boolean {
  const selectedShapeIds = editor.getSelectedShapeIds()
  if (selectedShapeIds.length !== 1) return false
  const shape = editor.getShape(selectedShapeIds[0])
  if (!shape || !isAnnotationShape(shape)) return false

  const nextText = text.trim() || ANNOTATION_DEFAULT_TEXT
  const isBox = isAnnotationBoxShape(shape)
  editor.updateShapes([
    {
      id: shape.id,
      type: shape.type,
      meta: {
        ...(shape.meta as Record<string, unknown>),
        sciforgeCanvasAnnotation: true,
        ...(isBox
          ? { sciforgeCanvasAnnotationBox: true }
          : { cowartAnnotationArrow: true })
      },
      props: {
        richText: toRichText(nextText)
      }
    }
  ] as never)
  editor.select(shape.id)
  editor.setCurrentTool('select')
  return true
}

function isAnnotationShape(shape: TldrawShape): boolean {
  return isAnnotationArrowShape(shape) || isAnnotationBoxShape(shape)
}

function isAnnotationArrowShape(shape: TldrawShape): boolean {
  if (shape.type !== 'arrow') return false
  const meta = shape.meta as Record<string, unknown>
  if (meta.cowartAnnotationArrow === true || meta.sciforgeCanvasAnnotation === true) return true

  const props = shape.props as unknown as Record<string, unknown>
  const text = annotationTextFromShape(shape)
  return Boolean(
    text &&
    (isAnnotationColorToken(props.color) || isAnnotationColorToken(props.labelColor))
  )
}

function isAnnotationBoxShape(shape: TldrawShape): boolean {
  if (shape.type !== 'geo') return false
  const meta = shape.meta as Record<string, unknown>
  if (meta.sciforgeCanvasAnnotationBox === true) return true
  if (meta.sciforgeCanvasAnnotation !== true) return false
  const props = shape.props as unknown as Record<string, unknown>
  return props.geo === 'rectangle'
}

function annotationTextFromShape(shape: TldrawShape): string {
  const props = shape.props as unknown as Record<string, unknown>
  return (
    plainTextFromRichText(props.richText) ??
    plainTextFromRichText(props.text) ??
    ''
  )
}

function plainTextFromRichText(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (!isRecord(value)) return undefined
  if (typeof value.text === 'string') return value.text
  const content = Array.isArray(value.content) ? value.content : []
  const text = content
    .map((item) => plainTextFromRichText(item))
    .filter(Boolean)
    .join(' ')
    .trim()
  return text || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function annotationShapeUpdatesForStoreChanges(changes: unknown): Array<{
  id: TLShapeId
  type: 'arrow' | 'geo'
  meta?: Record<string, unknown>
  props?: Record<string, unknown>
}> {
  const updates: Array<{
    id: TLShapeId
    type: 'arrow' | 'geo'
    meta?: Record<string, unknown>
    props?: Record<string, unknown>
  }> = []

  for (const [, next] of updatedRecordPairsFromStoreChanges(changes)) {
    if (next.typeName !== 'shape' || typeof next.id !== 'string') continue
    const meta = isRecord(next.meta) ? next.meta : {}
    const props = isRecord(next.props) ? next.props : {}
    if (next.type === 'geo') {
      const hasAnnotationMeta = meta.sciforgeCanvasAnnotationBox === true ||
        (meta.sciforgeCanvasAnnotation === true && props.geo === 'rectangle')
      if (!hasAnnotationMeta) continue

      const nextMeta: Record<string, unknown> = {}
      if (meta.sciforgeCanvasAnnotation !== true) nextMeta.sciforgeCanvasAnnotation = true
      if (meta.sciforgeCanvasAnnotationBox !== true) nextMeta.sciforgeCanvasAnnotationBox = true

      const nextProps: Record<string, unknown> = {}
      const color = typeof props.color === 'string' ? props.color : ANNOTATION_DEFAULT_COLOR
      if (props.geo !== 'rectangle') nextProps.geo = 'rectangle'
      if (props.fill !== 'none') nextProps.fill = 'none'
      if (props.dash !== 'draw') nextProps.dash = 'draw'
      if (props.labelColor !== color) nextProps.labelColor = color

      if (Object.keys(nextMeta).length || Object.keys(nextProps).length) {
        updates.push({
          id: next.id as TLShapeId,
          type: 'geo',
          ...(Object.keys(nextMeta).length ? { meta: { ...meta, ...nextMeta } } : {}),
          ...(Object.keys(nextProps).length ? { props: nextProps } : {})
        })
      }
      continue
    }
    if (next.type !== 'arrow') continue
    const hasAnnotationMeta = meta.cowartAnnotationArrow === true || meta.sciforgeCanvasAnnotation === true
    const hasAnnotationLook = (isAnnotationColorToken(props.color) || isAnnotationColorToken(props.labelColor)) &&
      Boolean(plainTextFromRichText(props.richText) ?? plainTextFromRichText(props.text))
    if (!hasAnnotationMeta && !hasAnnotationLook) continue

    const nextMeta: Record<string, unknown> = {}
    if (meta.cowartAnnotationArrow !== true) nextMeta.cowartAnnotationArrow = true
    if (meta.sciforgeCanvasAnnotation !== true) nextMeta.sciforgeCanvasAnnotation = true

    const nextProps: Record<string, unknown> = {}
    const color = typeof props.color === 'string' ? props.color : ANNOTATION_DEFAULT_COLOR
    if (props.labelColor !== color) nextProps.labelColor = color
    if (props.labelPosition !== ANNOTATION_LABEL_POSITION) nextProps.labelPosition = ANNOTATION_LABEL_POSITION
    if (typeof props.elbowMidPoint !== 'number') nextProps.elbowMidPoint = 0.5

    if (Object.keys(nextMeta).length || Object.keys(nextProps).length) {
      updates.push({
        id: next.id as TLShapeId,
        type: 'arrow',
        ...(Object.keys(nextMeta).length ? { meta: { ...meta, ...nextMeta } } : {}),
        ...(Object.keys(nextProps).length ? { props: nextProps } : {})
      })
    }
  }

  return updates
}

function updatedRecordPairsFromStoreChanges(changes: unknown): Array<[
  Record<string, unknown>,
  Record<string, unknown>
]> {
  if (!isRecord(changes) || !isRecord(changes.updated)) return []
  const pairs: Array<[Record<string, unknown>, Record<string, unknown>]> = []
  for (const value of Object.values(changes.updated)) {
    if (!Array.isArray(value) || value.length < 2) continue
    const [previous, next] = value
    if (isRecord(previous) && isRecord(next)) pairs.push([previous, next])
  }
  return pairs
}

function hasAnnotatableSelection(editor: Editor): boolean {
  const selectedShapeIds = editor.getSelectedShapeIds()
  if (selectedShapeIds.length !== 1) return false
  const shape = editor.getShape(selectedShapeIds[0])
  return Boolean(shape && !isAnnotationShape(shape))
}

function createAnnotationForSelectedShape(editor: Editor, text = '', mode: AnnotationMode = 'arrow'): boolean {
  const selectedShapeIds = editor.getSelectedShapeIds()
  if (selectedShapeIds.length !== 1) return false

  const sourceShapeId = selectedShapeIds[0]
  const sourceShape = editor.getShape(sourceShapeId)
  if (!sourceShape || isAnnotationShape(sourceShape)) return false

  const bounds = editor.getShapePageBounds(sourceShapeId)
  if (!bounds) return false

  const scale = editor.getResizeScaleFactor()
  if (mode === 'box') {
    const padding = 12 * scale
    const boxId = createShapeId()
    editor.createShape({
      id: boxId,
      type: 'geo',
      x: bounds.x - padding,
      y: bounds.y - padding,
      meta: {
        sciforgeCanvasAnnotation: true,
        sciforgeCanvasAnnotationBox: true,
        cowartAnnotationSourceShapeId: String(sourceShapeId)
      },
      props: {
        w: bounds.w + padding * 2,
        h: bounds.h + padding * 2,
        geo: 'rectangle',
        dash: 'draw',
        fill: 'none',
        color: ANNOTATION_DEFAULT_COLOR,
        labelColor: ANNOTATION_DEFAULT_COLOR,
        size: 'm',
        font: 'draw',
        align: 'middle',
        verticalAlign: 'middle',
        richText: toRichText(text),
        growY: 0,
        url: '',
        scale
      }
    } as never)
    startEditingAnnotationBoxLabel(editor, boxId)
    return true
  }

  const arrowId = createShapeId()
  const start = {
    x: bounds.x + bounds.w + 72 * scale,
    y: bounds.y + Math.max(36 * scale, bounds.h * 0.22)
  }
  const end = {
    x: bounds.x + bounds.w * 0.78 - start.x,
    y: bounds.y + bounds.h * 0.44 - start.y
  }

  editor.createShape({
    id: arrowId,
    type: 'arrow',
    x: start.x,
    y: start.y,
    meta: {
      cowartAnnotationArrow: true,
      sciforgeCanvasAnnotation: true,
      cowartAnnotationSourceShapeId: String(sourceShapeId)
    },
    props: {
      kind: 'arc',
      dash: 'draw',
      size: 'm',
      fill: 'none',
      color: ANNOTATION_DEFAULT_COLOR,
      labelColor: ANNOTATION_DEFAULT_COLOR,
      bend: getDefaultAnnotationArrowBend(end.x, end.y, scale),
      start: { x: 0, y: 0 },
      end,
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
      richText: toRichText(text),
      labelPosition: ANNOTATION_LABEL_POSITION,
      font: 'draw',
      scale,
      elbowMidPoint: 0.5
    }
  } as never)
  startEditingAnnotationArrowLabel(editor, arrowId)
  return true
}
