import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createPaperRadarCoreService, type PaperRadarCoreService } from './service.js';
import type { ArxivSyncRequest, BiorxivSyncRequest } from './sources.js';
import type { DigestRequest, RankRequest, SearchRequest, ServiceError, ServiceResult, TopicProfile } from './types.js';

export const SERVICE_ID = 'sciforge.paper-radar';
export const SERVICE_VERSION = '0.1.0';
export const PAPER_RADAR_RUNTIME_TOKEN_ENV = 'PAPER_RADAR_RUNTIME_TOKEN';
export const DEFAULT_MAX_JSON_BODY_BYTES = 1_000_000;

export interface PaperRadarOptions {
  dbPath: string;
  fetchImpl?: typeof fetch;
  maxBodyBytes?: number;
  now?: () => Date;
  profilesPath?: string;
  runtimeToken: string;
}

export function createPaperRadarServer(options: PaperRadarOptions): Server {
  const runtimeToken = normalizeRuntimeToken(options.runtimeToken);
  const maxBodyBytes = normalizeMaxBodyBytes(options.maxBodyBytes);
  const service = createPaperRadarCoreService({
    dbPath: options.dbPath,
    profilesPath: options.profilesPath,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  const now = options.now ?? (() => new Date());

  const server = createServer((req, res) => {
    handle(req, res, service, now, { runtimeToken, maxBodyBytes }).catch((error) => {
      const httpError = toHttpError(error);
      sendJson(res, httpError.status, errorResult(httpError.code, httpError.message, false));
    });
  });
  server.on('close', () => service.close());
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  service: PaperRadarCoreService,
  now: () => Date,
  security: { runtimeToken: string; maxBodyBytes: number },
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (!hasValidRuntimeToken(req, security.runtimeToken)) {
    return sendJson(res, 401, errorResult('UNAUTHORIZED', 'Unauthorized.', false));
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, stats: service.stats(), checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, { service: SERVICE_ID, version: SERVICE_VERSION });
  }
  if (req.method === 'POST' && url.pathname === '/sync/arxiv') {
    return syncArxivRoute(req, res, service, security.maxBodyBytes);
  }
  if (req.method === 'POST' && url.pathname === '/sync/biorxiv') {
    return syncBiorxivRoute(req, res, service, security.maxBodyBytes);
  }
  if (req.method === 'POST' && url.pathname === '/sync/profile') {
    return syncProfileRoute(req, res, service, security.maxBodyBytes);
  }
  if (req.method === 'GET' && url.pathname === '/profiles') {
    return sendJson(res, 200, ok({ profiles: service.listProfiles() }));
  }
  if (req.method === 'POST' && url.pathname === '/profiles') {
    return upsertProfileRoute(req, res, service, security.maxBodyBytes);
  }
  if (req.method === 'GET' && url.pathname === '/papers/search') {
    return searchRoute(url, res, service);
  }
  if (req.method === 'POST' && url.pathname === '/papers/rank') {
    return rankRoute(req, res, service, security.maxBodyBytes);
  }
  if (req.method === 'POST' && url.pathname === '/digest') {
    return digestRoute(req, res, service, security.maxBodyBytes);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

async function syncArxivRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as ArxivSyncRequest;
  const result = await service.syncArxiv(body);
  return sendJson(res, 200, ok(result));
}

async function syncBiorxivRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as BiorxivSyncRequest;
  const result = await service.syncBiorxiv(body);
  return sendJson(res, 200, ok(result));
}

async function syncProfileRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as { profile?: string; from?: string; to?: string; maxRecords?: number };
  const result = await service.syncProfile(body);
  return sendJson(res, 200, ok(result));
}

function searchRoute(url: URL, res: ServerResponse, service: PaperRadarCoreService): void {
  const req: SearchRequest = {
    query: url.searchParams.get('q') ?? undefined,
    sources: parseSources(url.searchParams.getAll('source')),
    categories: url.searchParams.getAll('category'),
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    topK: parseNumber(url.searchParams.get('topK')),
  };
  return sendJson(res, 200, ok(service.search(req)));
}

async function upsertProfileRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as TopicProfile;
  const profile = service.saveProfile(body);
  return sendJson(res, 200, ok({ profile }));
}

async function rankRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as RankRequest;
  return sendJson(res, 200, ok(service.rank(body)));
}

async function digestRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService, maxBodyBytes: number): Promise<void> {
  const body = (await readJson(req, maxBodyBytes)) as DigestRequest;
  return sendJson(res, 200, ok(service.digest(body)));
}

function parseSources(values: string[]): SearchRequest['sources'] {
  const sources = values.filter((value): value is 'arxiv' | 'biorxiv' => value === 'arxiv' || value === 'biorxiv');
  return sources.length ? sources : undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

function errorResult(code: ServiceError['code'], message: string, retryable: boolean): ServiceResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const contentLength = parseContentLength(req.headers['content-length']);
  if (contentLength !== null && contentLength > maxBodyBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBodyBytes} bytes.`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBodyBytes) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${maxBodyBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_ARGUMENT', 'Request body must be valid JSON.');
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRuntimeToken(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error(`${PAPER_RADAR_RUNTIME_TOKEN_ENV} is required to start the Paper Radar HTTP service.`);
  }
  return normalized;
}

function normalizeMaxBodyBytes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_JSON_BODY_BYTES;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Paper Radar max body bytes must be a positive integer.');
  }
  return value;
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

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ServiceError['code'],
    message: string,
  ) {
    super(message);
  }
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new HttpError(500, 'INTERNAL_ERROR', messageOf(error));
}
