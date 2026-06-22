import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement
} from 'react'
import {
  Columns2,
  Eye,
  FileCode2,
  FilePenLine
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  createPdfAnchor,
  type PdfAnnotationKind,
  type PdfAnnotationSidecar,
  type PdfAnnotationThread
} from '@shared/pdf-annotations'
import type { WriteExportFormat } from '@shared/write-export'
import { useChatStore } from '../../store/chat-store'
import { formatWorkspacePickerError } from '../../lib/format-workspace-picker-error'
import {
  useWriteWorkspaceStore,
  type WritePreviewMode,
  type WriteSaveStatus,
  writeBasenameFromPath,
  writeJoinPath,
  writeRelativeToWorkspace
} from '../../write/write-workspace-store'
import { getWriteRenderSafety } from '../../write/write-render-safety'
import {
  applyWriteInlineEditReplacement,
  buildWriteInlineEditCompletionRequest,
  buildWriteInlineEditDraft
} from '../../write/inline-edit'
import { createWriteRecentEdit } from '../../write/recent-edits'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import type { WriteRichFidelity } from '../../write/tiptap/markdown-manager'
import { startWriteWorkspaceFileWatch } from '../../write/write-file-watch'
import { useWriteSplitScrollSync } from './use-write-split-scroll-sync'
import { WriteWorkspaceEmptyState } from './WriteWorkspaceEmptyState'
import { WriteWorkspaceToolbar } from './WriteWorkspaceToolbar'
import { WriteInlineAgent } from './WriteInlineAgent'
import { WriteWorkspaceDocumentPane } from './WriteWorkspaceDocumentPane'
import {
  WritePdfAnnotationsPanel,
  type WritePdfAnnotationDisplayMode
} from './WritePdfAnnotationsPanel'
import type { WriteEditorSelectionState } from './WriteMarkdownEditor'
import {
  addPdfAnnotationToThread,
  createPdfAnnotationThread,
  deletePdfAnnotationThread,
  mergePdfAnnotationContribution,
  reopenPdfAnnotationThread,
  resolvePdfAnnotationThread,
  updatePdfAnnotation,
  type PdfAnnotationThreadSummary
} from '../../write/pdf-annotations'
import type { PdfAssistantAnswerSaver } from '../../write/pdf-assistant-annotation-save'
import type {
  WritePdfAnnotationAction,
  WritePdfAnnotationOverlay,
  WritePdfSelection,
  WritePdfSelectionPageRect
} from './WritePdfViewer'
import {
  INLINE_EDIT_RECENT_CONTEXT_CHARS,
  WRITE_AUTOSAVE_MS,
  WRITE_EXPORT_NOTICE_MS,
  WRITE_PREVIEW_DEBOUNCE_MS,
  WRITE_RICH_CLIPBOARD_ACTION,
  clamp,
  exportFormatLabel,
  formatSaveLabel,
  inlineAgentPosition,
  isMarkdownFile,
  useDebouncedValue,
  writePreviewModeForModeMenuItem,
  type WriteModeMenuItem,
  type WriteNotice
} from './write-workspace-view-utils'

type Props = {
  leftSidebarCollapsed: boolean; onToggleLeftSidebar: () => void
  input: string; setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  onPdfAssistantAnswerSaverChange?: (saver: PdfAssistantAnswerSaver | null) => void
  onPdfVisualSelectionImage?: (image: { dataUrl: string; mimeType: string; fileName: string }) => void | Promise<void>
}

type WriteAssistantQuotedSelectionState = WriteEditorSelectionState & {
  pdfAnchorId?: string
  pdfAnnotationThreadId?: string
  pdfAnnotationKind?: PdfAnnotationKind
}

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function annotationKindForAction(action: WritePdfAnnotationAction): PdfAnnotationKind | null {
  if (action === 'copy') return null
  if (action === 'comment') return 'comment'
  if (action === 'translation') return 'translation'
  if (action === 'question') return 'question'
  return 'highlight'
}

function overlayKindForThread(thread: PdfAnnotationThread): WritePdfAnnotationOverlay['kind'] {
  return thread.kind
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return window.btoa(binary)
}

function isPdfAnnotationFingerprintMismatch(message: string): boolean {
  const normalized = message.toLocaleLowerCase()
  return normalized.includes('fingerprint') && normalized.includes('match')
}

const PDF_ANNOTATION_PANEL_STORAGE_KEY = 'sciforge.write.pdfAnnotationPanelWidth'
const PDF_ANNOTATION_PANEL_MIN_WIDTH = 320
const PDF_ANNOTATION_PANEL_DEFAULT_WIDTH = 420
const PDF_ANNOTATION_PANEL_MAX_WIDTH = 680
const PDF_DOCUMENT_MIN_WIDTH = 460

function pdfAnnotationPanelMaxWidth(containerWidth?: number): number {
  if (!containerWidth || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return PDF_ANNOTATION_PANEL_MAX_WIDTH
  }
  return Math.max(
    PDF_ANNOTATION_PANEL_MIN_WIDTH,
    Math.min(PDF_ANNOTATION_PANEL_MAX_WIDTH, containerWidth - PDF_DOCUMENT_MIN_WIDTH)
  )
}

function normalizePdfAnnotationPanelWidth(width: number, containerWidth?: number): number {
  return clamp(Math.round(width), PDF_ANNOTATION_PANEL_MIN_WIDTH, pdfAnnotationPanelMaxWidth(containerWidth))
}

