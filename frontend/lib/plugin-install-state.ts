import { readBrowserStorageItem, writeBrowserStorageItem } from './browser-storage'

export type PluginInstallKind = 'mcp' | 'skill' | 'extension'

export const INSTALLED_PLUGINS_STORAGE_KEY = 'sciforge.installedPlugins'
export const PAPER_RADAR_EXTENSION_ID = 'paper-radar'

export function pluginStorageKey(kind: PluginInstallKind, id: string): string {
  return `${kind}:${id}`
}

export function loadInstalledPluginKeys(): string[] {
  try {
    const raw = readBrowserStorageItem(INSTALLED_PLUGINS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function saveInstalledPluginKeys(ids: string[]): void {
  writeBrowserStorageItem(INSTALLED_PLUGINS_STORAGE_KEY, JSON.stringify([...new Set(ids)]))
}

export function isPluginInstalled(kind: PluginInstallKind, id: string): boolean {
  return loadInstalledPluginKeys().includes(pluginStorageKey(kind, id))
}
