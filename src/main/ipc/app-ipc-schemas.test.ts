import { describe, expect, it } from 'vitest'
import {
  agentRuntimeApprovalResolvePayloadSchema,
  agentRuntimeAuxiliaryPayloadSchema,
  agentRuntimeSessionResumePayloadSchema,
  agentRuntimeThreadCompactPayloadSchema,
  agentRuntimeThreadDeletePayloadSchema,
  agentRuntimeThreadForkPayloadSchema,
  agentRuntimeThreadRenamePayloadSchema,
  agentRuntimeThreadRelationPayloadSchema,
  agentRuntimeUsagePayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeUserInputResolvePayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  clawImInstallPollPayloadSchema,
  evidenceDagOpenPayloadSchema,
  isSafeOpenExternalUrl,
  scheduleTaskFromTextPayloadSchema,
  settingsPatchSchema,
  shellOpenExternalUrlSchema,
  speechTranscriptionPayloadSchema,
  skillListPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  writeExportPayloadSchema,
  writeRichClipboardPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writeRetrievalPayloadSchema
} from './app-ipc-schemas'

describe('app-ipc-schemas', () => {
  it('accepts neutral agent runtime turn payloads', () => {
    const payload = agentRuntimeStartTurnPayloadSchema.parse({
      runtimeId: 'claude',
      threadId: ' thread-1 ',
      text: ' hello ',
      workspace: ' /tmp/workspace ',
      model: ' deepseek-v4-pro ',
      reasoningEffort: ' medium ',
      governanceProfile: 'remote_guard',
      fileReferences: [{
        path: ' /tmp/workspace/docs/spec.pdf ',
        relativePath: ' docs/spec.pdf ',
        name: ' spec.pdf ',
        kind: 'pdf',
        delivery: 'model_router_object',
        mimeType: ' application/pdf ',
        modelRouterObject: true
      }]
    })

    expect(payload).toEqual({
      runtimeId: 'claude',
      threadId: 'thread-1',
      text: 'hello',
      workspace: '/tmp/workspace',
      model: 'deepseek-v4-pro',
      reasoningEffort: 'medium',
      governanceProfile: 'remote_guard',
      fileReferences: [{
        path: '/tmp/workspace/docs/spec.pdf',
        relativePath: 'docs/spec.pdf',
        name: 'spec.pdf',
        kind: 'pdf',
        delivery: 'model_router_object',
        mimeType: 'application/pdf',
        modelRouterObject: true
      }]
    })
  })

  it('rejects empty neutral agent runtime turn text', () => {
    expect(() =>
      agentRuntimeStartTurnPayloadSchema.parse({
        threadId: 'thread-1',
        text: ' '
      })
    ).toThrow()
  })

  it('accepts Evidence DAG open payloads for Claude runtime threads', () => {
    expect(evidenceDagOpenPayloadSchema.parse({
      runtimeId: 'claude',
      threadId: ' thread-1 '
    })).toEqual({
      runtimeId: 'claude',
      threadId: 'thread-1'
    })
  })

  it('accepts neutral agent runtime event subscription and control payloads', () => {
    expect(agentRuntimeEventSubscribePayloadSchema.parse({
      runtimeId: 'kun',
      threadId: ' thread-1 ',
      sinceSeq: 7,
      streamId: ' stream-1 '
    })).toEqual({
      runtimeId: 'kun',
      threadId: 'thread-1',
      sinceSeq: 7,
      streamId: 'stream-1'
    })

    expect(agentRuntimeApprovalResolvePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      approvalId: ' approval-1 ',
      decision: 'allowed',
      message: ' ok '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      approvalId: 'approval-1',
      decision: 'allowed',
      message: 'ok'
    })

    expect(agentRuntimeUserInputResolvePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      requestId: ' request-1 ',
      answers: [{ id: ' choice ', label: ' Choice ', value: ' yes ' }]
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      requestId: 'request-1',
      answers: [{ id: 'choice', label: 'Choice', value: 'yes' }]
    })

    expect(agentRuntimeThreadRenamePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 ',
      title: ' New title '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1',
      title: 'New title'
    })

    expect(agentRuntimeThreadDeletePayloadSchema.parse({
      runtimeId: 'codex',
      threadId: ' thread-1 '
    })).toEqual({
      runtimeId: 'codex',
      threadId: 'thread-1'
    })

    expect(agentRuntimeThreadCompactPayloadSchema.parse({
      runtimeId: 'kun',
      threadId: ' thread-1 ',
      reason: ' Manual cleanup '
    })).toEqual({
      runtimeId: 'kun',
      threadId: 'thread-1',
      reason: 'Manual cleanup'
    })

    expect(agentRuntimeThreadForkPayloadSchema.parse({
      runtimeId: 'kun',
      threadId: ' thread-1 ',
      relation: ' side ',
      title: ' Side path '
    })).toEqual({
      runtimeId: 'kun',
      threadId: 'thread-1',
      relation: 'side',
      title: 'Side path'
    })

    expect(agentRuntimeSessionResumePayloadSchema.parse({
      runtimeId: 'kun',
      sessionId: ' session-1 ',
      model: ' deepseek-v4-pro ',
      mode: ' agent ',
      maxResumeCount: 3
    })).toEqual({
      runtimeId: 'kun',
      sessionId: 'session-1',
      model: 'deepseek-v4-pro',
      mode: 'agent',
      maxResumeCount: 3
    })

    expect(agentRuntimeThreadRelationPayloadSchema.parse({
      runtimeId: 'kun',
      threadId: ' thread-1 ',
      relation: ' primary '
    })).toEqual({
      runtimeId: 'kun',
      threadId: 'thread-1',
      relation: 'primary'
    })

    expect(agentRuntimeUsagePayloadSchema.parse({
      runtimeId: 'kun',
      groupBy: 'day',
      from: ' 2026-06-01 ',
      to: ' 2026-06-11 ',
      timezone: ' Asia/Shanghai '
    })).toEqual({
      runtimeId: 'kun',
      groupBy: 'day',
      from: '2026-06-01',
      to: '2026-06-11',
      timezone: 'Asia/Shanghai'
    })
  })

  it('accepts shared host-service auxiliary operations', () => {
    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'codex',
      operation: 'runCodeNavigation',
      payload: {
        workspaceRoot: ' /tmp/workspace ',
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
        line: 3,
        character: 8
      }
    })).toEqual({
      runtimeId: 'codex',
      operation: 'runCodeNavigation',
      payload: {
        workspaceRoot: ' /tmp/workspace ',
        operation: 'goToDefinition',
        filePath: 'src/index.ts',
        line: 3,
        character: 8
      }
    })

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'claude',
      operation: 'listThreadChildren',
      payload: {
        threadId: 'thread-1',
        parentTurnId: 'turn-1',
        activeOnly: true
      }
    })).toEqual({
      runtimeId: 'claude',
      operation: 'listThreadChildren',
      payload: {
        threadId: 'thread-1',
        parentTurnId: 'turn-1',
        activeOnly: true
      }
    })

    expect(agentRuntimeAuxiliaryPayloadSchema.parse({
      runtimeId: 'claude',
      operation: 'readChildTranscript',
      payload: {
        parentThreadId: 'thread-1',
        childId: 'child-1',
        transcriptRef: {
          kind: 'runtime',
          transcriptId: 'transcript-1'
        }
      }
    })).toEqual({
      runtimeId: 'claude',
      operation: 'readChildTranscript',
      payload: {
        parentThreadId: 'thread-1',
        childId: 'child-1',
        transcriptRef: {
          kind: 'runtime',
          transcriptId: 'transcript-1'
        }
      }
    })

    for (const operation of [
      'listThreadChildren',
      'readChildTranscript',
      'listModelAuditRecords',
      'clearModelAuditRecords',
      'getContextState',
      'createGitCheckpoint',
      'listGitCheckpoints',
      'previewGitCheckpoint',
      'restoreGitCheckpoint',
      'createMemory',
      'listMemories',
      'updateMemory',
      'deleteMemory',
      'listWorkspaceReferences',
      'previewWorkspaceReference'
    ] as const) {
      expect(agentRuntimeAuxiliaryPayloadSchema.parse({
        runtimeId: 'kun',
        operation,
        payload: { threadId: 'thread-1' }
      }).operation).toBe(operation)
    }
  })

  it('accepts skill list payloads with an optional workspace root', () => {
    expect(skillListPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace '
    })).toEqual({ workspaceRoot: '/tmp/workspace' })
    expect(skillListPayloadSchema.parse({})).toEqual({})
  })

  it('accepts speech transcription payloads with resolved provider settings', () => {
    const payload = speechTranscriptionPayloadSchema.parse({
      audioBase64: Buffer.from('fake-wav-bytes').toString('base64'),
      mimeType: ' audio/wav ',
      durationMs: 1200,
      speechToText: {
        enabled: true,
        protocol: 'openai-transcriptions',
        baseUrl: ' https://speech.example.test/v1 ',
        apiKey: 'sk-speech',
        model: ' whisper-1 ',
        language: ' zh ',
        timeoutMs: 30000
      }
    })

    expect(payload).toEqual({
      audioBase64: Buffer.from('fake-wav-bytes').toString('base64'),
      mimeType: 'audio/wav',
      durationMs: 1200,
      speechToText: {
        enabled: true,
        protocol: 'openai-transcriptions',
        baseUrl: 'https://speech.example.test/v1',
        apiKey: 'sk-speech',
        model: 'whisper-1',
        language: 'zh',
        timeoutMs: 30000
      }
    })
  })

  it('rejects non-audio speech transcription payloads', () => {
    expect(() =>
      speechTranscriptionPayloadSchema.parse({
        audioBase64: Buffer.from('fake-image-bytes').toString('base64'),
        mimeType: 'image/png'
      })
    ).toThrow(/audio MIME type/)
  })

  it('accepts a valid settings patch for kun and write settings', () => {
    const payload = settingsPatchSchema.parse({
      theme: 'dark',
      activeAgentRuntime: 'claude',
      agents: {
        kun: {
          port: 9000,
          model: 'deepseek-chat',
          tokenEconomy: {
            enabled: true,
            compressToolResults: false,
            historyHygiene: {
              maxToolResultTokens: 4000
            }
          }
        },
        codex: {
          command: 'codex',
          codexHome: '/tmp/codex-home',
          approvalPolicy: 'never',
          sandboxMode: 'workspace-write'
        },
        claude: {
          command: 'claude',
          configDir: '/tmp/claude-code',
          approvalPolicy: 'auto',
          sandboxMode: 'workspace-write',
          extraArgs: ['--allowedTools', 'Edit']
        }
      },
      write: {
        inlineCompletion: {
          model: 'deepseek-v4-pro',
          maxTokens: 128
        }
      }
    })

    expect(payload.agents?.kun?.port).toBe(9000)
    expect(payload.agents?.kun?.tokenEconomy?.enabled).toBe(true)
    expect(payload.agents?.kun?.tokenEconomy?.historyHygiene?.maxToolResultTokens).toBe(4000)
    expect(payload.activeAgentRuntime).toBe('claude')
    expect(payload.agents?.codex?.codexHome).toBe('/tmp/codex-home')
    expect(payload.agents?.claude?.configDir).toBe('/tmp/claude-code')
    expect(payload.write?.inlineCompletion?.model).toBe('deepseek-v4-pro')
  })

  it('accepts schedule settings patches and task payloads', () => {
    const payload = settingsPatchSchema.parse({
      schedule: {
        enabled: true,
        keepAwake: true,
        defaultWorkspaceRoot: '/tmp/schedule',
        model: 'deepseek-v4-flash',
        mode: 'plan',
        promptPrefix: 'Use the project checklist.',
        skills: {
          defaultNames: ['review'],
          extraDirs: ['/tmp/skills']
        },
        internal: {
          port: 9788,
          secret: 'secret'
        },
        tasks: [{
          id: 'task-1',
          title: 'Daily review',
          enabled: true,
          prompt: 'Review the repo',
          workspaceRoot: '/tmp/schedule',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-task-thread' },
          model: 'auto',
          reasoningEffort: 'high',
          mode: 'agent',
          schedule: {
            kind: 'daily',
            everyMinutes: 60,
            timeOfDay: '09:30',
            atTime: ''
          },
          lastStatus: 'idle'
        }]
      },
      claw: {
        channels: [{
          id: 'channel-1',
          provider: 'feishu',
          label: 'Team',
          enabled: true,
          model: 'auto',
          threadId: '',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-channel-thread' },
          workspaceRoot: '/tmp/claw',
          conversations: [{
            id: 'conversation-1',
            chatId: 'chat-1',
            latestMessageId: 'message-1',
            localThreadId: '',
            runtimeId: 'codex',
            agentThreadIds: { codex: 'codex-conversation-thread' },
            workspaceRoot: '/tmp/claw'
          }]
        }],
        tasks: [{
          id: 'claw-task-1',
          title: 'Claw review',
          prompt: 'Review chat',
          workspaceRoot: '/tmp/claw',
          runtimeId: 'codex',
          agentThreadIds: { codex: 'codex-claw-task-thread' },
          lastThreadId: ''
        }]
      }
    })

    expect(payload.schedule?.internal?.port).toBe(9788)
    expect(payload.schedule?.tasks?.[0]?.schedule?.kind).toBe('daily')
    expect(payload.schedule?.tasks?.[0]?.reasoningEffort).toBe('high')
    expect(payload.schedule?.tasks?.[0]?.agentThreadIds).toEqual({ codex: 'codex-task-thread' })
    expect(payload.claw?.channels?.[0]?.agentThreadIds).toEqual({ codex: 'codex-channel-thread' })
    expect(payload.claw?.channels?.[0]?.conversations?.[0]?.agentThreadIds).toEqual({
      codex: 'codex-conversation-thread'
    })
    expect(payload.claw?.tasks?.[0]?.agentThreadIds).toEqual({ codex: 'codex-claw-task-thread' })

    const fromText = scheduleTaskFromTextPayloadSchema.parse({
      text: 'Remind me tomorrow morning to ship the review',
      workspaceRoot: '/tmp/schedule',
      modelHint: 'deepseek-v4-pro',
      mode: 'agent'
    })

    expect(fromText.workspaceRoot).toBe('/tmp/schedule')
    expect(fromText.modelHint).toBe('deepseek-v4-pro')
  })

  it('strips legacy settings keys before validating settings patches', () => {
    const payload = settingsPatchSchema.parse({
      locale: 'zh',
      reasonix: { model: 'legacy-reasoner' },
      quickChat: { enabled: true },
      agents: {
        kun: {
          port: 9001
        },
        reasonix: {
          model: 'legacy-reasoner'
        },
        quickChat: {
          enabled: true
        }
      }
    })

    expect(payload.locale).toBe('zh')
    expect(payload.agents?.kun?.port).toBe(9001)
    expect('reasonix' in payload).toBe(false)
    expect('quickChat' in payload).toBe(false)
    expect('reasonix' in (payload.agents ?? {})).toBe(false)
    expect('quickChat' in (payload.agents ?? {})).toBe(false)
  })

  it('accepts partial provider profiles in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      provider: {
        apiKey: 'sk-updated',
        providers: [{
          id: 'deepseek',
          apiKey: 'sk-updated',
          endpointFormat: 'responses'
        }]
      }
    })

    expect(payload.provider?.apiKey).toBe('sk-updated')
    expect(payload.provider?.providers?.[0]).toEqual({
      id: 'deepseek',
      apiKey: 'sk-updated',
      endpointFormat: 'responses'
    })
  })

  it('accepts partial keyboard shortcut binding maps in settings patches', () => {
    const payload = settingsPatchSchema.parse({
      keyboardShortcuts: {
        bindings: {
          settings: ['Ctrl+,']
        }
      }
    })

    expect(payload.keyboardShortcuts?.bindings?.settings).toEqual(['Ctrl+,'])
  })

  it('rejects unknown settings patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          kun: {
            mysteryFlag: true
          }
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('rejects legacy Kun tool storm patches in favor of runtime guards', () => {
    expect(() =>
      settingsPatchSchema.parse({
        agents: {
          kun: {
            runtimeTuning: {
              toolStorm: {
                threshold: 4
              }
            }
          }
        }
      })
    ).toThrow(/Unrecognized key/)

    expect(settingsPatchSchema.parse({
      runtimeGuards: {
        toolStorm: {
          softThreshold: 4,
          hardThreshold: 8
        },
        budgets: {
          writeMaxToolEvents: 64
        }
      }
    }).runtimeGuards).toMatchObject({
      toolStorm: {
        softThreshold: 4,
        hardThreshold: 8
      },
      budgets: {
        writeMaxToolEvents: 64
      }
    })
  })

  it('rejects unknown schedule patch fields', () => {
    expect(() =>
      settingsPatchSchema.parse({
        schedule: {
          tasks: [{
            id: 'task-1',
            prompt: 'Run',
            schedule: { kind: 'manual' },
            legacyClawOnlyField: true
          }]
        }
      })
    ).toThrow(/Unrecognized key/)
  })

  it('allows only safe external URL protocols', () => {
    expect(isSafeOpenExternalUrl('https://deepseek.com')).toBe(true)
    expect(isSafeOpenExternalUrl('http://127.0.0.1:5173')).toBe(true)
    expect(isSafeOpenExternalUrl('mailto:zhongxingyuemail@gmail.com')).toBe(true)
    expect(isSafeOpenExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeOpenExternalUrl('file:///tmp/test')).toBe(false)
    expect(() => shellOpenExternalUrlSchema.parse('javascript:alert(1)')).toThrow(
      /Only http, https, and mailto URLs are allowed/
    )
  })

  it('accepts long Feishu install device codes', () => {
    const deviceCode = 'x'.repeat(2_048)
    const payload = clawImInstallPollPayloadSchema.parse({
      provider: 'feishu',
      deviceCode
    })

    expect(payload.deviceCode).toBe(deviceCode)
  })

  it('accepts Discord Client ID, binding, and guarded takeover payloads', async () => {
    const schemas = await import('./app-ipc-schemas')

    expect(schemas.discordConfigureClientPayloadSchema.parse({
      clientId: ' client-1 '
    })).toEqual({ clientId: 'client-1' })

    expect(schemas.discordConfigureProxyPayloadSchema.parse({
      proxyUrl: ' http://127.0.0.1:7890 '
    })).toEqual({ proxyUrl: 'http://127.0.0.1:7890' })

    expect(schemas.discordBindChannelPayloadSchema.parse({
      channelConfigId: ' config-1 ',
      guildId: ' guild-1 ',
      guildName: ' Support ',
      channelId: ' channel-1 ',
      channelName: ' support ',
      enabled: false,
      workspaceRoot: '/tmp/support',
      model: 'deepseek-v4-flash',
      agentProfile: {
        name: 'Support bot'
      }
    })).toMatchObject({
      channelConfigId: 'config-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      workspaceRoot: '/tmp/support',
      model: 'deepseek-v4-flash',
      agentProfile: { name: 'Support bot' }
    })

    expect(schemas.discordSetGuardPayloadSchema.parse({
      enabled: true,
      channelConfigId: ' config-1 ',
      forceTakeover: true
    })).toEqual({
      enabled: true,
      channelConfigId: 'config-1',
      forceTakeover: true
    })
  })

  it('accepts workspace directory payloads without a child path', () => {
    const payload = workspaceDirectoryTargetPayloadSchema.parse({
      workspaceRoot: '/tmp/workspace'
    })

    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.path).toBeUndefined()
  })

  it('accepts workspace directory create payloads', () => {
    const payload = workspaceDirectoryCreatePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: 'notes'
    })

    expect(payload.path).toBe('notes')
  })

  it('accepts workspace rename payloads', () => {
    const payload = workspaceEntryRenamePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md',
      newName: 'final.md'
    })

    expect(payload.newName).toBe('final.md')
  })

  it('accepts workspace delete payloads', () => {
    const payload = workspaceEntryDeletePayloadSchema.parse({
      workspaceRoot: '/tmp/workspace',
      path: '/tmp/workspace/draft.md'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
  })

  it('accepts structured inline completion payloads', () => {
    const payload = writeInlineCompletionPayloadSchema.parse({
      prefix: '## Heading\n\nSome intro',
      suffix: '',
      mode: 'edit',
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/notes.md',
      cursor: {
        line: 3,
        column: 10
      },
      context: {
        language: 'markdown',
        currentLinePrefix: 'Some intro',
        currentLineSuffix: '',
        previousLine: '',
        previousNonEmptyLine: '## Heading',
        nextLine: '',
        indentation: '',
        signals: {
          list: false,
          quote: false,
          heading: false,
          table: false,
          atLineEnd: true,
          endsWithSentencePunctuation: false,
          previousLineEndsWithSentencePunctuation: false,
          prefersNewLineCompletion: false,
          paragraphBreakOpportunity: false
        }
      },
      policy: {
        name: 'precision-inline-v2',
        instruction: 'Return only the inserted text.',
        acceptanceCriteria: ['Keep it short.'],
        rejectionCriteria: ['Do not ramble.']
      },
      preview: {
        local: 'Some intro',
        documentTail: '## Heading Some intro'
      },
      editCandidate: {
        kind: 'paragraph',
        from: 12,
        to: 22,
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 10,
        original: 'Some intro',
        selectedText: 'Some'
      },
      recentEdits: [{
        source: 'user',
        ageMs: 1_200,
        filePath: '/tmp/workspace/notes.md',
        from: 12,
        to: 16,
        deletedText: 'Old',
        insertedText: 'Some',
        beforeContext: '',
        afterContext: ' intro'
      }],
      model: 'deepseek-v4-pro'
    })

    expect(payload.model).toBe('deepseek-v4-pro')
    expect(payload.mode).toBe('edit')
    expect(payload.workspaceRoot).toBe('/tmp/workspace')
    expect(payload.cursor.line).toBe(3)
    expect(payload.editCandidate?.kind).toBe('paragraph')
    expect(payload.recentEdits?.[0].insertedText).toBe('Some')
  })

  it('accepts structured write retrieval payloads', () => {
    const payload = writeRetrievalPayloadSchema.parse({
      workspaceRoot: ' /tmp/workspace ',
      currentFilePath: ' /tmp/workspace/draft.md ',
      query: ' 面向科学场景的大模型复杂推理 ',
      maxSnippets: 4,
      includeCurrentFile: true
    })

    expect(payload).toEqual({
      workspaceRoot: '/tmp/workspace',
      currentFilePath: '/tmp/workspace/draft.md',
      query: '面向科学场景的大模型复杂推理',
      maxSnippets: 4,
      includeCurrentFile: true
    })
  })

  it('rejects empty write retrieval queries and excessive snippet counts', () => {
    expect(() =>
      writeRetrievalPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        query: ' '
      })
    ).toThrow()

    expect(() =>
      writeRetrievalPayloadSchema.parse({
        workspaceRoot: '/tmp/workspace',
        query: 'science',
        maxSnippets: 9
      })
    ).toThrow()
  })

  it('accepts write export payloads', () => {
    const payload = writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'docx',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.format).toBe('docx')
    expect(payload.content).toBe('# Draft')

    expect(writeExportPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      format: 'tex',
      content: '# Draft'
    }).format).toBe('tex')
  })

  it('accepts write rich clipboard payloads', () => {
    const payload = writeRichClipboardPayloadSchema.parse({
      path: '/tmp/workspace/draft.md',
      workspaceRoot: '/tmp/workspace',
      content: '# Draft'
    })

    expect(payload.path).toBe('/tmp/workspace/draft.md')
    expect(payload.content).toBe('# Draft')
  })
})
