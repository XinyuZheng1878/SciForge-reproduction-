import { describe, expect, it } from 'vitest'
import { probeDeepSeekReachable } from '../src/adapters/model/model-error-probe.js'

describe('model error probe', () => {
  it('probes the current local model router models endpoint', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (url) => {
      urls.push(String(url))
      return new Response(JSON.stringify({ data: [] }), { status: 200 })
    }

    const result = await probeDeepSeekReachable({
      baseUrl: 'http://127.0.0.1:3892/v1',
      fetchImpl
    })

    expect(result.reachable).toBe(true)
    expect(result.status).toBe(200)
    expect(urls).toEqual(['http://127.0.0.1:3892/v1/models'])
  })

  it('does not probe the DeepSeek host remotely', async () => {
    let called = false
    const fetchImpl: typeof fetch = async () => {
      called = true
      return new Response('{}', { status: 200 })
    }

    const result = await probeDeepSeekReachable({
      baseUrl: 'https://api.deepseek.com/beta',
      fetchImpl
    })

    expect(called).toBe(false)
    expect(result.reachable).toBe(false)
    expect(result.message).toMatch(/local model router/i)
  })
})
