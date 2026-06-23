import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createPaperRadarCoreService, type PaperRadarCoreService } from './service.js';
import type { ArxivSyncRequest, BiorxivSyncRequest } from './sources.js';
import type { DigestRequest, RankRequest, SearchRequest, ServiceError, ServiceResult, TopicProfile } from './types.js';

export const SERVICE_ID = 'sciforge.paper-radar';
export const SERVICE_VERSION = '0.1.0';

export interface PaperRadarOptions {
  dbPath: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  profilesPath?: string;
}

export function createPaperRadarServer(options: PaperRadarOptions): Server {
  const service = createPaperRadarCoreService({
    dbPath: options.dbPath,
    profilesPath: options.profilesPath,
    fetchImpl: options.fetchImpl,
    now: options.now,
  });
  const now = options.now ?? (() => new Date());

  const server = createServer((req, res) => {
    handle(req, res, service, now).catch((error) => {
      sendJson(res, 500, errorResult('INTERNAL_ERROR', messageOf(error), false));
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
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: SERVICE_ID, stats: service.stats(), checkedAt: now().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/version') {
    return sendJson(res, 200, { service: SERVICE_ID, version: SERVICE_VERSION });
  }
  if (req.method === 'POST' && url.pathname === '/sync/arxiv') {
    return syncArxivRoute(req, res, service);
  }
  if (req.method === 'POST' && url.pathname === '/sync/biorxiv') {
    return syncBiorxivRoute(req, res, service);
  }
  if (req.method === 'POST' && url.pathname === '/sync/profile') {
    return syncProfileRoute(req, res, service);
  }
  if (req.method === 'GET' && url.pathname === '/profiles') {
    return sendJson(res, 200, ok({ profiles: service.listProfiles() }));
  }
  if (req.method === 'POST' && url.pathname === '/profiles') {
    return upsertProfileRoute(req, res, service);
  }
  if (req.method === 'GET' && url.pathname === '/papers/search') {
    return searchRoute(url, res, service);
  }
  if (req.method === 'POST' && url.pathname === '/papers/rank') {
    return rankRoute(req, res, service);
  }
  if (req.method === 'POST' && url.pathname === '/digest') {
    return digestRoute(req, res, service);
  }
  return sendJson(res, 404, errorResult('NOT_FOUND', `No route for ${req.method} ${url.pathname}`, false));
}

async function syncArxivRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as ArxivSyncRequest;
  const result = await service.syncArxiv(body);
  return sendJson(res, 200, ok(result));
}

async function syncBiorxivRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as BiorxivSyncRequest;
  const result = await service.syncBiorxiv(body);
  return sendJson(res, 200, ok(result));
}

async function syncProfileRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as { profile?: string; from?: string; to?: string; maxRecords?: number };
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

async function upsertProfileRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as TopicProfile;
  const profile = service.saveProfile(body);
  return sendJson(res, 200, ok({ profile }));
}

async function rankRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as RankRequest;
  return sendJson(res, 200, ok(service.rank(body)));
}

async function digestRoute(req: IncomingMessage, res: ServerResponse, service: PaperRadarCoreService): Promise<void> {
  const body = (await readJson(req)) as DigestRequest;
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

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
