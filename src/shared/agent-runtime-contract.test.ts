import { describe, expect, it } from 'vitest'
import {
  AGENT_RUNTIME_EVENT_KINDS,
  createDefaultAgentRuntimeCapabilities,
  createUnavailableCapabilityState,
  type AgentRuntimeEvent
} from './agent-runtime-contract'

function exhaustiveEventLabel(event: AgentRuntimeEvent): string {
  switch (event.kind) {
    case 'thread_lifecycle':
      return event.state
    case 'turn_lifecycle':
      return event.state
    case 'runtime_status':
      return event.phase ?? 'runtime_status'
    case 'user_message':
      return event.text
    case 'assistant_delta':
      return event.text
    case 'reasoning_delta':
      return event.visibility
    case 'item_snapshot':
      return event.item.kind
    case 'tool_event':
      return event.status
    case 'approval_requested':
      return event.approvalId
    case 'approval_resolved':
      return event.decision
    case 'user_input_requested':
      return event.requestId
    case 'user_input_resolved':
      return event.status
    case 'compaction_event':
      return event.status
    case 'review_event':
      return event.status
    case 'goal_event':
      return event.status ?? 'goal'
    case 'todo_event':
      return String(event.items.length)
    case 'usage':
      return String(event.usage.inputTokens ?? 0)
    case 'error':
      return event.severity
    case 'heartbeat':
      return 'heartbeat'
    default: {
      const neverEvent: never = event
      return neverEvent
    }
  }
}

describe('agent runtime contract', () => {
  it('keeps event kinds aligned with the discriminated union', () => {
    const sampleEvents = [
      { kind: 'thread_lifecycle', threadId: 'thr', state: 'created' },
      { kind: 'turn_lifecycle', threadId: 'thr', turnId: 'turn', state: 'started' },
      { kind: 'runtime_status', threadId: 'thr', phase: 'process_start', message: 'starting' },
      { kind: 'user_message', threadId: 'thr', itemId: 'user', text: 'hello' },
      { kind: 'assistant_delta', threadId: 'thr', itemId: 'assistant', text: 'hi' },
      { kind: 'reasoning_delta', threadId: 'thr', itemId: 'reasoning', text: 'thinking', visibility: 'summary' },
      {
        kind: 'item_snapshot',
        threadId: 'thr',
        item: { id: 'item', kind: 'assistant_message', text: 'snapshot' }
      },
      { kind: 'tool_event', threadId: 'thr', itemId: 'tool', status: 'running', toolKind: 'tool_call' },
      { kind: 'approval_requested', threadId: 'thr', approvalId: 'approval', summary: 'Allow tool?' },
      { kind: 'approval_resolved', threadId: 'thr', approvalId: 'approval', decision: 'denied' },
      {
        kind: 'user_input_requested',
        threadId: 'thr',
        requestId: 'input',
        questions: [{ id: 'q', header: 'Choice', question: 'Pick one', options: [] }]
      },
      { kind: 'user_input_resolved', threadId: 'thr', requestId: 'input', status: 'cancelled' },
      { kind: 'compaction_event', threadId: 'thr', itemId: 'compact', status: 'success', summary: 'Compacted' },
      { kind: 'review_event', threadId: 'thr', itemId: 'review', status: 'running', title: 'Review' },
      { kind: 'goal_event', threadId: 'thr', status: 'active', objective: 'Ship it' },
      { kind: 'todo_event', threadId: 'thr', items: [{ id: 'todo', content: 'One', status: 'pending' }] },
      { kind: 'usage', threadId: 'thr', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      { kind: 'error', threadId: 'thr', recoverable: true, severity: 'warning', message: 'Recoverable' },
      { kind: 'heartbeat', threadId: 'thr' }
    ] satisfies AgentRuntimeEvent[]

    expect(sampleEvents.map((event) => event.kind)).toEqual(AGENT_RUNTIME_EVENT_KINDS)
    expect(sampleEvents.map(exhaustiveEventLabel)).toHaveLength(AGENT_RUNTIME_EVENT_KINDS.length)
  })

  it('defaults unsupported capabilities to unavailable instead of available', () => {
    const capabilities = createDefaultAgentRuntimeCapabilities({
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio'
    })

    expect(capabilities).toMatchObject({
      contractVersion: 1,
      runtimeId: 'codex',
      transport: 'jsonrpc_stdio',
      controls: {
        interrupt: false,
        steer: false,
        approval: 'unsupported',
        userInput: 'unsupported',
        compact: 'unsupported',
        fork: false,
        review: false,
        goals: false,
        todos: false,
        resumeSession: false
      }
    })
    expect(capabilities.events.live).toBe(false)
    expect(capabilities.reasoning.visibility).toBe('none')
    expect(capabilities.reasoning.source).toBe('unknown')
    expect(capabilities.latency.supportedPhases).toEqual([])
    expect(capabilities.tools.commandExecution.available).toBe(false)
    expect(capabilities.tools.mcp.available).toBe(false)
    expect(capabilities.tools.mcp.search?.available).toBe(false)
    expect(capabilities.tools.web.available).toBe(false)
    expect(capabilities.tools.web.fetch?.available).toBe(false)
    expect(capabilities.tools.web.search?.available).toBe(false)
    expect(capabilities.storage.attachments.available).toBe(false)
    expect(capabilities.storage.usage).toBe(false)
    expect(capabilities.storage.memory.available).toBe(false)
  })

  it('creates explicit unavailable capability states with reasons', () => {
    expect(createUnavailableCapabilityState('not implemented yet')).toEqual({
      available: false,
      reason: 'not implemented yet'
    })
  })

  it('keeps the shared contract free of renderer and runtime-specific imports', async () => {
    // @ts-ignore - This Vitest source-inspection check runs in Node, while the shared package also typechecks in the web tsconfig.
    const { readFileSync } = await import('node:fs')
    // @ts-ignore - See the Node-only source-inspection note above.
    const { dirname, resolve } = await import('node:path')
    // @ts-ignore - See the Node-only source-inspection note above.
    const { fileURLToPath } = await import('node:url')
    const contractPath = resolve(dirname(fileURLToPath(import.meta.url)), 'agent-runtime-contract.ts')
    const source = readFileSync(contractPath, 'utf8')

    expect(source).not.toMatch(/from\s+['"][^'"]*(?:@renderer|renderer|electron|src\/main|runtime\/kun|kun-adapter|kun-agent|runtime\/codex|codex\/app-server|codex-agent)[^'"]*['"]/)
    expect(source).not.toMatch(/require\([^)]*(?:@renderer|renderer|electron|src\/main|runtime\/kun|kun-adapter|kun-agent|runtime\/codex|codex\/app-server|codex-agent)/)
  })
})
