import { describe, expect, it } from 'vitest'
import {
  applyKunRuntimePatch,
  applyCodexRuntimePatch,
  codexSettingsPatch,
  kunSettingsEnvelope,
  kunSettingsPatch,
  DEFAULT_CODEX_DATA_DIR,
  DEFAULT_CLAUDE_CONFIG_DIR,
  DEFAULT_KUN_DATA_DIR,
  DEFAULT_KUN_MODEL,
  DEFAULT_APPROVAL_POLICY,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_WEIXIN_BRIDGE_RPC_URL,
  DEFAULT_SCHEDULE_INTERNAL_PORT,
  buildClawRuntimePrompt,
  defaultClawSettings,
  defaultModelRouterSettings,
  defaultModelProviderSettings,
  defaultSpeechToTextSettings,
  defaultRuntimeGuardSettings,
  mergeKunRuntimeSettings,
  mergeRuntimeGuardSettings,
  mergeScheduleSettings,
  mergeSpeechToTextSettings,
  defaultCodexRuntimeSettings,
  defaultClaudeRuntimeSettings,
  defaultKunRuntimeSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultKeyboardShortcuts,
  getActiveAgentRuntime,
  getActiveAgentApiKey,
  getCodexRuntimeSettings,
  getClaudeRuntimeSettings,
  isKunRuntimeInsecure,
  mergeClawSettings,
  migrateLegacyAppSettings,
  normalizeAppSettings,
  normalizeRuntimeGuardSettings,
  parseClawUserPromptForDisplay,
  normalizeScheduleSettings,
  resolveKunRuntimeSettings,
  resolveSpeechToTextSettings,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionBaseUrl,
  resolveWriteInlineCompletionModel,
  type AppSettingsV1,
  type ClawImChannelV1,
  type ClawImProvider
} from './app-settings'

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 'small',
    provider: defaultModelProviderSettings(),
    modelRouter: defaultModelRouterSettings(),
    activeAgentRuntime: 'kun',
    agents: {
      kun: defaultKunRuntimeSettings(),
      codex: defaultCodexRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
  }
}

function clawChannel(provider: ClawImProvider, label: string, name = label): ClawImChannelV1 {
  const now = '2026-06-01T00:00:00.000Z'
  return {
    id: `${provider}-${label}`,
    provider,
    label,
    enabled: true,
    model: 'auto',
    threadId: '',
    runtimeId: 'kun',
    agentThreadIds: {},
    workspaceRoot: '',
    agentProfile: {
      name,
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    createdAt: now,
    updatedAt: now
  }
}

describe('kun defaults', () => {
  it('keeps a single shared default data directory source', () => {
    expect(defaultKunRuntimeSettings().dataDir).toBe(DEFAULT_KUN_DATA_DIR)
  })

  it('defaults the assistant model to v4 pro', () => {
    expect(defaultKunRuntimeSettings().model).toBe(DEFAULT_KUN_MODEL)
  })

  it('defaults approval policy to auto', () => {
    expect(defaultKunRuntimeSettings().approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
    expect(defaultKunRuntimeSettings().approvalPolicy).toBe('auto')
  })

  it('defaults sandbox mode to full access', () => {
    expect(defaultKunRuntimeSettings().sandboxMode).toBe(DEFAULT_SANDBOX_MODE)
    expect(defaultKunRuntimeSettings().sandboxMode).toBe('danger-full-access')
  })

  it('defaults token economy mode to off', () => {
    expect(defaultKunRuntimeSettings().tokenEconomyMode).toBe(false)
    expect(defaultKunRuntimeSettings().tokenEconomy).toMatchObject({
      enabled: false,
      compressToolDescriptions: true,
      compressToolResults: true,
      conciseResponses: true,
      historyHygiene: {
        maxToolResultLines: 320,
        maxToolResultBytes: 32768,
        maxToolResultTokens: 8000,
        maxToolArgumentStringBytes: 8192,
        maxToolArgumentStringTokens: 2000,
        maxArrayItems: 80
      }
    })
  })

  it('defaults MCP search discovery to off', () => {
    expect(defaultKunRuntimeSettings().mcpSearch).toMatchObject({
      enabled: false,
      mode: 'auto',
      autoThresholdToolCount: 24,
      topKDefault: 5,
      topKMax: 10
    })
  })

  it('defaults advanced Kun runtime tuning to conservative values', () => {
    expect(defaultKunRuntimeSettings()).toMatchObject({
      storage: {
        backend: 'hybrid',
        sqlitePath: ''
      },
      contextCompaction: {
        defaultSoftThreshold: 16000,
        defaultHardThreshold: 24000,
        summaryMode: 'heuristic',
        summaryTimeoutMs: 15000,
        summaryMaxTokens: 1200,
        summaryInputMaxBytes: 98304
      },
      runtimeTuning: {
        toolArgumentRepair: {
          maxStringBytes: 524288
        }
      }
    })
  })

  it('defaults runtime guard settings to runtime-neutral tool storm limits', () => {
    expect(defaultRuntimeGuardSettings()).toEqual({
      toolStorm: {
        enabled: true,
        windowSize: 8,
        softThreshold: 3,
        hardThreshold: 6
      },
      budgets: {
        defaultMaxToolEvents: 80,
        writeMaxToolEvents: 96,
        remoteGuardMaxToolEvents: 32
      }
    })
  })

  it('normalizes legacy tool storm settings into runtime guards', () => {
    expect(normalizeRuntimeGuardSettings(undefined, {
      kunToolStorm: {
        enabled: false,
        windowSize: 12,
        threshold: 4
      }
    }).toolStorm).toEqual({
      enabled: false,
      windowSize: 12,
      softThreshold: 4,
      hardThreshold: 6
    })
    expect(normalizeRuntimeGuardSettings(undefined, {
      runtimeToolStorm: {
        windowSize: 10,
        softThreshold: 5,
        hardThreshold: 7
      }
    }).toolStorm).toMatchObject({
      windowSize: 10,
      softThreshold: 5,
      hardThreshold: 7
    })
  })

  it('migrates old persisted tool storm fields into normalized runtime guards', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      runtimeGuards: undefined,
      kunToolStorm: {
        windowSize: 9,
        threshold: 4
      }
    } as unknown as AppSettingsV1)

    expect(normalized.runtimeGuards?.toolStorm).toMatchObject({
      enabled: true,
      windowSize: 9,
      softThreshold: 4,
      hardThreshold: 6
    })
  })
})

