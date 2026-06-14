import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultSpeechToTextSettings,
  defaultWriteSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { SpeechToTextSettingsSection, speechToTextSettingsPatch } from './settings-section-speech-to-text'

const labels: Record<string, string> = {
  sectionSpeechToText: 'Speech-to-Text',
  speechToTextEnabled: 'Enable voice input',
  speechToTextEnabledDesc: 'Show voice input controls once configured.',
  speechToTextProtocol: 'Protocol',
  speechToTextProtocolDesc: 'Choose the request format.',
  speechProtocolOpenAi: 'OpenAI-compatible transcriptions',
  speechProtocolMimoAsr: 'MiMo ASR',
  speechToTextBaseUrl: 'Speech endpoint URL',
  speechToTextBaseUrlDesc: 'Base URL for speech.',
  speechToTextBaseUrlPlaceholder: 'https://api.example.com/v1',
  speechToTextApiKey: 'Speech API key',
  speechToTextApiKeyDesc: 'Speech-only credential.',
  speechToTextModel: 'Transcription model',
  speechToTextModelDesc: 'Model ID.',
  speechToTextModelPlaceholder: 'whisper-1',
  speechToTextLanguage: 'Language hint',
  speechToTextLanguageDesc: 'Optional language hint.',
  speechLanguage_auto: 'Auto-detect',
  speechLanguage_zh: 'Chinese',
  speechLanguage_en: 'English',
  speechLanguage_ja: 'Japanese',
  speechLanguage_ko: 'Korean',
  speechToTextTimeout: 'Timeout',
  speechToTextTimeoutDesc: 'Maximum wait in milliseconds.',
  showSecret: 'Show',
  hideSecret: 'Hide'
}

function t(key: string): string {
  return labels[key] ?? key
}

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'kun',
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    speechToText: {
      ...defaultSpeechToTextSettings(),
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: 'https://speech.example/v1',
      apiKey: 'sk-speech',
      model: 'mimo-v2.5-asr',
      language: 'zh',
      timeoutMs: 120_000
    },
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

describe('SpeechToTextSettingsSection', () => {
  it('renders independent speech-to-text controls', () => {
    const html = renderToStaticMarkup(createElement(SpeechToTextSettingsSection, {
      ctx: {
        t,
        form: buildSettings(),
        update: vi.fn(),
        selectControlClass: 'select-control'
      }
    }))

    expect(html).toContain('Speech-to-Text')
    expect(html).toContain('Enable voice input')
    expect(html).toContain('<option value="openai-transcriptions"')
    expect(html).toContain('<option value="mimo-asr" selected="">MiMo ASR</option>')
    expect(html).toContain('value="https://speech.example/v1"')
    expect(html).toContain('value="mimo-v2.5-asr"')
    expect(html).toContain('<option value="zh" selected="">Chinese</option>')
    expect(html).toContain('value="120000"')
    expect(html).not.toContain('Model Router')
    expect(html).not.toContain('Provider member')
  })

  it('builds app-level speech settings patches without touching providers or agents', () => {
    const patch = speechToTextSettingsPatch(defaultSpeechToTextSettings(), {
      enabled: true,
      baseUrl: 'https://speech.example/v1',
      apiKey: 'sk-speech',
      model: 'whisper-1'
    })

    expect(patch).toEqual({
      speechToText: {
        ...defaultSpeechToTextSettings(),
        enabled: true,
        baseUrl: 'https://speech.example/v1',
        apiKey: 'sk-speech',
        model: 'whisper-1'
      }
    })
    expect(patch.provider).toBeUndefined()
    expect(patch.modelRouter).toBeUndefined()
    expect(patch.agents).toBeUndefined()
  })
})
