import { join } from 'node:path'
import {
  emptyVisibleContextSnapshot,
  visibleContextSnapshotSchema,
  type VisibleContextComponentSnapshot,
  type VisibleContextResource,
  type VisibleContextSnapshot
} from '../../shared/visible-context'
import {
  atomicWriteAppDataJson,
  readAppDataStoreText
} from './app-data-store'

export const VISIBLE_CONTEXT_STORE_SEGMENTS = ['visible-context', 'snapshot.json'] as const

const MAX_OBJECT_KEYS = 64
const MAX_ARRAY_ITEMS = 64
const MAX_STRING_CHARS = 4096
const MAX_JSON_DEPTH = 6

export function visibleContextSnapshotPath(userDataDir: string): string {
  return join(userDataDir, ...VISIBLE_CONTEXT_STORE_SEGMENTS)
}

export class VisibleContextService {
  private current: VisibleContextSnapshot | null = null

  constructor(private readonly userDataDir: string) {}

  snapshotPath(): string {
    return visibleContextSnapshotPath(this.userDataDir)
  }

  async publish(snapshot: VisibleContextSnapshot): Promise<VisibleContextSnapshot> {
    const parsed = visibleContextSnapshotSchema.parse(snapshot)
    const sanitized = sanitizeVisibleContextSnapshot(parsed)
    this.current = sanitized
    await atomicWriteAppDataJson(
      this.userDataDir,
      VISIBLE_CONTEXT_STORE_SEGMENTS,
      sanitized,
      { trailingNewline: true }
    )
    return sanitized
  }

  async get(): Promise<VisibleContextSnapshot> {
    if (this.current) return this.current
    this.current = await this.readPersisted()
    return this.current
  }

  peek(): VisibleContextSnapshot {
    return this.current ?? emptyVisibleContextSnapshot()
  }

  private async readPersisted(): Promise<VisibleContextSnapshot> {
    try {
      const raw = await readAppDataStoreText(this.userDataDir, VISIBLE_CONTEXT_STORE_SEGMENTS)
      const parsed = visibleContextSnapshotSchema.safeParse(JSON.parse(raw) as unknown)
      if (parsed.success) return sanitizeVisibleContextSnapshot(parsed.data)
    } catch {
      return emptyVisibleContextSnapshot()
    }
    return emptyVisibleContextSnapshot()
  }
}

function sanitizeVisibleContextSnapshot(snapshot: VisibleContextSnapshot): VisibleContextSnapshot {
  return {
    ...snapshot,
    activeThreadId: snapshot.activeThreadId ?? null,
    components: snapshot.components
      .filter((component) => component.visible)
      .map(sanitizeVisibleContextComponent)
  }
}

function sanitizeVisibleContextComponent(
  component: VisibleContextComponentSnapshot
): VisibleContextComponentSnapshot {
  return {
    ...component,
    resources: component.resources?.map(sanitizeVisibleContextResource),
    state: sanitizeJsonObject(component.state)
  }
}

function sanitizeVisibleContextResource(resource: VisibleContextResource): VisibleContextResource {
  return {
    ...resource,
    metadata: sanitizeJsonObject(resource.metadata)
  }
}

function sanitizeJsonObject(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const sanitized = sanitizeJsonValue(value, 0)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : undefined
}

function sanitizeJsonValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING_CHARS)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (depth >= MAX_JSON_DEPTH) return '[truncated]'
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeJsonValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key.slice(0, 256)] = sanitizeJsonValue(entry, depth + 1)
    }
    return output
  }
  return undefined
}
