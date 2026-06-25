import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildLocalRuntimeServeArgs,
  resolveLocalRuntimeExecutable,
  type LocalRuntimeBinaryResolution
} from './resolve-local-runtime-binary'

const tempRoots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'local-runtime-resolver-'))
  tempRoots.push(root)
  return root
}

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '', 'utf8')
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveLocalRuntimeExecutable', () => {
  it('resolves the built local runtime entry from the app root', () => {
    const root = tempRoot()
    const entry = join(root, 'kun/dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveLocalRuntimeExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('does not fall back to TypeScript source files that Node cannot execute', () => {
    const root = tempRoot()
    touch(join(root, 'kun/src/cli/serve-entry.ts'))

    const resolution = resolveLocalRuntimeExecutable(root, '')

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [join(root, 'kun/dist/cli/serve-entry.js')],
      dataDir: ''
    })
  })

  it('accepts a local runtime package directory as a custom binary path', () => {
    const root = tempRoot()
    const entry = join(root, 'dist/cli/serve-entry.js')
    touch(entry)

    const resolution = resolveLocalRuntimeExecutable('/app', root)

    expect(resolution).toEqual({
      kind: 'node-script',
      command: process.execPath,
      args: [entry],
      dataDir: ''
    })
  })

  it('runs a non-JavaScript custom executable directly', () => {
    const resolution = resolveLocalRuntimeExecutable('/app', '/usr/local/bin/kun')

    expect(resolution).toEqual({
      kind: 'custom',
      command: '/usr/local/bin/kun',
      args: [],
      dataDir: ''
    })
  })
})

describe('buildLocalRuntimeServeArgs', () => {
  it('does not place runtime secrets on the child process argv', () => {
    const resolution: LocalRuntimeBinaryResolution = {
      kind: 'node-script',
      command: '/usr/bin/node',
      args: ['/app/kun/dist/cli/serve-entry.js'],
      dataDir: ''
    }

    const args = buildLocalRuntimeServeArgs({
      resolution,
      host: '127.0.0.1',
      port: 8899,
      dataDir: '/tmp/local-runtime',
      modelRouterBaseUrl: 'http://127.0.0.1:3892/v1',
      model: 'sciforge-router',
      forceDefaultModel: true,
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      tokenEconomyMode: false,
      insecure: false
    })

    expect(args).not.toContain('--api-key')
    expect(args).not.toContain('--runtime-token')
    expect(args).not.toContain('--endpoint-format')
    expect(args).toContain('--model-router-base-url')
    expect(args).toContain('http://127.0.0.1:3892/v1')
    expect(args).toContain('--force-default-model')
    expect(args).toContain('--token-economy-mode')
    expect(args).toContain('false')
  })
})
