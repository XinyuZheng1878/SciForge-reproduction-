import { describe, expect, it } from 'vitest'
import { formatConnectPhoneInstallError } from './SidebarClawDialogHelpers'

describe('SidebarClawDialogHelpers', () => {
  it('formats WeChat bridge errors without preserving OpenClaw compatibility text', () => {
    const t = (key: string) => `translated:${key}`

    expect(formatConnectPhoneInstallError('WeChat login bridge is unavailable.', t)).toBe(
      'translated:clawAddImWeixinBridgeMissing'
    )
    expect(formatConnectPhoneInstallError('OpenClaw Gateway is unavailable.', t)).toBe(
      'translated:clawAddImWeixinBridgeMissing'
    )
  })
})
