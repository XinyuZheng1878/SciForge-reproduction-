import { z } from 'zod'

export const WORKSPACE_TREE_RESOURCE_URI = 'workspace://tree'
export const WORKSPACE_FILE_RESOURCE_URI_TEMPLATE = 'workspace://file/{+path}'

export const WORKSPACE_INTEL_DEFAULT_READ_BYTES = 64 * 1024
export const WORKSPACE_INTEL_MAX_READ_BYTES = 1_500_000
export const WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS = 8_000
export const WORKSPACE_INTEL_DEFAULT_LIST_LIMIT = 200
export const WORKSPACE_INTEL_MAX_LIST_LIMIT = 2_000
export const WORKSPACE_INTEL_MAX_TREE_DEPTH = 12

export type WorkspaceIntelErrorCode =
  | 'workspace_root_required'
  | 'workspace_root_not_found'
  | 'workspace_root_mismatch'
  | 'path_required'
  | 'path_outside_workspace'
  | 'path_not_found'
  | 'not_directory'
  | 'is_directory'
  | 'binary_file'
  | 'invalid_request'
  | 'skill_not_found'
  | 'read_failed'

export type WorkspaceIntelError = {
  code: WorkspaceIntelErrorCode
  message: string
  retryable: boolean
  suggestedFix?: string
}

export type WorkspaceIntelFailure = {
  ok: false
  error: WorkspaceIntelError
}

export type WorkspaceEntryKind = 'file' | 'directory' | 'symlink' | 'other'
export type WorkspaceReferenceKind = 'file' | 'directory' | 'text' | 'image' | 'pdf' | 'binary' | 'symlink' | 'other'
export type WorkspaceSkillScope = 'project' | 'configured'

export type WorkspaceEntry = {
  name: string
  relativePath: string
  kind: WorkspaceEntryKind
  targetKind?: WorkspaceEntryKind
  targetInsideWorkspace?: boolean
  size?: number
  mtimeMs?: number
  mimeType?: string
  resourceUri?: string
}

export type WorkspaceListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  root: WorkspaceEntry
  entries: WorkspaceEntry[]
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
}

export type WorkspaceTreeNode = WorkspaceEntry & {
  children?: WorkspaceTreeNode[]
  childrenTruncated?: boolean
}

export type WorkspaceTreeResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  tree: WorkspaceTreeNode
  maxDepth: number
  entryCount: number
  truncated: boolean
}

export type WorkspaceReadResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  relativePath: string
  name: string
  kind: 'text'
  mimeType: string
  encoding: 'utf8'
  size: number
  mtimeMs: number
  offset: number
  bytesRead: number
  content: string
  truncated: boolean
  nextOffset?: number
  resourceUri: string
}

export type WorkspacePreviewResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  relativePath: string
  name: string
  kind: WorkspaceReferenceKind
  mimeType?: string
  size?: number
  mtimeMs?: number
  contentSummary: string
  content?: string
  children?: WorkspaceEntry[]
  truncated: boolean
  resourceUri?: string
}

export type WorkspaceReference = {
  name: string
  relativePath: string
  kind: WorkspaceReferenceKind
  size?: number
  mtimeMs?: number
  mimeType?: string
  resourceUri?: string
}

export type WorkspaceReferenceListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  references: WorkspaceReference[]
  limit: number
  cursor?: string
  nextCursor?: string
  truncated: boolean
}

export type WorkspaceReferencePreviewResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot: string
  reference: WorkspaceReference
  preview: Omit<Extract<WorkspacePreviewResult, { ok: true }>, 'workspaceRoot'>
}

export type WorkspaceSkillSummary = {
  id: string
  name: string
  scope: WorkspaceSkillScope
  legacy: boolean
  description?: string
  packageRelativePath?: string
  entryRelativePath?: string
  entryResourceUri?: string
}

export type WorkspaceSkillListResult = WorkspaceIntelFailure | {
  ok: true
  workspaceRoot?: string
  skills: WorkspaceSkillSummary[]
  validationErrors: Array<{ root: string; message: string }>
}

export type WorkspaceSkillReadResult = WorkspaceIntelFailure | {
  ok: true
  skill: WorkspaceSkillSummary
  content: string
  size: number
  truncated: boolean
  nextOffset?: number
}

export const WorkspaceRootInputSchema = z.object({
  workspaceRoot: z.string().trim().min(1).max(4096).optional()
}).strict()

export const WorkspaceListInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  recursive: z.boolean().optional(),
  depth: z.number().int().min(0).max(WORKSPACE_INTEL_MAX_TREE_DEPTH).optional(),
  limit: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_LIST_LIMIT).optional(),
  cursor: z.string().trim().min(1).max(64).optional(),
  includeHidden: z.boolean().optional()
}).strict()

export const WorkspaceTreeInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  depth: z.number().int().min(0).max(WORKSPACE_INTEL_MAX_TREE_DEPTH).optional(),
  limit: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_LIST_LIMIT).optional(),
  includeHidden: z.boolean().optional()
}).strict()

export const WorkspaceReadInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().min(1).max(4096),
  offset: z.number().int().min(0).optional(),
  maxBytes: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_READ_BYTES).optional()
}).strict()

export const WorkspacePreviewInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().max(4096).optional(),
  maxChars: z.number().int().min(1).max(WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS).optional()
}).strict()

export const WorkspaceReferenceListInputSchema = WorkspaceListInputSchema

export const WorkspaceReferencePreviewInputSchema = WorkspaceRootInputSchema.extend({
  path: z.string().trim().min(1).max(4096),
  maxChars: z.number().int().min(1).max(WORKSPACE_INTEL_DEFAULT_PREVIEW_CHARS).optional()
}).strict()

export const WorkspaceSkillListInputSchema = WorkspaceRootInputSchema

export const WorkspaceSkillReadInputSchema = WorkspaceRootInputSchema.extend({
  skillId: z.string().trim().min(1).max(256),
  offset: z.number().int().min(0).optional(),
  maxBytes: z.number().int().min(1).max(WORKSPACE_INTEL_MAX_READ_BYTES).optional()
}).strict()

export type WorkspaceListInput = z.infer<typeof WorkspaceListInputSchema>
export type WorkspaceTreeInput = z.infer<typeof WorkspaceTreeInputSchema>
export type WorkspaceReadInput = z.infer<typeof WorkspaceReadInputSchema>
export type WorkspacePreviewInput = z.infer<typeof WorkspacePreviewInputSchema>
export type WorkspaceReferenceListInput = z.infer<typeof WorkspaceReferenceListInputSchema>
export type WorkspaceReferencePreviewInput = z.infer<typeof WorkspaceReferencePreviewInputSchema>
export type WorkspaceSkillListInput = z.infer<typeof WorkspaceSkillListInputSchema>
export type WorkspaceSkillReadInput = z.infer<typeof WorkspaceSkillReadInputSchema>

export function workspaceFileResourceUri(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const encodedPath = normalized
    .split('/')
    .filter((part) => part.length > 0)
    .map(encodeURIComponent)
    .join('/')
  return `workspace://file/${encodedPath}`
}
