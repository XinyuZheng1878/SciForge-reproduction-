import { getModelRouterSettings, type AppSettingsV1 } from '../shared/app-settings'

export type ModelRouterHealthStatus =
  | 'healthy'
  | 'not_configured'
  | 'unavailable'
  | 'provider_auth_blocked'

export type ModelRouterHealthResult =
  | { ok: true; status: 'healthy'; message: string }
  | { ok: false; status: Exclude<ModelRouterHealthStatus, 'healthy'>; message: string }

export async function checkModelRouterHealth(
  settings: AppSettingsV1,
  options: {
    fetchImpl?: typeof fetch
  } = {}
): Promise<ModelRouterHealthResult> {
  const router = getModelRouterSettings(settings)
  if (!router.enabled) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Model Router is disabled'
    }
  }
  if (!router.baseUrl.trim() || !router.runtimeApiKey.trim() || !router.publicModelAlias.trim()) {
    return {
      ok: false,
      status: 'not_configured',
      message: 'Model Router URL, runtime API key, and public model alias are required'
    }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(modelRouterManagementUrl(router.baseUrl, '/healthz'), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(5_000)
    })
    if (response.ok) {
      return {
        ok: true,
        status: 'healthy',
        message: 'Model Router is healthy'
      }
    }
    const body = await safeResponseText(response)
    const status = classifyHealthzFailure(response.status, body)
    return {
      ok: false,
      status,
      message: status === 'provider_auth_blocked'
        ? 'Model Router provider credentials are unavailable or blocked'
        : 'Model Router health check failed'
    }
  } catch {
    return {
      ok: false,
      status: 'unavailable',
      message: 'Model Router is unavailable'
    }
  }
}

export function modelRouterManagementUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  const managementBase = trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed
  return `${managementBase}${path.startsWith('/') ? path : `/${path}`}`
}

function classifyHealthzFailure(status: number, body: string): Exclude<ModelRouterHealthStatus, 'healthy' | 'not_configured'> {
  if (status === 401 || status === 403) return 'provider_auth_blocked'
  if (/missing_secret|provider-auth|provider_auth|provider_http_40[13]|unauthenticated|unauthorized|forbidden/i.test(body)) {
    return 'provider_auth_blocked'
  }
  return 'unavailable'
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
