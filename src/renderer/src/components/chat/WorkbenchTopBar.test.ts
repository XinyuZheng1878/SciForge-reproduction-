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
})
