import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import { startDevBrowserBridgeServer, type DevBrowserBridgeDispatcher } from './dev-browser-bridge'

type TestServer = Awaited<ReturnType<typeof startDevBrowserBridgeServer>>

let server: TestServer | null = null

async function closeServer(): Promise<void> {
  if (!server) return
  await server.close()
  server = null
}

function readFromResponse(path: string): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, server?.url)
    const req = request(url, {
      method: 'GET',
      headers: {
        Origin: 'http://localhost:5173'
      }
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body,
        headers: res.headers
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

function postJson(path: string, body: unknown, clientId = 'browser-1'): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const url = new URL(path, server?.url)
    const req = request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-DeepSeek-Gui-Client': clientId,
        Origin: 'http://localhost:5173'
      }
    }, (res) => {
      let response = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        response += chunk
      })
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: response,
        headers: res.headers
      }))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function openSse(path: string): Promise<{ close: () => void; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const url = new URL(path, server?.url)
    const req = request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        Origin: 'http://localhost:5173'
      }
    }, (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      resolve({
        close: () => req.destroy(),
        chunks
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('dev browser bridge server', () => {
  afterEach(async () => {
    await closeServer()
  })

  it('serves health and forwards invoke requests to the dispatcher', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    const address = server.server.address() as AddressInfo
    expect(server.url).toBe(`http://127.0.0.1:${address.port}`)

    const health = await readFromResponse('/health')
    expect(health.status).toBe(200)
    expect(JSON.parse(health.body)).toEqual({ ok: true })
    expect(health.headers['access-control-allow-origin']).toBe('http://localhost:5173')

    const response = await postJson('/invoke', {
      channel: 'settings:set',
      payload: { theme: 'dark' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, payload: { ok: true, payload: { theme: 'dark' } } })
    expect(invoke).toHaveBeenCalledWith(
      'settings:set',
      { theme: 'dark' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('streams sender.send payloads to the matching browser client over SSE', async () => {
    const dispatcher: DevBrowserBridgeDispatcher = {
      invoke: vi.fn(async (_channel, _payload, sender) => {
        sender.send('agentRuntime:event', {
          streamId: 'stream-1',
          event: { kind: 'heartbeat', threadId: 'thread-1' }
        })
        return { streamId: 'stream-1' }
      })
    }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })
    const sse = await openSse('/events?clientId=browser-2')

    const response = await postJson('/invoke', {
      channel: 'agentRuntime:subscribeEvents',
      payload: { threadId: 'thread-1', streamId: 'stream-1' }
    }, 'browser-2')

    expect(response.status).toBe(200)
    await vi.waitFor(() => {
      expect(sse.chunks.join('')).toContain('"channel":"agentRuntime:event"')
      expect(sse.chunks.join('')).toContain('"streamId":"stream-1"')
    })
    sse.close()
  })
})
