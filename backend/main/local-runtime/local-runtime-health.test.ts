import { describe, expect, it } from 'vitest'
import { isLocalRuntimeHealthResponseBody } from './local-runtime-health'

describe('isLocalRuntimeHealthResponseBody', () => {
  it('accepts local runtime serve health responses', () => {
    expect(isLocalRuntimeHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'kun',
      mode: 'serve'
    }))).toBe(true)
  })

  it('rejects generic or legacy runtime health responses', () => {
    expect(isLocalRuntimeHealthResponseBody(JSON.stringify({ status: 'ok' }))).toBe(false)
    expect(isLocalRuntimeHealthResponseBody(JSON.stringify({
      status: 'ok',
      service: 'codewhale',
      mode: 'serve'
    }))).toBe(false)
  })
})
