import { describe, expect, it } from 'vitest'
import { decideDevPreviewPopup } from './dev-preview-popup-policy'

describe('dev preview popup policy', () => {
  it('routes allowed webview preview popups back into the panel', () => {
    expect(
      decideDevPreviewPopup('http://127.0.0.1:5173/docs?tab=1#intro', { fromWebview: true })
    ).toEqual({
      action: 'navigate-preview',
      url: 'http://127.0.0.1:5173/docs?tab=1#intro'
    })

    expect(
      decideDevPreviewPopup('https://192.168.4.20:49152/app', { fromWebview: true })
    ).toEqual({
      action: 'navigate-preview',
      url: 'https://192.168.4.20:49152/app'
    })
  })

  it('opens safe external webview popups through the shared external policy', () => {
    expect(decideDevPreviewPopup('https://example.com/docs', { fromWebview: true })).toEqual({
      action: 'open-external',
      url: 'https://example.com/docs'
    })
  })

  it('does not route renderer popups into the dev preview panel', () => {
    expect(decideDevPreviewPopup('http://localhost:3000/', { fromWebview: false })).toEqual({
      action: 'open-external',
      url: 'http://localhost:3000/'
    })
  })

  it('denies unsafe popup URLs', () => {
    expect(decideDevPreviewPopup('javascript:alert(1)', { fromWebview: true })).toEqual({
      action: 'deny'
    })
    expect(decideDevPreviewPopup('file:///tmp/preview.html', { fromWebview: false })).toEqual({
      action: 'deny'
    })
  })
})