function readStoredPdfAnnotationPanelWidth(): number {
  if (typeof window === 'undefined') return PDF_ANNOTATION_PANEL_DEFAULT_WIDTH
  try {
    const raw = window.localStorage.getItem(PDF_ANNOTATION_PANEL_STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    return normalizePdfAnnotationPanelWidth(Number.isFinite(parsed) ? parsed : PDF_ANNOTATION_PANEL_DEFAULT_WIDTH)
  } catch {
    return PDF_ANNOTATION_PANEL_DEFAULT_WIDTH
  }
}

export function WriteWorkspaceView({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  input,
  setInput,
  onSubmitPrompt,
  onPdfAssistantAnswerSaverChange,
  onPdfVisualSelectionImage
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const ensureWriteThreadForWorkspace = useChatStore((s) => s.ensureWriteThreadForWorkspace)
  const runtimeConnection = useChatStore((s) => s.runtimeConnection)
  const {
    workspaceRoot,
    activeFilePath,
    activeFileKind,
    rootDirectory,
    inlineCompletion,
    inlineCompletionApiReady,
    fileContent,
    imageDataUrl,
    imageMimeType,
    pdfDataBase64,
    pdfMimeType,
    pdfMtimeMs,
    fileSize,
    fileTruncated,
    fileError,
    fileLoading,
    saveStatus,
    previewMode,
    assistantOpen,
    selection,
    recentEdits,
    loadWriteSettings,
    addWriteWorkspace,
    setFileContent,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk,
    flushSave,
    createFile,
    refreshWorkspace,
    setFileError,
    setPreviewMode,
    setAssistantOpen,
    setSelection,
    recordRecentEdits,
    quoteCurrentSelection
  } = useWriteWorkspaceStore()
  const saveTimerRef = useRef<number | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null)
  const editorPaneRef = useRef<HTMLDivElement | null>(null)
  const previewPaneRef = useRef<HTMLDivElement | null>(null)
  const richEditorHandleRef = useRef<WriteRichEditorHandle | null>(null)
  const exportNoticeTimerRef = useRef<number | null>(null)
  const pdfSidecarSaveTimerRef = useRef<number | null>(null)
  const pdfSidecarLoadKeyRef = useRef('')
  const pdfAnnotationImportInputRef = useRef<HTMLInputElement | null>(null)
  const inlineAgentTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [inlineAgentValue, setInlineAgentValue] = useState('')
  const [inlineAgentOpen, setInlineAgentOpen] = useState(false)
  const [inlineEditInFlight, setInlineEditInFlight] = useState(false)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exportingFormat, setExportingFormat] = useState<WriteExportFormat | typeof WRITE_RICH_CLIPBOARD_ACTION | null>(null)
  const [exportNotice, setExportNotice] = useState<WriteNotice | null>(null)
  const [pdfSidecar, setPdfSidecar] = useState<PdfAnnotationSidecar | null>(null)
  const [pdfSidecarPath, setPdfSidecarPath] = useState('')
  const [pdfAnnotationPackageAction, setPdfAnnotationPackageAction] = useState<'export' | 'import' | 'reload' | null>(null)
  const [selectedPdfThreadId, setSelectedPdfThreadId] = useState<string | null>(null)
  const [hoveredPdfThreadId, setHoveredPdfThreadId] = useState<string | null>(null)
  const [pdfAnnotationDisplayMode, setPdfAnnotationDisplayMode] = useState<WritePdfAnnotationDisplayMode>('current')
  const [pdfJumpToRect, setPdfJumpToRect] = useState<WritePdfSelectionPageRect | null>(null)
  const [pdfAnnotationPanelWidth, setPdfAnnotationPanelWidth] = useState(readStoredPdfAnnotationPanelWidth)
  const workspaceReady = workspaceRoot.trim().length > 0
  const activeFileIsImage = activeFileKind === 'image'
  const activeFileIsPdf = activeFileKind === 'pdf'
  const activeFileIsText = activeFileKind === 'text'
  const isMarkdown = activeFilePath && activeFileIsText ? isMarkdownFile(activeFilePath) : true
  const renderSafety = getWriteRenderSafety({
    isMarkdown,
    contentLength: fileContent.length,
    fileSize,
    truncated: fileTruncated
  })
  const richModeAvailable = activeFileIsText && isMarkdown && renderSafety.livePreviewEnabled && !renderSafety.readOnly
  const richModeActive = previewMode === 'rich' && richModeAvailable
  const debouncedPreviewContent = useDebouncedValue(fileContent, WRITE_PREVIEW_DEBOUNCE_MS)
  const saveLabel = activeFileIsImage
    ? t('writeImagePreview')
    : activeFileIsPdf ? t('writePdfPreview')
    : renderSafety.readOnly ? t('writeReadOnly') : formatSaveLabel(saveStatus, t)
  const selectionAction = selection.charCount > 0 ? inlineAgentPosition(selection) : null
  const selectionActionActive = Boolean(selectionAction)
  const selectionActionLeft = selectionAction?.left
  const selectionActionTop = selectionAction?.top
  const activeFileLabel = activeFilePath
    ? writeRelativeToWorkspace(workspaceRoot, activeFilePath)
    : t('writeNoFileOpen')
  const activeFileName = activeFilePath ? writeBasenameFromPath(activeFilePath) : t('writeStudio')
  const workspacePathLabel = rootDirectory || workspaceRoot
  const workspaceName = workspacePathLabel ? writeBasenameFromPath(workspacePathLabel) : t('writeWorkspace')
  const exportInFlight = exportingFormat !== null
  const fileGuardMessage = renderSafety.notice === 'truncated'
    ? t('writeLargeFileTruncated')
    : renderSafety.notice === 'large-file'
      ? t('writeLargeFileSafeMode')
      : ''
  const fileGuardDetail = renderSafety.notice === 'large-file' ? t('writeLargeFileSafeModeSub') : ''
  const pdfAnnotationPanelStyle = useMemo<CSSProperties>(() => ({
    width: pdfAnnotationPanelWidth
  }), [pdfAnnotationPanelWidth])
  const pdfAnnotationOverlays = useMemo<WritePdfAnnotationOverlay[]>(() => {
    if (!pdfSidecar) return []
    return pdfSidecar.threads.map((thread) => {
      const anchorIds = new Set(thread.anchorIds)
      return {
        id: thread.id,
        kind: overlayKindForThread(thread),
        status: thread.status,
        rects: pdfSidecar.anchors
          .filter((anchor) => anchorIds.has(anchor.id))
          .flatMap((anchor) => anchor.rects),
        label: thread.kind === 'highlight' ? '' : undefined
      }
    }).filter((overlay) => overlay.rects.length > 0)
  }, [pdfSidecar])
  const activePdfAnnotationId = hoveredPdfThreadId ?? selectedPdfThreadId
  const visiblePdfAnnotationOverlays = useMemo<WritePdfAnnotationOverlay[]>(() => {
    if (pdfAnnotationDisplayMode === 'hidden') return []
    if (pdfAnnotationDisplayMode === 'all') return pdfAnnotationOverlays
    if (!activePdfAnnotationId) return []
    return pdfAnnotationOverlays.filter((overlay) => overlay.id === activePdfAnnotationId)
  }, [activePdfAnnotationId, pdfAnnotationDisplayMode, pdfAnnotationOverlays])

  useWriteSplitScrollSync({
    enabled: workspaceReady && previewMode === 'split' && activeFileIsText,
    editorRootRef: editorPaneRef,
    previewRef: previewPaneRef,
    rebindKey: activeFilePath ?? 'write-preview'
  })

  const showExportNotice = useCallback((notice: WriteNotice): void => {
    setExportNotice(notice)
  }, [])

  useEffect(() => {
    if (!activeFileIsPdf) return
    const syncPanelWidth = (): void => {
      const containerWidth = workspaceBodyRef.current?.clientWidth
      setPdfAnnotationPanelWidth((current) => normalizePdfAnnotationPanelWidth(current, containerWidth))
    }
    syncPanelWidth()
    window.addEventListener('resize', syncPanelWidth)
    return () => window.removeEventListener('resize', syncPanelWidth)
  }, [activeFileIsPdf])

  const beginPdfAnnotationPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = pdfAnnotationPanelWidth
    let nextWidth = startWidth
    const prevCursor = document.body.style.cursor
    const prevUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent): void => {
      const containerWidth = workspaceBodyRef.current?.clientWidth ?? window.innerWidth
      nextWidth = normalizePdfAnnotationPanelWidth(startWidth + startX - moveEvent.clientX, containerWidth)
      setPdfAnnotationPanelWidth(nextWidth)
    }

    const onUp = (): void => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevUserSelect
      try {
        window.localStorage.setItem(PDF_ANNOTATION_PANEL_STORAGE_KEY, String(nextWidth))
      } catch {
        // Width persistence is only a convenience; dragging should still work without storage.
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [pdfAnnotationPanelWidth])

  const handleRichFidelityChange = (fidelity: WriteRichFidelity): void => {
    if (fidelity.eligible) {
      if (fileError === t('writeRichFallbackNotice')) setFileError(null)
      return
    }
    if (previewMode === 'rich') setPreviewMode('source')
    setFileError(t('writeRichFallbackNotice'))
  }

  const createDraftFile = async (): Promise<void> => {
    if (!workspaceReady) {
      await pickWriteWorkspace()
      return
    }
    const root = rootDirectory || workspaceRoot
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = writeJoinPath(root, `draft-${stamp}.md`)
    await createFile(workspaceRoot, path, `# ${t('writeUntitledDraft')}\n\n`)
  }

  const setAssistantPrompt = (prompt: string): void => {
    setAssistantOpen(true)
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }

  const savePdfSidecarSoon = useCallback((sidecar: PdfAnnotationSidecar): void => {
    if (!activeFilePath || !activeFileIsPdf || typeof window.dsGui?.pdfAnnotations?.save !== 'function') return
    if (pdfSidecarSaveTimerRef.current) window.clearTimeout(pdfSidecarSaveTimerRef.current)
    pdfSidecarSaveTimerRef.current = window.setTimeout(() => {
      pdfSidecarSaveTimerRef.current = null
      void window.dsGui?.pdfAnnotations?.save({
        pdfPath: activeFilePath,
        workspaceRoot,
        sidecar
      }).then((result) => {
        if (!result.ok) {
          setFileError(result.message)
          return
        }
        setPdfSidecar(result.sidecar)
        setPdfSidecarPath(result.path)
      }).catch((error) => {
        setFileError(error instanceof Error ? error.message : String(error))
      })
    }, 180)
  }, [activeFileIsPdf, activeFilePath, setFileError, workspaceRoot])

  const updatePdfSidecar = useCallback((updater: (sidecar: PdfAnnotationSidecar) => PdfAnnotationSidecar): PdfAnnotationSidecar | null => {
    if (!pdfSidecar) return null
    const nextSidecar = updater(pdfSidecar)
    setPdfSidecar(nextSidecar)
    savePdfSidecarSoon(nextSidecar)
    return nextSidecar
  }, [pdfSidecar, savePdfSidecarSoon])

  const quoteSelectionToAssistant = useCallback((nextSelection?: WriteAssistantQuotedSelectionState): void => {
    if (!workspaceReady || !activeFilePath) return
    quoteCurrentSelection(workspaceRoot, nextSelection)
    setAssistantOpen(true)
    setInlineAgentValue('')
    setInlineAgentOpen(false)
    if (!input.trim()) setInput(t('writeAssistantPolishSelectionPrompt'))
  }, [activeFilePath, input, quoteCurrentSelection, setAssistantOpen, setInput, t, workspaceReady, workspaceRoot])

  const appendAssistantPrompt = useCallback((prompt: string): void => {
    setInput(input.trim() ? `${input.trim()}\n\n${prompt}` : prompt)
  }, [input, setInput])

  const addPdfAnnotationFromSelection = useCallback((action: WritePdfAnnotationAction, pdfSelection: WritePdfSelection): void => {
    if (!pdfSidecar) {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationSidecarUnavailable') })
      return
    }
    if (!pdfSelection.rects?.length) {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationAnchorUnavailable') })
      return
    }
    const kind = annotationKindForAction(action)
    if (!kind) {
      showExportNotice({ tone: 'success', message: t('writePdfAnnotationCopied') })
      return
    }
    const now = new Date().toISOString()
    const sourceText = pdfSelection.text.trim() || t('writePdfAnnotationVisualSelectionQuote')
    const anchor = createPdfAnchor({
      id: makeLocalId('pdf-anchor'),
      kind: pdfSelection.text.trim() ? 'text' : 'image',
      rects: pdfSelection.rects,
      quote: sourceText,
      pdfFingerprint: pdfSidecar.pdfFingerprint,
      createdAt: now
    })
    const body = kind === 'comment'
      ? ''
      : kind === 'highlight'
      ? ''
      : kind === 'translation'
        ? t('writePdfAnnotationTranslationPending')
        : kind === 'question'
          ? t('writePdfAnnotationQuestionPending')
          : ''
    const threadId = makeLocalId('pdf-thread')
    updatePdfSidecar((current) => createPdfAnnotationThread({
      ...current,
      anchors: [...current.anchors, anchor]
    }, {
      id: threadId,
      kind,
      anchorIds: [anchor.id],
      annotations: [{
        id: makeLocalId('pdf-ann'),
        anchorId: anchor.id,
        kind,
        body,
        sourceText,
        ...(kind === 'translation' ? { targetLanguage: t('writePdfAnnotationDefaultTargetLanguage') } : {})
      }],
      createdAt: now
    }))
    setSelectedPdfThreadId(threadId)
    if (action === 'question' || action === 'translation') {
      if (!pdfSelection.text.trim() && pdfSelection.visualImage) {
        void onPdfVisualSelectionImage?.(pdfSelection.visualImage)
      }
      quoteSelectionToAssistant({
        ...pdfSelection,
        text: sourceText,
        charCount: sourceText.length,
        pdfAnchorId: anchor.id,
        pdfAnnotationThreadId: threadId,
        pdfAnnotationKind: kind
      })
      appendAssistantPrompt(action === 'question'
        ? t('writePdfAnnotationAskPrompt')
        : t('writePdfAnnotationTranslatePrompt'))
    }
  }, [appendAssistantPrompt, onPdfVisualSelectionImage, pdfSidecar, quoteSelectionToAssistant, showExportNotice, t, updatePdfSidecar])

  const selectPdfAnnotationThread = useCallback((threadId: string, summary: PdfAnnotationThreadSummary): void => {
    setSelectedPdfThreadId(threadId)
    const firstRect = summary.anchors.flatMap((anchor) => anchor.rects)[0]
    if (firstRect) setPdfJumpToRect({ ...firstRect })
  }, [])

  const resolvePdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => resolvePdfAnnotationThread(current, threadId, now))
  }, [updatePdfSidecar])

  const reopenPdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => reopenPdfAnnotationThread(current, threadId, now))
  }, [updatePdfSidecar])

  const deletePdfAnnotation = useCallback((threadId: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((current) => deletePdfAnnotationThread(current, threadId, { updatedAt: now }))
    setSelectedPdfThreadId((current) => current === threadId ? null : current)
    setHoveredPdfThreadId((current) => current === threadId ? null : current)
  }, [updatePdfSidecar])

  const editPdfAnnotation = useCallback((annotationId: string, body: string): void => {
    const now = new Date().toISOString()
    updatePdfSidecar((sidecar) => updatePdfAnnotation(sidecar, annotationId, {
      body,
      updatedAt: now
    }))
  }, [updatePdfSidecar])

  const saveAssistantAnswerToPdfAnnotation = useCallback<PdfAssistantAnswerSaver>((request) => {
    if (!pdfSidecar || !activeFileIsPdf) return false
    const body = request.text.trim()
    const threadIds = Array.from(new Set(request.threadIds.map((item) => item.trim()).filter(Boolean)))
    if (!body || threadIds.length === 0) return false

    const now = new Date().toISOString()
    let nextSidecar = pdfSidecar
    const savedThreadIds: string[] = []
    for (const threadId of threadIds) {
      const thread = nextSidecar.threads.find((item) => item.id === threadId)
      if (!thread) continue
      const anchorId = thread.anchorIds[0]
      const anchor = anchorId ? nextSidecar.anchors.find((item) => item.id === anchorId) : undefined
      if (!anchorId || !anchor) continue
      nextSidecar = addPdfAnnotationToThread(nextSidecar, threadId, {
        id: makeLocalId('pdf-ann'),
        anchorId,
        kind: request.kind,
        body,
        sourceText: anchor.quote,
        sourceMessageId: request.messageId,
        ...(request.kind === 'translation' ? { targetLanguage: t('writePdfAnnotationDefaultTargetLanguage') } : {}),
        createdAt: now,
        resolveThread: request.kind === 'answer'
      })
      savedThreadIds.push(threadId)
    }

    if (savedThreadIds.length === 0) {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationSaveAnswerUnavailable') })
      return false
    }
    setPdfSidecar(nextSidecar)
    savePdfSidecarSoon(nextSidecar)
    setSelectedPdfThreadId(savedThreadIds[0] ?? null)
    showExportNotice({
      tone: 'success',
      message: t('writePdfAnnotationSavedAnswer', { count: savedThreadIds.length })
    })
    return true
  }, [activeFileIsPdf, pdfSidecar, savePdfSidecarSoon, showExportNotice, t])

  useEffect(() => {
    if (!onPdfAssistantAnswerSaverChange) return
    onPdfAssistantAnswerSaverChange(saveAssistantAnswerToPdfAnnotation)
    return () => onPdfAssistantAnswerSaverChange(null)
  }, [onPdfAssistantAnswerSaverChange, saveAssistantAnswerToPdfAnnotation])

  const exportPdfAnnotationPackage = useCallback(async (): Promise<void> => {
    if (!activeFilePath || !activeFileIsPdf || !pdfSidecar) return
    if (typeof window.dsGui?.pdfAnnotations?.export !== 'function') {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationExportUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('export')
    try {
      const result = await window.dsGui.pdfAnnotations.export({
        pdfPath: activeFilePath,
        workspaceRoot,
        sidecar: pdfSidecar
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writePdfAnnotationExportFailed', { message: result.message })
        })
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writePdfAnnotationExportSuccess', { file: writeBasenameFromPath(result.path) })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writePdfAnnotationExportFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [activeFileIsPdf, activeFilePath, pdfSidecar, showExportNotice, t, workspaceRoot])

  const importPdfAnnotationPackageFile = useCallback(async (file: File): Promise<void> => {
    if (!activeFilePath || !activeFileIsPdf) return
    if (typeof window.dsGui?.pdfAnnotations?.import !== 'function') {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationImportUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('import')
    try {
      const packageBase64 = await fileToBase64(file)
      const importPackage = (attemptRelocation: boolean) => window.dsGui.pdfAnnotations!.import({
        pdfPath: activeFilePath,
        workspaceRoot,
        packageBase64,
        attemptRelocation
      })
      let result = await importPackage(false)
      if (!result.ok && isPdfAnnotationFingerprintMismatch(result.message)) {
        const retry = window.confirm(t('writePdfAnnotationImportFingerprintMismatch', { file: file.name }))
        if (!retry) {
          showExportNotice({ tone: 'error', message: t('writePdfAnnotationImportCanceled') })
          return
        }
        result = await importPackage(true)
      }
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writePdfAnnotationImportFailed', { message: result.message })
        })
        return
      }

      const merged = pdfSidecar
        ? mergePdfAnnotationContribution(pdfSidecar, result.sidecar, { updatedAt: new Date().toISOString() })
        : {
            sidecar: result.sidecar,
            addedThreadCount: result.sidecar.threads.length,
            updatedThreadCount: 0,
            skippedThreadCount: 0,
            conflicts: []
          }
      setPdfSidecar(merged.sidecar)
      setPdfSidecarPath(result.path)
      setSelectedPdfThreadId(null)
      setPdfJumpToRect(null)
      if (pdfSidecar) savePdfSidecarSoon(merged.sidecar)
      if (result.warnings.length > 0) setFileError(result.warnings[0])
      showExportNotice({
        tone: 'success',
        message: t('writePdfAnnotationImportSuccess', {
          added: merged.addedThreadCount,
          updated: merged.updatedThreadCount,
          skipped: merged.skippedThreadCount
        })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writePdfAnnotationImportFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [
    activeFileIsPdf,
    activeFilePath,
    pdfSidecar,
    savePdfSidecarSoon,
    setFileError,
    showExportNotice,
    t,
    workspaceRoot
  ])

  const reloadPdfAnnotationSidecar = useCallback(async (): Promise<void> => {
    if (!activeFilePath || !activeFileIsPdf) return
    if (typeof window.dsGui?.pdfAnnotations?.load !== 'function') {
      showExportNotice({ tone: 'error', message: t('writePdfAnnotationReloadUnavailable') })
      return
    }

    setPdfAnnotationPackageAction('reload')
    try {
      const result = await window.dsGui.pdfAnnotations.load({
        pdfPath: activeFilePath,
        workspaceRoot
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writePdfAnnotationReloadFailed', { message: result.message })
        })
        return
      }
      const merged = pdfSidecar
        ? mergePdfAnnotationContribution(pdfSidecar, result.sidecar, { updatedAt: new Date().toISOString() })
        : {
            sidecar: result.sidecar,
            addedThreadCount: result.sidecar.threads.length,
            updatedThreadCount: 0,
            skippedThreadCount: 0,
            conflicts: []
          }
      setPdfSidecar(merged.sidecar)
      setPdfSidecarPath(result.path)
      setSelectedPdfThreadId(null)
      setPdfJumpToRect(null)
      if (pdfSidecar) savePdfSidecarSoon(merged.sidecar)
      if (result.warnings.length > 0) setFileError(result.warnings[0])
      showExportNotice({
        tone: 'success',
        message: t('writePdfAnnotationReloadSuccess', {
          added: merged.addedThreadCount,
          updated: merged.updatedThreadCount,
          skipped: merged.skippedThreadCount
        })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writePdfAnnotationReloadFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setPdfAnnotationPackageAction(null)
    }
  }, [
    activeFileIsPdf,
    activeFilePath,
    pdfSidecar,
    savePdfSidecarSoon,
    setFileError,
    showExportNotice,
    t,
    workspaceRoot
  ])

  const openPdfAnnotationPackagePicker = useCallback((): void => {
    if (!activeFilePath || !activeFileIsPdf || pdfAnnotationPackageAction) return
    const input = pdfAnnotationImportInputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }, [activeFileIsPdf, activeFilePath, pdfAnnotationPackageAction])

  const submitInlineAgent = (prompt: string): void => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath) return
    quoteCurrentSelection(workspaceRoot)
    setAssistantOpen(true)
    setInlineAgentValue('')
    setInlineAgentOpen(false)
    if (onSubmitPrompt) {
      onSubmitPrompt(trimmed)
      return
    }
    setInput(input.trim() ? `${input.trim()}\n\n${trimmed}` : trimmed)
  }

  const submitInlineEdit = async (prompt: string): Promise<void> => {
    const trimmed = prompt.trim()
    if (!trimmed || !workspaceReady || !activeFilePath || inlineEditInFlight) return
    if (renderSafety.readOnly) {
      setFileError(t('writeReadOnlySaveDisabled'))
      return
    }
    if (selection.ranges.length !== 1) {
      setFileError(t(selection.ranges.length > 1 ? 'writeInlineEditMultiSelection' : 'writeInlineEditNoSelection'))
      return
    }
    if (typeof window.dsGui?.requestWriteInlineCompletion !== 'function') {
      setFileError(t('writeInlineEditUnavailable'))
      return
    }

    const inlineEditContent = richModeActive
      ? richEditorHandleRef.current?.getProjectionText()
      : fileContent
    if (richModeActive && inlineEditContent == null) {
      setFileError(t('writeInlineEditChanged'))
      return
    }

    const draft = buildWriteInlineEditDraft(inlineEditContent ?? fileContent, selection.ranges[0], trimmed, {
      workspaceRoot,
      currentFilePath: activeFilePath,
      model: inlineCompletion.model,
      language: 'markdown',
      recentEdits
    })

    setInlineEditInFlight(true)
    try {
      const result = await window.dsGui.requestWriteInlineCompletion(
        buildWriteInlineEditCompletionRequest(draft.request)
      )
      if (!result.ok) {
        setFileError(t('writeInlineEditFailed', { message: result.message }))
        return
      }
      const replacement = result.action?.kind === 'edit'
        ? result.action.replacement
        : result.action?.text ?? result.completion

      const latest = useWriteWorkspaceStore.getState()
      if (
        latest.activeFilePath !== activeFilePath ||
        latest.activeFileKind !== 'text'
      ) {
        setFileError(t('writeInlineEditChanged'))
        return
      }

      if (richModeActive) {
        const applied = richEditorHandleRef.current?.applyProjectedReplacement(
          draft.scope,
          draft.scope.text,
          replacement,
          trimmed
        ) ?? false
        if (!applied) {
          setFileError(t('writeInlineEditChanged'))
          return
        }
        setSelection({ text: '', ranges: [], charCount: 0 })
        setInlineAgentValue('')
        setInlineAgentOpen(false)
        setFileError(null)
        showExportNotice({ tone: 'success', message: t('writeInlineEditApplied') })
        return
      }

      if (latest.fileContent.slice(draft.scope.from, draft.scope.to) !== draft.scope.text) {
        setFileError(t('writeInlineEditChanged'))
        return
      }

      const nextContent = applyWriteInlineEditReplacement(latest.fileContent, draft.scope, replacement)
      const inlineEditRecord = createWriteRecentEdit({
        source: 'inline-edit',
        filePath: activeFilePath,
        from: draft.scope.from,
        to: draft.scope.to,
        deletedText: draft.scope.text,
        insertedText: replacement,
        beforeContext: latest.fileContent.slice(
          Math.max(0, draft.scope.from - INLINE_EDIT_RECENT_CONTEXT_CHARS),
          draft.scope.from
        ),
        afterContext: nextContent.slice(
          draft.scope.from + replacement.length,
          Math.min(nextContent.length, draft.scope.from + replacement.length + INLINE_EDIT_RECENT_CONTEXT_CHARS)
        ),
        instruction: trimmed,
        scopeKind: draft.scope.kind
      })

      setFileContent(nextContent)
      if (inlineEditRecord) recordRecentEdits([inlineEditRecord])
      setSelection({ text: '', ranges: [], charCount: 0 })
      setInlineAgentValue('')
      setInlineAgentOpen(false)
      setFileError(null)
      showExportNotice({ tone: 'success', message: t('writeInlineEditApplied') })
    } catch (error) {
      setFileError(t('writeInlineEditFailed', {
        message: error instanceof Error ? error.message : String(error)
      }))
    } finally {
      setInlineEditInFlight(false)
    }
  }

  const pickWriteWorkspace = async (): Promise<void> => {
    try {
      setFileError(null)
      if (typeof window.dsGui?.pickWorkspaceDirectory !== 'function') {
        throw new Error('workspace:pick-directory unavailable')
      }
      const picked = await window.dsGui.pickWorkspaceDirectory(workspaceRoot || undefined)
      if (!picked.canceled && picked.path) {
        await addWriteWorkspace(picked.path)
        if (runtimeConnection === 'ready') void ensureWriteThreadForWorkspace(picked.path)
      }
    } catch (error) {
      setFileError(formatWorkspacePickerError(error))
    }
  }

  const exportCurrentFile = async (format: WriteExportFormat): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.dsGui?.exportWriteDocument !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeExportUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(format)
    try {
      const result = await window.dsGui.exportWriteDocument({
        path: activeFilePath,
        workspaceRoot,
        format,
        content: fileContent
      })
      if (!result.ok) {
        if (!result.canceled) {
          showExportNotice({
            tone: 'error',
            message: t('writeExportFailed', {
              format: exportFormatLabel(format, t),
              message: result.message
            })
          })
        }
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeExportSuccess', { format: exportFormatLabel(format, t) })
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeExportFailed', {
          format: exportFormatLabel(format, t),
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  const copyCurrentFileAsRichText = async (): Promise<void> => {
    if (!activeFilePath) return
    if (!activeFileIsText) return
    if (typeof window.dsGui?.copyWriteDocumentAsRichText !== 'function') {
      showExportNotice({ tone: 'error', message: t('writeCopyRichTextUnavailable') })
      return
    }

    setExportMenuOpen(false)
    setExportingFormat(WRITE_RICH_CLIPBOARD_ACTION)
    try {
      const result = await window.dsGui.copyWriteDocumentAsRichText({
        path: activeFilePath,
        workspaceRoot,
        content: fileContent
      })
      if (!result.ok) {
        showExportNotice({
          tone: 'error',
          message: t('writeCopyRichTextFailed', {
            message: result.message
          })
        })
        return
      }
      showExportNotice({
        tone: 'success',
        message: t('writeCopyRichTextSuccess')
      })
    } catch (error) {
      showExportNotice({
        tone: 'error',
        message: t('writeCopyRichTextFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
    } finally {
      setExportingFormat(null)
    }
  }

  useEffect(() => {
    void loadWriteSettings()
  }, [loadWriteSettings])

  useEffect(() => {
    setExportMenuOpen(false)
  }, [activeFilePath])

  useEffect(() => {
    const pdfPath = activeFileIsPdf ? activeFilePath : null
    if (!pdfPath) {
      pdfSidecarLoadKeyRef.current = ''
      setPdfSidecar(null)
      setPdfSidecarPath('')
      setSelectedPdfThreadId(null)
      setPdfJumpToRect(null)
      return
    }
    const loadKey = `${workspaceRoot}\n${pdfPath}\n${pdfMtimeMs}`
    if (pdfSidecarLoadKeyRef.current === loadKey) return
    pdfSidecarLoadKeyRef.current = loadKey
    setPdfSidecar(null)
    setPdfSidecarPath('')
    setSelectedPdfThreadId(null)
    setPdfJumpToRect(null)
    if (typeof window.dsGui?.pdfAnnotations?.load !== 'function') return

    let cancelled = false
    void window.dsGui.pdfAnnotations.load({
      pdfPath,
      workspaceRoot
    }).then((result) => {
      if (cancelled || pdfSidecarLoadKeyRef.current !== loadKey) return
      if (!result.ok) {
        setFileError(result.message)
        return
      }
      setPdfSidecar(result.sidecar)
      setPdfSidecarPath(result.path)
      if (result.warnings.length > 0) setFileError(result.warnings[0])
    }).catch((error) => {
      if (!cancelled) setFileError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
    }
  }, [activeFileIsPdf, activeFilePath, pdfMtimeMs, setFileError, workspaceRoot])

  useEffect(() => {
    setModeMenuOpen(false)
  }, [activeFilePath, previewMode])

  useEffect(() => {
    if (!selectionActionActive || !inlineAgentOpen) return
    window.requestAnimationFrame(() => inlineAgentTextareaRef.current?.focus())
  }, [inlineAgentOpen, selectionActionActive, selectionActionLeft, selectionActionTop])

  useEffect(() => {
    setInlineAgentOpen(false)
    setInlineAgentValue('')
  }, [selection.charCount, selection.text])

  useEffect(() => {
    if (!exportMenuOpen && !modeMenuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (
        exportMenuRef.current &&
        target instanceof Node &&
        !exportMenuRef.current.contains(target)
      ) {
        setExportMenuOpen(false)
      }
      if (
        modeMenuRef.current &&
        target instanceof Node &&
        !modeMenuRef.current.contains(target)
      ) {
        setModeMenuOpen(false)
      }
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setExportMenuOpen(false)
      setModeMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen, modeMenuOpen])

  useEffect(() => {
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    if (!exportNotice) return
    exportNoticeTimerRef.current = window.setTimeout(() => {
      exportNoticeTimerRef.current = null
      setExportNotice(null)
    }, WRITE_EXPORT_NOTICE_MS)
    return () => {
      if (exportNoticeTimerRef.current) {
        window.clearTimeout(exportNoticeTimerRef.current)
        exportNoticeTimerRef.current = null
      }
    }
  }, [exportNotice])

  useEffect(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (saveStatus !== 'dirty' || !workspaceReady || !activeFileIsText || renderSafety.readOnly) return
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void flushSave(workspaceRoot)
    }, WRITE_AUTOSAVE_MS)
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [flushSave, saveStatus, workspaceReady, workspaceRoot, fileContent, activeFileIsText, renderSafety.readOnly])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    if (pdfSidecarSaveTimerRef.current) window.clearTimeout(pdfSidecarSaveTimerRef.current)
    if (exportNoticeTimerRef.current) {
      window.clearTimeout(exportNoticeTimerRef.current)
      exportNoticeTimerRef.current = null
    }
    void useWriteWorkspaceStore.getState().flushSave(workspaceRoot)
  }, [workspaceRoot])

  useEffect(() => {
    if (!activeFilePath || !workspaceRoot.trim() || (!activeFileIsText && !activeFileIsImage)) return
    if (
      typeof window.dsGui?.watchWorkspaceFile !== 'function' ||
      typeof window.dsGui?.unwatchWorkspaceFile !== 'function' ||
      typeof window.dsGui?.onWorkspaceFileChanged !== 'function'
    ) {
      return
    }

    return startWriteWorkspaceFileWatch({
      api: window.dsGui,
      workspaceRoot,
      path: activeFilePath,
      kind: activeFileIsImage ? 'image' : 'text',
      onTextSnapshot: (snapshot) => {
        void syncActiveFileFromDisk(workspaceRoot, snapshot)
      },
      onImageChanged: (path) => {
        void syncActiveImageFromDisk(workspaceRoot, path)
      },
      onError: setFileError
    })
  }, [
    activeFilePath,
    activeFileIsImage,
    activeFileIsText,
    setFileError,
    workspaceRoot,
    syncActiveFileFromDisk,
    syncActiveImageFromDisk
  ])

  if (!workspaceReady) {
    return <WriteWorkspaceEmptyState error={fileError} onPickWorkspace={() => void pickWriteWorkspace()} />
  }

  const editorVisible = activeFileIsText && previewMode !== 'preview'
  const previewVisible = activeFileIsText && (previewMode === 'split' || previewMode === 'preview')
  const editorWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2 border-r border-ds-border-muted'
    : 'min-w-0 flex-1'
  const previewWidth = previewMode === 'split'
    ? 'min-w-0 flex-1 basis-1/2'
    : 'min-w-0 flex-1'
  const liveModeActive = previewMode === 'live' && renderSafety.livePreviewEnabled
  const sourceModeActive =
    previewMode === 'source' ||
    (previewMode === 'live' && !renderSafety.livePreviewEnabled) ||
    (previewMode === 'rich' && !richModeActive)
  const editorAppearance = sourceModeActive ? 'source' : 'live'

  const primaryModeItem: WriteModeMenuItem = {
    mode: 'rich',
    previewMode: 'rich',
    label: t('writeModeRich'),
    shortLabel: t('writeModeRichShort'),
    description: richModeAvailable ? undefined : t('writeModeRichUnavailable'),
    icon: <FilePenLine className="h-4 w-4" strokeWidth={1.85} />,
    active: richModeActive,
    disabled: !richModeAvailable
  }

  const modeMenuItems: WriteModeMenuItem[] = [
    primaryModeItem,
    {
      mode: 'source',
      previewMode: 'source',
      label: t('writeModeSource'),
      shortLabel: t('writeModeSourceShort'),
      icon: <FileCode2 className="h-4 w-4" strokeWidth={1.85} />,
      active: sourceModeActive
    },
    {
      mode: 'split',
      previewMode: 'split',
      label: t('writeModeSplit'),
      shortLabel: t('writeModeSplitShort'),
      icon: <Columns2 className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'split'
    },
    {
      mode: 'preview',
      previewMode: 'preview',
      label: t('writeModePreview'),
      shortLabel: t('writeModePreviewShort'),
      icon: <Eye className="h-4 w-4" strokeWidth={1.85} />,
      active: previewMode === 'preview'
    }
  ]

  return (
    <div className="write-workspace-view ds-no-drag flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-3 sm:px-4 md:px-6 lg:px-8">
      <WriteWorkspaceToolbar
        activeFileIsImage={activeFileIsImage}
        activeFileIsPdf={activeFileIsPdf}
        activeFileIsText={activeFileIsText}
        activeFileLabel={activeFileLabel}
        activeFileName={activeFileName}
        activeFilePath={activeFilePath ?? ''}
        assistantOpen={assistantOpen}
        exportInFlight={exportInFlight}
        exportMenuOpen={exportMenuOpen}
        exportMenuRef={exportMenuRef}
        leftSidebarCollapsed={leftSidebarCollapsed}
        liveModeActive={liveModeActive}
        modeMenuItems={modeMenuItems}
        modeMenuOpen={modeMenuOpen}
        modeMenuRef={modeMenuRef}
        primaryModeItem={primaryModeItem}
        previewMode={previewMode}
        readOnly={renderSafety.readOnly}
        saveLabel={saveLabel}
        saveStatus={saveStatus}
        setAssistantOpen={setAssistantOpen}
        setExportMenuOpen={setExportMenuOpen}
        setModeMenuOpen={setModeMenuOpen}
        setPreviewMode={setPreviewMode}
        onCopyRichText={() => void copyCurrentFileAsRichText()}
        onExportFile={(format) => void exportCurrentFile(format)}
        onPickWorkspace={() => void pickWriteWorkspace()}
        onSelectMode={(_, item) => setPreviewMode(writePreviewModeForModeMenuItem(item))}
        onSave={() => {
          if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
          void flushSave(workspaceRoot)
        }}
        onToggleLeftSidebar={onToggleLeftSidebar}
      />
      <div ref={workspaceBodyRef} className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden pb-3 pt-3">
        <div className="min-w-0 flex-1 overflow-hidden rounded-[28px] border border-ds-border bg-ds-card/88 shadow-[0_20px_56px_rgba(15,23,42,0.06)] backdrop-blur-xl">
          <WriteWorkspaceDocumentPane
            activeFilePath={activeFilePath}
            activeFileIsImage={activeFileIsImage}
            activeFileIsPdf={activeFileIsPdf}
            activeFileIsText={activeFileIsText}
            fileLoading={fileLoading}
            fileContent={fileContent}
            imageDataUrl={imageDataUrl}
            imageMimeType={imageMimeType}
            pdfDataBase64={pdfDataBase64}
            pdfMimeType={pdfMimeType}
            pdfMtimeMs={pdfMtimeMs}
            fileSize={fileSize}
            workspaceRoot={workspaceRoot}
            workspaceName={workspaceName}
            workspacePathLabel={workspacePathLabel}
            renderSafety={renderSafety}
            fileGuardMessage={fileGuardMessage}
            fileGuardDetail={fileGuardDetail}
            editorVisible={editorVisible}
            previewVisible={previewVisible}
            richModeActive={richModeActive}
            editorWidth={editorWidth}
            previewWidth={previewWidth}
            editorAppearance={editorAppearance}
            debouncedPreviewContent={debouncedPreviewContent}
            isMarkdown={isMarkdown}
            inlineCompletion={inlineCompletion}
            inlineCompletionApiReady={inlineCompletionApiReady}
            recentEdits={recentEdits}
            editorPaneRef={editorPaneRef}
            previewPaneRef={previewPaneRef}
            richEditorHandleRef={richEditorHandleRef}
            onAskAssistant={() => setAssistantPrompt(t('writeStartAskAiPrompt'))}
            onCreateDraft={() => void createDraftFile()}
            onPickWorkspace={() => void pickWriteWorkspace()}
            onRefreshWorkspace={() => void refreshWorkspace(workspaceRoot)}
            onContentChange={setFileContent}
            onDocumentEdit={recordRecentEdits}
            onSelectionChange={setSelection}
            onQuoteSelection={quoteSelectionToAssistant}
            pdfAnnotationOverlays={visiblePdfAnnotationOverlays}
            activePdfAnnotationId={activePdfAnnotationId}
            pdfJumpToRect={pdfJumpToRect}
            onPdfAnnotationAction={addPdfAnnotationFromSelection}
            onPdfAnnotationSelect={(threadId) => {
              setSelectedPdfThreadId(threadId)
              const thread = pdfSidecar?.threads.find((item) => item.id === threadId)
              const anchorId = thread?.anchorIds[0]
              const rect = anchorId ? pdfSidecar?.anchors.find((anchor) => anchor.id === anchorId)?.rects[0] : undefined
              if (rect) setPdfJumpToRect({ ...rect })
            }}
            onSaveShortcut={() => {
              if (renderSafety.readOnly) return
              if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
              void flushSave(workspaceRoot)
            }}
            onRichFidelityChange={handleRichFidelityChange}
            onImagePasteSaved={() => {
              setFileError(null)
              void refreshWorkspace(workspaceRoot)
            }}
            onImagePasteError={(message) => setFileError(message)}
          />
        </div>
        {activeFileIsPdf ? (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('writePdfAnnotationsResize')}
              title={t('writePdfAnnotationsResize')}
              className="ds-workbench-divider ds-no-drag relative z-20 shrink-0 cursor-col-resize"
              onPointerDown={beginPdfAnnotationPanelResize}
            />
            <div className="min-h-0 shrink-0" style={pdfAnnotationPanelStyle} title={pdfSidecarPath || undefined}>
              <WritePdfAnnotationsPanel
                sidecar={pdfSidecar}
                selectedThreadId={selectedPdfThreadId}
                annotationDisplayMode={pdfAnnotationDisplayMode}
                className="h-full overflow-hidden rounded-[20px] border border-ds-border-muted shadow-[0_14px_34px_rgba(15,23,42,0.06)]"
                exportingPackage={pdfAnnotationPackageAction === 'export'}
                importingPackage={pdfAnnotationPackageAction === 'import'}
                reloadingSidecar={pdfAnnotationPackageAction === 'reload'}
                onAnnotationDisplayModeChange={setPdfAnnotationDisplayMode}
                onSelectThread={selectPdfAnnotationThread}
                onHoverThread={(threadId) => setHoveredPdfThreadId(threadId)}
                onResolveThread={(threadId) => resolvePdfAnnotation(threadId)}
                onReopenThread={(threadId) => reopenPdfAnnotation(threadId)}
                onDeleteThread={(threadId) => deletePdfAnnotation(threadId)}
                onEditAnnotation={editPdfAnnotation}
                onExportPackage={() => void exportPdfAnnotationPackage()}
                onImportPackage={openPdfAnnotationPackagePicker}
                onReloadSidecar={() => void reloadPdfAnnotationSidecar()}
              />
            </div>
          </>
        ) : null}

      </div>
      <input
        ref={pdfAnnotationImportInputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ''
          if (file) void importPdfAnnotationPackageFile(file)
        }}
      />
      {selectionAction && activeFilePath && (activeFileIsText || activeFileIsPdf) ? (
        <WriteInlineAgent
          action={selectionAction}
          open={inlineAgentOpen}
          value={inlineAgentValue}
          inFlight={inlineEditInFlight}
          textareaRef={inlineAgentTextareaRef}
          onOpen={() => setInlineAgentOpen(true)}
          onClose={() => setInlineAgentOpen(false)}
          onValueChange={setInlineAgentValue}
          onSubmitPrompt={submitInlineAgent}
          onQuoteSelection={() => quoteSelectionToAssistant()}
          primaryAction={activeFileIsPdf ? 'send' : 'apply'}
          onApplyEdit={(value) => {
            if (activeFileIsPdf) {
              submitInlineAgent(value)
              return
            }
            void submitInlineEdit(value)
          }}
        />
      ) : null}

      {fileError ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full border border-red-200/70 bg-red-50/92 px-4 py-2 text-[13px] text-red-700 shadow-[0_14px_32px_rgba(15,23,42,0.12)] dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200">
          {fileError}
        </div>
      ) : null}
      {exportNotice ? (
        <div
          className={`pointer-events-none fixed left-1/2 z-40 -translate-x-1/2 rounded-full border px-4 py-2 text-[13px] shadow-[0_14px_32px_rgba(15,23,42,0.12)] ${
            exportNotice.tone === 'error'
              ? 'border-red-200/70 bg-red-50/92 text-red-700 dark:border-red-900/60 dark:bg-red-950/84 dark:text-red-200'
              : 'border-emerald-200/80 bg-emerald-50/92 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/84 dark:text-emerald-200'
          }`}
          style={{ bottom: fileError ? 68 : 20 }}
        >
          {exportNotice.message}
        </div>
      ) : null}
    </div>
  )
}