describe('app behavior settings', () => {
  it('defaults desktop behavior to off', () => {
    const raw = {
      ...settings(),
      appBehavior: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: false
    })
  })

  it('only keeps start minimized when open at login is enabled', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      appBehavior: {
        openAtLogin: false,
        startMinimized: true,
        closeToTray: true
      }
    })

    expect(normalized.appBehavior).toEqual({
      openAtLogin: false,
      startMinimized: false,
      closeToTray: true
    })
  })
})

describe('keyboard shortcut settings', () => {
  it('defaults shortcut overrides to empty', () => {
    const raw = {
      ...settings(),
      keyboardShortcuts: undefined
    } as unknown as AppSettingsV1

    expect(normalizeAppSettings(raw).keyboardShortcuts).toEqual({
      bindings: {}
    })
  })
})

describe('speech-to-text settings', () => {
  it('defaults voice input settings to disabled', () => {
    const raw = {
      ...settings(),
      speechToText: undefined
    } as AppSettingsV1

    expect(normalizeAppSettings(raw).speechToText).toEqual(defaultSpeechToTextSettings())
  })

  it('normalizes custom transcription settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      speechToText: {
        enabled: true,
        protocol: 'mimo-asr',
        baseUrl: '  https://speech.example/v1  ',
        apiKey: '  sk-speech  ',
        model: '  whisper-large-v3  ',
        language: '  ZH-CN  ',
        timeoutMs: 900_000
      }
    })

    expect(normalized.speechToText).toEqual({
      enabled: true,
      protocol: 'mimo-asr',
      baseUrl: 'https://speech.example/v1',
      apiKey: 'sk-speech',
      model: 'whisper-large-v3',
      language: 'zh-cn',
      timeoutMs: 600_000
    })
  })

  it('falls back to OpenAI-compatible transcriptions and clamps tiny timeouts', () => {
    const merged = mergeSpeechToTextSettings(defaultSpeechToTextSettings(), {
      enabled: true,
      protocol: 'bogus' as never,
      timeoutMs: 100
    })

    expect(merged.protocol).toBe('openai-transcriptions')
    expect(merged.timeoutMs).toBe(5_000)
  })

  it('resolves normalized settings from the app config', () => {
    const resolved = resolveSpeechToTextSettings({
      ...settings(),
      speechToText: {
        ...defaultSpeechToTextSettings(),
        enabled: true,
        baseUrl: ' https://speech.example/v1 ',
        apiKey: ' sk-speech ',
        model: ' whisper-1 '
      }
    })

    expect(resolved).toMatchObject({
      enabled: true,
      baseUrl: 'https://speech.example/v1',
      apiKey: 'sk-speech',
      model: 'whisper-1'
    })
  })
})

