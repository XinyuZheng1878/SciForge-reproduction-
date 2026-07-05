import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVIDENCE_DAG_SERVICE_URL,
  evidenceDagUiUrl
} from './contract'

describe('Evidence DAG desktop contract', () => {
  it('builds runtime-scoped UI URLs with the API token in the hash fragment', () => {
    expect(evidenceDagUiUrl({
      runtimeId: 'codex',
      threadId: 'thread-1',
      serviceUrl: 'http://127.0.0.1:4897/',
      apiKey: 'test-token'
    })).toBe('http://127.0.0.1:4897/?thread=codex%3Athread-1#token=test-token')
  })

  it('omits empty thread and token values', () => {
    expect(evidenceDagUiUrl({ threadId: '   ', apiKey: '   ' }))
      .toBe(`${DEFAULT_EVIDENCE_DAG_SERVICE_URL}/`)
  })
})
