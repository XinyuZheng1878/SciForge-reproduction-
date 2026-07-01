import { describe, expect, it } from 'vitest'
import { formatConnectPhoneInstallError } from './ConnectPhoneDialogHelpers'

describe('ConnectPhoneDialogHelpers', () => {
  it('formats WeChat bridge errors without preserving legacy gateway text', () => {
    const t = (key: string) => `translated:${key}`

    expect(formatConnectPhoneInstallError('WeChat login bridge is unavailable.', t)).toBe(
      'translated:connectPhoneWeixinBridgeMissing'
    )
    expect(formatConnectPhoneInstallError('OpenClaw Gateway is unavailable.', t)).toBe(
      'translated:connectPhoneWeixinBridgeMissing'
    )
  })
})
