import { describe, expect, it } from 'vitest'
import { isClawWorkspacePath } from './workspace-path'

describe('workspace path helpers', () => {
  it('recognizes remote-channel workspace paths as internal', () => {
    expect(isClawWorkspacePath('~/.sciforge/remote-channel/')).toBe(true)
    expect(isClawWorkspacePath('/Users/alice/.sciforge/remote-channel')).toBe(true)
    expect(isClawWorkspacePath('/Users/alice/.sciforge/remote-channel/agent/conversations/chat')).toBe(true)
    expect(isClawWorkspacePath('~/.sciforge/remote-channel/discord/server/channel')).toBe(true)
    expect(isClawWorkspacePath('C:\\Users\\alice\\.sciforge\\remote-channel\\discord\\server\\channel')).toBe(true)
  })

  it('treats legacy Claw workspace paths as normal workspaces', () => {
    expect(isClawWorkspacePath('/Users/alice/.sciforge/claw/agent/conversations/chat')).toBe(false)
    expect(isClawWorkspacePath('~/.sciforge/claw/discord/server/channel')).toBe(false)
    expect(isClawWorkspacePath('C:\\Users\\alice\\.sciforge\\claw\\discord\\server\\channel')).toBe(false)
  })
})
