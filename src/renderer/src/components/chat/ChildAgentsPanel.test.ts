import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeChild } from '@shared/agent-runtime-contract'
import type { SideConversation } from '../../store/chat-store-types'
import { ChildAgentsPanelView } from './ChildAgentsPanel'

const labels: Record<string, string> = {
  sidebarChildren: 'Children',
  sidebarChildrenActive: 'Active',
  sidebarChildrenLoading: 'Loading children',
  sidebarChildrenLoadError: 'Unable to load children',
  sidebarChildrenNoThread: 'No active thread.',
  sidebarChildrenEmpty: 'No child agents yet.',
  sidebarChildrenDetail: 'details',
  sidebarChildrenCloseDetail: 'Close child details',
  sidebarChildrenStatus: 'Status',
  sidebarChildrenPrompt: 'Prompt',
  sidebarChildrenPromptEmpty: 'No prompt provided.',
  sidebarChildrenSummary: 'Summary',
  sidebarChildrenSummaryEmpty: 'No summary yet.',
  sidebarChildrenUsage: 'Usage',
  sidebarChildrenUsageUnavailable: 'No usage recorded',
  sidebarChildrenUsageTotal: '{{count}} total',
  sidebarChildrenUsageInput: '{{count}} input',
  sidebarChildrenUsageOutput: '{{count}} output',
  sidebarChildrenUsageReasoning: '{{count}} reasoning',
  sidebarChildrenUsageCost: '{{cost}}',
  sidebarChildrenOpenThread: 'Open thread',
  sidebarChildrenTranscriptLoading: 'Loading transcript',
  sidebarChildrenTranscriptError: 'Unable to load transcript',
  sidebarChildrenTranscriptUnavailable: 'Transcript is unavailable',
  sidebarChildrenTranscriptTitle: 'Transcript',
  sidebarChildrenTranscriptEmpty: 'No transcript entries yet.',
  sidebarChildrenKindAgent: 'Agent',
  sidebarChildrenKindWorkflow: 'Workflow',
  sidebarChildrenKindThread: 'Thread',
  sidebarChildrenKindRemote: 'Remote',
  sidebarChildrenStatusQueued: 'Queued',
  sidebarChildrenStatusRunning: 'Running',
  sidebarChildrenStatusCompleted: 'Completed',
  sidebarChildrenStatusFailed: 'Failed',
  sidebarChildrenStatusAborted: 'Aborted',
  sidebarChildrenStatusUnknown: 'Unknown',
  processed: 'Processed',
  processStepCount: '{{count}} steps',
  toolKindTool: 'Tool',
  rightPanelCollapse: 'Collapse right sidebar'
}

function t(key: string, opts?: Record<string, unknown>): string {
  return (labels[key] ?? key).replace(/\{\{(\w+)}}/g, (_, name: string) => String(opts?.[name] ?? ''))
}

function child(overrides: Partial<AgentRuntimeChild> = {}): AgentRuntimeChild {
  return {
    runtimeId: 'codex',
    parentThreadId: 'thread-main',
    id: 'child-research',
    kind: 'agent',
    name: 'research',
    status: 'running',
    prompt: 'Find recent papers',
    summary: 'Collecting sources',
    usage: {
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200
    },
    ...overrides
  }
}

function renderView(overrides: Partial<Parameters<typeof ChildAgentsPanelView>[0]> = {}): string {
  const props: Parameters<typeof ChildAgentsPanelView>[0] = {
    activeThreadId: 'thread-main',
    activeRuntimeId: 'codex',
    children: [child()],
    selectedChildId: null,
    loading: false,
    error: null,
    selectedSide: null,
    sideLoading: false,
    runtimeConnection: 'ready',
    composerPickList: ['deepseek-chat'],
    composerModelGroups: [],
    activeAgentRuntime: 'codex',
    runtimeCapabilities: {
      interrupt: true,
      stream: true,
      approvals: true,
      attachFiles: false
    },
    transcriptState: { status: 'idle' },
    onSelectChild: vi.fn(),
    onSideInputChange: vi.fn(),
    onSideSend: vi.fn(),
    onSideInterrupt: vi.fn(),
    onSideModelChange: vi.fn(),
    onSideReasoningEffortChange: vi.fn(),
    onCollapse: vi.fn(),
    t,
    ...overrides
  }
  return renderToStaticMarkup(createElement(ChildAgentsPanelView, props))
}

