import { createPaperRadarCoreService } from './service.js';

export interface DailySyncOptions {
  dbPath: string;
  profilesPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  arxivCategories: string[];
  maxRecords: number;
}

export interface DailySyncScheduler {
  runOnce: () => Promise<void>;
  stop: () => void;
}

export function startDailySync(options: DailySyncOptions, intervalMs: number): DailySyncScheduler {
  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      await runDailySync(options);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    runOnce().catch((error) => console.error(`[paper-radar] scheduled sync failed: ${messageOf(error)}`));
  }, intervalMs);
  timer.unref();

  runOnce().catch((error) => console.error(`[paper-radar] initial sync failed: ${messageOf(error)}`));

  return {
    runOnce,
    stop: () => clearInterval(timer),
  };
}

async function runDailySync(options: DailySyncOptions): Promise<void> {
  const service = createPaperRadarCoreService({
    dbPath: options.dbPath,
    profilesPath: options.profilesPath,
    fetchImpl: options.fetchImpl,
    now: options.now,
    profileStoreOptions: { persistDefault: false },
  });
  const now = options.now ?? (() => new Date());
  try {
    const today = isoDate(now());
    const yesterday = isoDate(addDays(now(), -1));
    const arxivSince = service.getSyncState('arxiv', 'last_sync_date') ?? yesterday;
    const biorxivFrom = service.getSyncState('biorxiv', 'last_sync_date') ?? yesterday;

    const arxiv = await service.syncArxiv({
      categories: options.arxivCategories,
      since: arxivSince,
      until: today,
      maxRecords: options.maxRecords,
    });
    const biorxiv = await service.syncBiorxiv({
      from: biorxivFrom,
      to: today,
      maxRecords: options.maxRecords,
    });

    console.log(
      `[paper-radar] synced metadata: arxiv=${arxiv.upserted}, biorxiv=${biorxiv.upserted}, date=${today}`,
    );
  } finally {
    service.close();
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