describe('claw settings', () => {
  it('stores the WeChat bridge URL in Claw IM settings', () => {
    const defaults = defaultClawSettings()
    expect(defaults.im.weixinBridgeUrl).toBe(DEFAULT_WEIXIN_BRIDGE_RPC_URL)

    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '  http://127.0.0.1:8787/rpc  '
        }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:8787/rpc')
  })

  it('migrates the legacy OpenClaw Gateway URL into the WeChat bridge URL', () => {
    const defaults = defaultClawSettings()
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaults,
        im: {
          ...defaults.im,
          weixinBridgeUrl: '',
          openClawGatewayUrl: '  http://127.0.0.1:8787/rpc  '
        } as typeof defaults.im & { openClawGatewayUrl: string }
      }
    })

    expect(normalized.claw.im.weixinBridgeUrl).toBe('http://127.0.0.1:8787/rpc')
  })

  it('preserves Codex-only Claw IM conversations without a legacy Kun thread id', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [{
          ...clawChannel('feishu', 'team'),
          runtimeId: 'codex',
          threadId: '',
          agentThreadIds: { codex: 'codex-channel-thread' },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: 'remote-1',
            latestMessageId: 'message-1',
            senderId: 'sender-1',
            senderName: 'Ada',
            localThreadId: '',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'codex-conversation-thread' },
            workspaceRoot: '/tmp/workspace',
            createdAt: '2026-06-11T00:00:00.000Z',
            updatedAt: '2026-06-11T00:00:01.000Z'
          }]
        }]
      }
    })

    expect(normalized.claw.channels[0]).toMatchObject({
      runtimeId: 'codex',
      threadId: '',
      agentThreadIds: { codex: 'codex-channel-thread' }
    })
    expect(normalized.claw.channels[0]?.conversations).toEqual([
      expect.objectContaining({
        id: 'conversation-1',
        localThreadId: '',
        runtimeId: 'codex',
        agentThreadIds: { codex: 'codex-conversation-thread' }
      })
    ])
  })

  it('preserves Claude Claw IM thread mappings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [{
          ...clawChannel('feishu', 'Claude Channel'),
          runtimeId: 'claude',
          threadId: '',
          agentThreadIds: { claude: 'claude-channel-thread' },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            localThreadId: '',
            runtimeId: 'claude',
            agentThreadIds: { claude: 'claude-conversation-thread' },
            workspaceRoot: '/tmp/workspace',
            createdAt: '2026-06-11T00:00:00.000Z',
            updatedAt: '2026-06-11T00:00:01.000Z'
          }]
        }]
      }
    })

    const channel = normalized.claw.channels[0]
    expect(channel.runtimeId).toBe('claude')
    expect(channel.agentThreadIds).toEqual({ claude: 'claude-channel-thread' })
    expect(channel.conversations[0]).toMatchObject({
      runtimeId: 'claude',
      agentThreadIds: { claude: 'claude-conversation-thread' }
    })
  })

  it('normalizes Claw IM channel guard mode with an only_mention default', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [
          clawChannel('feishu', 'Default Guard'),
          {
            ...clawChannel('feishu', 'All Messages'),
            guardMode: 'all_messages'
          },
          {
            ...clawChannel('feishu', 'Bad Guard'),
            guardMode: 'bogus' as never
          }
        ]
      }
    })

    expect(normalized.claw.channels.map((channel) => channel.guardMode)).toEqual([
      'only_mention',
      'all_messages',
      'only_mention'
    ])
  })

  it('normalizes phone agent default names without touching custom names', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [
          clawChannel('weixin', 'WeChat Agent', 'WeChat Agent'),
          clawChannel('feishu', 'Feishu / Lark', 'Feishu Agent'),
          clawChannel('weixin', 'Support Bot', '')
        ]
      }
    })

    expect(normalized.claw.channels.map((channel) => ({
      label: channel.label,
      name: channel.agentProfile.name
    }))).toEqual([
      { label: 'weixin agent', name: 'weixin agent' },
      { label: 'feishu agent', name: 'feishu agent' },
      { label: 'Support Bot', name: 'Support Bot' }
    ])
  })

  it('migrates legacy claw channel and conversation threads to Kun mappings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [{
          id: 'channel-1',
          provider: 'weixin',
          label: 'WeChat Agent',
          enabled: true,
          model: 'auto',
          threadId: ' legacy-channel-thread ',
          agentThreadIds: {
            codewhale: ' legacy-codewhale-channel ',
            reasonix: ' legacy-reasonix-channel '
          },
          workspaceRoot: '',
          agentProfile: {
            name: 'WeChat Agent',
            description: '',
            identity: '',
            personality: '',
            userContext: '',
            replyRules: ''
          },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            localThreadId: '',
            agentThreadIds: {
              reasonix: ' legacy-reasonix-conversation '
            },
            workspaceRoot: '',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z'
          }],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        }]
      }
    } as unknown as AppSettingsV1)

    const channel = normalized.claw.channels[0]
    expect(channel.runtimeId).toBe('kun')
    expect(channel.threadId).toBe('legacy-channel-thread')
    expect(channel.agentThreadIds).toEqual({ kun: 'legacy-channel-thread' })
    expect(channel.agentThreadIds?.codex).toBeUndefined()

    const conversation = channel.conversations[0]
    expect(conversation.runtimeId).toBe('kun')
    expect(conversation.localThreadId).toBe('legacy-reasonix-conversation')
    expect(conversation.agentThreadIds).toEqual({ kun: 'legacy-reasonix-conversation' })
    expect(conversation.agentThreadIds?.codex).toBeUndefined()
  })

  it('round-trips Codex claw thread mappings while keeping legacy Kun fields', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [{
          ...clawChannel('feishu', 'Codex Channel'),
          threadId: 'kun-channel-thread',
          runtimeId: 'codex',
          agentThreadIds: {
            kun: 'kun-channel-thread',
            codex: 'codex-channel-thread'
          },
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            remoteThreadId: '',
            latestMessageId: 'message-1',
            senderId: '',
            senderName: '',
            localThreadId: 'kun-conversation-thread',
            runtimeId: 'codex',
            agentThreadIds: {
              kun: 'kun-conversation-thread',
              codex: 'codex-conversation-thread'
            },
            workspaceRoot: '',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z'
          }]
        }]
      }
    })

    const channel = normalized.claw.channels[0]
    expect(channel.runtimeId).toBe('codex')
    expect(channel.threadId).toBe('kun-channel-thread')
    expect(channel.agentThreadIds).toEqual({
      kun: 'kun-channel-thread',
      codex: 'codex-channel-thread'
    })

    const conversation = channel.conversations[0]
    expect(conversation.runtimeId).toBe('codex')
    expect(conversation.localThreadId).toBe('kun-conversation-thread')
    expect(conversation.agentThreadIds).toEqual({
      kun: 'kun-conversation-thread',
      codex: 'codex-conversation-thread'
    })
  })

  it('merges claw settings without dropping Kun or Codex thread mappings', () => {
    const current = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        channels: [{
          ...clawChannel('feishu', 'Merged Channel'),
          threadId: 'kun-channel-thread',
          runtimeId: 'codex',
          agentThreadIds: {
            kun: 'kun-channel-thread',
            codex: 'codex-channel-thread'
          }
        }]
      }
    }).claw

    const merged = mergeClawSettings(current, {
      channels: [{
        ...current.channels[0],
        label: 'Merged Channel Renamed'
      }]
    })

    expect(merged.channels[0].runtimeId).toBe('codex')
    expect(merged.channels[0].threadId).toBe('kun-channel-thread')
    expect(merged.channels[0].agentThreadIds).toEqual({
      kun: 'kun-channel-thread',
      codex: 'codex-channel-thread'
    })
  })
})

