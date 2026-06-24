import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferenceKind
} from '@shared/agent-runtime-contract'
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Loader2,
  PanelRightClose,
  Plus,
  RefreshCw,
  Scissors,
  Trash2
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../../agent/registry'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import {
  composerFileReferenceKey,
  type ComposerFileReference
} from '../../lib/composer-file-references'
import { composerReferenceFromWorkspaceReference } from '../../lib/workspace-reference-composer'
import type { WorkspaceReferenceGroup } from '../../lib/workspace-reference-groups'

export { composerReferenceFromWorkspaceReference } from '../../lib/workspace-reference-composer'

type Props = {
  workspaceRoot: string
  workspaceGroups?: WorkspaceReferenceGroup[]
  selectedPath?: string | null
  initialDirectory?: FileTreeInitialDirectory | null
  selectedReferences?: ComposerFileReference[]
  className?: string
  onPreviewFile: (reference: AgentRuntimeWorkspaceReference) => void
  onAddReference: (reference: ComposerFileReference) => void
  onCollapse: () => void
}

export type FileTreeInitialDirectory = {
  workspaceRoot: string
  path: string
  nonce: number
}

type DirectoryState = {
  references: AgentRuntimeWorkspaceReference[]
  loading: boolean
  error: string | null
}

type FileTreeContextMenuState = {
  x: number
  y: number
  reference: AgentRuntimeWorkspaceReference | null
  directory: boolean
  expanded: boolean
  targetDirectoryPath: string
}

type FileTreeClipboardState = {
  action: 'copy' | 'cut'
  reference: AgentRuntimeWorkspaceReference
}

const ROOT_PATH = ''
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules'])
const FILE_TREE_CONTEXT_MENU_WIDTH = 206
const FILE_TREE_CONTEXT_MENU_HEIGHT = 292

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function pathKey(value: string): string {
  return normalizePath(value).toLowerCase()
}

function workspaceName(workspaceRoot: string): string {
  return normalizePath(workspaceRoot).split('/').filter(Boolean).at(-1) ?? workspaceRoot
}

function ancestorDirectoryPaths(path: string): string[] {
  const normalized = normalizePath(path)
  if (!normalized) return [ROOT_PATH]
  const segments = normalized.split('/').filter(Boolean)
  return [
    ROOT_PATH,
    ...segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  ]
}

