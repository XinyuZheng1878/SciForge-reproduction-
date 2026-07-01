import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FIGURE_STYLE_PANEL_PAGE_KEY,
  persistFigureStylePanelPage,
  readStoredFigureStylePanelPage
} from './figure-style-panel-state'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key)
    },
    setItem: (key, value) => {
      items.set(key, value)
    }
  }
}

describe('figure-style-panel-state', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the legacy panel page key but writes only the SciForge key', () => {
    localStorage.setItem('deepseekgui.figureStyle.activePage', 'canvas')

    expect(readStoredFigureStylePanelPage()).toBe('canvas')

    persistFigureStylePanelPage('style')

    expect(localStorage.getItem(FIGURE_STYLE_PANEL_PAGE_KEY)).toBe('style')
    expect(localStorage.getItem('deepseekgui.figureStyle.activePage')).toBe('canvas')
  })
})
