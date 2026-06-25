import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows blob image URLs for local attachment previews', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const imgSrc = csp.match(/img-src\s+([^;]+)/)?.[1] ?? ''

    expect(imgSrc.split(/\s+/)).toContain('blob:')
  })

  it('allows the dev browser bridge fetch and EventSource endpoints', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const connectSrc = csp.match(/connect-src\s+([^;]+)/)?.[1] ?? ''

    expect(connectSrc.split(/\s+/)).toEqual(expect.arrayContaining([
      "'self'",
      'http://127.0.0.1:5174',
      'http://localhost:5174'
    ]))
  })

  it('allows loopback iframe HTML previews', () => {
    const html = readFileSync(resolve('src/renderer/index.html'), 'utf8')
    const csp = html.match(/Content-Security-Policy"[\s\S]*?content="([^"]+)"/)?.[1] ?? ''
    const frameSrc = csp.match(/frame-src\s+([^;]+)/)?.[1] ?? ''

    expect(frameSrc.split(/\s+/)).toEqual(expect.arrayContaining([
      "'self'",
      'http://127.0.0.1:*',
      'http://localhost:*'
    ]))
  })
})
