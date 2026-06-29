import { describe, expect, it } from 'vitest'
import {
  buildImageGenerationMcpServerConfig,
  imageGenerationMcpSettingsChanged,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  defaultConnectPhoneSettings,
  defaultImageGenerationSettings,
  defaultKeyboardShortcuts,
  defaultLocalRuntimeSettings,
  defaultModelProviderSettings,
  defaultRemoteChannelSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  type AppSettingsV1,
  type ImageGenerationSettingsPatchV1
} from '../shared/app-settings'

function createSettings(imageGeneration: ImageGenerationSettingsPatchV1 = {}): AppSettingsV1 {
  const remoteChannel = defaultRemoteChannelSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    agents: {
      sciforge: defaultLocalRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: {
      enabled: true,
      retentionDays: 2
    },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    imageGeneration: {
      ...defaultImageGenerationSettings(),
      ...imageGeneration
    },
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    remoteChannel: {
      ...remoteChannel,
      enabled: true,
      im: {
        ...remoteChannel.im,
        enabled: true,
        port: 8787,
        secret: ''
      }
    },
    connectPhone: defaultConnectPhoneSettings()
  }
}

const launch: ImageGenerationMcpLaunchConfig = {
  appPath: '/Applications/SciForge.app',
  execPath: '/Applications/SciForge.app/Contents/MacOS/SciForge',
  isPackaged: false
}

describe('image generation MCP config', () => {
  it('passes configured image generation settings through stdio MCP env', () => {
    const server = buildImageGenerationMcpServerConfig(launch, '/tmp/workspace', {
      ...defaultImageGenerationSettings(),
      enabled: true,
      apiKey: 'image-key',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'qwen-image-2.0-pro'
    })

    expect(server).toMatchObject({
      enabled: true,
      transport: 'stdio',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        SCIFORGE_IMAGE_API_KEY: 'image-key',
        SCIFORGE_IMAGE_BASE_URL: 'http://127.0.0.1:3888/v1',
        SCIFORGE_IMAGE_MODEL: 'qwen-image-2.0-pro'
      },
      trustedWorkspaceRoots: ['/tmp/workspace'],
      trustScope: 'user'
    })
  })

  it('requests a runtime restart when image worker launch env changes', () => {
    const configured = createSettings({
      enabled: true,
      apiKey: 'old-key',
      baseUrl: 'http://127.0.0.1:3888/v1',
      model: 'qwen-image-2.0-pro'
    })

    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings())).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), createSettings({ model: 'gpt-image-1' }))).toBe(false)
    expect(imageGenerationMcpSettingsChanged(createSettings(), configured)).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ ...configured.imageGeneration, apiKey: 'new-key' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ ...configured.imageGeneration, baseUrl: 'http://127.0.0.1:3999/v1' }))).toBe(true)
    expect(imageGenerationMcpSettingsChanged(configured, createSettings({ ...configured.imageGeneration, model: 'gpt-image-2' }))).toBe(true)
  })
})