function side(overrides: Partial<SideConversation> = {}): SideConversation {
  return {
    threadId: 'thread-child',
    runtimeId: 'codex',
    parentThreadId: 'thread-main',
    source: 'child_agent',
    title: 'research',
    createdAt: '2026-06-27T08:00:00.000Z',
    inheritedAt: '2026-06-27T08:00:00.000Z',
    blocks: [
      { kind: 'user', id: 'user-1', text: 'Analyze the UI' },
      { kind: 'assistant', id: 'assistant-1', text: 'child-ok' }
    ],
    liveReasoning: '',
    liveAssistant: '',
    lastSeq: 4,
    input: '',
    model: 'deepseek-chat',
    reasoningEffort: 'max',
    busy: false,
    turnId: null,
    userItemId: null,
    error: null,
    ...overrides
  }
}

describe('ChildAgentsPanelView', () => {
  it('shows direct children of the active thread as horizontal tabs in a right panel', () => {
    const html = renderView({
      children: [
        child(),
        child({
          id: 'child-other',
          parentThreadId: 'thread-other',
          name: 'hidden child',
          status: 'completed'
        })
      ]
    })

    expect(html).toContain('Children')
    expect(html).toContain('Collapse right sidebar')
    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('research')
    expect(html).toContain('Running')
    expect(html).toContain('Collecting sources')
    expect(html).not.toContain('hidden child')
  })

  it('renders an empty state instead of a blank panel', () => {
    const html = renderView({ children: [] })

    expect(html).toContain('No child agents yet.')
    expect(html).toContain('Children')
  })

  it('renders selected child context and usage above the transcript', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          summary: 'Found the best candidates',
          usage: {
            inputTokens: 456,
            outputTokens: 778,
            reasoningTokens: 12,
            totalTokens: 1234
          }
        })
      ]
    })

    expect(html).toContain('Completed')
    expect(html).toContain('Find recent papers')
    expect(html).toContain('Found the best candidates')
    expect(html).toContain('1,234 total')
    expect(html).toContain('456 input')
    expect(html).toContain('778 output')
  })

  it('renders a child transcript in chronological chat and process order without open-thread actions', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          status: 'completed',
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' }
        })
      ],
      transcriptState: {
        status: 'loaded',
        childId: 'child-research',
        transcript: {
          runtimeId: 'codex',
          parentThreadId: 'thread-main',
          childId: 'child-research',
          entries: [
            { id: 'entry-user', kind: 'user_message', text: 'Analyze the UI' },
            { id: 'entry-reasoning', kind: 'reasoning', text: 'Inspecting the panel layout' },
            { id: 'entry-tool', kind: 'tool', summary: 'Read component files', status: 'completed' },
            { id: 'entry-assistant', kind: 'assistant_message', text: 'The panel is ready.' }
          ]
        }
      }
    })

    expect(html).toContain('Analyze the UI')
    expect(html).toContain('Processed')
    expect(html).toContain('2 steps')
    expect(html).toContain('Inspecting the panel layout')
    expect(html).toContain('Read component files')
    expect(html).toContain('The panel is ready.')
    expect(html).not.toContain('Open transcript')
    expect(html).not.toContain('Open thread')
  })

  it('renders an attached child thread as a chat surface with a composer', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' },
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        })
      ],
      selectedSide: side()
    })

    expect(html).toContain('Analyze the UI')
    expect(html).toContain('child-ok')
    expect(html).toContain('<textarea')
    expect(html).not.toContain('Open thread')
  })

  it('defaults to running, then queued, then most recently updated children', () => {
    const html = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          id: 'completed-recent',
          name: 'completed-recent',
          status: 'completed',
          updatedAt: '2026-06-27T12:00:00.000Z'
        }),
        child({
          id: 'queued-child',
          name: 'queued-child',
          status: 'queued',
          updatedAt: '2026-06-27T09:00:00.000Z'
        }),
        child({
          id: 'running-child',
          name: 'running-child',
          status: 'running',
          updatedAt: '2026-06-27T08:00:00.000Z'
        })
      ]
    })

    expect(html.indexOf('running-child')).toBeLessThan(html.indexOf('queued-child'))
    expect(html.indexOf('queued-child')).toBeLessThan(html.indexOf('completed-recent'))
  })
})
