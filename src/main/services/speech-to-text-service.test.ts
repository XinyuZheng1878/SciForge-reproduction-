import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '../../shared/app-settings-types'
import {
  SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS,
  SPEECH_TRANSCRIPTION_MAX_DURATION_MS
} from '../../shared/speech-to-text'
import {
  SpeechHttpError,
  isSpeechToTextConfigured,
  joinSpeechApiUrl,
  requestSpeechTranscription
} from './speech-to-text-service'

const AUDIO_BASE64 = Buffer.from('fake-wav-bytes').toString('base64')

function settingsWithSpeech(overrides: Record<string, unknown> = {}): AppSettingsV1 {
  return {
    speechToText: {
      enabled: true,
      protocol: 'openai-transcriptions',
      baseUrl: 'https://speech.example.test/v1',
      apiKey: 'sk-speech',
      model: 'whisper-1',
      language: '',
      timeoutMs: 30000,
      ...overrides
    }
  } as unknown as AppSettingsV1
}

type RecordedRequest = { url: string; init: RequestInit }

function fakeFetch(body: unknown, status = 200): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof fetch
  return { fetchImpl, requests }
}

describe('speech-to-text service', () => {
  it('reports configuration state from enabled/baseUrl/apiKey/model', () => {
    expect(isSpeechToTextConfigured({ enabled: true, baseUrl: 'x', apiKey: 'y', model: 'z' })).toBe(true)
    expect(isSpeechToTextConfigured({ enabled: false, baseUrl: 'x', apiKey: 'y', model: 'z' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, baseUrl: '', apiKey: 'y', model: 'z' })).toBe(false)
    expect(isSpeechToTextConfigured({ enabled: true, baseUrl: 'x', apiKey: '', model: 'z' })).toBe(false)
  })

  it('rejects when the speech provider is not configured', async () => {
    const result = await requestSpeechTranscription(settingsWithSpeech({ apiKey: '' }), {
      audioBase64: AUDIO_BASE64,
      mimeType: 'audio/wav'
    })

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('not configured') })
  })

  it('enforces payload size and duration caps before network requests', async () => {
    const fetchImpl = (() => Promise.reject(new Error('should not fetch'))) as typeof fetch

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: '', mimeType: 'audio/wav' },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'audio payload is empty or too large' })

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: 'a'.repeat(SPEECH_TRANSCRIPTION_MAX_BASE64_CHARS + 1), mimeType: 'audio/wav' },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'audio payload is empty or too large' })

    await expect(requestSpeechTranscription(
      settingsWithSpeech(),
      {
        audioBase64: AUDIO_BASE64,
        mimeType: 'audio/wav',
        durationMs: SPEECH_TRANSCRIPTION_MAX_DURATION_MS + 1
      },
      { fetchImpl }
    )).resolves.toEqual({ ok: false, message: 'recording duration exceeds the speech-to-text limit' })
  })

  it('transcribes via OpenAI-compatible audio/transcriptions multipart upload', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: ' hello world ' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav', durationMs: 1200 },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'hello world' })
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://speech.example.test/v1/audio/transcriptions')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-speech')
    const form = requests[0].init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect(form.get('response_format')).toBe('json')
    expect(form.get('language')).toBeNull()
    const file = form.get('file')
    expect(file).toBeInstanceOf(Blob)
    expect((file as File).name).toBe('recording.wav')
  })

  it('passes non-auto language hints to OpenAI-compatible transcription', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: 'hi' })
    await requestSpeechTranscription(
      settingsWithSpeech({ language: 'zh' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/mp4' },
      { fetchImpl }
    )

    const form = requests[0].init.body as FormData
    expect(form.get('language')).toBe('zh')
    expect((form.get('file') as File).name).toBe('recording.m4a')
  })

  it('transcribes via MiMo ASR chat completions with a base64 data URI', async () => {
    const { fetchImpl, requests } = fakeFetch({
      choices: [{ message: { content: ' ni hao ' } }]
    })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ protocol: 'mimo-asr', model: 'mimo-v2.5-asr' }),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'ni hao' })
    expect(requests[0].url).toBe('https://speech.example.test/v1/chat/completions')
    const headers = requests[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-speech')
    expect(headers['api-key']).toBe('sk-speech')
    const payload = JSON.parse(String(requests[0].init.body))
    expect(payload).toMatchObject({
      model: 'mimo-v2.5-asr',
      asr_options: { language: 'auto' },
      stream: false
    })
    expect(payload.messages[0].content[0]).toEqual({
      type: 'input_audio',
      input_audio: { data: `data:audio/wav;base64,${AUDIO_BASE64}` }
    })
  })

  it('uses request-provided resolved speech settings when supplied by IPC caller', async () => {
    const { fetchImpl, requests } = fakeFetch({ text: 'override transcript' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech({ enabled: false, apiKey: '' }),
      {
        audioBase64: AUDIO_BASE64,
        mimeType: 'audio/webm',
        speechToText: {
          enabled: true,
          protocol: 'openai-transcriptions',
          baseUrl: 'https://override.example.test/v1',
          apiKey: 'sk-override',
          model: 'gpt-4o-transcribe',
          language: 'en',
          timeoutMs: 12000
        }
      },
      { fetchImpl }
    )

    expect(result).toEqual({ ok: true, text: 'override transcript' })
    expect(requests[0].url).toBe('https://override.example.test/v1/audio/transcriptions')
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-override')
    const form = requests[0].init.body as FormData
    expect(form.get('model')).toBe('gpt-4o-transcribe')
    expect(form.get('language')).toBe('en')
    expect((form.get('file') as File).name).toBe('recording.webm')
  })

  it('redacts secret-looking upstream response text from error messages', async () => {
    const { fetchImpl } = fakeFetch({ error: { message: 'Authorization: Bearer sk-speech' } }, 401)
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('HTTP 401')
      expect(result.message).not.toContain('sk-speech')
      expect(result.message).toContain('<redacted>')
    }
  })

  it('rejects an empty transcription result', async () => {
    const { fetchImpl } = fakeFetch({ text: '   ' })
    const result = await requestSpeechTranscription(
      settingsWithSpeech(),
      { audioBase64: AUDIO_BASE64, mimeType: 'audio/wav' },
      { fetchImpl }
    )

    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('empty') })
  })

  it('joins speech API URLs without changing the configured base path', () => {
    expect(joinSpeechApiUrl('https://speech.example.test/v1/', 'audio/transcriptions')).toBe(
      'https://speech.example.test/v1/audio/transcriptions'
    )
  })

  it('stores redacted HTTP error bodies only', () => {
    const error = new SpeechHttpError(400, 'api_key=sk-secret')

    expect(error.message).toBe('HTTP 400: api_key=<redacted>')
    expect(error.body).toBe('api_key=<redacted>')
  })
})
