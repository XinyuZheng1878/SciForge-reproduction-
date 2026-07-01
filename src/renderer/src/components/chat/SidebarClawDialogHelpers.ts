export type ClawInstallTarget = 'feishu' | 'lark' | 'weixin'

export type ClawInstallQrState = {
  status: 'idle' | 'loading' | 'showing' | 'success' | 'error'
  url: string
  deviceCode: string
  userCode: string
  timeLeft: number
  error: string
}

export function formatClawInstallError(
  message: string,
  t: (k: string, opts?: Record<string, unknown>) => string
): string {
  const value = message.trim()
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

export function clawInstallTargetLabel(
  t: (k: string, opts?: Record<string, unknown>) => string,
  target: ClawInstallTarget
): string {
  if (target === 'weixin') return t('clawAddImTargetWeixin')
  return target === 'lark' ? t('clawAddImTargetLark') : t('clawAddImTargetFeishu')
}
