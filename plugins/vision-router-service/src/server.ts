import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { ClientAbortError, ProviderError, translateImage, type QwenConfig } from './qwen.js';
import type { ServiceError, ServiceResult, VisionTranslateRequest, VisionTranslation } from './types.js';

export const SERVICE_ID = 'sciforge.vision-router';
export const SERVICE_VERSION = '0.1.0';
export const VISION_ROUTER_RUNTIME_TOKEN_ENV = 'VISION_ROUTER_RUNTIME_TOKEN';
export const DEFAULT_MAX_JSON_BODY_BYTES = 40 * 1024 * 1024;

export interface VisionRouterOptions {
  qwen: QwenConfig;
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
  runtimeToken: string;
  /** Deterministic clock for tests. */
  now?: () => Date;
}

export function createVisionRouterServer(options: VisionRouterOptions): Server {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes);
  const runtimeToken = normalizeRuntimeToken(options.runtimeToken);
  const now = options.now ?? (() => new Date());

  return createServer((req, res) => {
    handle(req, res, options, fetchImpl, now, { runtimeToken, maxBodyBytes }).catch((error) => {
      sendJson(res, 500, errorResult('INTERNAL_ERROR', messageOf(error), false));
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisionRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
  security: { runtimeToken: string; maxBodyBytes: number },
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (!hasValidRuntimeToken(req, security.runtimeToken)) {
    return sendJson(res, 401, errorResult('UNAUTHENTICATED', 'Unauthorized.', false));
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, { service: SERVICE_ID, version: SERVICE_VERSION, model: options.qwen.model });
  }
  if (req.method === 'POST' && url.pathname === '/vision/translate') {
    return translateRoute(req, res, options, fetchImpl, now, security.maxBodyBytes);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

async function translateRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: VisionRouterOptions,
  fetchImpl: typeof fetch,
  now: () => Date,
  maxBodyBytes: number,
): Promise<void> {
  const startedAt = now().toISOString();
  let body: VisionTranslateRequest;
  try {
    body = (await readJson(req, maxBodyBytes)) as VisionTranslateRequest;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return sendJson(res, 413, errorResult('PAYLOAD_TOO_LARGE', `Request body exceeds ${error.limitBytes} bytes.`, false));
    }
    return sendJson(res, 400, errorResult('INVALID_ARGUMENT', 'Request body must be valid JSON.', false));
  }

  const requestId = body.requestId ?? `vt_${createHash('sha256').update(startedAt).digest('hex').slice(0, 12)}`;
  const provenance = { serviceId: SERVICE_ID, operation: 'vision_translate', requestId, startedAt };
  const imgKind = body.image?.base64 ? `base64(${body.image.base64.length}b)` : body.image?.url ? 'url' : 'none';
  console.log(`[vision] POST /vision/translate requestId=${requestId} image=${imgKind} objectId=${(body as { objectId?: string }).objectId ?? '-'}`);

  if (!body.image || (!body.image.url && !body.image.base64)) {
    return sendJson(res, 400, {
      ok: false,
      error: { code: 'INVALID_ARGUMENT', message: '`image.url` or `image.base64` is required.', retryable: false },
      provenance: { ...provenance, completedAt: now().toISOString() },
    } satisfies ServiceResult<never>);
  }

  // Abort the (possibly long, retrying) upstream call if the caller disconnects before we reply.
  const upstream = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) upstream.abort();
  });

  try {
    const translation = await translateImage(options.qwen, body.image, body.instruction, fetchImpl, upstream.signal);
    console.log(`[vision] requestId=${requestId} OK summary="${boundedSummary(translation.summary, 80)}"`);
    const result: ServiceResult<VisionTranslation> = {
      ok: true,
      summary: boundedSummary(translation.summary),
      data: translation,
      provenance: { ...provenance, completedAt: now().toISOString() },
    };
    return sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof ClientAbortError || upstream.signal.aborted) return; // caller gone; nothing to send
    const { status, err } = classify(error);
    return sendJson(res, status, {
      ok: false,
      error: err,
      provenance: { ...provenance, completedAt: now().toISOString() },
    } satisfies ServiceResult<never>);
  }
}

function classify(error: unknown): { status: number; err: ServiceError } {
  if (error instanceof ProviderError) {
    if (error.httpStatus === 401 || error.httpStatus === 403) {
      return { status: 502, err: { code: 'UNAUTHENTICATED', message: error.message, retryable: false } };
    }
    if (error.httpStatus === 429) {
      return { status: 502, err: { code: 'RATE_LIMITED', message: error.message, retryable: true } };
    }
    return { status: 502, err: { code: 'UNAVAILABLE', message: error.message, retryable: true } };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return { status: 504, err: { code: 'TIMEOUT', message: 'vision provider timed out', retryable: true } };
  }
  return { status: 500, err: { code: 'INTERNAL_ERROR', message: messageOf(error), retryable: false } };
}

function errorResult(code: ServiceError['code'], message: string, retryable: boolean): ServiceResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function boundedSummary(value: string, max = 280): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentLength = parseContentLength(req.headers['content-length']);
  if (contentLength !== null && contentLength > maxBodyBytes) {
    throw new RequestBodyTooLargeError(maxBodyBytes);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeMaxBodyBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_JSON_BODY_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Vision Router max body bytes must be a positive integer.');
  }
  return value;
}

function normalizeRuntimeToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error(`${VISION_ROUTER_RUNTIME_TOKEN_ENV} is required to start the Vision Router service.`);
  }
  return normalized;
}

function parseContentLength(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hasValidRuntimeToken(req: IncomingMessage, expectedToken: string): boolean {
  const providedToken = bearerTokenFromHeader(req.headers.authorization);
  return Boolean(providedToken) && timingSafeStringEqual(providedToken, expectedToken);
}

function bearerTokenFromHeader(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() ?? '';
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}

class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super('Request body is too large.');
  }
}
