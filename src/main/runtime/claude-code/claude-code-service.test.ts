import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptionsWithoutStdio
} from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultClaudeRuntimeSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultModelRouterSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { ClaudeCodeRuntimeService } from './claude-code-service'

type SpawnCall = {
  command: string
  args: string[]
  options: SpawnOptionsWithoutStdio
  child: ChildProcessWithoutNullStreams
}

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: '/tmp/sciforge-workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function childProcess(): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    setTimeout(() => child.emit('close', null, signal ?? 'SIGTERM'), 0)
    return true
  }) as ChildProcessWithoutNullStreams['kill']
  return child
}

function fakeSpawn(
  handler: (call: SpawnCall) => void
): { spawn: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams; calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  const spawn = vi.fn((command: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    const child = childProcess()
    const call = { command, args, options, child }
    calls.push(call)
    handler(call)
    return child
  })
  return { spawn, calls }
}

function writeJsonLine(child: ChildProcessWithoutNullStreams, value: unknown): void {
  ;(child.stdout as PassThrough).write(`${JSON.stringify(value)}\n`)
}

function closeOk(child: ChildProcessWithoutNullStreams): void {
  child.emit('close', 0, null)
}

async function serviceRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sciforge-claude-runtime-'))
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code test condition.')
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ClaudeCodeRuntimeService', () => {
  it('returns an install hint when the Claude CLI probe is missing', async () => {
    const { spawn } = fakeSpawn(({ child }) => {
      setTimeout(() => {
        child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))
      }, 0)
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      spawn
    })

    const result = await service.connect()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('ENOENT')
      expect(result.message).toMatch(/Install the `claude` CLI/)
    }
  })

  it('creates GUI-owned threads without launching Claude', async () => {
    const { spawn, calls } = fakeSpawn(() => undefined)
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      spawn
    })

    const result = await service.startThread({ workspace: '/tmp/workspace', title: 'Draft' })

    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(0)
    if (result.ok) {
      expect(result.thread.runtimeId).toBe('claude')
      expect(result.thread.title).toBe('Draft')
    }
  })

  it('launches turns through the Model Router and resumes stored Claude sessions', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-secret')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    const { spawn, calls } = fakeSpawn(({ args, child }) => {
      if (args[0] === '--version') {
        setTimeout(() => {
          ;(child.stdout as PassThrough).write('1.2.3\n')
          closeOk(child)
        }, 0)
        return
      }
      setTimeout(() => {
        writeJsonLine(child, { type: 'system', session_id: 'claude-session-1' })
        writeJsonLine(child, {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello from Claude.' }],
            usage: { input_tokens: 3, output_tokens: 4 }
          }
        })
        closeOk(child)
      }, 0)
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings(),
      storageRoot: await serviceRoot(),
      managedConfigDir: '/tmp/sciforge-claude-config',
      spawn
    })

    const thread = await service.startThread({ workspace: '/tmp/workspace', title: 'Resume me' })
    if (!thread.ok) throw new Error(thread.message)
    const firstTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'hello',
      workspace: '/tmp/workspace'
    })
    if (!firstTurn.ok) throw new Error(firstTurn.message)
    await waitUntil(async () => {
      const detail = await service.readThread(thread.thread.id)
      return detail.ok && detail.detail.backendThreadId === 'claude-session-1'
    })
    const secondTurn = await service.startTurn({
      threadId: thread.thread.id,
      text: 'again',
      workspace: '/tmp/workspace'
    })
    if (!secondTurn.ok) throw new Error(secondTurn.message)

    const turnCalls = calls.filter((call) => call.args[0] === '-p')
    expect(turnCalls).toHaveLength(2)
    expect(turnCalls[0]?.args).toEqual(expect.arrayContaining([
      '-p',
      'hello',
      '--output-format',
      'stream-json',
      '--verbose',
      '--bare',
      '--model',
      'sonnet',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Edit'
    ]))
    expect(turnCalls[0]?.args).not.toContain('--cwd')
    expect(turnCalls[0]?.options.cwd).toBe('/tmp/workspace')
    expect(turnCalls[0]?.options.env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:49876')
    expect(turnCalls[0]?.options.env?.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
    expect(turnCalls[0]?.options.env?.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
    expect(turnCalls[0]?.options.env?.ANTHROPIC_MODEL).toBe('sonnet')
    expect(turnCalls[1]?.args).toEqual(expect.arrayContaining(['--resume', 'claude-session-1']))

    let detail = await service.readThread(thread.thread.id)
    await waitUntil(async () => {
      detail = await service.readThread(thread.thread.id)
      return detail.ok && (detail.detail.items?.filter((item) =>
        item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
      ).length ?? 0) === 2
    })
    if (!detail.ok) throw new Error(detail.message)
    expect(detail.detail.backendThreadId).toBe('claude-session-1')
    expect(detail.detail.items?.filter((item) =>
      item.kind === 'assistant_message' && item.text === 'Hello from Claude.'
    )).toHaveLength(2)
    expect(detail.detail.items?.some((item) => item.kind === 'tool')).toBe(false)
  })
})
