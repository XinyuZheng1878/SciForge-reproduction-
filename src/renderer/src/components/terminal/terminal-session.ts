import { workspaceRootIdentityKey } from '../../lib/workspace-path'

const DEFAULT_TERMINAL_WORKSPACE = 'no-workspace'
const DEFAULT_TERMINAL_TAB = 'main'
const TERMINAL_SESSION_NAMESPACE = 'terminal'

export function terminalWorkspaceSessionKey(workspaceRoot: string): string {
  return workspaceRootIdentityKey(workspaceRoot) || DEFAULT_TERMINAL_WORKSPACE
}

export function terminalSessionIdForWorkspace(workspaceRoot: string, tabId: string): string {
  const workspacePart = compactWorkspaceFingerprint(terminalWorkspaceSessionKey(workspaceRoot))
  return [TERMINAL_SESSION_NAMESPACE, workspacePart, normalizedTabKey(tabId)].join(':')
}

function normalizedTabKey(tabId: string): string {
  return tabId.trim() || DEFAULT_TERMINAL_TAB
}

function compactWorkspaceFingerprint(value: string): string {
  let left = 0x9e3779b9 ^ value.length
  let right = 0x85ebca6b ^ value.length

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    left = Math.imul(left ^ code, 0x27d4eb2d)
    right = Math.imul(right ^ code, 0x165667b1)
  }

  left = Math.imul(left ^ (left >>> 15), 0x2c1b3c6d)
  right = Math.imul(right ^ (right >>> 13), 0x297a2d39)
  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`
}
