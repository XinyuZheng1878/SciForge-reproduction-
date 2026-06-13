import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImConversationV1
} from '../shared/app-settings'
import { createClawRuntime } from './claw-runtime'
import {
  CLAW_IM_PROVIDER_CAPABILITIES,
  classifyClawFailure,
  clawImAttachmentFromGeneratedFile,
  prepareClawImReplyText,
  splitClawImReplyText
} from './claw-runtime-helpers'

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: true, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    claw: {
      ...defaultClawSettings(),
      enabled: true,
      tasks: [
        {
          id: 'task_1',
          title: 'Task 1',
          enabled: true,
          prompt: 'Summarize changes',
          workspaceRoot: '/tmp/workspace',
          model: 'auto',
          reasoningEffort: 'medium',
          mode: 'agent',
          schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
          lastRunAt: '',
          nextRunAt: '',
          lastStatus: 'idle',
          lastMessage: '',
          lastThreadId: ''
        }
      ]
    },
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function buildConversation(overrides: Partial<ClawImConversationV1> = {}): ClawImConversationV1 {
  return {
    id: 'conv_1',
    chatId: 'oc_chat_a',
    remoteThreadId: '',
    latestMessageId: 'om_previous',
    senderId: 'ou_1',
    senderName: 'Alice',
    localThreadId: 'thr_old',
    workspaceRoot: '/tmp/workspace/conversations/oc_chat_a',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function buildChannel(overrides: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  return {
    id: 'channel_1',
    provider: 'feishu' as const,
    label: 'Phone',
    enabled: true,
    model: 'auto',
    threadId: 'thr_old',
    workspaceRoot: '/tmp/workspace',
    agentProfile: {
      name: 'kun',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function mutableSettingsStore(initialSettings: AppSettingsV1): {
  current: () => AppSettingsV1
  store: {
    load: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
  }
} {
  let currentSettings = initialSettings
  const store = {
    load: vi.fn(async () => currentSettings),
    patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
      currentSettings = {
        ...currentSettings,
        ...partial,
        claw: partial.claw
          ? {
              ...currentSettings.claw,
              ...partial.claw,
              im: partial.claw.im
                ? { ...currentSettings.claw.im, ...partial.claw.im }
                : currentSettings.claw.im
            }
          : currentSettings.claw
      }
      return currentSettings
    })
  }
  return { current: () => currentSettings, store }
}

describe('ClawRuntime', () => {
  it('classifies the standard Claw IM failure buckets', () => {
    expect(classifyClawFailure({ code: 'runtime_offline', message: 'Kun is offline.' })).toBe('runtime_offline')
    expect(classifyClawFailure({ code: 'provider_unavailable', message: 'model deepseek-v4-pro missing' })).toBe('model_missing')
    expect(classifyClawFailure({ message: 'Timed out waiting for agent response.' })).toBe('timeout')
    expect(classifyClawFailure({ code: 'empty_response', message: 'Agent completed without a reply.' })).toBe('empty_response')
    expect(classifyClawFailure({ code: 'approval_required', message: 'waiting for desktop approval' })).toBe('waiting_desktop_approval')
    expect(classifyClawFailure({ status: 404, message: 'thread not found' })).toBe('local_thread_deleted')
    expect(classifyClawFailure({ code: 'provider_send_failed', message: 'Discord send failed' })).toBe('provider_send_failed')
  })

  it('defines provider reply and attachment capabilities for Feishu, WeChat, and Discord', () => {
    expect(CLAW_IM_PROVIDER_CAPABILITIES.feishu).toMatchObject({
      label: 'Feishu / Lark',
      maxMessageLength: 30_000,
      markdown: { supported: true, preserveCodeBlocks: true },
      attachments: {
        file: { supported: true, maxBytes: 50 * 1024 * 1024 },
        image: { supported: true },
        link: { supported: true }
      },
      retry: { maxAttempts: 2 }
    })
    expect(CLAW_IM_PROVIDER_CAPABILITIES.weixin).toMatchObject({
      label: 'WeChat',
      maxMessageLength: 2_000,
      markdown: { supported: false, preserveCodeBlocks: true },
      attachments: {
        file: { supported: false },
        image: { supported: false },
        link: { supported: true }
      },
      retry: { maxAttempts: 2 }
    })
    expect(CLAW_IM_PROVIDER_CAPABILITIES.discord).toMatchObject({
      label: 'Discord',
      maxMessageLength: 2_000,
      markdown: { supported: true, preserveCodeBlocks: true },
      attachments: {
        file: { supported: false },
        image: { supported: false },
        link: { supported: true }
      },
      retry: { maxAttempts: 3 }
    })
  })

  it('splits long replies while preserving fenced code blocks where possible', () => {
    const reply = [
      'Here is the patch:',
      '```ts',
      ...Array.from({ length: 8 }, (_, index) => `const value${index} = ${index};`),
      '```',
      'Done.'
    ].join('\n')

    const chunks = splitClawImReplyText('discord', reply, { maxMessageLength: 90 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 90)).toBe(true)
    expect(chunks[0]).toContain('```ts')
    expect(chunks[0].trimEnd()).toMatch(/```$/)
    expect(chunks[1]).toMatch(/^```ts\n/)
  })

  it('adds an attachment fallback summary when a provider cannot deliver generated files', () => {
    const prepared = prepareClawImReplyText('weixin', '文件已经生成。', {
      attachments: [
        clawImAttachmentFromGeneratedFile({
          path: '/tmp/workspace/report.md',
          relativePath: 'report.md',
          fileName: 'report.md'
        }),
        clawImAttachmentFromGeneratedFile({
          path: '/tmp/workspace/chart.png',
          relativePath: 'chart.png',
          fileName: 'chart.png'
        })
      ],
      maxMessageLength: 500
    })

    const fullText = prepared.textChunks.join('\n')
    expect(prepared.unsupportedAttachments.map((item) => item.name)).toEqual(['report.md', 'chart.png'])
    expect(fullText).toContain('WeChat 当前不能直接投递这些附件')
    expect(fullText).toContain('report.md')
    expect(fullText).toContain('请到桌面查看完整结果')
  })

  it('bases Feishu conversation workspaces on the configured Claw workspace', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const channel: ClawImChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.claw.channels = [channel]
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: undefined,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, undefined, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default')
  })

  it('repairs legacy Feishu conversation workspaces created from an empty channel root', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const conversation: ClawImConversationV1 = {
      id: 'conv_1',
      chatId: 'oc_chat_a',
      remoteThreadId: '',
      latestMessageId: 'msg_1',
      senderId: 'ou_1',
      senderName: 'Alice',
      localThreadId: 'thr_1',
      workspaceRoot: '/conversations/oc_chat_a',
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    const channel: ClawImChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [conversation],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.claw.channels = [channel]
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: typeof conversation,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, conversation, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default')
  })

  it('repairs legacy Feishu conversation sub-workspaces under the channel project root', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const conversation = buildConversation({
      chatId: 'oc_chat_a',
      remoteThreadId: '',
      workspaceRoot: '/tmp/claw-default/conversations/oc_chat_a'
    })
    const channel = buildChannel({
      workspaceRoot: '',
      conversations: [conversation]
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: typeof conversation,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, conversation, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default')
  })

  it('delegates reminder creation to Schedule without writing claw tasks', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const createScheduledTaskFromText = vi.fn(async () => ({
      kind: 'created' as const,
      taskId: 'schedule-task-1',
      title: 'Reminder',
      scheduleAt: '2026-06-03T09:00:00.000+08:00',
      confirmationText: 'Scheduled.'
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: 'Remind me tomorrow to ship the review.' })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toEqual({
      ok: true,
      createdTaskId: 'schedule-task-1',
      reply: 'Scheduled.'
    })
    expect(createScheduledTaskFromText).toHaveBeenCalledWith('Remind me tomorrow to ship the review.', {
      workspaceRoot: settings.workspaceRoot,
      modelHint: settings.claw.im.model,
      mode: settings.claw.im.mode
    })
    expect(store.patch).not.toHaveBeenCalled()
    expect(settings.claw.tasks).toHaveLength(1)
  })

  it('reports that scheduled tasks have moved to Schedule', async () => {
    const settings = buildSettings()
    let currentSettings = settings
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const store = {
      load: vi.fn(async () => currentSettings),
      patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
        currentSettings = {
          ...currentSettings,
          ...partial,
          claw: { ...currentSettings.claw, ...(partial.claw ?? {}) }
        }
        return currentSettings
      })
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await runtime.runTask('task_1')

    expect(result).toEqual({ ok: false, message: 'Claw scheduled tasks have moved to Schedule.' })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('accepts assistant_text items when waiting for a Claw turn result', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            thread: { id: 'thr_1', status: 'completed' },
            turns: [{ id: 'turn_1', status: 'completed' }],
            items: [{ kind: 'assistant_text', detail: 'hello from claw' }]
          })
        }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 10,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from claw' })
  })

  it('reads assistant text from the Kun thread detail shape used by the real runtime', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_1' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            latestSeq: 3,
            turns: [
              {
                id: 'turn_1',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from nested turn items' }]
              }
            ]
          })
        }
      }
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' }) }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({ ok: true, text: 'hello from nested turn items' })
  })

  it('replaces a missing configured IM thread before starting a new inbound turn', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const onTurnStarted = vi.fn()
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_missing/turns') {
        return {
          ok: false,
          status: 404,
          body: JSON.stringify({ code: 'not_found', message: 'thread not found: thr_missing' })
        }
      }
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_replacement' }) }
      }
      if (path === '/v1/threads/thr_replacement' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_replacement/turns') {
        return {
          ok: true,
          status: 202,
          body: JSON.stringify({ threadId: 'thr_replacement', turnId: 'turn_replacement' })
        }
      }
      if (path === '/v1/threads/thr_replacement' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_replacement',
            status: 'idle',
            turns: [
              {
                id: 'turn_replacement',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'recovered reply' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest,
      logError
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          threadId?: string
          onTurnStarted?: (payload: {
            threadId: string
            turnId: string
            previousThreadId?: string
          }) => Promise<void> | void
        }
      ) => Promise<{ ok: boolean; threadId?: string; turnId?: string; text?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im',
      threadId: 'thr_missing',
      onTurnStarted
    })

    expect(result).toMatchObject({
      ok: true,
      threadId: 'thr_replacement',
      turnId: 'turn_replacement',
      text: 'recovered reply'
    })
    expect(onTurnStarted).toHaveBeenCalledWith({
      threadId: 'thr_replacement',
      turnId: 'turn_replacement',
      previousThreadId: 'thr_missing'
    })
    expect(logError).toHaveBeenCalledWith(
      'claw-runtime',
      'Configured IM thread was missing; creating a replacement thread.',
      expect.objectContaining({ threadId: 'thr_missing', source: 'im' })
    )
  })

  it('returns classified failures when Kun reports a missing model', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async (_settings, path) => {
      if (path === '/v1/threads') {
        return { ok: true, status: 200, body: JSON.stringify({ id: 'thr_model_missing' }) }
      }
      if (path === '/v1/threads/thr_model_missing/turns') {
        return {
          ok: false,
          status: 400,
          body: JSON.stringify({
            code: 'provider_unavailable',
            message: 'model deepseek-v4-pro is missing'
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
        }
      ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
    }).runPrompt(settings, {
      prompt: 'hello',
      title: 'demo',
      workspaceRoot: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      waitForResult: false,
      responseTimeoutMs: 2_000,
      source: 'im'
    })

    expect(result).toMatchObject({
      ok: false,
      message: 'model deepseek-v4-pro is missing',
      failureKind: 'model_missing'
    })
  })

  it('falls back to a plain Feishu chat message when replying to an inbound message fails', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: 'agent reply' },
      { replyTo: undefined, replyInThread: undefined }
    )
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      'Failed to send Feishu / Lark reply; falling back to plain chat message.',
      expect.objectContaining({
        channelId: 'channel_1',
        message: 'reply permission denied',
        purpose: 'agent-reply',
        replyTo: 'om_inbound',
        to: 'oc_chat_a'
      })
    )
  })

  it('queues Feishu messages per chat so SDK event handlers can ack immediately', async () => {
    const settings = buildSettings()
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    const order: string[] = []
    let releaseFirst: () => void = () => undefined
    const handleFeishuMessage = vi.fn(async (_channelId: string, message: { messageId: string }) => {
      order.push(`start:${message.messageId}`)
      if (message.messageId === 'om_1') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      order.push(`end:${message.messageId}`)
    })
    ;(runtime as unknown as { handleFeishuMessage: typeof handleFeishuMessage })
      .handleFeishuMessage = handleFeishuMessage

    const enqueue = (runtime as unknown as {
      enqueueFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        chatType: 'p2p' | 'group'
        content: string
        rawContentType: string
        mentionedBot: boolean
        mentionAll: boolean
        mentions: unknown[]
        resources: unknown[]
      }) => void
    }).enqueueFeishuMessage.bind(runtime)

    enqueue('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_1',
      senderId: 'ou_1',
      chatType: 'p2p',
      content: 'first',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    })
    enqueue('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_2',
      senderId: 'ou_1',
      chatType: 'p2p',
      content: 'second',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    })

    await vi.waitFor(() => {
      expect(order).toEqual(['start:om_1'])
    })
    releaseFirst()
    await vi.waitFor(() => {
      expect(order).toEqual(['start:om_1', 'end:om_1', 'start:om_2', 'end:om_2'])
    })
  })

  it('drops duplicate Feishu message deliveries before queuing work', async () => {
    const settings = buildSettings()
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    const handleFeishuMessage = vi.fn(async () => undefined)
    ;(runtime as unknown as { handleFeishuMessage: typeof handleFeishuMessage })
      .handleFeishuMessage = handleFeishuMessage
    const enqueue = (runtime as unknown as {
      enqueueFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        chatType: 'p2p' | 'group'
        content: string
        rawContentType: string
        mentionedBot: boolean
        mentionAll: boolean
        mentions: unknown[]
        resources: unknown[]
      }) => void
    }).enqueueFeishuMessage.bind(runtime)
    const message = {
      chatId: 'oc_chat_a',
      messageId: 'om_duplicate',
      senderId: 'ou_1',
      chatType: 'p2p' as const,
      content: 'hello',
      rawContentType: 'text',
      mentionedBot: false,
      mentionAll: false,
      mentions: [],
      resources: []
    }

    enqueue('channel_1', message)
    enqueue('channel_1', message)

    await vi.waitFor(() => {
      expect(handleFeishuMessage).toHaveBeenCalledTimes(1)
    })
  })

  it('ignores unmentioned Feishu group messages when channel guard mode is only_mention', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({ guardMode: 'only_mention' })]
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const addReaction = vi.fn(async () => 'rc_1')
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_group_a',
      messageId: 'om_group_noise',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'group',
      mentionedBot: false,
      mentionAll: false,
      content: 'ambient group chatter',
      rawContentType: 'text',
      mentions: []
    })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(addReaction).not.toHaveBeenCalled()
  })

  it('handles all_messages Feishu groups through the shared channel thread', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({
      guardMode: 'all_messages',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_group' }) }
      }
      if (path === '/v1/threads/thr_group' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_group/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_group' }) }
      }
      if (path === '/v1/threads/thr_group' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_group',
            turns: [{
              id: 'turn_group',
              status: 'completed',
              items: [{ kind: 'assistant_text', text: 'group reply' }]
            }]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const addReaction = vi.fn(async () => 'rc_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_group_a',
      messageId: 'om_group_1',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'group',
      mentionedBot: false,
      mentionAll: false,
      content: 'group task',
      rawContentType: 'text',
      mentions: []
    })

    expect(current().claw.channels[0]).toMatchObject({
      threadId: 'thr_group',
      remoteSession: expect.objectContaining({ chatId: 'oc_group_a', messageId: 'om_group_1' })
    })
    expect(current().claw.channels[0].conversations).toEqual([])
    expect(send).toHaveBeenCalledWith(
      'oc_group_a',
      { markdown: 'group reply' },
      { replyTo: 'om_group_1', replyInThread: false }
    )
  })

  it('handles Feishu /new locally by clearing the mapped IM thread', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    const conversation = buildConversation()
    settings.claw.channels = [buildChannel({ conversations: [conversation] })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/new',
      rawContentType: 'text',
      mentions: []
    })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Started a new topic. The next message will create a fresh local conversation.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    expect(current().claw.channels[0].threadId).toBe('')
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('')
    expect(current().claw.channels[0].remoteSession?.messageId).toBe('om_inbound')
  })

  it('handles Feishu model commands locally for the current IM channel', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel()]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const send = vi.fn(async () => ({ messageId: 'om_sent' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send }> })
      .feishuChannels
      .set('channel_1', { send })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '-model flash',
      rawContentType: 'text',
      mentions: []
    })

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(current().claw.channels[0].model).toBe('deepseek-v4-flash')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Claw IM model switched to `deepseek-v4-flash`.' },
      { replyTo: 'om_inbound', replyInThread: false }
    )
  })

  it('handles generic IM lifecycle commands for mode, summary, status, detach, and new private', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_summary'
      })]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_summary' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_summary',
            items: [{ kind: 'compaction_event', summary: 'Short project summary.' }]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const commandInput = (text: string, messageId: string) => runtime.handleIncomingImMessage({
      provider: 'weixin',
      channelId: 'channel_weixin',
      text,
      sender: 'Alice',
      remoteSession: {
        chatId: 'wx_user_1',
        messageId,
        threadId: '',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      }
    })

    await expect(commandInput('/mode plan', 'wx_msg_mode')).resolves.toMatchObject({
      ok: true,
      reply: 'Claw IM mode switched to `plan`.'
    })
    expect(current().claw.im.mode).toBe('plan')

    await expect(commandInput('/status', 'wx_msg_status')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Mode: plan')
    })
    await expect(commandInput('where', 'wx_msg_where')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Workspace: /tmp/workspace/conversations/oc_chat_a')
    })
    await expect(commandInput('/where', 'wx_msg_slash_where')).resolves.toMatchObject({
      ok: true,
      reply: expect.not.stringContaining('[redacted-path]')
    })
    await expect(commandInput('/summary', 'wx_msg_summary')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Short project summary.')
    })
    await expect(commandInput('/new private', 'wx_msg_private')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('not supported yet')
    })
    await expect(commandInput('/detach', 'wx_msg_detach')).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining('Detached')
    })
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('')
  })

  it('handles webhook /help as an IM command before starting a Kun turn', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({ provider: 'weixin' as const, id: 'channel_weixin' })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const createScheduledTaskFromText = vi.fn()
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText
    })
    const body = JSON.stringify({ text: '/help', provider: 'weixin', channelId: 'channel_weixin' })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('Claw IM commands:')
    })
    expect(createScheduledTaskFromText).not.toHaveBeenCalled()
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('attaches a remote IM conversation to the active desktop thread', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn()
    const notifyChannelActivity = vi.fn()
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '/attach current',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_attach',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody).reply).toContain('Attached to the active desktop conversation')
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'desktop-thread-1',
      runtimeId: 'codex'
    })
    expect(current().claw.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' }
    })
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_attach',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'desktop-thread-1' },
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('records WeChat webhook conversations and returns the GUI-generated reply', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_weixin',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'hello from GUI' }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('hello from GUI')
    })
    expect(JSON.parse(responseBody).reply).toContain('Claw IM commands:')
    expect(current().claw.channels[0].threadId).toBe('thr_weixin')
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      localThreadId: 'thr_weixin'
    })
  })

  it('handles Codex-bound IM channels through agentRuntime instead of legacy /v1 runtimeRequest', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: 'kun-thread',
      agentThreadIds: { kun: 'kun-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected legacy runtimeRequest path ${path}`)
    })
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex' as const,
        title: 'Codex IM',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'codex-thread',
        runtimeId: 'codex' as const,
        title: 'Codex thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'hello from codex' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'hello from codex' }]
      }))
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      agentRuntime,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '你好',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('hello from codex')
    })
    expect(JSON.parse(responseBody).reply).toContain('Claw IM commands:')
    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Claw IM:WeChat] webhook'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'codex-thread',
      text: expect.stringContaining('你好'),
      displayText: '你好'
    }))
    expect(agentRuntime.readThread).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'codex-thread'
    })
    expect(current().claw.channels[0]).toMatchObject({
      runtimeId: 'codex',
      threadId: 'kun-thread',
      agentThreadIds: {
        kun: 'kun-thread',
        codex: 'codex-thread'
      }
    })
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      localThreadId: '',
      runtimeId: 'codex',
      agentThreadIds: {
        codex: 'codex-thread'
      }
    })
  })

  it('returns an empty-response failure when a Codex IM turn completes without assistant text', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.claw.im.enabled = true
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex IM',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async () => ({
          threadId: 'codex-thread',
          turnId: 'codex-turn'
        })),
        readThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex thread',
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: 1,
          turns: [{
            id: 'codex-turn',
            threadId: 'codex-thread',
            status: 'completed' as const,
            items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
          }],
          items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
        }))
      }
      const runtime = createClawRuntime({
        store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
        runtimeRequest: vi.fn() as never,
        agentRuntime,
        logError: () => undefined
      })

      const resultPromise = (runtime as unknown as {
        runPrompt: (
          settingsArg: AppSettingsV1,
          options: {
            prompt: string
            title: string
            workspaceRoot: string
            model: string
            mode: 'agent' | 'plan'
            waitForResult: boolean
            responseTimeoutMs: number
            source: 'task' | 'im'
            runtimeId: 'codex'
          }
        ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
      }).runPrompt(settings, {
        prompt: 'hello',
        title: 'demo',
        workspaceRoot: '/tmp/workspace',
        model: 'auto',
        mode: 'agent',
        waitForResult: true,
        responseTimeoutMs: 10_000,
        source: 'im',
        runtimeId: 'codex'
      })

      await vi.advanceTimersByTimeAsync(1_500)

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        message: 'Agent completed without a reply.',
        failureKind: 'empty_response'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not block the IM queue when timed-out Codex interrupt never resolves', async () => {
    vi.useFakeTimers()
    try {
      const settings = buildSettings()
      settings.activeAgentRuntime = 'codex'
      settings.claw.im.enabled = true
      const logError = vi.fn()
      const agentRuntime = {
        startThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex IM',
          updatedAt: '2026-06-02T00:00:00.000Z'
        })),
        startTurn: vi.fn(async () => ({
          threadId: 'codex-thread',
          turnId: 'codex-turn'
        })),
        readThread: vi.fn(async () => ({
          id: 'codex-thread',
          runtimeId: 'codex' as const,
          title: 'Codex thread',
          updatedAt: '2026-06-02T00:00:00.000Z',
          latestSeq: 1,
          turns: [{
            id: 'codex-turn',
            threadId: 'codex-thread',
            status: 'running' as const,
            items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
          }],
          items: [{ id: 'user-1', kind: 'user_message' as const, text: 'hello' }]
        })),
        interruptTurn: vi.fn(() => new Promise<void>(() => undefined))
      }
      const runtime = createClawRuntime({
        store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
        runtimeRequest: vi.fn() as never,
        agentRuntime,
        logError
      })

      const resultPromise = (runtime as unknown as {
        runPrompt: (
          settingsArg: AppSettingsV1,
          options: {
            prompt: string
            title: string
            workspaceRoot: string
            model: string
            mode: 'agent' | 'plan'
            waitForResult: boolean
            responseTimeoutMs: number
            source: 'task' | 'im'
            runtimeId: 'codex'
          }
        ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
      }).runPrompt(settings, {
        prompt: 'hello',
        title: 'demo',
        workspaceRoot: '/tmp/workspace',
        model: 'auto',
        mode: 'agent',
        waitForResult: true,
        responseTimeoutMs: 1,
        source: 'im',
        runtimeId: 'codex'
      })

      await vi.advanceTimersByTimeAsync(1_500)
      await vi.advanceTimersByTimeAsync(5_000)

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        message: 'Timed out waiting for agent response.',
        failureKind: 'timeout'
      })
      expect(logError).toHaveBeenCalledWith(
        'claw-runtime',
        'Failed to interrupt timed out agent turn.',
        expect.objectContaining({
          runtimeId: 'codex',
          threadId: 'codex-thread',
          turnId: 'codex-turn',
          message: 'Timed out interrupting agent turn.'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a conversation-bound Codex thread for an unbound phone conversation instead of following desktop or channel focus', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: { codex: 'last-channel-thread' },
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected legacy runtimeRequest path ${path}`)
    })
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'new-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'new-codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'new-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'new-codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
      }))
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '从手机继续当前会话',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'new-codex-thread',
      reply: expect.stringContaining('phone reply')
    })
    expect(agentRuntime.startThread).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      workspace: '/tmp/workspace',
      title: '[Claw IM:WeChat] webhook'
    }))
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'new-codex-thread',
      text: expect.stringContaining('从手机继续当前会话'),
      displayText: '从手机继续当前会话'
    }))
    expect(agentRuntime.startTurn).not.toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'last-channel-thread'
    }))
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'new-codex-thread',
      runtimeId: 'codex'
    })
    expect(current().claw.channels[0]).toMatchObject({
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-codex-thread' }
    })
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'wx_user_1',
      latestMessageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'new-codex-thread' },
      workspaceRoot: '/tmp/workspace'
    })
  })

  it('serializes Feishu private messages with per-message remote thread ids on one local conversation', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 3_500
    settings.claw.channels = [buildChannel({
      provider: 'feishu' as const,
      id: 'channel_feishu',
      label: 'Feishu',
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: {},
      conversations: []
    })]
    const { current, store } = mutableSettingsStore(settings)
    let createdThreads = 0
    let turns = 0
    const agentRuntime = {
      startThread: vi.fn(async () => {
        createdThreads += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return {
          id: `phone-thread-${createdThreads}`,
          runtimeId: 'codex' as const,
          title: 'Phone thread',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      }),
      startTurn: vi.fn(async (input: { threadId: string }) => {
        turns += 1
        return {
          threadId: input.threadId,
          turnId: `turn-${turns}`
        }
      }),
      readThread: vi.fn(async ({ threadId }: { threadId: string }) => ({
        id: threadId,
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 2,
        turns: [
          {
            id: 'turn-1',
            threadId,
            status: 'completed' as const,
            items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'reply to Q1' }]
          },
          {
            id: 'turn-2',
            threadId,
            status: 'completed' as const,
            items: [{ id: 'assistant-2', kind: 'assistant_message' as const, text: 'reply to Q2' }]
          }
        ],
        items: [
          { id: 'assistant-1', kind: 'assistant_message' as const, text: 'reply to Q1' },
          { id: 'assistant-2', kind: 'assistant_message' as const, text: 'reply to Q2' }
        ]
      }))
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      agentRuntime,
      notifyChannelActivity: vi.fn(),
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })

    const [first, second] = await Promise.all([
      runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'Q1',
        sender: 'Alice',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_private_chat',
          messageId: 'om_q1',
          threadId: 'om_q1_remote_thread',
          senderId: 'ou_alice',
          senderName: 'Alice'
        }
      }),
      runtime.handleIncomingImMessage({
        provider: 'feishu',
        channelId: 'channel_feishu',
        text: 'Q2',
        sender: 'Alice',
        chatType: 'p2p',
        remoteSession: {
          chatId: 'oc_private_chat',
          messageId: 'om_q2',
          threadId: 'om_q2_remote_thread',
          senderId: 'ou_alice',
          senderName: 'Alice'
        }
      })
    ])

    expect(first).toMatchObject({ ok: true, threadId: 'phone-thread-1', reply: expect.stringContaining('reply to Q1') })
    expect(second).toMatchObject({ ok: true, threadId: 'phone-thread-1', reply: expect.stringContaining('reply to Q2') })
    expect(agentRuntime.startThread).toHaveBeenCalledTimes(1)
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(1, expect.objectContaining({
      threadId: 'phone-thread-1',
      displayText: 'Q1'
    }))
    expect(agentRuntime.startTurn).toHaveBeenNthCalledWith(2, expect.objectContaining({
      threadId: 'phone-thread-1',
      displayText: 'Q2'
    }))
    expect(current().claw.channels[0].conversations).toHaveLength(1)
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      chatId: 'oc_private_chat',
      remoteThreadId: '',
      latestMessageId: 'om_q2',
      agentThreadIds: { codex: 'phone-thread-1' }
    })
    expect(current().claw.channels[0].recentMessages).toEqual([
      expect.objectContaining({
        messageId: 'om_q1',
        senderName: 'Alice',
        text: 'Q1'
      }),
      expect.objectContaining({
        messageId: 'om_q2',
        senderName: 'Alice',
        text: 'Q2'
      })
    ])
  })

  it('continues an existing phone conversation mapping instead of rebinding to active desktop focus', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: {},
      conversations: [{
        id: 'conversation-1',
        chatId: 'wx_user_1',
        remoteThreadId: '',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: '',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'stale-phone-thread' },
        workspaceRoot: '/tmp/old-phone-workspace',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path) => {
      throw new Error(`unexpected legacy runtimeRequest path ${path}`)
    })
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected new thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'stale-phone-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'stale-phone-thread',
        runtimeId: 'codex' as const,
        title: 'Phone thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'stale-phone-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'phone reply' }]
      }))
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: 'desktop-thread-1',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '继续电脑端这个话题',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'stale-phone-thread',
      reply: expect.stringContaining('phone reply')
    })
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: 'codex',
      threadId: 'stale-phone-thread',
      text: expect.stringContaining('继续电脑端这个话题'),
      displayText: '继续电脑端这个话题'
    }))
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'stale-phone-thread',
      runtimeId: 'codex'
    })
    expect(current().claw.channels[0].conversations).toHaveLength(1)
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      id: 'conversation-1',
      latestMessageId: 'wx_msg_2',
      runtimeId: 'codex',
      agentThreadIds: { codex: 'stale-phone-thread' },
      workspaceRoot: '/tmp/old-phone-workspace'
    })
  })

  it('keeps a reconnected phone conversation on its stored runtime instead of using active desktop runtime', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      runtimeId: 'kun',
      threadId: 'stale-kun-channel-thread',
      agentThreadIds: { kun: 'stale-kun-channel-thread' },
      conversations: [{
        id: 'conversation-1',
        chatId: 'wx_user_1',
        remoteThreadId: '',
        latestMessageId: 'wx_msg_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'stale-kun-conversation-thread',
        runtimeId: 'kun',
        agentThreadIds: { kun: 'stale-kun-conversation-thread' },
        workspaceRoot: '/tmp/old-phone-workspace',
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }]
    })]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/stale-kun-conversation-thread/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'kun-turn' }) }
      }
      if (path === '/v1/threads/stale-kun-conversation-thread' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'stale-kun-conversation-thread',
            status: 'idle',
            turns: [{
              id: 'kun-turn',
              status: 'completed',
              items: [{ kind: 'assistant_text', text: 'stored runtime reply' }]
            }]
          })
        }
      }
      throw new Error(`unexpected legacy runtimeRequest path ${path}`)
    })
    const notifyChannelActivity = vi.fn()
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'unexpected-new-thread',
        runtimeId: 'codex' as const,
        title: 'Unexpected new thread',
        updatedAt: '2026-06-02T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'desktop-codex-thread',
        turnId: 'codex-turn'
      })),
      readThread: vi.fn(async () => ({
        id: 'desktop-codex-thread',
        runtimeId: 'codex' as const,
        title: 'Desktop Codex thread',
        updatedAt: '2026-06-02T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'codex-turn',
          threadId: 'desktop-codex-thread',
          status: 'completed' as const,
          items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'new process reply' }]
        }],
        items: [{ id: 'assistant-1', kind: 'assistant_message' as const, text: 'new process reply' }]
      }))
    }
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      agentRuntime,
      getActiveThreadContext: () => ({
        threadId: 'desktop-codex-thread',
        runtimeId: 'codex',
        workspaceRoot: '/tmp/workspace'
      }),
      notifyChannelActivity,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: '第二次连接新的本地进程',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_3',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      threadId: 'stale-kun-conversation-thread',
      reply: expect.stringContaining('stored runtime reply')
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      '/v1/threads/stale-kun-conversation-thread/turns',
      expect.objectContaining({ method: 'POST' }),
      'kun'
    )
    expect(agentRuntime.startThread).not.toHaveBeenCalled()
    expect(agentRuntime.startTurn).not.toHaveBeenCalled()
    expect(notifyChannelActivity).toHaveBeenCalledWith({
      channelId: 'channel_weixin',
      threadId: 'stale-kun-conversation-thread',
      runtimeId: 'kun'
    })
    expect(current().claw.channels[0]).toMatchObject({
      runtimeId: 'kun',
      threadId: 'stale-kun-conversation-thread',
      agentThreadIds: {
        kun: 'stale-kun-conversation-thread'
      }
    })
    expect(current().claw.channels[0].conversations[0]).toMatchObject({
      id: 'conversation-1',
      latestMessageId: 'wx_msg_3',
      runtimeId: 'kun',
      localThreadId: 'stale-kun-conversation-thread',
      agentThreadIds: {
        kun: 'stale-kun-conversation-thread'
      },
      workspaceRoot: '/tmp/old-phone-workspace'
    })
  })

  it('waits for the current WeChat turn to complete before returning the final reply', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_500
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: '',
      conversations: []
    })]
    const { store } = mutableSettingsStore(settings)
    let getCount = 0
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads' && init?.method === 'POST') {
        return { ok: true, status: 201, body: JSON.stringify({ id: 'thr_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'PATCH') {
        return { ok: true, status: 200, body: '{}' }
      }
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_weixin' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        getCount += 1
        return {
          ok: true,
          status: 200,
          body: JSON.stringify(getCount === 1
            ? {
                id: 'thr_weixin',
                status: 'running',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous reply' }]
                  },
                  {
                    id: 'turn_weixin',
                    status: 'running',
                    items: [
                      { kind: 'assistant_text', text: 'intermediate reply' },
                      { kind: 'tool_call', detail: 'checking disk usage' }
                    ]
                  }
                ]
              }
            : {
                id: 'thr_weixin',
                status: 'idle',
                turns: [
                  {
                    id: 'turn_previous',
                    status: 'completed',
                    items: [{ kind: 'assistant_text', text: 'previous reply' }]
                  },
                  {
                    id: 'turn_weixin',
                    status: 'completed',
                    items: [
                      { kind: 'assistant_text', text: 'intermediate reply' },
                      { kind: 'tool_result', detail: 'tool finished' },
                      { kind: 'assistant_text', text: 'final result' }
                    ]
                  }
                ]
              })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'clean disk',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_1',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(200)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: true,
      reply: expect.stringContaining('final result')
    })
    expect(JSON.parse(responseBody).reply).toContain('Claw IM commands:')
    expect(getCount).toBe(2)
  })

  it('does not return a previous WeChat session reply for a new turn', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 10
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous reply' }]
              },
              {
                id: 'turn_current',
                status: 'completed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Agent completed without a reply.',
      failureKind: 'empty_response'
    })
  })

  it('interrupts timed out agent runtime turns so phone duty does not stay running', async () => {
    const settings = buildSettings()
    const interruptTurn = vi.fn(async () => undefined)
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      agentRuntime: {
        readThread: vi.fn(async () => ({
          id: 'thread-1',
          runtimeId: 'codex' as const,
          title: 'Thread',
          updatedAt: '2026-06-12T00:00:00.000Z',
          latestSeq: 1,
          turns: [{ id: 'turn-1', threadId: 'thread-1', status: 'running' as const, items: [] }],
          items: []
        })),
        interruptTurn
      } as never,
      logError: () => undefined
    })

    await expect((runtime as unknown as {
      waitForAgentRuntimeAssistantResult: (
        threadId: string,
        turnId: string,
        timeoutMs: number,
        workspaceRoot: string,
        runtimeId: 'codex'
      ) => Promise<unknown>
    }).waitForAgentRuntimeAssistantResult(
      'thread-1',
      'turn-1',
      0,
      '/tmp/workspace',
      'codex'
    )).rejects.toThrow('Timed out waiting for agent response.')

    expect(interruptTurn).toHaveBeenCalledWith({
      runtimeId: 'codex',
      threadId: 'thread-1',
      turnId: 'turn-1',
      discard: true
    })
  })

  it('returns waiting desktop approval when an agent runtime turn is blocked on approval', async () => {
    const settings = buildSettings()
    settings.activeAgentRuntime = 'codex'
    const agentRuntime = {
      startThread: vi.fn(async () => ({
        id: 'thread-approval',
        runtimeId: 'codex' as const,
        title: 'Thread',
        updatedAt: '2026-06-12T00:00:00.000Z'
      })),
      startTurn: vi.fn(async () => ({
        threadId: 'thread-approval',
        turnId: 'turn-approval'
      })),
      readThread: vi.fn(async () => ({
        id: 'thread-approval',
        runtimeId: 'codex' as const,
        title: 'Thread',
        updatedAt: '2026-06-12T00:00:00.000Z',
        latestSeq: 1,
        turns: [{
          id: 'turn-approval',
          threadId: 'thread-approval',
          status: 'running' as const,
          items: [{
            id: 'approval-1',
            kind: 'approval' as const,
            status: 'pending' as const,
            summary: 'Command approval requested'
          }]
        }],
        items: []
      }))
    }
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      agentRuntime: agentRuntime as never,
      logError: () => undefined
    })

    const result = await (runtime as unknown as {
      runPrompt: (
        settingsArg: AppSettingsV1,
        options: {
          prompt: string
          title: string
          workspaceRoot: string
          model: string
          mode: 'agent' | 'plan'
          waitForResult: boolean
          responseTimeoutMs: number
          source: 'task' | 'im'
          runtimeId: 'codex'
        }
      ) => Promise<{ ok: boolean; message?: string; failureKind?: string }>
    }).runPrompt(settings, {
      prompt: 'needs approval',
      title: 'approval demo',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      mode: 'agent',
      waitForResult: true,
      responseTimeoutMs: 2_000,
      source: 'im',
      runtimeId: 'codex'
    })

    expect(result).toMatchObject({
      ok: false,
      message: 'Waiting for desktop approval before Claw can continue.',
      failureKind: 'waiting_desktop_approval'
    })
  })

  it('does not return historical WeChat text when the current turn fails', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      label: 'WeChat',
      threadId: 'thr_weixin',
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        latestMessageId: 'wx_previous',
        senderId: 'wx_user_1',
        senderName: 'Alice',
        localThreadId: 'thr_weixin'
      })]
    })]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_weixin/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_current' }) }
      }
      if (path === '/v1/threads/thr_weixin' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_weixin',
            status: 'idle',
            turns: [
              {
                id: 'turn_previous',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: 'previous reply' }]
              },
              {
                id: 'turn_current',
                status: 'failed',
                items: []
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    const body = JSON.stringify({
      text: 'new question',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_2',
      senderId: 'wx_user_1',
      senderName: 'Alice'
    })
    const req = {
      method: 'POST',
      url: settings.claw.im.path,
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(body)
      }
    }
    let status = 0
    let responseBody = ''
    const res = {
      writeHead: vi.fn((nextStatus: number) => {
        status = nextStatus
      }),
      end: vi.fn((payload: string) => {
        responseBody = payload
      })
    }

    await (runtime as unknown as {
      handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
    }).handleWebhook(req, res)

    expect(status).toBe(500)
    expect(JSON.parse(responseBody)).toMatchObject({
      ok: false,
      message: 'Agent turn failed.'
    })
  })

  it('mirrors local Claw thread messages back to the bundled WeChat bridge', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'wx_out_1'
    }))
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'hello from local', 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledWith({
      accountId: 'wx_account',
      to: 'wx_user_1',
      text: 'hello from local'
    })
  })

  it('splits long mirrored WeChat messages by provider limits', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'wx_out'
    }))
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'w'.repeat(2_100), 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendWeixinBridgeMessage).toHaveBeenCalledTimes(2)
    const calls = sendWeixinBridgeMessage.mock.calls as unknown as Array<[{
      accountId: string
      to: string
      text: string
    }]>
    for (const [payload] of calls) {
      expect(payload.text.length).toBeLessThanOrEqual(CLAW_IM_PROVIDER_CAPABILITIES.weixin.maxMessageLength)
    }
  })

  it('splits long mirrored Discord messages by provider limits', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'discord' as const,
      id: 'channel_discord',
      threadId: 'thr_discord',
      platformCredential: {
        kind: 'discord',
        applicationId: 'app_1',
        botId: 'bot_1',
        botUsername: 'DeepSeek',
        guildId: 'guild_1',
        guildName: 'Guild',
        channelId: 'discord_channel_1',
        channelName: 'support',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'discord_channel_1',
        localThreadId: 'thr_discord'
      })]
    })]
    const sendDiscordChannelMessage = vi.fn(async () => ({
      ok: true as const,
      messageId: 'discord_out'
    }))
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined,
      sendDiscordChannelMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_discord', 'd'.repeat(2_100), 'assistant')

    expect(result).toEqual({ ok: true })
    expect(sendDiscordChannelMessage).toHaveBeenCalledTimes(2)
    const calls = sendDiscordChannelMessage.mock.calls as unknown as Array<[{
      channelId: string
      text: string
    }]>
    for (const [payload] of calls) {
      expect(payload.text.length).toBeLessThanOrEqual(CLAW_IM_PROVIDER_CAPABILITIES.discord.maxMessageLength)
    }
  })

  it('returns and records provider send failures when mirroring to WeChat fails', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel({
      provider: 'weixin' as const,
      id: 'channel_weixin',
      threadId: 'thr_weixin',
      platformCredential: {
        kind: 'weixin',
        accountId: 'wx_account',
        sessionKey: 'wx_session',
        createdAt: '2026-06-02T00:00:00.000Z'
      },
      conversations: [buildConversation({
        chatId: 'wx_user_1',
        localThreadId: 'thr_weixin'
      })]
    })]
    const logError = vi.fn()
    const sendWeixinBridgeMessage = vi.fn(async () => ({
      ok: false as const,
      message: 'bridge offline'
    }))
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError,
      sendWeixinBridgeMessage
    })

    const result = await runtime.mirrorThreadMessageToIm('thr_weixin', 'hello from local', 'assistant')

    expect(result).toMatchObject({
      ok: false,
      message: 'WeChat send failed: bridge offline',
      failureKind: 'provider_send_failed'
    })
    expect(logError).toHaveBeenCalledWith(
      'claw-weixin',
      'Failed to mirror Claw message to WeChat',
      expect.objectContaining({
        failureKind: 'provider_send_failed',
        message: 'WeChat send failed: bridge offline'
      })
    )
  })

  it('sends the latest generated workspace file to Feishu when the user asks for it', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-file-'))
    const filePath = join(workspaceRoot, 'hello.md')
    await writeFile(filePath, '# Hello\n')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      const conversation: ClawImConversationV1 = {
        id: 'conv_1',
        chatId: 'oc_chat_a',
        remoteThreadId: '',
        latestMessageId: 'om_previous',
        senderId: 'ou_1',
        senderName: 'Alice',
        localThreadId: 'thr_1',
        workspaceRoot,
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      const channel: ClawImChannelV1 = {
        id: 'channel_1',
        provider: 'feishu' as const,
        label: 'Phone',
        enabled: true,
        model: 'auto',
        threadId: '',
        workspaceRoot,
        agentProfile: {
          name: 'kun',
          description: '',
          identity: '',
          personality: '',
          userContext: '',
          replyRules: ''
        },
        conversations: [conversation],
        createdAt: '2026-06-02T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z'
      }
      settings.claw.channels = [channel]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1/turns') {
          return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_2' }) }
        }
        if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_1',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolKind: 'file_change',
                      output: {
                        path: filePath,
                        relative_path: 'hello.md',
                        bytes_written: 8
                      },
                      isError: false
                    }
                  ]
                },
                {
                  id: 'turn_2',
                  status: 'completed',
                  items: [
                    {
                      kind: 'assistant_text',
                      text: '我无法直接通过飞书发送文件给你，但文件已经创建在 workspace 中。'
                    }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_file_1')
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          threadId?: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '发给我',
        rawContentType: 'text',
        mentions: []
      })

      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { markdown: '可以，我把 hello.md 作为附件发给你。' },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'hello.md' } },
        { replyTo: 'om_inbound', replyInThread: false }
      )
      // The direct-file path is fast (synchronous file lookup + upload) and
      // The direct-file path is fast (synchronous file lookup + upload) and
      // must NOT add a pending reaction — that would be visually noisy.
      const addReactionSpy = (runtime as unknown as { feishuChannels: Map<string, { addReaction: ReturnType<typeof vi.fn> }> })
        .feishuChannels.get('channel_1')?.addReaction
      expect(addReactionSpy).not.toHaveBeenCalled()
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('sends agent reply containing markdown as Feishu / Lark markdown', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const markdownReply = '**bold** `code`\n- item 1\n- item 2'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_md' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_md',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: markdownReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const send = vi.fn(async () => ({ messageId: 'om_md' }))
    const addReaction = vi.fn(async () => 'rc_test_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'tell me a story',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction is added on the user's inbound message BEFORE
    // the agent reply is sent.
    expect(addReaction).toHaveBeenCalledWith('om_inbound', 'OnIt')
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: markdownReply },
      { replyTo: 'om_inbound', replyInThread: false }
    )
    const textFormCall = (send.mock.calls as unknown as Array<[string, Record<string, unknown>]>)
      .find(([, input]) => typeof input?.text === 'string')
    expect(textFormCall).toBeUndefined()
  })

  it('falls back to markdown form when retrying without replyTo', async () => {
    const settings = buildSettings()
    const logError = vi.fn()
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('reply permission denied'))
      .mockResolvedValueOnce({ messageId: 'om_fallback' })
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError
    })

    const result = await (runtime as unknown as {
      sendFeishuMessage: (
        bridge: { send: typeof send },
        to: string,
        input: { markdown: string },
        options: { replyTo?: string; replyInThread?: boolean },
        context: Record<string, unknown>
      ) => Promise<{ messageId: string }>
    }).sendFeishuMessage(
      { send },
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true },
      { purpose: 'agent-reply', channelId: 'channel_1' }
    )

    expect(result).toEqual({ messageId: 'om_fallback' })
    expect(send).toHaveBeenNthCalledWith(
      1,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: 'om_inbound', replyInThread: true }
    )
    expect(send).toHaveBeenNthCalledWith(
      2,
      'oc_chat_a',
      { markdown: '**hello**' },
      { replyTo: undefined, replyInThread: undefined }
    )
  })

  it('continues agent flow when pending reaction add fails', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const logError = vi.fn()
    const agentReply = 'all good'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_react_fail' }) }
      }
      if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_1',
            status: 'idle',
            turns: [
              {
                id: 'turn_react_fail',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: agentReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const addReaction = vi.fn().mockRejectedValue(new Error('addReaction API error'))
    const send = vi.fn(async () => ({ messageId: 'om_agent_after_react_fail' }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_react_fail',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'do something',
      rawContentType: 'text',
      mentions: []
    })

    // The pending reaction failure must be logged and swallowed.
    expect(logError).toHaveBeenCalledWith(
      'claw-feishu',
      expect.stringContaining('pending reaction'),
      expect.objectContaining({
        message: 'addReaction API error',
        chatId: 'oc_chat_a',
        messageId: 'om_inbound_react_fail'
      })
    )
    // The agent reply is still dispatched despite the reaction failure.
    expect(send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: agentReply },
      { replyTo: 'om_inbound_react_fail', replyInThread: false }
    )
  })

  it('does not add a pending reaction for IM commands', async () => {
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.channels = [buildChannel()]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const send = vi.fn(async () => ({ messageId: 'om_cmd' }))
    const addReaction = vi.fn(async () => 'rc_cmd_1')
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
      .feishuChannels
      .set('channel_1', { send, addReaction })

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: {
        chatId: string
        messageId: string
        threadId?: string
        senderId: string
        senderName?: string
        chatType: 'p2p' | 'group'
        mentionedBot: boolean
        mentionAll: boolean
        content: string
        rawContentType: string
        mentions: unknown[]
      }) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_cmd',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: '/help',
      rawContentType: 'text',
      mentions: []
    })

    // /help produces a single IM command reply; no pending reaction.
    expect(send).toHaveBeenCalledTimes(1)
    expect(addReaction).not.toHaveBeenCalled()
  })
})
