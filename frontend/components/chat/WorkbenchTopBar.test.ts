import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { WorkbenchTopBar } from './WorkbenchTopBar'

describe('WorkbenchTopBar Paper Radar entry', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('hides Paper Radar when the extension is not enabled', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      paperRadarEnabled: false
    }))

    expect(html).not.toContain('Paper Radar')
  })

  it('shows and marks Paper Radar when the extension is enabled', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'paper',
      onToggleRightPanelMode: vi.fn(),
      paperRadarEnabled: true
    }))

    expect(html).toContain('Paper Radar')
    expect(html).toContain('aria-pressed="true"')
  })

  it('shows Evidence DAG as a right panel item', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'evidence',
      onToggleRightPanelMode: vi.fn()
    }))

    expect(html).toContain('Evidence DAG')
    expect(html).toContain('aria-pressed="true"')
  })

  it('renders separate controls for opening the workspace and choosing the default editor', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      workspaceRoot: '/workspace/sciforge'
    }))

    expect(html).toContain('aria-label="Open workspace in editor"')
    expect(html).toContain('aria-label="Choose default editor"')
  })

  it('hides the child agent status button until children exist', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      childAgentCount: 0,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).not.toContain('aria-label="Children"')
  })

  it('shows the child agent status button with count and active state', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: 'child-agents',
      onToggleRightPanelMode: vi.fn(),
      childAgentCount: 2,
      childAgentRunningCount: 1,
      childAgentsOpen: true,
      onOpenChildAgents: vi.fn()
    }))

    expect(html).toContain('aria-label="Children"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('>2</span>')
    expect(html).toContain('animate-pulse')
  })

  it('disables the side chat entry when the side conversation gate is unavailable', () => {
    const html = renderToStaticMarkup(createElement(WorkbenchTopBar, {
      rightPanelMode: null,
      onToggleRightPanelMode: vi.fn(),
      sideChatEnabled: false,
      onOpenSideChat: vi.fn()
    }))

    const sideButton = html.match(/<button[^>]*aria-label="Open side chat"[^>]*>/)?.[0] ?? ''
    expect(sideButton).toContain('disabled=""')
  })
})
