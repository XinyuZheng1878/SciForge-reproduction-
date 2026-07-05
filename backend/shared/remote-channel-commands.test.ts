import { describe, expect, it } from 'vitest'

import { parseRemoteChannelCommand } from './remote-channel-commands'

describe('parseRemoteChannelCommand', () => {
  it('parses remote-channel selector and lifecycle commands', () => {
    expect(parseRemoteChannelCommand('/help')).toEqual({ kind: 'help' })
    expect(parseRemoteChannelCommand('/where')).toEqual({ kind: 'status', scope: 'where' })
    expect(parseRemoteChannelCommand('/projects')).toEqual({ kind: 'projects' })
    expect(parseRemoteChannelCommand('/use project 1')).toEqual({ kind: 'useProject', target: '1' })
    expect(parseRemoteChannelCommand('/use project SciForge')).toEqual({
      kind: 'useProject',
      target: 'SciForge'
    })
    expect(parseRemoteChannelCommand('/threads')).toEqual({ kind: 'threads' })
    expect(parseRemoteChannelCommand('/use thread 2')).toEqual({ kind: 'useThread', target: '2' })
    expect(parseRemoteChannelCommand('/use thread Fix remote binding')).toEqual({
      kind: 'useThread',
      target: 'Fix remote binding'
    })
    expect(parseRemoteChannelCommand('/new Fix remote binding')).toEqual({
      kind: 'newThread',
      title: 'Fix remote binding'
    })
    expect(parseRemoteChannelCommand('/attach current')).toEqual({ kind: 'attachCurrent' })
    expect(parseRemoteChannelCommand('/jobs')).toEqual({ kind: 'jobs' })
  })

  it('trims arguments while preserving their display text', () => {
    expect(parseRemoteChannelCommand(' /use project   My Project  ')).toEqual({
      kind: 'useProject',
      target: 'My Project'
    })
    expect(parseRemoteChannelCommand('/use thread   Release Readiness  ')).toEqual({
      kind: 'useThread',
      target: 'Release Readiness'
    })
    expect(parseRemoteChannelCommand('/new   Follow Up Plan  ')).toEqual({
      kind: 'newThread',
      title: 'Follow Up Plan'
    })
  })

  it('does not treat missing required arguments as valid selector commands', () => {
    expect(parseRemoteChannelCommand('/use project')).toBeNull()
    expect(parseRemoteChannelCommand('/use thread')).toBeNull()
    expect(parseRemoteChannelCommand('/projects 1')).toBeNull()
    expect(parseRemoteChannelCommand('/threads 1')).toBeNull()
  })

  it('keeps existing lifecycle command meanings', () => {
    expect(parseRemoteChannelCommand('/new')).toEqual({ kind: 'clear' })
    expect(parseRemoteChannelCommand('/new private')).toEqual({ kind: 'newPrivate' })
    expect(parseRemoteChannelCommand('/status')).toEqual({ kind: 'status', scope: 'status' })
    expect(parseRemoteChannelCommand('where')).toEqual({ kind: 'status', scope: 'where' })
  })
})
