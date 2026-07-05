import { describe, expect, it } from 'vitest'
import { readJsonBody } from '../src/server/read-json-body.js'

describe('readJsonBody', () => {
  it('returns an empty object for requests without a body', async () => {
    await expect(readJsonBody(new Request('http://localhost/v1/demo'))).resolves.toEqual({
      ok: true,
      value: {}
    })
  })

  it('parses valid JSON bodies', async () => {
    await expect(
      readJsonBody(new Request('http://localhost/v1/demo', {
        method: 'POST',
        body: JSON.stringify({ ok: true })
      }))
    ).resolves.toEqual({
      ok: true,
      value: { ok: true }
    })
  })

  it('returns a structured 400 response for invalid JSON bodies', async () => {
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      body: '{'
    }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(400)
    expect(JSON.parse(result.response.body)).toMatchObject({
      code: 'validation_error',
      message: 'invalid JSON body'
    })
  })

  it('returns a structured 413 response when content-length exceeds the limit', async () => {
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      headers: { 'content-length': '12' },
      body: '{}'
    }), { maxBytes: 4 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
    expect(JSON.parse(result.response.body)).toMatchObject({
      code: 'validation_error',
      message: 'request body is too large',
      details: { limitBytes: 4 }
    })
  })

  it('returns a structured 413 response when streamed bodies exceed the limit', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"text":"'))
        controller.enqueue(new TextEncoder().encode('abcdef"}'))
        controller.close()
      }
    })
    const result = await readJsonBody(new Request('http://localhost/v1/demo', {
      method: 'POST',
      body,
      duplex: 'half'
    } as RequestInit & { duplex: 'half' }), { maxBytes: 8 })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
    expect(JSON.parse(result.response.body)).toMatchObject({
      code: 'validation_error',
      message: 'request body is too large',
      details: { limitBytes: 8 }
    })
  })
})
