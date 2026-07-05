import { describe, expect, it } from 'vitest'
import {
  terminalSessionIdForWorkspace,
  terminalWorkspaceSessionKey
} from './terminal-session'

describe('terminal session ids', () => {
  it('namespaces equal tab ids by workspace identity', () => {
    const first = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main')
    const second = terminalSessionIdForWorkspace('/Users/zxy/project-b', 'main')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^terminal:[a-z0-9]+:main$/)
    expect(second).toMatch(/^terminal:[a-z0-9]+:main$/)
  })

  it('normalizes equivalent workspace roots before deriving ids', () => {
    expect(terminalWorkspaceSessionKey('/Users/zxy/project-a/')).toBe(
      terminalWorkspaceSessionKey('/users/zxy/project-a')
    )
  })

  it('uses the main tab namespace when no tab id is supplied', () => {
    expect(terminalSessionIdForWorkspace('/Users/zxy/project-a', '  ')).toMatch(/:main$/)
  })

  it('does not leak long workspace paths into the session id', () => {
    const longWorkspace = `/Users/zxy/${'nested/'.repeat(80)}project`
    const sessionId = terminalSessionIdForWorkspace(longWorkspace, 'tab-1')

    expect(sessionId.length).toBeLessThan(80)
    expect(sessionId).not.toContain('nested')
  })
})
