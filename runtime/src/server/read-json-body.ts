import type { LocalRuntimeErrorBody } from '../contracts/errors.js'
import { jsonResponse, type JsonResponse } from './response.js'

export const LOCAL_RUNTIME_JSON_BODY_LIMIT_BYTES = 16 * 1024 * 1024

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: JsonResponse }

export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number } = {}
): Promise<ReadJsonBodyResult> {
  if (request.body === null) return { ok: true, value: {} }
  const textResult = await readRequestText(request, options.maxBytes ?? LOCAL_RUNTIME_JSON_BODY_LIMIT_BYTES)
  if (!textResult.ok) return textResult
  const text = textResult.value
  if (!text) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const body: LocalRuntimeErrorBody = {
      code: 'validation_error',
      message: 'invalid JSON body',
      details: error instanceof Error ? error.message : String(error)
    }
    return { ok: false, response: jsonResponse(body, 400) }
  }
}

async function readRequestText(
  request: Request,
  limitBytes: number
): Promise<{ ok: true; value: string } | { ok: false; response: JsonResponse }> {
  assertPositiveLimit(limitBytes)
  const declaredLength = contentLength(request.headers)
  if (declaredLength !== null && declaredLength > limitBytes) {
    return requestBodyTooLargeResponse(limitBytes)
  }

  const reader = request.body?.getReader()
  if (!reader) return { ok: true, value: '' }
  let size = 0
  const chunks: Buffer[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const buffer = Buffer.from(value)
      size += buffer.byteLength
      if (size > limitBytes) {
        await reader.cancel().catch(() => undefined)
        return requestBodyTooLargeResponse(limitBytes)
      }
      chunks.push(buffer)
    }
  } finally {
    reader.releaseLock()
  }
  return { ok: true, value: Buffer.concat(chunks).toString('utf8') }
}

function requestBodyTooLargeResponse(limitBytes: number): { ok: false; response: JsonResponse } {
  const body: LocalRuntimeErrorBody = {
    code: 'validation_error',
    message: 'request body is too large',
    details: { limitBytes }
  }
  return { ok: false, response: jsonResponse(body, 413) }
}

function contentLength(headers: Headers): number | null {
  const raw = headers.get('content-length')
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function assertPositiveLimit(limitBytes: number): void {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new Error('Request body limit must be a positive integer.')
  }
}
