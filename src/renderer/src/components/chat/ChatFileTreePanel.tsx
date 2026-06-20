import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferenceKind
} from '@shared/agent-runtime-contract'
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Image,
  Loader2,
  PanelRightClose,
  Plus,
  RefreshCw
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { getProvider } from '../../agent/registry'
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
  selectedReferences?: ComposerFileReference[]
  className?: string
  onPreviewFile: (reference: AgentRuntimeWorkspaceReference) => void
  onAddReference: (reference: ComposerFileReference) => void
  onCollapse: () => void
}

type DirectoryState = {
  references: AgentRuntimeWorkspaceReference[]
  loading: boolean
  error: string | null
}

const ROOT_PATH = ''
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.hg', '.svn', 'node_modules'])

function normalizePath(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/+$/g, '')
}

function pathKey(value: string): string {
  return normalizePath(value).toLowerCase()
}

function workspaceName(workspaceRoot: string): string {
  return normalizePath(workspaceRoot).split('/').filter(Boolean).at(-1) ?? workspaceRoot
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
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0]
  const root = selectedGroup?.workspaceRoot.trim() ?? ''
  const selectedKey = useMemo(() => pathKey(selectedPath ?? ''), [selectedPath])
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
  }, [root])

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
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const addReference = (reference: AgentRuntimeWorkspaceReference): void => {
    onAddReference(composerReferenceFromWorkspaceReference(reference))
  }

  const refresh = (): void => {
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
        const previewable = !directory && reference.kind !== 'image'
        const active = previewable && selectedKey === pathKey(reference.relativePath)
        const referenceKey = composerFileReferenceKey({
          relativePath: reference.relativePath,
          workspaceRoot: reference.workspaceRoot
        })
        const selected = selectedReferenceKeys.has(referenceKey)
        const row = (
          <div
            key={reference.relativePath}
            className={`group flex min-h-8 items-center gap-1 px-1.5 pr-2 text-[12.5px] ${
              active ? 'bg-ds-hover text-ds-ink' : 'text-ds-muted hover:bg-ds-hover/70 hover:text-ds-ink'
            }`}
            style={{ paddingLeft: depth * 14 + 6 }}
            title={reference.relativePath || reference.name}
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
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {root ? renderDirectory(ROOT_PATH, 0) : (
          <div className="px-3 py-3 text-[12px] leading-5 text-ds-muted">
            {t('workspaceRequiredToCreateThread')}
          </div>
        )}
      </div>
    </aside>
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
