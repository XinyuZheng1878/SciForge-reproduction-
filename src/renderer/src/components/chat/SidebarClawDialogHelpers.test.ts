import { describe, expect, it } from 'vitest'
import { formatClawInstallError } from './SidebarClawDialogHelpers'

describe('SidebarClawDialogHelpers', () => {
  it('formats WeChat bridge errors without preserving OpenClaw compatibility text', () => {
    const t = (key: string) => `translated:${key}`

    expect(formatClawInstallError('WeChat login bridge is unavailable.', t)).toBe(
      'translated:clawAddImWeixinBridgeMissing'
    )
    expect(formatClawInstallError('OpenClaw Gateway is unavailable.', t)).toBe(
      'OpenClaw Gateway is unavailable.'
    )
  })
})