describe('isKunRuntimeInsecure', () => {
  it('treats an empty runtime token as effectively insecure', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: ''
      })
    ).toBe(true)
  })

  it('keeps auth enabled when a token exists and insecure is false', () => {
    expect(
      isKunRuntimeInsecure({
        ...defaultKunRuntimeSettings(),
        insecure: false,
        runtimeToken: 'tok-1'
      })
    ).toBe(false)
  })
})

describe('mergeKunRuntimeSettings', () => {
  it('merges a direct kun patch without the envelope wrapper', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      model: 'deepseek-reasoner',
      port: 9000,
      tokenEconomyMode: true
    })
    expect(next.model).toBe('deepseek-reasoner')
    expect(next.port).toBe(9000)
    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.baseUrl).toBe(current.baseUrl)
  })

  it('deep-merges token economy settings and keeps the legacy switch synced', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      tokenEconomy: {
        enabled: true,
        compressToolResults: false,
        historyHygiene: {
          maxToolResultLines: 120
        }
      }
    })

    expect(next.tokenEconomyMode).toBe(true)
    expect(next.tokenEconomy.enabled).toBe(true)
    expect(next.tokenEconomy.compressToolDescriptions).toBe(true)
    expect(next.tokenEconomy.compressToolResults).toBe(false)
    expect(next.tokenEconomy.historyHygiene.maxToolResultLines).toBe(120)
    expect(next.tokenEconomy.historyHygiene.maxToolResultBytes).toBe(
      current.tokenEconomy.historyHygiene.maxToolResultBytes
    )

    const legacySwitch = mergeKunRuntimeSettings(next, { tokenEconomyMode: false })
    expect(legacySwitch.tokenEconomyMode).toBe(false)
    expect(legacySwitch.tokenEconomy.enabled).toBe(false)
  })

  it('deep-merges MCP search settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      mcpSearch: {
        enabled: true,
        mode: 'search',
        topKDefault: 3
      }
    })

    expect(next.mcpSearch.enabled).toBe(true)
    expect(next.mcpSearch.mode).toBe('search')
    expect(next.mcpSearch.topKDefault).toBe(3)
    expect(next.mcpSearch.topKMax).toBe(current.mcpSearch.topKMax)
  })

  it('deep-merges advanced Kun settings', () => {
    const current = defaultKunRuntimeSettings()
    const next = mergeKunRuntimeSettings(current, {
      storage: {
        sqlitePath: ' /tmp/kun.sqlite3 '
      },
      contextCompaction: {
        defaultSoftThreshold: 64000
      },
      runtimeTuning: {
        toolArgumentRepair: {
          maxStringBytes: 262144
        }
      }
    })

    expect(next.storage.backend).toBe('hybrid')
    expect(next.storage.sqlitePath).toBe('/tmp/kun.sqlite3')
    expect(next.contextCompaction.defaultSoftThreshold).toBe(64000)
    expect(next.contextCompaction.defaultHardThreshold).toBe(64000)
    expect(next.contextCompaction.summaryMode).toBe('heuristic')
    expect(next.runtimeTuning.toolArgumentRepair).toEqual({
      maxStringBytes: 262144
    })
  })

  it('deep-merges runtime guard settings through the new config model', () => {
    const next = mergeRuntimeGuardSettings(defaultRuntimeGuardSettings(), {
      toolStorm: {
        softThreshold: 5
      },
      budgets: {
        remoteGuardMaxToolEvents: 16
      }
    })

    expect(next.toolStorm).toEqual({
      enabled: true,
      windowSize: 8,
      softThreshold: 5,
      hardThreshold: 6
    })
    expect(next.budgets).toEqual({
      defaultMaxToolEvents: 80,
      writeMaxToolEvents: 96,
      remoteGuardMaxToolEvents: 16
    })
  })
})

