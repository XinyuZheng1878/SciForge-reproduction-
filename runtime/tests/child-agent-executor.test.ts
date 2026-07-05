import { describe, expect, it } from 'vitest'

import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../src/cache/immutable-prefix.js'
import {
  DEFAULT_CHILD_MAX_TURN_MODEL_STEPS,
  createChildAgentExecutor,
  resolveChildMaxTurnModelSteps
} from '../src/delegation/child-agent-executor.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'

function model(chunks: ModelStreamChunk[], seen: ModelRequest[] = []): ModelClient {
  return {
    provider: 'child-test',
    model: 'child-test',
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
      seen.push(request)
      for (const chunk of chunks) yield chunk
    }
  }
}

describe('child agent executor', () => {
  it('raises low parent step budgets for delegated long-running child turns', () => {
    expect(resolveChildMaxTurnModelSteps(undefined)).toBe(DEFAULT_CHILD_MAX_TURN_MODEL_STEPS)
    expect(resolveChildMaxTurnModelSteps({ maxTurnModelSteps: 128 })).toBe(DEFAULT_CHILD_MAX_TURN_MODEL_STEPS)
    expect(resolveChildMaxTurnModelSteps({ maxTurnModelSteps: 1024 })).toBe(1024)
  })

  it('runs a real child AgentLoop and returns assistant summary plus usage', async () => {
    const seen: ModelRequest[] = []
    const executor = createChildAgentExecutor({
      model: model([
        { kind: 'assistant_text_delta', text: 'child ' },
        { kind: 'assistant_text_delta', text: 'answer' },
        {
          kind: 'usage',
          usage: {
            promptTokens: 11,
            completionTokens: 3,
            totalTokens: 14,
            cacheHitTokens: 5,
            cacheMissTokens: 6,
            cacheHitRate: 5 / 11,
            cachedTokens: 5,
            turns: 1,
            costUsd: 0.001,
            cacheSavingsUsd: 0.0002
          }
        },
        { kind: 'completed', stopReason: 'stop' }
      ], seen),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_1',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      label: 'research',
      prompt: 'Research the issue',
      workspace: '/tmp/project',
      signal: new AbortController().signal,
      appendTranscript: async () => undefined
    })

    expect(result.summary).toBe('child answer')
    expect(result.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'user_message',
        text: 'Research the issue'
      }),
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'child answer'
      })
    ]))
    expect(result.usage).toMatchObject({
      promptTokens: 11,
      completionTokens: 3,
      totalTokens: 14,
      cacheHitTokens: 5,
      cacheSavingsUsd: 0.0002,
      turns: 1
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      threadId: 'child_1',
      model: 'child-test',
      systemPrompt: 'child system',
      history: [
        expect.objectContaining({
          kind: 'user_message',
          text: 'Research the issue'
        })
      ]
    })
    expect(seen[0]?.tools).toEqual([])
  })

  it('redacts secrets before persisting child transcripts', async () => {
    const runtimeToken = 'local-router-11111111-2222-3333-4444-555555555555'
    const providerToken = 'sk-testsecret1234567890abcdef'
    let calls = 0
    const transcript: unknown[] = []
    const qaTool = LocalToolHost.defineTool({
      name: 'vision_qa',
      description: 'Run figure QA',
      inputSchema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
          prompt: { type: 'string' }
        },
        required: ['apiKey', 'prompt']
      },
      policy: 'auto',
      execute: async () => ({
        output: {
          ok: true,
          token: runtimeToken,
          message: `Authorization: Bearer ${providerToken}`
        }
      })
    })
    const executor = createChildAgentExecutor({
      model: {
        provider: 'child-redaction-test',
        model: 'child-redaction-test',
        async *stream(): AsyncIterable<ModelStreamChunk> {
          calls += 1
          if (calls === 1) {
            yield {
              kind: 'tool_call_complete',
              callId: 'call_vision',
              toolName: 'vision_qa',
              arguments: {
                apiKey: runtimeToken,
                prompt: `use ${providerToken}`
              }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield {
            kind: 'assistant_text_delta',
            text: `QA complete with ${runtimeToken} and ${providerToken}`
          }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      toolHost: new LocalToolHost({
        registry: new CapabilityRegistry([
          { id: 'local', kind: 'built-in', enabled: true, available: true, tools: [qaTool] }
        ])
      }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-redaction-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_redacted',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: `Check figure with token ${runtimeToken}`,
      signal: new AbortController().signal,
      appendTranscript: async (entry) => { transcript.push(entry) }
    })

    const serialized = JSON.stringify({ result, transcript })
    expect(serialized).not.toContain(runtimeToken)
    expect(serialized).not.toContain(providerToken)
    expect(serialized).toContain('<redacted>')
  })

  it('does not fail a child run for tool-loop recovery warnings when the child recovers', async () => {
    const seen: ModelRequest[] = []
    let calls = 0
    let executions = 0
    const echoTool = LocalToolHost.defineTool({
      name: 'echo',
      description: 'Echo text',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text']
      },
      policy: 'auto',
      execute: async () => {
        executions += 1
        return { output: { ok: executions } }
      }
    })
    const executor = createChildAgentExecutor({
      model: {
        provider: 'child-storm-test',
        model: 'child-storm-test',
        async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
          seen.push(request)
          calls += 1
          if (calls <= 3) {
            yield {
              kind: 'tool_call_complete',
              callId: `call_echo_${calls}`,
              toolName: 'echo',
              arguments: { text: 'repeat me' }
            }
            yield { kind: 'completed', stopReason: 'tool_calls' }
            return
          }
          yield { kind: 'assistant_text_delta', text: 'Recovered with a substantive child summary.' }
          yield { kind: 'completed', stopReason: 'stop' }
        }
      },
      toolHost: new LocalToolHost({
        registry: new CapabilityRegistry([
          { id: 'local', kind: 'built-in', enabled: true, available: true, tools: [echoTool] }
        ])
      }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-storm-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    const result = await executor({
      childId: 'child_recovered',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Recover from repeated tool calls',
      signal: new AbortController().signal,
      appendTranscript: async () => undefined
    })

    expect(result.summary).toBe('Recovered with a substantive child summary.')
    expect(calls).toBe(4)
    expect(executions).toBe(2)
    expect(seen.at(-1)?.contextInstructions?.join('\n')).toContain('Tool loop recovery')
    expect(result.transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'assistant_message',
        text: 'Recovered with a substantive child summary.'
      })
    ]))
  })

  it('fails the child run when the child loop cannot produce a completed turn', async () => {
    const executor = createChildAgentExecutor({
      model: model([{ kind: 'error', message: 'model failed', code: 'bad_model' }]),
      toolHost: new LocalToolHost({ registry: new CapabilityRegistry([]) }),
      prefix: createImmutablePrefix({ systemPrompt: 'child system' }),
      defaultModel: 'child-test',
      nowIso: () => '2026-06-03T00:00:00.000Z'
    })

    await expect(executor({
      childId: 'child_fail',
      parentThreadId: 'thr_parent',
      parentTurnId: 'turn_parent',
      prompt: 'Fail',
      signal: new AbortController().signal,
      appendTranscript: async () => undefined
    })).rejects.toMatchObject({
      message: expect.stringMatching(/child agent failed|model failed/i),
      multiAgentTranscript: expect.arrayContaining([
        expect.objectContaining({ kind: 'user_message', text: 'Fail' })
      ])
    })
  })
})
