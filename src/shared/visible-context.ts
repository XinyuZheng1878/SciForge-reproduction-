import { z } from 'zod'

export const VISIBLE_CONTEXT_SCHEMA_VERSION = 1
export const VISIBLE_CONTEXT_MAX_COMPONENTS = 64
export const VISIBLE_CONTEXT_MAX_RESOURCES = 64

const maxPathSchema = z.string().trim().min(1).max(4096)
const optionalStringSchema = (max: number): z.ZodOptional<z.ZodString> =>
  z.string().trim().max(max).optional()

export type VisibleContextResource = {
  kind: string
  role?: string
  title?: string
  accessHint?: string
  resourceUri?: string
  workspaceRoot?: string
  path?: string
  relativePath?: string
  name?: string
  mimeType?: string
  fileKind?: string
  size?: number
  mtimeMs?: number
  annotationCount?: number
  threadCount?: number
  openThreadCount?: number
  selectedThreadId?: string | null
  updatedAt?: string
  metadata?: Record<string, unknown>
}

export type VisibleContextComponentSnapshot = {
  id: string
  region: string
  component: string
  title?: string
  visible: boolean
  priority?: number
  updatedAt: string
  summary: string
  resources?: VisibleContextResource[]
  state?: Record<string, unknown>
}

export type VisibleContextSnapshot = {
  schemaVersion: typeof VISIBLE_CONTEXT_SCHEMA_VERSION
  updatedAt: string
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
  components: VisibleContextComponentSnapshot[]
}

export const visibleContextResourceSchema = z.object({
  kind: z.string().trim().min(1).max(128),
  role: optionalStringSchema(128),
  title: optionalStringSchema(256),
  accessHint: optionalStringSchema(128),
  resourceUri: optionalStringSchema(1024),
  workspaceRoot: maxPathSchema.optional(),
  path: maxPathSchema.optional(),
  relativePath: maxPathSchema.optional(),
  name: optionalStringSchema(512),
  mimeType: optionalStringSchema(128),
  fileKind: optionalStringSchema(128),
  size: z.number().finite().nonnegative().optional(),
  mtimeMs: z.number().finite().nonnegative().optional(),
  annotationCount: z.number().int().nonnegative().optional(),
  threadCount: z.number().int().nonnegative().optional(),
  openThreadCount: z.number().int().nonnegative().optional(),
  selectedThreadId: z.string().trim().max(256).nullable().optional(),
  updatedAt: optionalStringSchema(128),
  metadata: z.record(z.string(), z.unknown()).optional()
}).strict()

export const visibleContextComponentSnapshotSchema = z.object({
  id: z.string().trim().min(1).max(256),
  region: z.string().trim().min(1).max(128),
  component: z.string().trim().min(1).max(128),
  title: optionalStringSchema(256),
  visible: z.boolean(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  updatedAt: z.string().trim().min(1).max(128),
  summary: z.string().trim().max(2000),
  resources: z.array(visibleContextResourceSchema).max(VISIBLE_CONTEXT_MAX_RESOURCES).optional(),
  state: z.record(z.string(), z.unknown()).optional()
}).strict()

export const visibleContextSnapshotSchema = z.object({
  schemaVersion: z.literal(VISIBLE_CONTEXT_SCHEMA_VERSION),
  updatedAt: z.string().trim().min(1).max(128),
  activeThreadId: z.string().trim().max(256).nullable().optional(),
  workspaceRoot: maxPathSchema.optional(),
  route: z.string().trim().max(128).optional(),
  components: z.array(visibleContextComponentSnapshotSchema).max(VISIBLE_CONTEXT_MAX_COMPONENTS)
}).strict()

export function emptyVisibleContextSnapshot(updatedAt = new Date(0).toISOString()): VisibleContextSnapshot {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    updatedAt,
    components: []
  }
}
