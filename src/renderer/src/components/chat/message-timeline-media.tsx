import type { ComponentPropsWithRef, ReactElement } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, ImageIcon, Loader2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  hasSafeEmbeddedMediaExtension,
  isSafeEmbeddedMediaMimeType,
  normalizeSafeEmbeddedMediaUrl,
  normalizeSafeRemoteEmbeddedMediaUrl
} from '@shared/external-url-policy'
import type { AttachmentReference, RuntimeDisclosureMetadata } from '../../agent/types'
import { getProvider } from '../../agent/registry'
import { openSafeExternalUrl } from '../../lib/open-external'
import { useChatStore } from '../../store/chat-store'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { ImagePreviewLightbox } from './ImagePreviewLightbox'

type TimelineImageReference = {
  id?: string
  name?: string
  fileName?: string
  mimeType?: string
  byteSize?: number
  width?: number
  height?: number
  previewUrl?: string
  dataUrl?: string
  url?: string
  path?: string
  relativePath?: string
  absolutePath?: string
  source: 'attachment' | 'generated'
}

type TimelineImageGalleryVariant = 'user' | 'tool' | 'conversation' | 'assistant'

type PreviewState = {
  urls: Record<string, string>
  failures: Record<string, string>
  paths: Record<string, string>
}

type PreviewRequest =
  | { key: string; id: string; mode: 'attachment' }
  | { key: string; path: string; mode: 'workspace-image' }

type ImageActionState = 'idle' | 'busy' | 'done' | 'error'

const ACTION_RESET_MS = 1600

function readString(raw: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeGeneratedFileReference(entry: unknown): TimelineImageReference | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const id = readString(raw, 'id', 'attachmentId')
  const name = readString(raw, 'name', 'fileName', 'filename')
  const fileName = readString(raw, 'fileName', 'filename')
  const mimeType = readString(raw, 'mimeType', 'type', 'mediaType')
  const previewUrl = readString(raw, 'previewUrl', 'dataUrl', 'url')
  const dataUrl = readString(raw, 'dataUrl')
  const url = readString(raw, 'url')
  const path = readString(raw, 'path', 'file')
  const relativePath = readString(raw, 'relativePath', 'relative_path')
  const absolutePath = readString(raw, 'absolutePath', 'absolute_path')
  const byteSize = readNumber(raw, 'byteSize')
  const width = readNumber(raw, 'width')
  const height = readNumber(raw, 'height')
  const normalized: TimelineImageReference = {
    source: 'generated',
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(fileName ? { fileName } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(byteSize ? { byteSize } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(previewUrl ? { previewUrl } : {}),
    ...(dataUrl ? { dataUrl } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(relativePath ? { relativePath } : {}),
    ...(absolutePath ? { absolutePath } : {})
  }
  return isImageReference(normalized) ? normalized : null
}

function normalizeAttachmentReference(entry: AttachmentReference): TimelineImageReference | null {
  const normalized: TimelineImageReference = {
    source: 'attachment',
    id: entry.id,
    ...(entry.name ? { name: entry.name } : {}),
    ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
    ...(entry.byteSize ? { byteSize: entry.byteSize } : {}),
    ...(entry.width ? { width: entry.width } : {}),
    ...(entry.height ? { height: entry.height } : {}),
    ...(entry.previewUrl ? { previewUrl: entry.previewUrl } : {}),
    ...(entry.path ? { path: entry.path } : {}),
    ...(entry.relativePath ? { relativePath: entry.relativePath } : {}),
    ...(entry.absolutePath ? { absolutePath: entry.absolutePath } : {})
  }
  return isImageReference(normalized) || !normalized.mimeType ? normalized : null
}

function arrayFromMeta(meta: Record<string, unknown> | undefined, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = meta?.[key]
    if (Array.isArray(value)) return value
  }
  return []
}

export function imageAttachmentsFromMeta(meta: RuntimeDisclosureMetadata | undefined): AttachmentReference[] {
  const byId = new Map<string, AttachmentReference>()
  for (const entry of meta?.attachments ?? []) {
    if (entry.id?.trim()) byId.set(entry.id.trim(), entry)
  }
  for (const id of meta?.attachmentIds ?? []) {
    const normalizedId = id.trim()
    if (normalizedId && !byId.has(normalizedId)) byId.set(normalizedId, { id: normalizedId })
  }
  return [...byId.values()]
}

export function timelineImagesFromMeta(meta: Record<string, unknown> | undefined): TimelineImageReference[] {
  const runtimeMeta = meta as RuntimeDisclosureMetadata | undefined
  const images: TimelineImageReference[] = []
  const indexByKey = new Map<string, number>()
  const add = (image: TimelineImageReference | null): void => {
    if (!image) return
    const key = imageKey(image)
    const existing = indexByKey.get(key)
    if (existing !== undefined) {
      images[existing] = { ...images[existing], ...image }
      return
    }
    indexByKey.set(key, images.length)
    images.push(image)
  }

  for (const attachment of imageAttachmentsFromMeta(runtimeMeta)) {
    add(normalizeAttachmentReference(attachment))
  }
  for (const entry of [
    ...arrayFromMeta(meta, 'generatedFiles'),
    ...arrayFromMeta(meta, 'generatedImages'),
    ...arrayFromMeta(meta, 'images')
  ]) {
    add(normalizeGeneratedFileReference(entry))
  }
  return images.filter((image) => isImageReference(image) || (image.source === 'attachment' && Boolean(image.id)))
}

function imageKey(image: TimelineImageReference): string {
  return (
    image.id ||
    image.absolutePath ||
    image.path ||
    image.relativePath ||
    image.previewUrl ||
    image.dataUrl ||
    image.url ||
    image.name ||
    image.fileName ||
    'image'
  )
}

function imageTitle(image: TimelineImageReference): string {
  const fromPath = imagePath(image)?.split(/[\\/]/).filter(Boolean).at(-1)
  return image.name || image.fileName || fromPath || image.id || 'image'
}

function imagePath(image: TimelineImageReference): string | undefined {
  return image.absolutePath || image.path || image.relativePath
}

function isAbsolutePathLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~') || /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')
}

