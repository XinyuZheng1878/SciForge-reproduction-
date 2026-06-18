import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp } from 'node:fs/promises'
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
import {
  startModelRouterServer,
  type ModelRouterConfig
} from '../../../../packages/workers/model-router/src/router'
import { ClaudeCodeRuntimeService } from './claude-code-service'

type SpawnCall = {
  command: string
  args: string[]
  options: SpawnOptionsWithoutStdio
  child: ChildProcessWithoutNullStreams
}

type CapturedProviderCall = {
  url: string
  body: Record<string, unknown>
}

type CapturedClaudeRequest = {
  path: string
  body: Record<string, unknown>
  env: NodeJS.ProcessEnv
}

function settings(input: { workspaceRoot: string; modelRouterBaseUrl: string }): AppSettingsV1 {
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
        model: '',
        extraArgs: ['--allowedTools', 'Edit']
      }
    },
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: input.modelRouterBaseUrl,
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    workspaceRoot: input.workspaceRoot,
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

function modelRouterConfig(): ModelRouterConfig {
  return {
    defaultProfile: 'default',
    publicModelAlias: 'deepseek-gui-router',
    runtimeApiKeyEnv: 'MODEL_ROUTER_RUNTIME_KEY',
    profiles: {
      default: {
        traceRoot: '.sciforge/model-router-traces',
        textReasoner: {
          provider: 'test-text-provider',
          baseUrl: 'https://text.example/v1',
          apiKeyEnv: 'TEXT_PROVIDER_KEY',
          model: 'text-model'
        },
        translators: {}
      }
    }
  }
}

function modelRouterEnv(): Record<string, string> {
  return {
    MODEL_ROUTER_RUNTIME_KEY: 'local-runtime-router-key',
    TEXT_PROVIDER_KEY: 'text-secret'
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
): (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams {
  return vi.fn((command: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    const child = childProcess()
    handler({ command, args, options, child })
    return child
  })
}

function writeJsonLine(child: ChildProcessWithoutNullStreams, value: unknown): void {
  ;(child.stdout as PassThrough).write(`${JSON.stringify(value)}\n`)
}

function closeOk(child: ChildProcessWithoutNullStreams): void {
  child.emit('close', 0, null)
}

function closeFailed(child: ChildProcessWithoutNullStreams, error: unknown): void {
  ;(child.stderr as PassThrough).write(error instanceof Error ? error.message : String(error))
  child.emit('close', 1, null)
}

async function waitUntil(assertion: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Claude Code model-router e2e condition.')
}

async function fakeClaudeCliTurn(call: SpawnCall, captured: CapturedClaudeRequest[]): Promise<void> {
  const env = call.options.env ?? {}
  const baseUrl = String(env.ANTHROPIC_BASE_URL ?? '')
  const apiKey = String(env.ANTHROPIC_API_KEY ?? '')
  const requestUrl = `${baseUrl}/v1/messages?beta=true`
  const requestBody = {
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    stream: true,
    thinking: { type: 'disabled' },
    output_config: { type: 'text' },
    system: [{ type: 'text', text: 'You are Claude Code.' }],
    tools: [{
      name: 'Bash',
      description: 'execute shell commands',
      input_schema: {
        type: 'object',
        properties: {
          command: { type: 'string' }
        },
        required: ['command'],
        additionalProperties: false
      }
    }],
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'Run a harmless check.' }]
    }]
  }
  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  })
  captured.push({
    path: new URL(requestUrl).pathname + new URL(requestUrl).search,
    body: requestBody,
    env
  })
  if (!response.ok) throw new Error(`Fake Claude CLI request failed: ${response.status} ${await response.text()}`)
  const body = await response.text()
  const events = parseSseEvents(body)
  const text = events
    .map((event) => recordValue(event.delta))
    .filter((delta) => delta.type === 'text_delta')
    .map((delta) => String(delta.text ?? ''))
    .join('')
  writeJsonLine(call.child, { type: 'system', session_id: 'claude-e2e-session' })
  writeJsonLine(call.child, {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 17, output_tokens: 5 }
    }
  })
  writeJsonLine(call.child, {
    type: 'result',
    result: text,
    usage: { input_tokens: 17, output_tokens: 5 },
    session_id: 'claude-e2e-session'
  })
  closeOk(call.child)
}

