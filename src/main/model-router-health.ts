import { getModelRouterSettings, type AppSettingsV1 } from '../shared/app-settings'

export type ModelRouterHealthStatus =
  | 'healthy'
  | 'not_configured'
  | 'unavailable'
  | 'provider_auth_blocked'
  | 'provider_network'
  | 'provider_bad_response'
  | 'provider_error'

export type ModelRouterHealthResult =
  | { ok: true; status: 'healthy'; message: string }
  | { ok: false; status: Exclude<ModelRouterHealthStatus, 'healthy'>; message: string }

export async function isModelRouterServiceHealthy(
  settings: AppSettingsV1,
  options: {
    fetchImpl?: typeof fetch
  } = {}
): Promise<boolean> {
  const router = getModelRouterSettings(settings)
  if (!router.enabled || !router.baseUrl.trim()) return false

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(modelRouterManagementUrl(router.baseUrl, '/health'), {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return false
    const text = await safeResponseText(response)
    if (!text.trim()) return true
    const body = JSON.parse(text) as Record<string, unknown>
    return body.ok !== false
  } catch {
    return false
  }
}

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
      message: modelRouterHealthFailureMessage(status)
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

function modelRouterHealthFailureMessage(status: Exclude<ModelRouterHealthStatus, 'healthy' | 'not_configured'>): string {
  switch (status) {
    case 'provider_auth_blocked':
      return 'Model Router provider credentials are unavailable or blocked'
    case 'provider_network':
      return 'Model Router provider network request failed or timed out'
    case 'provider_bad_response':
      return 'Model Router provider returned an invalid response'
    case 'provider_error':
      return 'Model Router provider returned an error'
    case 'unavailable':
      return 'Model Router health check failed'
  }
}

function classifyHealthzFailure(status: number, body: string): Exclude<ModelRouterHealthStatus, 'healthy' | 'not_configured'> {
  if (status === 401 || status === 403) return 'provider_auth_blocked'
  if (/missing_secret|provider-auth|provider_auth|provider_http_40[13]|unauthenticated|unauthorized|forbidden/i.test(body)) {
    return 'provider_auth_blocked'
  }
  if (/provider-network|provider_network|provider_exception_(?:timeout|network|fetch_failed)|timeout|timed out|network/i.test(body)) {
    return 'provider_network'
  }
  if (/provider-bad-response|provider_bad_response|provider_invalid_json|provider_error_payload|invalid response|non-json/i.test(body)) {
    return 'provider_bad_response'
  }
  if (/provider-error|provider_error|provider_http_\d{3}|provider_exception_/i.test(body)) {
    return 'provider_error'
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