function workspaceRootForPath(path: string | undefined, workspaceRoot: string | undefined): string | undefined {
  if (!path || isAbsolutePathLike(path)) return undefined
  return workspaceRoot
}

function rawPreviewUrl(image: TimelineImageReference): string | undefined {
  return image.previewUrl || image.dataUrl || image.url
}

function isSafePreviewUrl(value: string | undefined): boolean {
  return normalizeSafeEmbeddedMediaUrl(value) !== null
}

function isImageReference(image: TimelineImageReference): boolean {
  if (isSafeEmbeddedMediaMimeType(image.mimeType)) return true
  const source = [image.name, image.fileName, image.path, image.relativePath, image.absolutePath, image.url].find(Boolean)
  if (source && hasSafeEmbeddedMediaExtension(source)) return true
  return isSafePreviewUrl(rawPreviewUrl(image))
}

function formatByteSize(byteSize: number | undefined): string {
  if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = byteSize
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  if (typeof document === 'undefined') return
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  link.rel = 'noreferrer'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function usePreviewState(images: TimelineImageReference[]): PreviewState {
  const activeThreadId = useChatStore((s) => s.activeThreadId)
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const [state, setState] = useState<PreviewState>({ urls: {}, failures: {}, paths: {} })
  const requests = useMemo(() => {
    return images
      .map((image): PreviewRequest | null => {
        const key = imageKey(image)
        if (rawPreviewUrl(image) || state.urls[key] || state.failures[key]) return null
        const path = imagePath(image)
        if (path) return { key, path, mode: 'workspace-image' }
        if (image.source === 'attachment' && image.id) return { key, id: image.id, mode: 'attachment' }
        return null
      })
      .filter((request): request is PreviewRequest => request !== null)
  }, [images, state.failures, state.urls])
  const requestKey = requests
    .map((request) => request.mode === 'attachment' ? `attachment:${request.id}` : `path:${request.path}`)
    .join('\n')

  useEffect(() => {
    if (!requestKey) return
    const provider = getProvider()
    let cancelled = false
    void Promise.all(requests.map(async (request) => {
      try {
        if (request.mode === 'attachment') {
          if (typeof provider.getAttachmentContent !== 'function') {
            return { key: request.key, failed: 'Attachment content is unavailable.' }
          }
          const content = await provider.getAttachmentContent(request.id, {
            ...(activeThreadId ? { threadId: activeThreadId } : {}),
            ...(workspaceRoot ? { workspace: workspaceRoot } : {})
          })
          if (!isSafeEmbeddedMediaMimeType(content.attachment.mimeType)) {
            return { key: request.key, failed: 'Attachment is not an image.' }
          }
          const previewUrl = normalizeSafeEmbeddedMediaUrl(`data:${content.attachment.mimeType};base64,${content.dataBase64}`)
          if (!previewUrl) {
            return { key: request.key, failed: 'Attachment image type is not supported.' }
          }
          return {
            key: request.key,
            previewUrl,
            path: content.attachment.localFilePath
          }
        }

        if (typeof window.sciforge?.readWorkspaceImage !== 'function') {
          return { key: request.key, failed: 'Image reader is unavailable.' }
        }
        const result = await window.sciforge.readWorkspaceImage({
          path: request.path,
          ...(workspaceRootForPath(request.path, workspaceRoot) ? {
            workspaceRoot: workspaceRootForPath(request.path, workspaceRoot)
          } : {})
        })
        if (!result.ok) return { key: request.key, failed: result.message }
        return { key: request.key, previewUrl: result.dataUrl, path: result.path }
      } catch (error) {
        return {
          key: request.key,
          failed: error instanceof Error ? error.message : String(error)
        }
      }
    })).then((results) => {
      if (cancelled) return
      setState((current) => {
        const next: PreviewState = {
          urls: { ...current.urls },
          failures: { ...current.failures },
          paths: { ...current.paths }
        }
        for (const result of results) {
          if ('previewUrl' in result && typeof result.previewUrl === 'string') {
            next.urls[result.key] = result.previewUrl
            delete next.failures[result.key]
          }
          if ('path' in result && typeof result.path === 'string') {
            next.paths[result.key] = result.path
          }
          if ('failed' in result && typeof result.failed === 'string') {
            next.failures[result.key] = result.failed
          }
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [activeThreadId, requestKey, requests, workspaceRoot])

  return state
}

function TimelineImageTile({
  image,
  previewUrl,
  resolvedPath,
  failure,
  variant
}: {
  image: TimelineImageReference
  previewUrl?: string
  resolvedPath?: string
  failure?: string
  variant: TimelineImageGalleryVariant
}): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useChatStore((s) => s.workspaceRoot)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [downloadState, setDownloadState] = useState<ImageActionState>('idle')
  const [copyState, setCopyState] = useState<ImageActionState>('idle')
  const [openState, setOpenState] = useState<ImageActionState>('idle')
  const title = imageTitle(image)
  const sourcePath = resolvedPath || imagePath(image)
  const sourceUrl = normalizeSafeRemoteEmbeddedMediaUrl(image.url) ?? undefined
  const rawUrl = rawPreviewUrl(image)
  const safeRawUrl = normalizeSafeEmbeddedMediaUrl(rawUrl) ?? undefined
  const src = safeRawUrl || previewUrl
  const copyValue = sourcePath || sourceUrl
  const byteSize = formatByteSize(image.byteSize)
  const metadata = [image.mimeType, byteSize].filter(Boolean).join(' | ')
  const canOpenOriginal = Boolean(sourcePath || sourceUrl)
  const canDownload = Boolean(src)
  const canCopy = Boolean(copyValue)
  const tileClass =
    variant === 'conversation' || variant === 'assistant'
      ? 'h-48 w-full overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm sm:h-56'
      : variant === 'tool'
        ? 'h-32 w-40 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
        : 'h-28 w-36 overflow-hidden rounded-lg border border-ds-border-muted bg-ds-card shadow-sm'
  const iconButtonClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-ds-border-muted bg-ds-card/92 text-ds-muted shadow-sm backdrop-blur transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

  useEffect(() => {
    if (downloadState === 'idle' && copyState === 'idle' && openState === 'idle') return
    const timer = window.setTimeout(() => {
      setDownloadState('idle')
      setCopyState('idle')
      setOpenState('idle')
    }, ACTION_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [copyState, downloadState, openState])

  const handleDownload = (): void => {
    if (!src) {
      setDownloadState('error')
      return
    }
    try {
      downloadDataUrl(src, title)
      setDownloadState('done')
    } catch {
      setDownloadState('error')
    }
  }

  const handleOpenOriginal = async (): Promise<void> => {
    if (!sourcePath && !sourceUrl) return
    setOpenState('busy')
    try {
      if (sourcePath) {
        const result = await openWorkspacePathInEditor(
          { path: sourcePath },
          workspaceRootForPath(sourcePath, workspaceRoot)
        )
        setOpenState(result.ok ? 'done' : 'error')
        return
      }
      if (await openSafeExternalUrl(sourceUrl)) {
        setOpenState('done')
        return
      }
      setOpenState('error')
    } catch {
      setOpenState('error')
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!copyValue || typeof navigator?.clipboard?.writeText !== 'function') {
      setCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(copyValue)
      setCopyState('done')
    } catch {
      setCopyState('error')
    }
  }

  const actionIcon = (state: ImageActionState, fallback: ReactElement): ReactElement => {
    if (state === 'busy') return <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
    if (state === 'done') return <Check className="h-3.5 w-3.5" strokeWidth={2} />
    return fallback
  }

  if (src) {
    return (
      <figure className={`${tileClass} group/image relative`} title={title}>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="block h-full w-full cursor-zoom-in bg-ds-subtle"
          title={t('imagePreviewOpen', { name: title })}
          aria-label={t('imagePreviewOpen', { name: title })}
        >
          <img src={src} alt={title} className="h-full w-full object-contain" loading="lazy" />
        </button>
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover/image:opacity-100 group-focus-within/image:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              handleDownload()
            }}
            disabled={!canDownload}
            title={t('generatedFileDownload')}
            aria-label={t('generatedFileDownload')}
            className={iconButtonClass}
          >
            {actionIcon(downloadState, <Download className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleOpenOriginal()
            }}
            disabled={!canOpenOriginal || openState === 'busy'}
            title={t('imageOpenOriginal')}
            aria-label={t('imageOpenOriginal')}
            className={iconButtonClass}
          >
            {actionIcon(openState, <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              void handleCopy()
            }}
            disabled={!canCopy}
            title={copyState === 'done' ? t('copySuccess') : t('filePreviewCopyPath')}
            aria-label={copyState === 'done' ? t('copySuccess') : t('filePreviewCopyPath')}
            className={iconButtonClass}
          >
            {actionIcon(copyState, <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          </button>
        </div>
        {metadata ? (
          <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-ds-card/90 px-2 py-1 text-[11px] text-ds-faint opacity-0 transition group-hover/image:opacity-100">
            {metadata}
          </figcaption>
        ) : null}
        <ImagePreviewLightbox
          open={previewOpen}
          src={src}
          alt={title}
          title={title}
          downloadDisabled={!canDownload}
          downloadLabel={t('generatedFileDownload')}
          onDownload={handleDownload}
          onClose={() => setPreviewOpen(false)}
        />
      </figure>
    )
  }

  return (
    <div className={`${tileClass} flex flex-col justify-between p-3`} title={failure || title}>
      <div className="flex min-w-0 items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted bg-ds-subtle text-ds-muted">
          {failure ? (
            <TriangleAlert className="h-4 w-4" strokeWidth={1.8} />
          ) : (
            <ImageIcon className="h-4 w-4" strokeWidth={1.8} />
          )}
        </span>
        <div className="min-w-0">
          <div className="line-clamp-2 break-words text-[12.5px] font-semibold leading-5 text-ds-ink">
            {title}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ds-faint">
            {failure || t('generatedFilePreviewUnavailable')}
          </div>
        </div>
      </div>
      {copyValue ? (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="mt-3 inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-card/90 px-2 text-[11.5px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          {actionIcon(copyState, <Copy className="h-3.5 w-3.5" strokeWidth={1.9} />)}
          {copyState === 'done' ? t('copySuccess') : t('filePreviewCopyPath')}
        </button>
      ) : null}
    </div>
  )
}

export function TimelineImageGallery({
  images,
  variant
}: {
  images: TimelineImageReference[]
  variant: TimelineImageGalleryVariant
}): ReactElement | null {
  const previewState = usePreviewState(images)
  if (images.length === 0) return null
  const wrapperClass =
    variant === 'conversation'
      ? `grid w-full max-w-2xl grid-cols-1 gap-2 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`
      : variant === 'assistant'
        ? `mt-3 grid w-full max-w-2xl grid-cols-1 gap-2 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`
        : variant === 'tool'
          ? 'flex min-w-0 flex-wrap gap-2 border-t border-ds-border-muted/60 px-4 py-3'
          : 'flex max-w-[80%] flex-wrap justify-end gap-2'

  return (
    <div className={wrapperClass}>
      {images.map((image) => {
        const key = imageKey(image)
        return (
          <TimelineImageTile
            key={key}
            image={image}
            previewUrl={previewState.urls[key]}
            resolvedPath={previewState.paths[key]}
            failure={previewState.failures[key]}
            variant={variant}
          />
        )
      })}
    </div>
  )
}

export function TimelineImagesFromMeta({
  meta,
  variant
}: {
  meta?: Record<string, unknown>
  variant: TimelineImageGalleryVariant
}): ReactElement | null {
  const images = useMemo(() => timelineImagesFromMeta(meta), [meta])
  return <TimelineImageGallery images={images} variant={variant} />
}

export function TimelineImageResultsPanel({
  blocks
}: {
  blocks: Array<{ id: string; meta?: Record<string, unknown> }>
}): ReactElement | null {
  const { t } = useTranslation('common')
  const images = useMemo(() => {
    const byKey = new Map<string, TimelineImageReference>()
    for (const block of blocks) {
      for (const image of timelineImagesFromMeta(block.meta)) {
        byKey.set(imageKey(image), image)
      }
    }
    return [...byKey.values()]
  }, [blocks])

  if (images.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="text-[12px] font-semibold text-ds-faint">{t('generatedFilesTitle')}</div>
      <TimelineImageGallery images={images} variant="conversation" />
    </div>
  )
}

type MarkdownImageProps = ComponentPropsWithRef<'img'> & { node?: unknown }

export function AssistantMarkdownImage({
  src,
  alt,
  title,
  className
}: MarkdownImageProps): ReactElement {
  const image = useMemo<TimelineImageReference | null>(() => {
    if (!src) return null
    const value = String(src)
    const base: TimelineImageReference = {
      source: 'generated',
      ...(typeof alt === 'string' && alt.trim() ? { name: alt.trim() } : {}),
      ...(isSafePreviewUrl(value) ? { previewUrl: value } : { path: value })
    }
    return isImageReference(base) ? base : null
  }, [alt, src])

  if (!image) {
    return <span className={className}>{alt || title || 'image'}</span>
  }

  return (
    <div className="my-3">
      <TimelineImageGallery images={[image]} variant="assistant" />
    </div>
  )
}
