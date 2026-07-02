import { dirname } from 'node:path'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'
import {
  applyEditsToNormalizedContent,
  detectLineEnding,
  firstChangedLine,
  generateDisplayDiff,
  generateUnifiedPatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom
} from './edit-diff.js'
import { withFileMutationQueue } from './file-mutation-queue.js'
import type { EditLocalToolOptions, WriteLocalToolOptions } from './builtin-tool-types.js'
import { defaultEditLocalToolOperations, defaultWriteLocalToolOperations } from './builtin-tool-operations.js'
import { parseEditInstructions, resolveWorkspacePath, withToolBoundary } from './builtin-tool-utils.js'
import { assertCanWritePath } from './sandbox-policy.js'
import { isHygienePlaceholderValue } from '../../shared/hygiene-placeholders.js'

export function createWriteLocalTool(_options: WriteLocalToolOptions = {}): LocalTool {
  const mkdirOp = _options.operations?.mkdir ?? defaultWriteLocalToolOperations.mkdir!
  const writeFileOp = _options.operations?.writeFile ?? defaultWriteLocalToolOperations.writeFile!
  return LocalToolHost.defineTool({
    name: 'write',
    description: 'Create or overwrite a workspace file with the provided content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      if (isHygienePlaceholderValue(args.content)) {
        return {
          output: {
            error:
              'refusing to write a request/cache-hygiene placeholder as file content; read the source or generate the real content before retrying'
          },
          isError: true
        }
      }
      const content = typeof args.content === 'string' ? args.content : null
      if (!rawPath.trim() || content == null) {
        return { output: { error: 'path and content are required' }, isError: true }
      }
      if (isHygienePlaceholderValue(content)) {
        return {
          output: {
            error:
              'refusing to write a request/cache-hygiene placeholder as file content; read the source or generate the real content before retrying'
          },
          isError: true
        }
      }
      const { absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        await mkdirOp(dirname(absolutePath))
        await writeFileOp(absolutePath, content)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            bytes_written: Buffer.byteLength(content, 'utf8')
          }
        }
      })
    })
  })
}

export const createWriteTool = createWriteLocalTool
export const createWriteToolDefinition = createWriteLocalTool

export function createEditLocalTool(_options: EditLocalToolOptions = {}): LocalTool {
  const readFileOp = _options.operations?.readFile ?? defaultEditLocalToolOperations.readFile!
  const writeFileOp = _options.operations?.writeFile ?? defaultEditLocalToolOperations.writeFile!
  return LocalToolHost.defineTool({
    name: 'edit',
    description: 'Edit a workspace file using exact text replacement. Supports multiple disjoint edits in one call.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        oldText: { type: 'string' },
        newText: { type: 'string' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' }
            },
            required: ['oldText', 'newText'],
            additionalProperties: false
          }
        }
      },
      required: ['path'],
      additionalProperties: false
    },
    policy: 'on-request',
    toolKind: 'file_change',
    execute: async (args, context) => withToolBoundary(async () => {
      const rawPath = typeof args.path === 'string' ? args.path : ''
      if (editContainsHygienePlaceholderValue(args)) {
        return {
          output: {
            error:
              'refusing to insert a request/cache-hygiene placeholder into a file; read the source or generate the real replacement before retrying'
          },
          isError: true
        }
      }
      const edits = parseEditInstructions(args)
      if (!rawPath.trim() || edits.length === 0) {
        return { output: { error: 'path and at least one edit are required' }, isError: true }
      }
      const { absolutePath, relativePath } = resolveWorkspacePath(rawPath, context)
      assertCanWritePath(absolutePath, context)
      return withFileMutationQueue(absolutePath, async () => {
        const rawSource = await readFileOp(absolutePath)
        const { bom, text: source } = stripBom(rawSource)
        const lineEnding = detectLineEnding(source)
        const normalizedSource = normalizeToLF(source)
        const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedSource, edits, relativePath)
        const next = bom + restoreLineEndings(newContent, lineEnding)
        await writeFileOp(absolutePath, next)
        const diff = generateDisplayDiff(baseContent, newContent)
        const patch = generateUnifiedPatch(relativePath, baseContent, newContent)
        return {
          output: {
            path: absolutePath,
            relative_path: relativePath,
            replacements: edits.length,
            bytes_written: Buffer.byteLength(next, 'utf8'),
            diff,
            patch,
            first_changed_line: firstChangedLine(baseContent, newContent)
          }
        }
      })
    })
  })
}

export const createEditTool = createEditLocalTool
export const createEditToolDefinition = createEditLocalTool

function editContainsHygienePlaceholderValue(args: Record<string, unknown>): boolean {
  if (isHygienePlaceholderValue(args.newText)) return true
  if (!Array.isArray(args.edits)) return false
  return args.edits.some((edit) => edit && typeof edit === 'object' && isHygienePlaceholderValue((edit as Record<string, unknown>).newText))
}
