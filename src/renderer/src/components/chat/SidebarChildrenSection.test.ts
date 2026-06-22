import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeChild } from '@shared/agent-runtime-contract'
import { SidebarChildrenSectionView } from './SidebarChildrenSection'

const labels: Record<string, string> = {
  sidebarChildren: 'Children',
  sidebarChildrenLoading: 'Loading children',
  sidebarChildrenLoadError: 'Unable to load children',
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
  sidebarChildrenOpenTranscript: 'Open transcript',
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
  sidebarChildrenStatusUnknown: 'Unknown'
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

function renderView(overrides: Partial<Parameters<typeof SidebarChildrenSectionView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(SidebarChildrenSectionView, {
      activeThreadId: 'thread-main',
      activeRuntimeId: 'codex',
      children: [child()],
      selectedChildId: null,
      loading: false,
      error: null,
      transcriptState: { status: 'idle' },
      onSelectChild: vi.fn(),
      onCloseDetail: vi.fn(),
      onShowTranscript: vi.fn(),
      onOpenThread: vi.fn(),
      t,
      ...overrides
    })
  )
}

describe('SidebarChildrenSectionView', () => {
  it('shows a children group for direct children of the active thread', () => {
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
    expect(html).toContain('research')
    expect(html).toContain('Running')
    expect(html).toContain('Collecting sources')
    expect(html).not.toContain('hidden child')
  })

  it('renders selected child details with status, prompt, summary, and usage', () => {
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

    expect(html).toContain('Status')
    expect(html).toContain('Completed')
    expect(html).toContain('Prompt')
    expect(html).toContain('Find recent papers')
    expect(html).toContain('Summary')
    expect(html).toContain('Found the best candidates')
    expect(html).toContain('1,234 total')
    expect(html).toContain('456 input')
    expect(html).toContain('778 output')
  })

  it('shows transcript and open-thread actions only when refs are available', () => {
    const withActions = renderView({
      selectedChildId: 'child-research',
      children: [
        child({
          transcriptRef: { runtimeId: 'codex', childId: 'child-research', transcriptId: 'transcript-1' },
          openAsThreadRef: { runtimeId: 'codex', threadId: 'thread-child' }
        })
      ]
    })

    expect(withActions).toContain('Open transcript')
    expect(withActions).toContain('Open thread')

    const withoutActions = renderView({
      selectedChildId: 'child-research',
      children: [child()]
    })

    expect(withoutActions).not.toContain('Open transcript')
    expect(withoutActions).not.toContain('Open thread')
  })
})
