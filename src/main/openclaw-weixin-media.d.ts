declare module '@tencent-weixin/openclaw-weixin/dist/src/messaging/send-media.js' {
  export function sendWeixinMediaFile(params: {
    filePath: string
    to: string
    text: string
    opts: {
      baseUrl: string
      token?: string
      timeoutMs?: number
      contextToken?: string
    }
    cdnBaseUrl: string
  }): Promise<{ messageId: string }>
}