describe('kun envelope helpers', () => {
  it('wraps runtime settings and patches into the compatibility shell', () => {
    const runtime = defaultKunRuntimeSettings()
    expect(kunSettingsEnvelope(runtime)).toEqual({ kun: runtime })
    expect(kunSettingsPatch({ model: 'deepseek-reasoner' })).toEqual({
      kun: { model: 'deepseek-reasoner' }
    })
  })

  it('applies a kun patch onto full app settings', () => {
    const current = settings()
    const next = applyKunRuntimePatch(current, { model: 'deepseek-reasoner' })
    expect(next.agents.kun.model).toBe('deepseek-reasoner')
    expect(getCodexRuntimeSettings(next)).toEqual(getCodexRuntimeSettings(current))
    expect(next.write).toEqual(current.write)
  })
})

describe('agent runtime settings', () => {
  it('defaults to Kun while normalizing a Codex runtime settings slot', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        kun: defaultKunRuntimeSettings()
      }
    })

    expect(getActiveAgentRuntime(normalized)).toBe('kun')
    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      command: 'codex',
      codexHome: DEFAULT_CODEX_DATA_DIR,
      autoStart: true
    }))
  })

  it('normalizes invalid runtime ids back to Kun', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'mystery-runtime'
    } as unknown as AppSettingsV1)

    expect(getActiveAgentRuntime(normalized)).toBe('kun')
  })

  it('preserves Claude Code as an active runtime with default settings', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'claude',
      agents: {
        kun: defaultKunRuntimeSettings(),
        codex: defaultCodexRuntimeSettings(),
        claude: {
          ...defaultClaudeRuntimeSettings(),
          command: 'claude',
          configDir: DEFAULT_CLAUDE_CONFIG_DIR
        }
      }
    })

    expect(getActiveAgentRuntime(normalized)).toBe('claude')
    expect(getClaudeRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      command: 'claude',
      configDir: DEFAULT_CLAUDE_CONFIG_DIR,
      sandboxMode: 'workspace-write'
    }))
  })

  it('does not require a Kun API key when Codex is the active runtime', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'codex',
      provider: {
        ...defaultModelProviderSettings(),
        apiKey: ''
      }
    })

    expect(getActiveAgentApiKey(normalized)).toBe('')
  })

  it('uses the Model Router runtime API key while Codex is the active runtime', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      activeAgentRuntime: 'codex',
      provider: {
        ...defaultModelProviderSettings(),
        apiKey: 'sk-codex-shared'
      },
      modelRouter: {
        ...defaultModelRouterSettings(),
        runtimeApiKey: 'sk-router-runtime'
      }
    })

    expect(getActiveAgentApiKey(normalized)).toBe('sk-router-runtime')
  })

  it('wraps codex runtime patches into the shared agents envelope', () => {
    expect(codexSettingsPatch({ codexHome: '/tmp/codex-home' })).toEqual({
      codex: { codexHome: '/tmp/codex-home' }
    })
  })

  it('applies a codex patch without changing Kun settings', () => {
    const current = settings()
    const next = applyCodexRuntimePatch(current, {
      codexHome: '/tmp/codex-home',
      approvalPolicy: 'never'
    })

    expect(next.agents.kun).toEqual(current.agents.kun)
    expect(getCodexRuntimeSettings(next)).toEqual(expect.objectContaining({
      codexHome: '/tmp/codex-home',
      approvalPolicy: 'never'
    }))
  })

  it('normalizes persisted Codex permission values to app-server-supported values', () => {
    const normalized = normalizeAppSettings({
      ...settings(),
      agents: {
        ...settings().agents,
        codex: {
          ...defaultCodexRuntimeSettings(),
          approvalPolicy: 'suggest',
          sandboxMode: 'external-sandbox'
        }
      }
    })

    expect(getCodexRuntimeSettings(normalized)).toEqual(expect.objectContaining({
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write'
    }))
  })
})

