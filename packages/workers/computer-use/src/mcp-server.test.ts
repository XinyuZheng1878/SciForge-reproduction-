import assert from 'node:assert/strict'
import test from 'node:test'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  createComputerUseMcpServer,
  installComputerUseShutdownReleaseHooks,
  startComputerUseMcpServer,
  type ComputerUseMcpLifecycleProcess
} from './mcp-server.js'
import type { ComputerUseReleaseReason, ComputerUseSession } from './contract.js'
import type { ComputerUseService } from './service.js'

test('creates a computer-use MCP server', () => {
  const server = createComputerUseMcpServer()
  assert.ok(server)
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
