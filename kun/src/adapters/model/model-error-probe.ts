export type DeepSeekProbeResult = {
  reachable: boolean
  status?: number
  message: string
}

const LOCAL_MODEL_ROUTER_BASE_URL = 'http://127.0.0.1:3892/v1'

export function isDeepSeekHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.deepseek.com' || host.endsWith('.deepseek.com')
  } catch {
    return false
  }
}

export async function probeDeepSeekReachable(input: {
  baseUrl: string
  fetchImpl: typeof fetch
}): Promise<DeepSeekProbeResult> {
  const url = probeUrl(input.baseUrl)
  if (!url) {
    return {
      reachable: false,
      message: 'Local model router probe skipped: base URL is not local.'
    }
  }
  try {
    const response = await input.fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json, text/plain, */*' }
    })
    return {
      reachable: response.status < 500,
      status: response.status,
      message: response.status < 500
        ? `Local model router is reachable (probe status ${response.status}).`
        : `Local model router probe returned ${response.status}.`
    }
  } catch (error) {
    return {
      reachable: false,
      message: `Local model router probe failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function probeUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return `${LOCAL_MODEL_ROUTER_BASE_URL}/models`
  try {
    const url = new URL(trimmed)
    if (!isLocalHost(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.at(-1)?.toLowerCase() === 'models') {
      url.search = ''
      return url.toString()
    }
    if (parts.at(-1)?.toLowerCase() === 'beta' || /^v\d+$/i.test(parts.at(-1) ?? '')) {
      parts.pop()
    }
    url.pathname = `/${[...parts, 'v1', 'models'].join('/')}`
    url.search = ''
    return url.toString()
  } catch {
    return `${LOCAL_MODEL_ROUTER_BASE_URL}/models`
  }
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}
