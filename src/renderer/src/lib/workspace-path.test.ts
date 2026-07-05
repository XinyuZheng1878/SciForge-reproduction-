import { describe, expect, it } from 'vitest'
import { isRemoteChannelWorkspacePath } from './workspace-path'

describe('workspace path helpers', () => {
  it('recognizes remote-channel workspace paths as internal', () => {
    expect(isRemoteChannelWorkspacePath('~/.sciforge/remote-channel/')).toBe(true)
    expect(isRemoteChannelWorkspacePath('/Users/alice/.sciforge/remote-channel')).toBe(true)
    expect(isRemoteChannelWorkspacePath('/Users/alice/.sciforge/remote-channel/agent/conversations/chat')).toBe(true)
    expect(isRemoteChannelWorkspacePath('~/.sciforge/remote-channel/discord/server/channel')).toBe(true)
    expect(isRemoteChannelWorkspacePath('C:\\Users\\alice\\.sciforge\\remote-channel\\discord\\server\\channel')).toBe(true)
  })

  it('treats legacy Claw workspace paths as normal workspaces', () => {
    expect(isRemoteChannelWorkspacePath('/Users/alice/.sciforge/claw/agent/conversations/chat')).toBe(false)
    expect(isRemoteChannelWorkspacePath('~/.sciforge/claw/discord/server/channel')).toBe(false)
    expect(isRemoteChannelWorkspacePath('C:\\Users\\alice\\.sciforge\\claw\\discord\\server\\channel')).toBe(false)
  })
})
