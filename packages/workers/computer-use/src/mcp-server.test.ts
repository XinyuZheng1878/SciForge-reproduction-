import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  createComputerUseMcpServer,
  installComputerUseShutdownReleaseHooks,
  startComputerUseMcpServer,
  type ComputerUseMcpLifecycleProcess
} from './mcp-server.js'
import type {
  ComputerUseBindResult,
  ComputerUseReleaseReason,
  ComputerUseSession
} from './contract.js'
import type { ComputerUseService } from './service.js'

test('creates a computer-use MCP server', () => {
  const server = createComputerUseMcpServer()
  assert.ok(server)
})

test('bind_target defaults to the isolated browser-cdp backend', async (t) => {
  const service = new FakeMcpService()
  const server = createComputerUseMcpServer(service as unknown as ComputerUseService)
  const client = new Client({ name: 'computer-use-test', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  t.after(async () => {
    await client.close()
    await server.close()
  })

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ])

  const tools = await client.listTools()
  const tool = tools.tools.find((candidate) => candidate.name === 'computer_use')
  assert.ok(tool)
  const schema = JSON.stringify(tool.inputSchema)
  assert.match(schema, /browser-cdp/)
  assert.doesNotMatch(schema, /global-native/)
  assert.doesNotMatch(schema, /mac-app-scoped/)

  const result = await client.callTool({
    name: 'computer_use',
    arguments: {
      action: 'bind_target',
      targetId: 'browser-cdp:isolated-browser',
      agentId: 'agent-1',
      threadId: 'thread-1'
    }
  })

  assert.equal(result.isError, undefined)
  assert.equal(service.binds[0]?.backend, 'browser-cdp')
})

test('stdio startup releases all active sessions on transport close', async () => {
  const service = new FakeShutdownService()
  const transport = new FakeTransport()
  const lifecycle = new FakeLifecycleProcess()

  await startComputerUseMcpServer(service as unknown as ComputerUseService, {
    transport,
    lifecycleProcess: lifecycle.asProcess(),
    exitOnSignal: false
  })
  await transport.close()
  await flushPromises()

  assert.equal(transport.started, true)
  assert.deepEqual(service.releaseReasons, ['service_shutdown'])
  assert.equal(lifecycle.listenerCount('SIGINT'), 0)
  assert.equal(lifecycle.listenerCount('SIGTERM'), 0)
})

test('shutdown hooks release all active sessions on SIGINT and SIGTERM', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const service = new FakeShutdownService()
    const transport = new FakeTransport()
    const lifecycle = new FakeLifecycleProcess()
    const dispose = installComputerUseShutdownReleaseHooks({
      service: service as unknown as Pick<ComputerUseService, 'releaseAllTargets'>,
      transport,
      lifecycleProcess: lifecycle.asProcess(),
      exitOnSignal: false
    })

    lifecycle.emit(signal)
    await flushPromises()
    lifecycle.emit('exit')
    await flushPromises()

    assert.deepEqual(service.releaseReasons, ['service_shutdown'])
    dispose()
  }
})

test('shutdown hooks release all active sessions on process exit paths', async () => {
  const service = new FakeShutdownService()
  const transport = new FakeTransport()
  const lifecycle = new FakeLifecycleProcess()
  const dispose = installComputerUseShutdownReleaseHooks({
    service: service as unknown as Pick<ComputerUseService, 'releaseAllTargets'>,
    transport,
    lifecycleProcess: lifecycle.asProcess(),
    exitOnSignal: false
  })

  lifecycle.emit('beforeExit')
  lifecycle.emit('exit')
  await flushPromises()

  assert.deepEqual(service.releaseReasons, ['service_shutdown'])
  dispose()
})

class FakeShutdownService {
  readonly releaseReasons: ComputerUseReleaseReason[] = []

  async releaseAllTargets(reason: ComputerUseReleaseReason): Promise<ComputerUseSession[]> {
    this.releaseReasons.push(reason)
    return []
  }
}

class FakeMcpService {
  readonly binds: Array<{
    computerUseSessionId?: string
    agentId: string
    threadId: string
    turnId?: string
    backend: string
    targetId: string
  }> = []

  async bindTarget(input: FakeMcpService['binds'][number]): Promise<ComputerUseBindResult> {
    this.binds.push(input)
    const now = '2026-06-23T00:00:00.000Z'
    return {
      ok: true,
      session: {
        computerUseSessionId: input.computerUseSessionId ?? input.agentId,
        agentId: input.agentId,
        threadId: input.threadId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        targetId: input.targetId,
        backend: 'browser-cdp',
        leaseState: 'active',
        createdAt: now,
        updatedAt: now
      },
      target: {
        id: input.targetId,
        kind: 'window',
        title: 'Isolated browser',
        backend: 'browser-cdp',
        inputIsolation: 'agent-isolated',
        affectsUserInput: false
      },
      lease: {
        leaseId: 'lease-1',
        computerUseSessionId: input.computerUseSessionId ?? input.agentId,
        agentId: input.agentId,
        threadId: input.threadId,
        targetId: input.targetId,
        backend: 'browser-cdp',
        acquiredAt: now,
        updatedAt: now
      }
    }
  }
}

class FakeTransport implements Transport {
  started = false
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  async start(): Promise<void> {
    this.started = true
  }

  async send(): Promise<void> {}

  async close(): Promise<void> {
    this.onclose?.()
  }
}

type LifecycleEvent = 'SIGINT' | 'SIGTERM' | 'beforeExit' | 'exit'

class FakeLifecycleProcess {
  private readonly listeners = new Map<LifecycleEvent, Set<(...args: unknown[]) => void>>()

  once(event: LifecycleEvent, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set<(...args: unknown[]) => void>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return this
  }

  off(event: LifecycleEvent, listener: (...args: unknown[]) => void): this {
    const listeners = this.listeners.get(event)
    listeners?.delete(listener)
    if (listeners?.size === 0) this.listeners.delete(event)
    return this
  }

  exit(code?: number): never {
    throw new Error(`unexpected test process exit: ${code ?? 0}`)
  }

  emit(event: LifecycleEvent): void {
    const listeners = [...(this.listeners.get(event) ?? [])]
    this.listeners.delete(event)
    for (const listener of listeners) listener()
  }

  listenerCount(event: LifecycleEvent): number {
    return this.listeners.get(event)?.size ?? 0
  }

  asProcess(): ComputerUseMcpLifecycleProcess {
    return this as unknown as ComputerUseMcpLifecycleProcess
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
