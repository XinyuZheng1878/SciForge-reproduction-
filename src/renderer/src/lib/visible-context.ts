import {
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextComponentSnapshot,
  type VisibleContextSnapshot
} from '@shared/visible-context'

type VisibleContextShell = {
  activeThreadId?: string | null
  workspaceRoot?: string
  route?: string
}

const components = new Map<string, VisibleContextComponentSnapshot>()
let shell: VisibleContextShell = {}
let publishTimer: number | null = null

export function setVisibleContextShell(next: VisibleContextShell): void {
  shell = {
    activeThreadId: next.activeThreadId ?? null,
    workspaceRoot: next.workspaceRoot || undefined,
    route: next.route || undefined
  }
  scheduleVisibleContextPublish()
}

export function registerVisibleContextComponent(
  component: VisibleContextComponentSnapshot
): () => void {
  const snapshot = {
    ...component,
    visible: component.visible !== false
  }
  components.set(snapshot.id, snapshot)
  scheduleVisibleContextPublish()
  return () => {
    if (components.get(snapshot.id) === snapshot) {
      components.delete(snapshot.id)
      scheduleVisibleContextPublish()
    }
  }
}

function scheduleVisibleContextPublish(): void {
  if (typeof window === 'undefined') return
  if (publishTimer !== null) window.clearTimeout(publishTimer)
  publishTimer = window.setTimeout(() => {
    publishTimer = null
    publishVisibleContext()
  }, 80)
}

function publishVisibleContext(): void {
  if (typeof window === 'undefined') return
  const publish = window.sciforge?.visibleContext?.publish
  if (typeof publish !== 'function') return
  const updatedAt = new Date().toISOString()
  const snapshot: VisibleContextSnapshot = {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    updatedAt,
    ...(shell.activeThreadId !== undefined ? { activeThreadId: shell.activeThreadId } : {}),
    ...(shell.workspaceRoot ? { workspaceRoot: shell.workspaceRoot } : {}),
    ...(shell.route ? { route: shell.route } : {}),
    components: [...components.values()]
      .filter((component) => component.visible)
      .sort((a, b) => {
        const priority = (b.priority ?? 0) - (a.priority ?? 0)
        return priority || a.region.localeCompare(b.region) || a.id.localeCompare(b.id)
      })
  }
  void publish(snapshot).catch(() => undefined)
}