describe('legacy Kun defaults migration', () => {
  it('normalizes old master settings without an agents.kun envelope', () => {
    const normalized = normalizeAppSettings({
      version: 1,
      locale: 'zh',
      theme: 'dark',
      uiFontScale: 'small',
      agentProvider: 'deepseek-runtime',
      deepseek: {
        binaryPath: '/usr/local/bin/deepseek',
        port: 8787,
        autoStart: false,
        apiKey: 'sk-old',
        baseUrl: 'https://api.deepseek.com',
        runtimeToken: 'old-token',
        extraCorsOrigins: [],
        approvalPolicy: 'on-request',
        sandboxMode: 'read-only'
      },
      workspaceRoot: '/tmp/legacy-workspace',
      log: { enabled: true, retentionDays: 2 },
      notifications: { turnComplete: true },
      guiUpdate: { channel: 'frontier' },
      claw: defaultClawSettings()
    } as unknown as AppSettingsV1)

    expect(normalized.agents.kun).toEqual(expect.objectContaining({
      binaryPath: '',
      port: 8787,
      autoStart: false,
      runtimeToken: 'old-token',
      approvalPolicy: 'on-request',
      sandboxMode: 'read-only'
    }))
    expect(normalized.provider).toEqual(expect.objectContaining({
      apiKey: 'sk-old',
      baseUrl: 'https://api.deepseek.com'
    }))
    expect('agentProvider' in normalized).toBe(false)
    expect('deepseek' in normalized).toBe(false)
  })

  it('moves the legacy local HTTP default port to the Kun default port', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {
        port: 7878
      }
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.port).toBe(8899)
  })

  it('uses the current approval policy default for missing legacy local HTTP settings', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agentProvider: 'deepseek-runtime',
      deepseek: {}
    } as unknown as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun?.approvalPolicy).toBe(DEFAULT_APPROVAL_POLICY)
  })

  it('upgrades old persisted Kun defaults to the current defaults', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '~/.deepseekgui/coreagent',
          model: 'deepseek-chat'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: DEFAULT_KUN_DATA_DIR,
      model: DEFAULT_KUN_MODEL
    }))
  })

  it('preserves a non-legacy Kun model override', () => {
    const migrated = migrateLegacyAppSettings({
      version: 1,
      agents: {
        kun: {
          dataDir: '/tmp/custom-kun',
          model: 'deepseek-v4-flash'
        }
      }
    } as Parameters<typeof migrateLegacyAppSettings>[0])

    expect(migrated.agents?.kun).toEqual(expect.objectContaining({
      dataDir: '/tmp/custom-kun',
      model: 'deepseek-v4-flash'
    }))
  })

  it('preserves custom model providers while migrating legacy settings', () => {
    const migrated = normalizeAppSettings({
      ...settings(),
      agentProvider: 'deepseek-runtime',
      provider: {
        apiKey: 'sk-default',
        baseUrl: 'https://api.deepseek.com',
        providers: [
          ...defaultModelProviderSettings().providers,
          {
            id: 'custom-provider-2',
            name: 'Custom Provider',
            apiKey: 'sk-custom',
            baseUrl: 'https://custom.example/v1',
            endpointFormat: 'responses',
            models: ['custom-model']
          }
        ]
      },
      agents: {
        kun: {
          ...defaultKunRuntimeSettings(),
          providerId: 'custom-provider-2',
          model: 'custom-model'
        }
      }
    } as unknown as AppSettingsV1)

    expect(migrated.provider.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'custom-provider-2',
          name: 'Custom Provider',
          apiKey: 'sk-custom',
          baseUrl: 'https://custom.example/v1',
          endpointFormat: 'responses',
          models: ['custom-model']
        })
      ])
    )
    expect(migrated.agents.kun.providerId).toBe('custom-provider-2')
    expect(resolveKunRuntimeSettings(migrated)).toEqual(
      expect.objectContaining({
        apiKey: '',
        baseUrl: 'http://127.0.0.1:3892/v1',
        endpointFormat: 'responses',
        model: 'sciforge-router'
      })
    )
  })
})

