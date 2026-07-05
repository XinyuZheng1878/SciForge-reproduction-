import { afterEach, describe, expect, it } from 'vitest'
import {
  isPluginInstalled,
  loadInstalledPluginKeys,
  PAPER_RADAR_EXTENSION_ID,
  pluginStorageKey,
  saveInstalledPluginKeys
} from './plugin-install-state'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function installStorage(storage: MemoryStorage): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })
}

function restoreLocalStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage')
  }
}

afterEach(() => {
  restoreLocalStorage()
})

describe('plugin install state', () => {
  it('stores Paper Radar as an extension install key', () => {
    installStorage(new MemoryStorage())

    const key = pluginStorageKey('extension', PAPER_RADAR_EXTENSION_ID)
    saveInstalledPluginKeys([key, key])

    expect(loadInstalledPluginKeys()).toEqual([key])
    expect(isPluginInstalled('extension', PAPER_RADAR_EXTENSION_ID)).toBe(true)
    expect(isPluginInstalled('mcp', PAPER_RADAR_EXTENSION_ID)).toBe(false)
  })

  it('treats invalid storage JSON as no installed plugins', () => {
    const storage = new MemoryStorage()
    installStorage(storage)
    storage.setItem('sciforge.installedPlugins', '{bad json')

    expect(loadInstalledPluginKeys()).toEqual([])
  })
})
