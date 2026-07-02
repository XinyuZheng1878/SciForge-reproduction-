import { describe, expect, it } from 'vitest'

import { repairDispatchToolArguments } from '../src/loop/tool-call-repair.js'

describe('tool call dispatch repair', () => {
  it('flattens common wrapper argument objects', () => {
    const repaired = repairDispatchToolArguments({
      tool_name: 'read',
      arguments: { path: 'src/app.ts' }
    })

    expect(repaired.arguments).toEqual({ path: 'src/app.ts' })
    expect(repaired.notes).toEqual(['flattened arguments wrapper'])
  })

  it('parses fenced JSON from wrapper strings', () => {
    const repaired = repairDispatchToolArguments({
      input: '```json\n{"query":"auth"}\n```'
    })

    expect(repaired.arguments).toEqual({ query: 'auth' })
    expect(repaired.notes).toEqual(['flattened input wrapper'])
  })

  it('scavenges a JSON object from a single string argument', () => {
    const repaired = repairDispatchToolArguments({
      query: 'please use {"path":"README.md"} now'
    })

    expect(repaired.arguments).toEqual({ path: 'README.md' })
    expect(repaired.notes).toEqual(['scavenged JSON object from query'])
  })

  it('does not turn non-command JSON payloads into bash arguments', () => {
    const repaired = repairDispatchToolArguments(
      {
        command: '{"name":"AF3_probe","sequences":[]}'
      },
      { toolName: 'bash', toolKind: 'command_execution' }
    )

    expect(repaired.arguments).toEqual({ command: '{"name":"AF3_probe","sequences":[]}' })
    expect(repaired.notes).toEqual([])
  })

  it('still repairs command JSON wrappers for bash calls', () => {
    const repaired = repairDispatchToolArguments(
      {
        arguments: '{"command":"pwd"}'
      },
      { toolName: 'bash', toolKind: 'command_execution' }
    )

    expect(repaired.arguments).toEqual({ command: 'pwd' })
    expect(repaired.notes).toEqual(['flattened arguments wrapper'])
  })

  it('truncates very large non-file-change strings without touching file edits', () => {
    const repaired = repairDispatchToolArguments(
      { transcript: 'a'.repeat(32) },
      { maxStringBytes: 8 }
    )
    expect(String(repaired.arguments.transcript)).toContain('[truncated by local runtime tool argument repair]')
    expect(repaired.notes).toEqual(['truncated 1 oversized argument string(s)'])

    const preserved = repairDispatchToolArguments(
      { content: 'a'.repeat(32) },
      { toolKind: 'file_change', maxStringBytes: 8 }
    )
    expect(preserved.arguments).toEqual({ content: 'a'.repeat(32) })
    expect(preserved.notes).toEqual([])
  })
})
