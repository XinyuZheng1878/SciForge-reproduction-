export type ConnectPhoneInstallTarget = 'feishu' | 'lark' | 'weixin'

export type ConnectPhoneInstallQrState = {
  status: 'idle' | 'loading' | 'showing' | 'success' | 'error'
  url: string
  deviceCode: string
  userCode: string
  timeLeft: number
  error: string
}

export function formatConnectPhoneInstallError(
  rawMessage: string,
  t: (k: string, opts?: Record<string, unknown>) => string
): string {
  const value = rawMessage.trim()
  if (
    /WeChat login bridge/i.test(value) ||
    /OpenClaw Gateway/i.test(value) ||
    /^not found$/i.test(value) ||
    /fetch failed/i.test(value) ||
    /ECONNREFUSED/i.test(value) ||
    /HTTP (401|404|503)/i.test(value)
  ) {
    return t('clawAddImWeixinBridgeMissing')
  }
  return value
}

export function connectPhoneInstallTargetLabel(
  t: (k: string, opts?: Record<string, unknown>) => string,
  target: ConnectPhoneInstallTarget
): string {
  if (target === 'weixin') return t('clawAddImTargetWeixin')
  return target === 'lark' ? t('clawAddImTargetLark') : t('clawAddImTargetFeishu')
}