function parentDirectoryPath(path: string): string {
  const normalized = normalizePath(path)
  const slash = normalized.lastIndexOf('/')
  return slash > 0 ? normalized.slice(0, slash) : ''
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function referenceIcon(kind: AgentRuntimeWorkspaceReferenceKind, expanded: boolean): ReactElement {
  if (kind === 'directory') {
    return expanded
      ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
      : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
  }
  if (kind === 'image') {
    return <Image className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
  }
  return <FileText className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
}

export function ChatFileTreePanel({
  workspaceRoot,
  workspaceGroups,
  selectedPath,
  initialDirectory,
  selectedReferences = [],
  className,
  onPreviewFile,
  onAddReference,
  onCollapse
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const groups = useMemo(
    () => normalizeWorkspaceGroups(workspaceRoot, workspaceGroups),
    [workspaceGroups, workspaceRoot]
  )
  const [selectedGroupId, setSelectedGroupId] = useState(() => groups[0]?.id ?? '')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_PATH]))
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [focusedDirectoryPath, setFocusedDirectoryPath] = useState('')
  const [pendingScrollPath, setPendingScrollPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<FileTreeContextMenuState | null>(null)
  const [fileClipboard, setFileClipboard] = useState<FileTreeClipboardState | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const root = selectedGroup?.workspaceRoot.trim() ?? ''
  const selectedKey = useMemo(() => pathKey(selectedPath ?? ''), [selectedPath])
  const focusedDirectoryKey = useMemo(() => pathKey(focusedDirectoryPath), [focusedDirectoryPath])
  const selectedReferenceKeys = useMemo(
    () => new Set(selectedReferences.map(composerFileReferenceKey)),
    [selectedReferences]
  )

  useEffect(() => {
    if (groups.length === 0) {
      if (selectedGroupId) setSelectedGroupId('')
      return
    }
    if (!groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0]?.id ?? '')
    }
  }, [groups, selectedGroupId])

  useEffect(() => {
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
    setContextMenu(null)
  }, [root])

  useEffect(() => {
    if (!initialDirectory) return
    const nextRoot = normalizePath(initialDirectory.workspaceRoot)
    const nextPath = normalizePath(initialDirectory.path)
    const matchingGroup = groups.find((group) => pathKey(group.workspaceRoot) === pathKey(nextRoot))
    if (matchingGroup && matchingGroup.id !== selectedGroupId) {
      setSelectedGroupId(matchingGroup.id)
    }
    setFocusedDirectoryPath(nextPath)
    setPendingScrollPath(nextPath)
    setExpanded((current) => {
      const next = new Set(current)
      for (const path of ancestorDirectoryPaths(nextPath)) next.add(path)
      return next
    })
  }, [groups, initialDirectory, selectedGroupId])

  const loadDirectory = useCallback((path: string): void => {
    if (!root) return
    const provider = getProvider()
    if (!provider.listWorkspaceReferences) {
      setDirectories((current) => ({
        ...current,
        [path || ROOT_PATH]: {
          references: [],
          loading: false,
          error: t('workspaceReferenceUnavailable')
        }
      }))
      return
    }
    const key = path || ROOT_PATH
    setDirectories((current) => ({
      ...current,
      [key]: {
        references: current[key]?.references ?? [],
        loading: true,
        error: null
      }
    }))
    void provider.listWorkspaceReferences({
        workspaceRoot: root,
        ...(path ? { path } : {}),
        limit: 300
      })
      .then((result) => {
        setDirectories((current) => ({
          ...current,
          [key]: result?.ok
            ? {
                references: result.references,
                loading: false,
                error: null
              }
            : {
                references: [],
                loading: false,
                error: result?.message ?? t('workspaceReferenceUnavailable')
              }
        }))
      })
      .catch((error) => {
        setDirectories((current) => ({
          ...current,
          [key]: {
            references: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      })
  }, [root, t])

  useEffect(() => {
    for (const path of expanded) {
      if (!directories[path || ROOT_PATH]) loadDirectory(path)
    }
  }, [directories, expanded, loadDirectory])

  const toggleDirectory = (path: string): void => {
    setFocusedDirectoryPath(normalizePath(path))
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openContextMenu = (
    event: ReactMouseEvent<HTMLDivElement>,
    reference: AgentRuntimeWorkspaceReference,
    directory: boolean,
    expandedDirectory: boolean
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    if (directory) setFocusedDirectoryPath(normalizePath(reference.relativePath))
    setContextMenu({
      x: clamp(event.clientX, 8, window.innerWidth - FILE_TREE_CONTEXT_MENU_WIDTH - 8),
      y: clamp(event.clientY, 8, window.innerHeight - FILE_TREE_CONTEXT_MENU_HEIGHT - 8),
      reference,
      directory,
      expanded: expandedDirectory,
      targetDirectoryPath: directory
        ? normalizePath(reference.relativePath)
        : parentDirectoryPath(reference.relativePath)
    })
  }

  const openWorkspaceContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element | null
    if (target?.closest('[data-file-tree-path]')) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: clamp(event.clientX, 8, window.innerWidth - FILE_TREE_CONTEXT_MENU_WIDTH - 8),
      y: clamp(event.clientY, 8, window.innerHeight - FILE_TREE_CONTEXT_MENU_HEIGHT - 8),
      reference: null,
      directory: true,
      expanded: true,
      targetDirectoryPath: ROOT_PATH
    })
  }

  useEffect(() => {
    if (pendingScrollPath === null) return
    const container = scrollContainerRef.current
    if (!container) return
    if (!pendingScrollPath) {
      container.scrollTo({ top: 0 })
      setPendingScrollPath(null)
      return
    }
    const row = Array.from(container.querySelectorAll<HTMLElement>('[data-file-tree-path]'))
      .find((element) => element.dataset.fileTreePath === pendingScrollPath)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    setPendingScrollPath(null)
  }, [directories, expanded, pendingScrollPath, root])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])

  const addReference = (reference: AgentRuntimeWorkspaceReference): void => {
    onAddReference(composerReferenceFromWorkspaceReference(reference))
  }

  const copyReferencePath = async (reference: AgentRuntimeWorkspaceReference): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    await navigator.clipboard.writeText(reference.relativePath)
  }

  const openReferenceInEditor = (reference: AgentRuntimeWorkspaceReference): void => {
    void openWorkspacePathInEditor(
      { path: reference.relativePath },
      reference.workspaceRoot || root
    ).then((result) => {
      if (!result.ok) {
        void window.dsGui?.logError?.('editor-open', 'Failed to open workspace file tree item', {
          message: result.message,
          target: reference
        })?.catch(() => undefined)
      }
    })
  }

  const reloadDirectory = (path: string): void => {
    const normalized = normalizePath(path)
    setFocusedDirectoryPath(normalized)
    setPendingScrollPath(normalized)
    setExpanded((current) => {
      const next = new Set(current)
      for (const item of ancestorDirectoryPaths(normalized)) next.add(item)
      return next
    })
    setDirectories({})
  }

  const pasteClipboardEntry = async (targetDirectoryPath: string): Promise<void> => {
    if (!fileClipboard) return
    const payload = {
      sourcePath: fileClipboard.reference.relativePath,
      sourceWorkspaceRoot: fileClipboard.reference.workspaceRoot || root,
      targetDirectory: normalizePath(targetDirectoryPath),
      targetWorkspaceRoot: root
    }
    try {
      const result = fileClipboard.action === 'cut'
        ? await window.dsGui.moveWorkspaceEntry(payload)
        : await window.dsGui.copyWorkspaceEntry(payload)
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      if (fileClipboard.action === 'cut') setFileClipboard(null)
      reloadDirectory(payload.targetDirectory)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const deleteReference = async (reference: AgentRuntimeWorkspaceReference, directory: boolean): Promise<void> => {
    const confirmKey = directory ? 'writeDeleteFolderConfirm' : 'writeDeleteFileConfirm'
    if (!window.confirm(t(confirmKey, { name: reference.name || reference.relativePath }))) return
    try {
      const result = await window.dsGui.deleteWorkspaceEntry({
        path: reference.relativePath,
        workspaceRoot: reference.workspaceRoot || root
      })
      if (!result.ok) {
        window.alert(result.message)
        return
      }
      if (
        fileClipboard &&
        pathKey(fileClipboard.reference.workspaceRoot) === pathKey(reference.workspaceRoot) &&
        pathKey(fileClipboard.reference.relativePath) === pathKey(reference.relativePath)
      ) {
        setFileClipboard(null)
      }
      reloadDirectory(parentDirectoryPath(reference.relativePath))
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  const refresh = (): void => {
    setContextMenu(null)
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
  }

  const renderDirectory = (path: string, depth: number): ReactElement[] => {
    const state = directories[path || ROOT_PATH]
    if (state?.loading && state.references.length === 0) {
      return [
        <div
          key={`${path || 'root'}-loading`}
          className="flex min-h-9 items-center gap-2 px-2.5 text-[12px] text-ds-muted"
          style={{ paddingLeft: depth * 14 + 10 }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {t('fileTreeLoading')}
        </div>
      ]
    }
    if (state?.error) {
      return [
        <div
          key={`${path || 'root'}-error`}
          className="px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300"
          style={{ paddingLeft: depth * 14 + 10 }}
          title={state.error}
        >
          {state.error}
        </div>
      ]
    }
    if (!state?.references.length) {
      return depth === 0
        ? [
            <div key="empty" className="px-3 py-3 text-[12px] text-ds-muted">
              {t('fileTreeEmpty')}
            </div>
          ]
        : []
    }

    return state.references
      .filter((reference) =>
        reference.kind !== 'directory' || !IGNORED_DIRECTORY_NAMES.has(reference.name.toLowerCase())
      )
      .flatMap((reference) => {
        const directory = reference.kind === 'directory'
        const expandedDirectory = directory && expanded.has(reference.relativePath)
        const previewable = !directory
        const active = previewable && selectedKey === pathKey(reference.relativePath)
        const directoryFocused = directory && focusedDirectoryKey === pathKey(reference.relativePath)
        const contextActive = contextMenu?.reference
          ? pathKey(contextMenu.reference.relativePath) === pathKey(reference.relativePath)
          : false
        const referenceKey = composerFileReferenceKey({
          relativePath: reference.relativePath,
          workspaceRoot: reference.workspaceRoot
        })
        const selected = selectedReferenceKeys.has(referenceKey)
        const row = (
          <div
            key={reference.relativePath}
            data-file-tree-path={normalizePath(reference.relativePath)}
            className={`group flex min-h-8 items-center gap-1 px-1.5 pr-2 text-[12.5px] ${
              active || directoryFocused || contextActive ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
            }`}
            style={{ paddingLeft: depth * 14 + 6 }}
            title={reference.relativePath || reference.name}
            onContextMenu={(event) => openContextMenu(event, reference, directory, expandedDirectory)}
          >
            <button
              type="button"
              onClick={() => {
                if (directory) {
                  toggleDirectory(reference.relativePath)
                  return
                }
                if (previewable) onPreviewFile(reference)
              }}
              className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left ${previewable || directory ? '' : 'cursor-default'}`}
            >
              {directory ? (
                expandedDirectory ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
                )
              ) : (
                <span className="h-3.5 w-3.5 shrink-0" />
              )}
              {referenceIcon(reference.kind, expandedDirectory)}
              <span className="min-w-0 flex-1 truncate">{reference.name}</span>
            </button>
            <button
              type="button"
              onClick={() => addReference(reference)}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-faint transition hover:bg-ds-card hover:text-ds-ink disabled:cursor-default disabled:opacity-70"
              disabled={selected}
              title={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
              aria-label={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
            >
              {selected ? <Check className="h-3.5 w-3.5" strokeWidth={1.9} /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
            </button>
          </div>
        )
        return directory && expandedDirectory
          ? [row, ...renderDirectory(reference.relativePath, depth + 1)]
          : [row]
      })
  }

  return (
    <aside className={`ds-no-drag flex min-h-0 flex-col border-l border-ds-border-muted bg-ds-main ${className ?? ''}`}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
        <FolderOpen className="h-4 w-4 shrink-0 text-ds-muted" strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ds-ink">
            {t('workspaceFilesTitle')}
          </div>
          <div className="truncate text-[11px] text-ds-faint" title={root}>
            {root ? selectedGroup?.label ?? workspaceName(root) : t('workspaceRequiredToCreateThread')}
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!root}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-50"
          title={t('workspaceReferenceRefresh')}
          aria-label={t('workspaceReferenceRefresh')}
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          title={t('rightPanelCollapse')}
          aria-label={t('rightPanelCollapse')}
        >
          <PanelRightClose className="h-4 w-4" strokeWidth={1.85} />
        </button>
      </div>
      {groups.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-ds-border-muted px-2 py-2">
          {groups.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => setSelectedGroupId(group.id)}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                group.id === selectedGroup?.id
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-ds-border-muted bg-ds-card text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
              }`}
              title={group.workspaceRoot}
            >
              {group.label}
            </button>
          ))}
        </div>
      ) : null}
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-auto py-1"
        onContextMenu={openWorkspaceContextMenu}
      >
        {root ? renderDirectory(ROOT_PATH, 0) : (
          <div className="px-3 py-3 text-[12px] leading-5 text-ds-muted">
            {t('workspaceRequiredToCreateThread')}
          </div>
        )}
      </div>
      {contextMenu ? (
        <FileTreeContextMenu
          state={contextMenu}
          selected={contextMenu.reference
            ? selectedReferenceKeys.has(composerFileReferenceKey({
                relativePath: contextMenu.reference.relativePath,
                workspaceRoot: contextMenu.reference.workspaceRoot
              }))
            : false}
          canPaste={Boolean(fileClipboard)}
          onClose={() => setContextMenu(null)}
          onPreview={() => {
            if (contextMenu.reference) onPreviewFile(contextMenu.reference)
          }}
          onToggleDirectory={() => {
            if (contextMenu.reference) toggleDirectory(contextMenu.reference.relativePath)
          }}
          onAddReference={() => {
            if (contextMenu.reference) addReference(contextMenu.reference)
          }}
          onOpenEditor={() => {
            if (contextMenu.reference) openReferenceInEditor(contextMenu.reference)
          }}
          onCopyEntry={() => {
            if (contextMenu.reference) setFileClipboard({ action: 'copy', reference: contextMenu.reference })
          }}
          onCutEntry={() => {
            if (contextMenu.reference) setFileClipboard({ action: 'cut', reference: contextMenu.reference })
          }}
          onPaste={() => void pasteClipboardEntry(contextMenu.targetDirectoryPath)}
          onDelete={() => {
            if (contextMenu.reference) void deleteReference(contextMenu.reference, contextMenu.directory)
          }}
          onCopyPath={() => {
            if (contextMenu.reference) void copyReferencePath(contextMenu.reference)
          }}
          onRefresh={refresh}
          t={t}
        />
      ) : null}
    </aside>
  )
}

function FileTreeContextMenu({
  state,
  selected,
  canPaste,
  onClose,
  onPreview,
  onToggleDirectory,
  onAddReference,
  onOpenEditor,
  onCopyEntry,
  onCutEntry,
  onPaste,
  onDelete,
  onCopyPath,
  onRefresh,
  t
}: {
  state: FileTreeContextMenuState
  selected: boolean
  canPaste: boolean
  onClose: () => void
  onPreview: () => void
  onToggleDirectory: () => void
  onAddReference: () => void
  onOpenEditor: () => void
  onCopyEntry: () => void
  onCutEntry: () => void
  onPaste: () => void
  onDelete: () => void
  onCopyPath: () => void
  onRefresh: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const run = (action: () => void): void => {
    onClose()
    action()
  }

  return (
    <div
      role="menu"
      aria-label={state.reference?.relativePath || state.reference?.name || t('workspaceFilesTitle')}
      className="ds-no-drag fixed z-50 min-w-[206px] rounded-lg border border-ds-border bg-ds-card/98 p-1 text-[13px] text-ds-ink shadow-[0_16px_42px_rgba(15,23,42,0.16)] backdrop-blur-xl dark:bg-ds-card"
      style={{ left: state.x, top: state.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {state.reference ? (
        <>
          {state.directory ? (
            <FileTreeContextMenuItem
              icon={state.expanded
                ? <Folder className="h-3.5 w-3.5" strokeWidth={1.8} />
                : <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={state.expanded ? t('fileTreeCollapse') : t('fileTreeExpand')}
              onClick={() => run(onToggleDirectory)}
            />
          ) : (
            <FileTreeContextMenuItem
              icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.8} />}
              label={t('fileTreePreview')}
              onClick={() => run(onPreview)}
            />
          )}
          <FileTreeContextMenuItem
            icon={selected
              ? <Check className="h-3.5 w-3.5" strokeWidth={1.9} />
              : <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />}
            label={selected ? t('workspaceReferenceAdded') : t('workspaceReferenceAdd')}
            disabled={selected}
            onClick={() => run(onAddReference)}
          />
          <div className="my-1 h-px bg-ds-border-muted" />
          <FileTreeContextMenuItem
            icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('windowsMenuCopy')}
            onClick={() => run(onCopyEntry)}
          />
          <FileTreeContextMenuItem
            icon={<Scissors className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('windowsMenuCut')}
            onClick={() => run(onCutEntry)}
          />
        </>
      ) : null}
      <FileTreeContextMenuItem
        icon={<ClipboardPaste className="h-3.5 w-3.5" strokeWidth={1.8} />}
        label={t('windowsMenuPaste')}
        disabled={!canPaste}
        onClick={() => run(onPaste)}
      />
      <div className="my-1 h-px bg-ds-border-muted" />
      {state.reference ? (
        <>
          <FileTreeContextMenuItem
            icon={<ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('filePreviewOpenEditor')}
            onClick={() => run(onOpenEditor)}
          />
          <FileTreeContextMenuItem
            icon={<Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('filePreviewCopyPath')}
            onClick={() => run(onCopyPath)}
          />
          <div className="my-1 h-px bg-ds-border-muted" />
          <FileTreeContextMenuItem
            icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={state.directory ? t('writeDeleteFolder') : t('writeDeleteFile')}
            danger
            onClick={() => run(onDelete)}
          />
        </>
      ) : (
        <FileTreeContextMenuItem
          icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
          label={t('workspaceReferenceRefresh')}
          onClick={() => run(onRefresh)}
        />
      )}
    </div>
  )
}

function FileTreeContextMenuItem({
  icon,
  label,
  disabled = false,
  danger = false,
  onClick
}: {
  icon: ReactElement
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[30px] w-full items-center gap-2 rounded-md px-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-300'
          : 'hover:bg-[var(--ds-sidebar-row-hover)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current opacity-80">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}

function normalizeWorkspaceGroups(
  workspaceRoot: string,
  workspaceGroups: WorkspaceReferenceGroup[] | undefined
): WorkspaceReferenceGroup[] {
  const raw = workspaceGroups?.length
    ? workspaceGroups
    : workspaceRoot.trim()
      ? [{
          id: `project:${workspaceRoot.trim()}`,
          label: workspaceName(workspaceRoot),
          workspaceRoot,
          kind: 'project' as const
        }]
      : []
  const seen = new Set<string>()
  const groups: WorkspaceReferenceGroup[] = []
  for (const group of raw) {
    const root = normalizePath(group.workspaceRoot)
    if (!root) continue
    const key = root.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      ...group,
      workspaceRoot: root,
      label: group.label || workspaceName(root)
    })
  }
  return groups
}
