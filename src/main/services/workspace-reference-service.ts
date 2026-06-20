import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type {
  AgentRuntimeWorkspaceReference,
  AgentRuntimeWorkspaceReferencePreview
} from '../../shared/agent-runtime-contract'
import {
  readWorkspaceFile,
  readWorkspaceImage
} from './workspace-files'
import {
  canonicalPath,
  compareWorkspaceEntries,
  extensionFromName,
  normalizePathSeparators,
  resolveOpenTargetPath,
  resolveWorkspaceDirectory
} from './workspace-paths'

const MAX_DIRECTORY_CHILDREN = 300
const MAX_SUMMARY_CHARS = 8_000

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.ico'])

export class WorkspaceReferenceService {
  async list(input: {
    workspaceRoot: string
    path?: string
    recursive?: boolean
    limit?: number
  }): Promise<{ ok: true; references: AgentRuntimeWorkspaceReference[] } | { ok: false; message: string }> {
    try {
      const workspaceRoot = await canonicalPath(input.workspaceRoot)
      const root = await resolveWorkspaceDirectory({
        workspaceRoot,
        ...(input.path?.trim() ? { path: input.path.trim() } : {})
      })
      const limit = Math.max(1, Math.min(input.limit ?? MAX_DIRECTORY_CHILDREN, 2_000))
      const references = await listReferences(workspaceRoot, root, input.recursive === true, limit)
      return { ok: true, references }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async preview(input: {
    workspaceRoot: string
    path: string
  }): Promise<{ ok: true; preview: AgentRuntimeWorkspaceReferencePreview } | { ok: false; message: string }> {
    try {
      const workspaceRoot = await canonicalPath(input.workspaceRoot)
      const targetPath = await resolveOpenTargetPath(input.path, workspaceRoot, { allowBasenameFallback: false })
      const reference = await referenceForPath(workspaceRoot, targetPath)
      if (reference.kind === 'directory') {
        const children = await listReferences(workspaceRoot, targetPath, false, MAX_DIRECTORY_CHILDREN)
        return {
          ok: true,
          preview: {
            reference,
            contentSummary: `Directory with ${children.length} visible entries.`,
            children
          }
        }
      }
      if (reference.kind === 'image') {
        const image = await readWorkspaceImage({ path: targetPath, workspaceRoot })
        return {
          ok: true,
          preview: {
            reference,
            contentSummary: image.ok
              ? `Image ${reference.relativePath} (${image.mimeType}, ${formatBytes(image.size)}).`
              : image.message
          }
        }
      }
      const result = await readWorkspaceFile({ path: targetPath, workspaceRoot })
      if (!result.ok) return { ok: false, message: result.message }
      if (result.kind === 'pdf') {
        return {
          ok: true,
          preview: {
            reference: { ...reference, kind: 'pdf', mimeType: result.mimeType, size: result.size },
            contentSummary: `PDF ${reference.relativePath} (${formatBytes(result.size)}).`
          }
        }
      }
      const content = result.content.slice(0, MAX_SUMMARY_CHARS)
      return {
        ok: true,
        preview: {
          reference: { ...reference, kind: 'text', mimeType: result.mimeType, size: result.size },
          contentSummary: summarizeText(content, result.truncated),
          content,
          truncated: result.truncated || result.content.length > MAX_SUMMARY_CHARS
        }
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}

async function listReferences(
  workspaceRoot: string,
  root: string,
  recursive: boolean,
  limit: number
): Promise<AgentRuntimeWorkspaceReference[]> {
  const output: AgentRuntimeWorkspaceReference[] = []
  const stack = [root]
  while (stack.length && output.length < limit) {
    const current = stack.shift()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    const sorted = entries
      .filter((entry) => entry.name !== '.DS_Store' && entry.name !== '.git' && entry.name !== 'node_modules')
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const)
      }))
      .sort(compareWorkspaceEntries)
    for (const entry of sorted) {
      if (output.length >= limit) break
      const path = join(current, entry.name)
      const reference = await referenceForPath(workspaceRoot, path)
      output.push(reference)
      if (recursive && reference.kind === 'directory') stack.push(path)
    }
  }
  return output
}

async function referenceForPath(workspaceRoot: string, path: string): Promise<AgentRuntimeWorkspaceReference> {
  const info = await stat(path)
  const ext = extensionFromName(path)
  const relativePath = normalizePathSeparators(relative(workspaceRoot, path))
  const kind = info.isDirectory()
    ? 'directory'
    : ext === '.pdf'
      ? 'pdf'
      : IMAGE_EXTENSIONS.has(ext)
        ? 'image'
        : 'file'
  return {
    workspaceRoot,
    relativePath,
    name: basename(path),
    kind,
    ...(info.isFile() ? { size: info.size } : {}),
    ...(kind === 'pdf' ? { mimeType: 'application/pdf' } : {}),
    ...(kind === 'image' ? { mimeType: imageMime(ext) } : {})
  }
}

function summarizeText(content: string, truncated: boolean): string {
  const lines = content.split('\n').slice(0, 80)
  const summary = lines.join('\n').trim()
  return `${summary}${truncated ? '\n...[truncated]' : ''}`
}

function imageMime(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.bmp') return 'image/bmp'
  if (ext === '.avif') return 'image/avif'
  if (ext === '.ico') return 'image/x-icon'
  return 'image/png'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
