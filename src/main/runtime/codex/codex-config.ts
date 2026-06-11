import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCodexRuntimeSettings, type AppSettingsV1 } from '../../../shared/app-settings'

export type CodexAppServerLaunchConfig = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  codexHome: string
}

export async function prepareCodexAppServerLaunch(options: {
  settings: AppSettingsV1
  workspace?: string
  env?: NodeJS.ProcessEnv
}): Promise<CodexAppServerLaunchConfig> {
  const runtime = getCodexRuntimeSettings(options.settings)
  const command = runtime.command.trim()
  if (!command) throw new Error('Codex command is required.')
  const codexHome = expandHome(runtime.codexHome)
  if (!codexHome) throw new Error('Codex CODEX_HOME is required.')
  const cwd = resolveCodexWorkspace(options.settings, options.workspace)
  if (!cwd) throw new Error('Codex workspace is required.')
  await mkdir(codexHome, { recursive: true })
  return {
    command,
    args: ['app-server', '--listen', 'stdio://', ...runtime.extraArgs],
    cwd,
    env: codexRuntimeEnv(options.env ?? process.env, codexHome),
    codexHome
  }
}

export function resolveCodexWorkspace(settings: AppSettingsV1, workspace?: string): string {
  return expandHome(workspace || settings.workspaceRoot || '~')
}

export function codexRuntimeEnv(baseEnv: NodeJS.ProcessEnv, codexHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    CODEX_HOME: codexHome
  }
  delete env.CODEX_USER_HOME
  delete env.CODEX_CONFIG_HOME
  env.NO_PROXY = appendNoProxyLoopbacks(env.NO_PROXY)
  env.no_proxy = appendNoProxyLoopbacks(env.no_proxy)
  return env
}

export function expandHome(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))
  return value
}

function appendNoProxyLoopbacks(value: string | undefined): string {
  const required = ['127.0.0.1', 'localhost', '::1']
  const parts = (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const existing = new Set(parts.map((part) => part.toLowerCase()))
  for (const entry of required) {
    if (!existing.has(entry.toLowerCase())) parts.push(entry)
  }
  return parts.join(',')
}
