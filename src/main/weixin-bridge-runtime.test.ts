import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { weixinBridgeRuntimeInternals } from './weixin-bridge-runtime'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/deepseek-gui-test-user-data',
    getVersion: () => '0.2.0-test'
  }
}))

const requireFromTest = createRequire(import.meta.url)

describe('weixin bridge runtime', () => {
  it('builds WeChat base_info from the bundled WeChat plugin package', () => {
    const pkg = requireFromTest('@tencent-weixin/openclaw-weixin/package.json') as {
      version: string
    }
    const baseInfo = weixinBridgeRuntimeInternals.buildBaseInfo()

    expect(baseInfo).toMatchObject({
      channel_version: pkg.version,
      bot_agent: 'DeepSeekGUI/0.2.0-test'
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
})
