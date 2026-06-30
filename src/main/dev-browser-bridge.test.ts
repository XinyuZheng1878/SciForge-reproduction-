import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import { request } from 'node:http'
import {
  DEV_BROWSER_BRIDGE_TOKEN_HEADER,
  DEV_BROWSER_BRIDGE_TOKEN_QUERY_PARAM,
  startDevBrowserBridgeServer,
  type DevBrowserBridgeDispatcher
} from './dev-browser-bridge'

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

type PostJsonOptions = {
  clientId?: string
  token?: string | null
}

function postJson(path: string, body: unknown, options: PostJsonOptions | string = {}): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const url = new URL(path, server?.url)
    const clientId = typeof options === 'string' ? options : options.clientId ?? 'browser-1'
    const token = typeof options === 'string'
      ? server?.token
      : 'token' in options
        ? options.token
        : server?.token
    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'X-SciForge-Client': clientId,
      Origin: 'http://localhost:5173'
    }
    if (token !== null && token !== undefined) {
      headers[DEV_BROWSER_BRIDGE_TOKEN_HEADER] = token
    }
    const req = request(url, {
      method: 'POST',
      headers
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

type OpenSseOptions = {
  token?: string | null
}

function openSse(path: string, options: OpenSseOptions = {}): Promise<{ close: () => void; chunks: string[] }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    const url = new URL(path, server?.url)
    const token = 'token' in options ? options.token : server?.token
    if (token !== null && token !== undefined && !url.searchParams.has(DEV_BROWSER_BRIDGE_TOKEN_QUERY_PARAM)) {
      url.searchParams.set(DEV_BROWSER_BRIDGE_TOKEN_QUERY_PARAM, token)
    }
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

  it('serves health and forwards authenticated read requests to the dispatcher', async () => {
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
      channel: 'settings:get',
      payload: { scope: 'all' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, payload: { ok: true, payload: { scope: 'all' } } })
    expect(invoke).toHaveBeenCalledWith(
      'settings:get',
      { scope: 'all' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('generates a per-server token when no token is configured', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })

    expect(server.token).toMatch(/^[a-f0-9]{64}$/)
    expect(server.token).not.toBe('sciforge-dev-browser-bridge')

    const response = await postJson('/invoke', {
      channel: 'settings:get'
    }, { token: 'sciforge-dev-browser-bridge' })

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge token is missing or invalid.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects invoke requests that do not include the bridge token', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await postJson('/invoke', {
      channel: 'settings:get'
    }, { token: null })

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge token is missing or invalid.'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects event streams that do not include the bridge token', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await readFromResponse('/events?clientId=browser-unauth')

    expect(response.status).toBe(401)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge token is missing or invalid.'
    })
  })

  it('rejects unrelated host mutating channels by default', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await postJson('/invoke', {
      channel: 'desktop:command',
      payload: { command: 'open-settings' }
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge channel is not allowed: desktop:command'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('allows authenticated settings writes in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await postJson('/invoke', {
      channel: 'settings:set',
      payload: { provider: { apiKey: 'provider-key' } }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: { ok: true, payload: { provider: { apiKey: 'provider-key' } } }
    })
    expect(invoke).toHaveBeenCalledWith(
      'settings:set',
      { provider: { apiKey: 'provider-key' } },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('allows authenticated agent runtime actions in browser dev mode', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    for (const channel of ['agentRuntime:connect', 'agentRuntime:startTurn', 'sciforge-canvas:open'] as const) {
      const response = await postJson('/invoke', {
        channel,
        payload: channel === 'sciforge-canvas:open'
          ? { workspaceRoot: '/tmp/workspace', canvasId: 'thread-test' }
          : { runtimeId: 'sciforge' }
      })

      expect(response.status).toBe(200)
      expect(JSON.parse(response.body).ok).toBe(true)
    }
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('allows callers to explicitly opt into mutating channels', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123',
      allowedChannels: ['settings:set']
    })

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

  it('allows all app bridge channels when explicitly enabled for local dev parity', async () => {
    const invoke = vi.fn(async (_channel, payload) => ({ ok: true, payload }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123',
      allowAllChannels: true
    })

    const response = await postJson('/invoke', {
      channel: 'agentRuntime:startTurn',
      payload: { threadId: 'thread-1', text: 'hello' }
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      payload: { ok: true, payload: { threadId: 'thread-1', text: 'hello' } }
    })
    expect(invoke).toHaveBeenCalledWith(
      'agentRuntime:startTurn',
      { threadId: 'thread-1', text: 'hello' },
      expect.objectContaining({ id: expect.any(Number), send: expect.any(Function) })
    )
  })

  it('rejects invoke requests for channels outside the default allowlist', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await postJson('/invoke', {
      channel: 'desktop:command',
      payload: 'quit'
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Dev browser bridge channel is not allowed: desktop:command'
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects oversized invoke request bodies before dispatching', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const dispatcher: DevBrowserBridgeDispatcher = { invoke }

    server = await startDevBrowserBridgeServer({
      dispatcher,
      port: 0,
      token: 'test-bridge-token-123'
    })

    const response = await postJson('/invoke', {
      channel: 'settings:get',
      payload: 'x'.repeat(2_000_000)
    })

    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      message: 'Request body is too large.'
    })
    expect(invoke).not.toHaveBeenCalled()
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

  it('broadcasts server-level messages to connected browser clients', async () => {
    const dispatcher: DevBrowserBridgeDispatcher = {
      invoke: vi.fn(async () => ({ ok: true }))
    }

    server = await startDevBrowserBridgeServer({ dispatcher, port: 0 })
    const first = await openSse('/events?clientId=browser-a')
    const second = await openSse('/events?clientId=browser-b')

    server.send('remoteChannel:activity', {
      channelId: 'channel-1',
      threadId: 'thread-1',
      runtimeId: 'codex'
    })

    await vi.waitFor(() => {
      expect(first.chunks.join('')).toContain('"channel":"remoteChannel:activity"')
      expect(first.chunks.join('')).toContain('"threadId":"thread-1"')
      expect(second.chunks.join('')).toContain('"channel":"remoteChannel:activity"')
      expect(second.chunks.join('')).toContain('"threadId":"thread-1"')
    })
    first.close()
    second.close()
  })
})
