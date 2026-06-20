import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  defaultClaudeRuntimeSettings,
  defaultClawSettings,
  defaultCodexRuntimeSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '../../../shared/app-settings'
import { ClaudeRuntimeService } from './claude-service'

function settings(command: string, workspaceRoot: string): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    activeAgentRuntime: 'claude',
    provider: defaultModelProviderSettings(),
    modelRouter: {
      ...defaultModelRouterSettings(),
      baseUrl: 'http://127.0.0.1:49876/v1',
      publicModelAlias: 'deepseek-gui-router',
      runtimeApiKey: 'local-runtime-router-key'
    },
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings(),
      claude: {
        ...defaultClaudeRuntimeSettings(),
        command,
        claudeHome: '',
        permissionMode: 'dontAsk'
      }
    },
    workspaceRoot,
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

describe('ClaudeRuntimeService', () => {
  it('runs a Claude turn through Model Router stored thread events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepseek-gui-claude-runtime-'))
    const command = join(root, 'fake-claude.mjs')
    await writeFile(command, fakeClaudeCliScript(), 'utf8')
    await chmod(command, 0o755)
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push({ url: String(url), init: init ?? {}, body })
      return Response.json({
        id: 'resp_fake',
        object: 'response',
        model: 'deepseek-gui-router',
        output_text: 'pong',
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          cached_input_tokens: 0,
          reasoning_output_tokens: 0
        }
      })
    }) as typeof fetch

    const service = new ClaudeRuntimeService({
      settings: async () => settings(command, root),
      storageRoot: join(root, 'store'),
      fetchImpl,
      env: {
        ...process.env,
        OPENAI_API_KEY: 'outer-openai-secret',
        DEEPSEEK_API_KEY: 'outer-deepseek-secret',
        ANTHROPIC_AUTH_TOKEN: 'outer-anthropic-token',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'outer-sonnet',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com'
      }
    })

    await expect(service.connect()).resolves.toMatchObject({
      ok: true,
      info: { version: '2.1.143 (Fake Claude Code)' }
    })

    const started = await service.startThread({ title: 'Claude E2E', workspace: root })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const turn = await service.startTurn({
      threadId: started.thread.id,
      text: 'Reply with exactly: pong',
      workspace: root
    })
    expect(turn).toMatchObject({ ok: true, threadId: started.thread.id })
    let detail = await service.readThread(started.thread.id)
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (detail.ok && detail.detail.turns?.[0]?.status === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 25))
      detail = await service.readThread(started.thread.id)
    }

    const events = await service.readStoredEvents(started.thread.id, 0)
    expect(events.map((event) => event.kind)).toEqual([
      'user_message',
      'turn_lifecycle',
      'runtime_status',
      'assistant_delta',
      'usage',
      'turn_lifecycle'
    ])
    expect(detail.ok).toBe(true)
    if (!detail.ok) return
    expect(detail.detail.items?.map((item) => [item.kind, item.text])).toEqual([
      ['user_message', 'Reply with exactly: pong'],
      ['assistant_message', 'pong']
    ])
    expect(detail.detail.turns?.[0]).toMatchObject({ status: 'completed' })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('http://127.0.0.1:49876/v1/responses')
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe('Bearer local-runtime-router-key')
    expect(requests[0].body).toMatchObject({
      model: 'deepseek-gui-router',
      input: 'Reply with exactly: pong'
    })
  })
})

function fakeClaudeCliScript(): string {
  return `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  console.log('2.1.143 (Fake Claude Code)')
  process.exit(0)
}
if (!process.argv.includes('--bare')) {
  process.stderr.write('missing --bare\\n')
  process.exit(2)
}
if (process.env.OPENAI_API_KEY !== undefined || process.env.DEEPSEEK_API_KEY !== undefined) {
  process.stderr.write('leaked upstream provider key\\n')
  process.exit(2)
}
if (process.env.ANTHROPIC_BASE_URL !== 'http://127.0.0.1:49876') {
  process.stderr.write('unexpected base URL ' + String(process.env.ANTHROPIC_BASE_URL) + '\\n')
  process.exit(2)
}
if (process.env.ANTHROPIC_API_KEY !== 'local-runtime-router-key') {
  process.stderr.write('unexpected API key ' + String(process.env.ANTHROPIC_API_KEY) + '\\n')
  process.exit(2)
}
if (process.env.ANTHROPIC_AUTH_TOKEN !== undefined) {
  process.stderr.write('leaked auth token\\n')
  process.exit(2)
}
if (process.env.ANTHROPIC_MODEL !== 'deepseek-gui-router') {
  process.stderr.write('unexpected model ' + String(process.env.ANTHROPIC_MODEL) + '\\n')
  process.exit(2)
}
const sessionIndex = process.argv.indexOf('--session-id')
const sessionId = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : 'fake-session'
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  cwd: process.cwd(),
  session_id: sessionId,
  model: 'fake-sonnet',
  claude_code_version: '2.1.143'
}))
console.log(JSON.stringify({
  type: 'assistant',
  message: {
    content: [{ type: 'text', text: 'pong' }]
  },
  session_id: sessionId
}))
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'pong',
  session_id: sessionId,
  total_cost_usd: 0,
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0
  }
}))
`
}