function parseSseEvents(raw: string): Array<Record<string, unknown>> {
  return raw
    .split(/\n\n+/)
    .map((block) => block.split(/\n/).find((line) => line.startsWith('data: '))?.slice('data: '.length).trim() ?? '')
    .filter((line) => line && line !== '[DONE]')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function providerFetch(calls: CapturedProviderCall[]): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    const body = typeof init?.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {}
    calls.push({ url: String(input), body })
    return new Response(JSON.stringify({
      id: 'chatcmpl-claude-e2e',
      object: 'chat.completion',
      created: 1,
      model: 'text-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Routed Claude request.'
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 17,
        completion_tokens: 5,
        total_tokens: 22
      }
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Claude Code runtime + Model Router e2e', () => {
  it('routes Claude Code Anthropic Messages traffic through the local Model Router', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'upstream-openai-key')
    vi.stubEnv('DEEPSEEK_API_KEY', 'upstream-deepseek-key')
    vi.stubEnv('ANTHROPIC_API_KEY', 'upstream-anthropic-key')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'upstream-anthropic-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')
    vi.stubEnv('ANTHROPIC_MODEL', 'opus')
    vi.stubEnv('ANTHROPIC_DEFAULT_SONNET_MODEL', 'bailian/deepseek-v4-flash')

    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-workspace-'))
    await mkdir(workspaceRoot, { recursive: true })
    const providerCalls: CapturedProviderCall[] = []
    const claudeRequests: CapturedClaudeRequest[] = []
    const router = await startModelRouterServer({
      port: 0,
      config: modelRouterConfig(),
      env: modelRouterEnv(),
      workspaceRoot,
      fetchImpl: providerFetch(providerCalls)
    })
    const spawn = fakeSpawn((call) => {
      if (call.args[0] === '--version') {
        ;(call.child.stdout as PassThrough).write('2.1.143 (Claude Code)\n')
        closeOk(call.child)
        return
      }
      void fakeClaudeCliTurn(call, claudeRequests).catch((error) => closeFailed(call.child, error))
    })
    const service = new ClaudeCodeRuntimeService({
      settings: async () => settings({
        workspaceRoot,
        modelRouterBaseUrl: `${router.url}/v1`
      }),
      storageRoot: await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-store-')),
      managedConfigDir: await mkdtemp(join(tmpdir(), 'sciforge-claude-e2e-config-')),
      spawn
    })

    try {
      const thread = await service.startThread({ workspace: workspaceRoot, title: 'Claude e2e' })
      if (!thread.ok) throw new Error(thread.message)
      const turn = await service.startTurn({
        threadId: thread.thread.id,
        text: 'Run a harmless check.',
        workspace: workspaceRoot
      })
      if (!turn.ok) throw new Error(turn.message)

      await waitUntil(async () => {
        const detail = await service.readThread(thread.thread.id)
        return detail.ok && detail.detail.latestTurnStatus === 'completed'
      })

      const detail = await service.readThread(thread.thread.id)
      if (!detail.ok) throw new Error(detail.message)
      expect(detail.detail.backendThreadId).toBe('claude-e2e-session')
      expect(detail.detail.items).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant_message',
          text: 'Routed Claude request.'
        })
      ]))
      expect(claudeRequests).toHaveLength(1)
      expect(claudeRequests[0]?.path).toBe('/v1/messages?beta=true')
      expect(claudeRequests[0]?.body).toMatchObject({
        model: 'claude-sonnet-4-6',
        stream: true,
        thinking: { type: 'disabled' },
        output_config: { type: 'text' }
      })
      expect(claudeRequests[0]?.body.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Bash' })
      ]))
      expect(claudeRequests[0]?.env.OPENAI_API_KEY).toBeUndefined()
      expect(claudeRequests[0]?.env.DEEPSEEK_API_KEY).toBeUndefined()
      expect(claudeRequests[0]?.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
      expect(claudeRequests[0]?.env.ANTHROPIC_BASE_URL).toBe(router.url)
      expect(claudeRequests[0]?.env.ANTHROPIC_API_KEY).toBe('local-runtime-router-key')
      expect(claudeRequests[0]?.env.ANTHROPIC_AUTH_TOKEN).toBe('local-runtime-router-key')
      expect(claudeRequests[0]?.env.ANTHROPIC_MODEL).toBe('sonnet')
      expect(providerCalls).toHaveLength(1)
      expect(providerCalls[0]?.url).toBe('https://text.example/v1/chat/completions')
      expect(providerCalls[0]?.body.model).toBe('text-model')
      expect(providerCalls[0]?.body).not.toHaveProperty('thinking')
      expect(providerCalls[0]?.body).not.toHaveProperty('output_config')
      expect(providerCalls[0]?.body.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          function: expect.objectContaining({ name: 'Bash' })
        })
      ]))
    } finally {
      await service.stop()
      await router.close()
    }
  })
})
