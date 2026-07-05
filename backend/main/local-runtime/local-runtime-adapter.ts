import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_LOCAL_RUNTIME_DATA_DIR,
  getLocalRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  buildLocalRuntimeServeArgs,
  resolveLocalRuntimeExecutable
} from './resolve-local-runtime-binary'
import {
  isLocalRuntimeChildRunning,
  reclaimLocalRuntimePort,
  startLocalRuntimeChild,
  stopLocalRuntimeChildAndWait
} from './local-runtime-process'
import { getLocalRuntimeBaseUrl } from './local-runtime-base-url'
import type { ManagedRuntimeAdapter } from '../runtime/runtime-adapter'

const SCIFORGE_RUNTIME_ID = 'sciforge' as const

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked')
    : app.getAppPath()
}

export const localRuntimeAdapter: ManagedRuntimeAdapter & {
  resolveExecutable(settings: AppSettingsV1): Promise<string>
  getBaseUrl(settings: AppSettingsV1): string
  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }>
} = {
  id: SCIFORGE_RUNTIME_ID,

  async resolveExecutable(settings: AppSettingsV1): Promise<string> {
    const runtime = getLocalRuntimeSettings(settings)
    const resolution = resolveLocalRuntimeExecutable(appRoot(), runtime.binaryPath)
    if (resolution.kind === 'node-script') {
      const scriptPath = resolution.args[0] ?? ''
      return runtime.binaryPath.trim()
        ? `Node.js script (${scriptPath})`
        : `Bundled SciForge Runtime (${scriptPath})`
    }
    return resolution.command
  },

  ensureRunning(settings: AppSettingsV1): Promise<void> {
    return startLocalRuntimeChild(settings)
  },

  stopAndWait(): Promise<void> {
    return stopLocalRuntimeChildAndWait()
  },

  isChildRunning(): boolean {
    return isLocalRuntimeChildRunning()
  },

  getBaseUrl(settings: AppSettingsV1): string {
    const runtime = getLocalRuntimeSettings(settings)
    return getLocalRuntimeBaseUrl(runtime.port)
  },

  reclaimPort(port: number): Promise<{ ok: true } | { ok: false; message: string }> {
    return reclaimLocalRuntimePort(port)
  }
}

export function getRuntimeBaseUrlForSettings(settings: AppSettingsV1): string {
  return localRuntimeAdapter.getBaseUrl(settings)
}

/** Build the bearer-token authorization header for local runtime requests. */
export function runtimeAuthHeaders(settings: AppSettingsV1): Headers {
  const runtime = getLocalRuntimeSettings(settings)
  const headers = new Headers()
  if (runtime.runtimeToken.trim()) {
    headers.set('Authorization', `Bearer ${runtime.runtimeToken.trim()}`)
  }
  return headers
}

export type LocalRuntimeHttpRequestInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export async function localRuntimeHttpRequestViaHost(
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: LocalRuntimeHttpRequestInit,
  ensureRuntime: (settings: AppSettingsV1) => Promise<void>
): Promise<{ ok: boolean; status: number; body: string }> {
  await ensureRuntime(settings)
  const base = getRuntimeBaseUrlForSettings(settings)
  const pathNorm = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`
  const url = `${base}${pathNorm}`
  const hdrs = runtimeAuthHeaders(settings)
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    hdrs.set(key, value)
  }
  hdrs.set('Accept', 'application/json')
  if (init.body && !hdrs.has('Content-Type')) {
    hdrs.set('Content-Type', 'application/json')
  }
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: hdrs,
    body: init.body,
    signal: AbortSignal.timeout(init.method === 'POST' ? 60_000 : 15_000)
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}

export { buildLocalRuntimeServeArgs, resolveLocalRuntimeExecutable }

/**
 * Default data directory used when the user has not provided one.
 * The path lives under the app user-data directory so packaged
 * installs do not need write access to the install folder.
 */
export function defaultLocalRuntimeDataDir(): string {
  return DEFAULT_LOCAL_RUNTIME_DATA_DIR.replace(/^~(?=$|[\\/])/, homedir())
}
