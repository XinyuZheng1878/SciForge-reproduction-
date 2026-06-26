import { describe, expect, it } from 'vitest'
import {
  clawDefaultAgentName,
  clawDefaultChannelWorkspacePreview,
  formatClawInstallError
} from './SidebarClawDialogHelpers'

describe('SidebarClawDialogHelpers', () => {
  it('uses product default agent names for phone providers', () => {
    expect(clawDefaultAgentName('feishu')).toBe('feishu agent')
    expect(clawDefaultAgentName('lark')).toBe('lark agent')
    expect(clawDefaultAgentName('weixin')).toBe('weixin agent')
  })

  it('formats WeChat bridge errors without preserving OpenClaw compatibility text', () => {
    const t = (key: string) => `translated:${key}`

    expect(formatClawInstallError('WeChat login bridge is unavailable.', t)).toBe(
      'translated:clawAddImWeixinBridgeMissing'
    )
    expect(formatClawInstallError('OpenClaw Gateway is unavailable.', t)).toBe(
      'OpenClaw Gateway is unavailable.'
    )
  })

  it('uses remote-channel as the default workspace namespace for new bindings', () => {
    expect(clawDefaultChannelWorkspacePreview('feishu', 'feishu')).toBe(
      '~/.sciforge/remote-channel/feishu/feishu/<appId-or-channel-id>'
    )
    expect(clawDefaultChannelWorkspacePreview('weixin', 'weixin')).toBe(
      '~/.sciforge/remote-channel/weixin/weixin/<account-id-or-channel-id>'
    )
  })
})