describe('schedule settings', () => {
  it('provides independent top-level schedule defaults', () => {
    const defaults = defaultScheduleSettings()

    expect(defaults.enabled).toBe(false)
    expect(defaults.keepAwake).toBe(false)
    expect(defaults.internal.port).toBe(DEFAULT_SCHEDULE_INTERNAL_PORT)
    expect(defaults.tasks).toEqual([])
  })

  it('normalizes and merges schedule patches without reading legacy claw tasks', () => {
    const legacyTask = {
      id: 'legacy-claw-task',
      title: 'Legacy task',
      enabled: true,
      prompt: 'Old Claw task',
      workspaceRoot: '/tmp/workspace',
      model: 'auto',
      reasoningEffort: 'medium' as const,
      mode: 'agent' as const,
      schedule: { kind: 'daily' as const, everyMinutes: 60, timeOfDay: '08:00', atTime: '' },
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle' as const,
      lastMessage: '',
      lastThreadId: '',
      runtimeId: 'kun' as const,
      agentThreadIds: {}
    }
    const normalized = normalizeAppSettings({
      ...settings(),
      claw: {
        ...defaultClawSettings(),
        tasks: [legacyTask]
      },
      schedule: undefined as unknown as AppSettingsV1['schedule']
    })

    expect(normalized.claw.tasks).toHaveLength(1)
    expect(normalized.schedule.tasks).toEqual([])

    const merged = mergeScheduleSettings(normalizeScheduleSettings(undefined), {
      enabled: true,
      defaultWorkspaceRoot: ' /tmp/schedule ',
      internal: { port: 99, secret: ' secret ' },
      tasks: [{
        title: 'Daily',
        prompt: 'Run',
        schedule: { kind: 'daily', everyMinutes: 0, timeOfDay: 'bad', atTime: 'not-a-date' }
      }]
    })

    expect(merged.enabled).toBe(true)
    expect(merged.defaultWorkspaceRoot).toBe('/tmp/schedule')
    expect(merged.internal.port).toBe(1024)
    expect(merged.internal.secret).toBe('secret')
    expect(merged.tasks[0].schedule.everyMinutes).toBe(1)
    expect(merged.tasks[0].schedule.timeOfDay).toBe('09:00')
    expect(merged.tasks[0].schedule.atTime).toBe('')
    expect(merged.tasks[0].reasoningEffort).toBe('medium')
  })

  it('migrates legacy scheduled task threads to Kun mappings', () => {
    const normalized = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Legacy task',
        prompt: 'Run',
        lastThreadId: ' legacy-task-thread ',
        agentThreadIds: {
          codewhale: ' legacy-codewhale-task '
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(normalized.tasks[0]).toMatchObject({
      runtimeId: 'kun',
      lastThreadId: 'legacy-task-thread',
      agentThreadIds: { kun: 'legacy-task-thread' }
    })
    expect(normalized.tasks[0].agentThreadIds?.codex).toBeUndefined()
  })

  it('round-trips Codex scheduled task mappings while keeping Kun mappings', () => {
    const current = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Codex task',
        prompt: 'Run',
        lastThreadId: 'kun-task-thread',
        runtimeId: 'codex',
        agentThreadIds: {
          kun: 'kun-task-thread',
          codex: 'codex-task-thread'
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(current.tasks[0]).toMatchObject({
      runtimeId: 'codex',
      lastThreadId: 'kun-task-thread',
      agentThreadIds: {
        kun: 'kun-task-thread',
        codex: 'codex-task-thread'
      }
    })

    const merged = mergeScheduleSettings(current, {
      tasks: [{
        ...current.tasks[0],
        title: 'Codex task renamed'
      }]
    })

    expect(merged.tasks[0].runtimeId).toBe('codex')
    expect(merged.tasks[0].lastThreadId).toBe('kun-task-thread')
    expect(merged.tasks[0].agentThreadIds).toEqual({
      kun: 'kun-task-thread',
      codex: 'codex-task-thread'
    })
  })

  it('round-trips Claude scheduled task mappings', () => {
    const current = normalizeScheduleSettings({
      tasks: [{
        id: 'task-1',
        title: 'Claude task',
        prompt: 'Run',
        lastThreadId: '',
        runtimeId: 'claude',
        agentThreadIds: {
          claude: 'claude-task-thread'
        }
      }]
    } as unknown as AppSettingsV1['schedule'])

    expect(current.tasks[0]).toMatchObject({
      runtimeId: 'claude',
      agentThreadIds: {
        claude: 'claude-task-thread'
      }
    })
  })
})

describe('claw runtime prompts', () => {
  it('does not duplicate default Schedule MCP tool instructions in managed prompts', () => {
    const state = settings()
    state.claw.channels = [{
      id: 'channel-1',
      provider: 'feishu',
      label: 'kun',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      conversations: [],
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z'
    }]

    const prompt = buildClawRuntimePrompt(state, 'hi', { channel: state.claw.channels[0] })

    expect(prompt).toContain('[Claw managed instructions]')
    expect(prompt).toContain('[Agent name]\nkun')
    expect(prompt).not.toContain('gui_schedule')
    expect(prompt).not.toContain('scheduled-task tools')
  })

  it('parses managed IM prompts into compact display text', () => {
    const parsed = parseClawUserPromptForDisplay([
      '[Claw managed instructions]',
      '',
      '[Claw IM agent instructions]',
      '',
      '[Agent name]',
      'kun',
      '',
      '---',
      '[Current user request]',
      '[Feishu / Lark inbound message]',
      'Chat type: p2p',
      'Sender: user-1',
      '',
      'hi'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: 'hi',
      managed: true,
      inbound: true,
      sender: 'user-1',
      chatType: 'p2p'
    })
  })

  it('parses Discord inbound prompts with the shared IM display logic', () => {
    const parsed = parseClawUserPromptForDisplay([
      '[Claw managed instructions]',
      '',
      '---',
      '[Current user request]',
      '[Discord inbound message]',
      'Guild: gzy的服务器',
      'Channel: #debug',
      'Sender: gzy',
      '你想我吗'
    ].join('\n'))

    expect(parsed).toMatchObject({
      text: '你想我吗',
      managed: true,
      inbound: true,
      sourceLabel: 'Discord',
      sender: 'gzy'
    })
  })
})

describe('write inline completion runtime config', () => {
  it('uses the Model Router base URL instead of the General provider URL', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
  })

  it('ignores an explicit write-only baseUrl override for runtime-facing calls', () => {
    const state = settings()
    state.provider.baseUrl = 'https://general.example/v1'
    state.write.inlineCompletion.baseUrl = 'https://write-only.example/v1'
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
  })

  it('uses the Model Router public alias instead of the Kun model', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('ignores explicit write model overrides for runtime-facing calls', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    state.write.inlineCompletion.inheritModel = false
    state.write.inlineCompletion.model = 'deepseek-v4-flash'

    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('ignores explicit request models for runtime-facing calls', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    expect(resolveWriteInlineCompletionModel(state, 'deepseek-v4-pro')).toBe('sciforge-router')
  })

  it('tolerates legacy write inline settings without new override fields', () => {
    const state = settings()
    state.provider.apiKey = 'general-key'
    state.provider.baseUrl = 'https://general.example/v1'
    state.modelRouter = {
      ...defaultModelRouterSettings(),
      ...state.modelRouter,
      runtimeApiKey: 'local-runtime-router-key'
    }
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = { ...state.write.inlineCompletion } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.apiKey
    delete legacyInlineCompletion.baseUrl
    delete legacyInlineCompletion.inheritModel
    delete legacyInlineCompletion.model
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionApiKey(state)).toBe('local-runtime-router-key')
    expect(resolveWriteInlineCompletionBaseUrl(state)).toBe('http://127.0.0.1:3892/v1')
    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })

  it('keeps legacy flash defaults behind the Model Router public alias', () => {
    const state = settings()
    state.agents.kun.model = 'deepseek-chat'
    const legacyInlineCompletion = {
      ...state.write.inlineCompletion,
      model: 'deepseek-v4-flash'
    } as Partial<AppSettingsV1['write']['inlineCompletion']>
    delete legacyInlineCompletion.inheritModel
    state.write.inlineCompletion = legacyInlineCompletion as AppSettingsV1['write']['inlineCompletion']

    expect(resolveWriteInlineCompletionModel(state)).toBe('sciforge-router')
  })
})
