import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import {
  configureWeixinBridgeRuntimeContextProvider,
  weixinBridgeRuntimeInternals
} from './weixin-bridge-runtime'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/sciforge-test-user-data',
    getVersion: () => '0.2.0-test'
  }
}))

const requireFromTest = createRequire(import.meta.url)

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  if (Array.isArray(headers)) return Object.fromEntries(headers)
  return { ...headers }
}

describe('weixin bridge runtime', () => {
  afterEach(() => {
    configureWeixinBridgeRuntimeContextProvider(null)
    vi.unstubAllGlobals()
  })

  it('builds WeChat base_info from the bundled WeChat plugin package', () => {
    const pkg = requireFromTest('@tencent-weixin/openclaw-weixin/package.json') as {
      version: string
    }
    const baseInfo = weixinBridgeRuntimeInternals.buildBaseInfo()

    expect(baseInfo).toMatchObject({
      channel_version: pkg.version,
      bot_agent: 'SciForge/0.2.0-test'
    })
  })

  it('keeps OpenClaw-compatible account id normalization for existing WeChat state files', () => {
    const { normalizeAccountId } = weixinBridgeRuntimeInternals

    expect(normalizeAccountId('b0f5860fdecb@im.bot')).toBe('b0f5860fdecb-im-bot')
    expect(normalizeAccountId('ABC@IM.WECHAT')).toBe('abc-im-wechat')
    expect(normalizeAccountId('')).toBe('default')
    expect(normalizeAccountId('__proto__')).toBe('default')
  })

  it('does not expose the removed OpenClaw adapter builders', () => {
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('buildGuiManagedOpenClawConfig')
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('buildWeixinBridgeAdapterSource')
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('parseNodeVersion')
  })

  it('extracts at most three generated files from webhook replies for WeChat media delivery', () => {
    const { webhookGeneratedFiles } = weixinBridgeRuntimeInternals

    expect(webhookGeneratedFiles({
      files: [
        { path: '/tmp/workspace/a.png', fileName: 'a.png' },
        { path: '/tmp/workspace/b.pdf' },
        { path: '', fileName: 'skip.txt' },
        { path: '/tmp/workspace/c.md', fileName: 'c.md' },
        { path: '/tmp/workspace/d.md', fileName: 'd.md' }
      ]
    })).toEqual([
      { path: '/tmp/workspace/a.png', fileName: 'a.png' },
      { path: '/tmp/workspace/b.pdf', fileName: 'b.pdf' },
      { path: '/tmp/workspace/c.md', fileName: 'c.md' }
    ])
  })

  it('keeps WeChat sender dispatch ordered while sending queued feedback immediately', async () => {
    const { enqueueWeixinSenderDispatch } = weixinBridgeRuntimeInternals
    const senderChains = new Map<string, Promise<void>>()
    const events: string[] = []
    let releaseFirst: () => void = () => undefined
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const common = {
      to: 'wx_user_1',
      senderChains,
      signal: new AbortController().signal,
      sendStatus: async (text: string) => {
        events.push(`status:${text}`)
      },
      onFailure: (message: string) => {
        events.push(`failure:${message}`)
      }
    }

    const first = enqueueWeixinSenderDispatch({
      ...common,
      run: async () => {
        events.push('run:first:start')
        await firstDone
        events.push('run:first:end')
      }
    })
    await vi.waitFor(() => {
      expect(events).toContain('run:first:start')
    })

    const second = enqueueWeixinSenderDispatch({
      ...common,
      run: async () => {
        events.push('run:second')
      }
    })
    await vi.waitFor(() => {
      expect(events).toContain('status:已收到，前一条消息还在处理中，这条已排队。')
    })
    expect(events).not.toContain('run:second')

    releaseFirst()
    await Promise.all([first, second])

    expect(events).toEqual([
      'status:已收到，正在处理。',
      'run:first:start',
      'status:已收到，前一条消息还在处理中，这条已排队。',
      'run:first:end',
      'status:已收到，正在处理。',
      'run:second'
    ])
  })

  it('posts webhook messages with the current SciForge secret header only', async () => {
    configureWeixinBridgeRuntimeContextProvider(async () => ({
      webhookUrl: 'http://127.0.0.1:8787/claw/im',
      webhookSecret: 'bridge-secret',
      channelId: 'channel_weixin'
    }))
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(
      JSON.stringify({ ok: true, reply: 'ok' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(weixinBridgeRuntimeInternals.postToSciForgeWebhook({
      message_id: 'wx_msg_1',
      from_user_id: 'wx_user_1',
      item_list: [{ type: 1, text_item: { text: 'hello' } }]
    }, 'account-1')).resolves.toMatchObject({ ok: true, reply: 'ok' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    expect(headersToRecord(init?.headers)).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer bridge-secret',
      'x-sciforge-secret': 'bridge-secret'
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      provider: 'weixin',
      channelId: 'channel_weixin',
      text: 'hello',
      messageId: 'wx_msg_1'
    })
  })
})
