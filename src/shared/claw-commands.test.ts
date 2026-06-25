import { describe, expect, it } from 'vitest'

import { parseClawCommand } from './claw-commands'

describe('parseClawCommand', () => {
  it('parses the PROJECT.md minimal command set', () => {
    expect(parseClawCommand('/help')).toEqual({ kind: 'help' })
    expect(parseClawCommand('/where')).toEqual({ kind: 'status', scope: 'where' })
    expect(parseClawCommand('/projects')).toEqual({ kind: 'projects' })
    expect(parseClawCommand('/use project 1')).toEqual({ kind: 'useProject', target: '1' })
    expect(parseClawCommand('/use project SciForge')).toEqual({
      kind: 'useProject',
      target: 'SciForge'
    })
    expect(parseClawCommand('/threads')).toEqual({ kind: 'threads' })
    expect(parseClawCommand('/use thread 2')).toEqual({ kind: 'useThread', target: '2' })
    expect(parseClawCommand('/use thread Fix remote binding')).toEqual({
      kind: 'useThread',
      target: 'Fix remote binding'
    })
    expect(parseClawCommand('/new Fix remote binding')).toEqual({
      kind: 'newThread',
      title: 'Fix remote binding'
    })
    expect(parseClawCommand('/attach current')).toEqual({ kind: 'attachCurrent' })
    expect(parseClawCommand('/jobs')).toEqual({ kind: 'jobs' })
  })

  it('trims arguments while preserving their display text', () => {
    expect(parseClawCommand(' /use project   My Project  ')).toEqual({
      kind: 'useProject',
      target: 'My Project'
    })
    expect(parseClawCommand('/use thread   Release Readiness  ')).toEqual({
      kind: 'useThread',
      target: 'Release Readiness'
    })
    expect(parseClawCommand('/new   Follow Up Plan  ')).toEqual({
      kind: 'newThread',
      title: 'Follow Up Plan'
    })
  })

  it('does not treat missing required arguments as valid selector commands', () => {
    expect(parseClawCommand('/use project')).toBeNull()
    expect(parseClawCommand('/use thread')).toBeNull()
    expect(parseClawCommand('/projects 1')).toBeNull()
    expect(parseClawCommand('/threads 1')).toBeNull()
  })

  it('keeps existing lifecycle command meanings', () => {
    expect(parseClawCommand('/new')).toEqual({ kind: 'clear' })
    expect(parseClawCommand('/new private')).toEqual({ kind: 'newPrivate' })
    expect(parseClawCommand('/status')).toEqual({ kind: 'status', scope: 'status' })
    expect(parseClawCommand('where')).toEqual({ kind: 'status', scope: 'where' })
  })
})
