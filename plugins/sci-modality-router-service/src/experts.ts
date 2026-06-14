import type { Modality, ModalityTranslation } from './types.js';

export interface ExpertConfig {
  /** OpenAI-compatible base URL of the expert-translator provider, e.g. http://127.0.0.1:8001/v1 */
  baseUrl: string;
  apiKey: string;
  /** Per-attempt timeout. GPU model load + inference can be slow, so wait generously. */
  timeoutMs: number;
  /** Max attempts (>= 1). Transient failures are retried — see translateModality. */
  maxAttempts: number;
  /** Exponential backoff base between attempts (ms). */
  retryBaseMs: number;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * Modality -> expert model id, as registered by the expert-translator provider
 * (see expert-translator/server.py `EXPERTS`). Each id is backed by a real model
 * running a real forward pass on GPU.
 */
export const EXPERT_MODEL: Record<Modality, string> = {
  protein: 'esm2-protein',
  nucleotide: 'nt-nucleotide',
  molecule: 'chemllm-molecule',
  single_cell: 'scibert-singlecell',
  spatial: 'scibert-spatial',
  spectrometry: 'chemberta-spectrometry',
};

// Translate-only system prompt. Mirrors the Vision Router contract: turn the
// scientific input into faithful textual evidence; do NOT reason, plan, answer
// the user, draw conclusions, or claim task completion. The expert models compose
// prose strictly from their own real numeric outputs.
const SYSTEM_PROMPT = [
  'You are a SciForge scientific-modality translator.',
  'Convert the provided non-text scientific input into concise, faithful textual evidence for another agent.',
  'Report only what the model measured: sequence/structure statistics, model scores, salient features, and uncertainty.',
  'Do not reason about the task, answer the user, give advice, draw biological/chemical conclusions,',
  'or claim task completion. You translate scientific signal into words — nothing more.',
].join(' ');

export class ProviderError extends Error {
  constructor(message: string, readonly httpStatus: number) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Raised when the HTTP caller disconnects mid-translation; stops retrying immediately. */
export class ClientAbortError extends Error {
  constructor() {
    super('modality translation aborted by caller');
    this.name = 'ClientAbortError';
  }
}

/** Could not infer the modality from the payload and the caller gave none. */
export class UndetectableModalityError extends Error {
  constructor() {
    super('could not auto-detect modality; pass an explicit `modality`');
    this.name = 'UndetectableModalityError';
  }
}

/**
 * Translate one scientific input to text via the expert-translator provider
 * (OpenAI-compatible chat/completions), retrying transient failures
 * (timeout / 5xx / 429 / network) with exponential backoff. The downstream main
 * agent cannot read these modalities, so there is no useful fallback — this
 * service is the authority on "keep trying until the expert answers". The only
 * non-retryable outcomes are auth failures (401/403) and a caller abort.
 */
export async function translateModality(
  config: ExpertConfig,
  modality: Modality,
  payload: string,
  instruction: string | undefined,
  modalitySource: 'explicit' | 'detected',
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ModalityTranslation> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    if (signal?.aborted) throw new ClientAbortError();
    try {
      return await translateOnce(config, modality, payload, instruction, modalitySource, fetchImpl, signal);
    } catch (error) {
      if (signal?.aborted) throw new ClientAbortError();
      lastError = error;
      if (attempt >= config.maxAttempts || !isRetryable(error)) throw error;
      await delay(backoffMs(attempt, config.retryBaseMs), signal);
    }
  }
  throw lastError ?? new ProviderError('expert provider call failed', 502);
}

function isRetryable(error: unknown): boolean {
  // Auth won't fix itself by retrying; everything else (timeout, 5xx, 429, network) might.
  if (error instanceof ProviderError) return error.httpStatus !== 401 && error.httpStatus !== 403;
  return true;
}

/** One expert-translator call with a per-attempt timeout. Throws ProviderError / AbortError. */
async function translateOnce(
  config: ExpertConfig,
  modality: Modality,
  payload: string,
  instruction: string | undefined,
  modalitySource: 'explicit' | 'detected',
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<ModalityTranslation> {
  const model = EXPERT_MODEL[modality];
  const userText = buildUserText(modality, payload, instruction);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  if (!response.ok) {
    throw new ProviderError(`expert provider returned HTTP ${response.status} for ${model}`, response.status);
  }
  const payloadJson = (await response.json()) as unknown;
  const summary = extractText(payloadJson).trim();
  if (!summary) throw new ProviderError(`expert ${model} returned empty content`, 502);
  return { summary, modality, model, modalitySource };
}

/**
 * Wrap the payload in the fence the expert-translator parser understands
 * (`User request context: …` + `--- <modality> input --- … --- end … ---`),
 * so each expert receives a clean (instruction, payload) split.
 */
function buildUserText(modality: Modality, payload: string, instruction: string | undefined): string {
  const head = instruction?.trim() ? `User request context: ${instruction.trim()}\n` : '';
  return `${head}--- ${modality} input ---\n${payload.trim()}\n--- end ${modality} input ---`;
}

// --- modality detection -----------------------------------------------------

const AA = 'ACDEFGHIKLMNPQRSTVWY';
const NT = 'ACGTUN';

/** Split into trimmed, non-empty lines — the shared shape every tabular detector works on. */
function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
}

/**
 * Best-effort modality detection from a raw text payload. Deliberately
 * conservative and ordered most-specific-first; throws UndetectableModalityError
 * when it cannot tell, so callers fail loudly rather than translating with the
 * wrong expert. An explicit `modality` on the request always bypasses this.
 */
export function detectModality(payload: string): Modality {
  const text = payload.trim();
  if (!text) throw new UndetectableModalityError();
  const lower = text.toLowerCase();

  // 1) Mass spectrometry: keyword, or many 2-column numeric "m/z intensity" peak rows.
  if (/\bm\/z\b|\bmass spec|\bms\/ms\b|\bspectrum\b|precursor/i.test(text) || looksLikePeakList(text)) {
    return 'spectrometry';
  }

  // 2) Spatial transcriptomics: a coordinate+feature grid ("<x> <y> <gene>" rows), an explicit
  //    x/y coordinate header, or a spatial keyword. Checked before single-cell because spatial
  //    rows also carry gene names.
  if (looksLikeSpatialGrid(text) || hasCoordinateColumns(text)) {
    return 'spatial';
  }

  // 3) Single-cell expression: gene:value tables, or a bare gene-marker list (one symbol per line).
  if (looksLikeExpressionTable(text) || looksLikeMarkerList(text)) {
    return /\b(spatial|tissue|niche)\b/i.test(lower) ? 'spatial' : 'single_cell';
  }

  // 4) Sequence payloads: only a FASTA-headed body or a single whitespace-free token
  //    qualifies — this rejects natural-language prose, whose letters otherwise overlap
  //    heavily with the 20 amino-acid codes. Strip headers, then inspect the alphabet.
  const hadHeader = /^>/m.test(text);
  const bodyTokens = text
    .replace(/^>.*$/gm, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const isSequenceShaped = hadHeader || bodyTokens.length === 1;
  if (isSequenceShaped) {
    const letters = stripToLetters(text);
    if (letters.length >= 10) {
      const ntFrac = fractionIn(letters, NT);
      if (ntFrac >= 0.9 && !looksLikeSmiles(text)) return 'nucleotide';
      const aaFrac = fractionIn(letters, AA);
      if (aaFrac >= 0.85 && !looksLikeSmiles(text)) return 'protein';
    }
  }

  // 5) SMILES / small molecule: single token with bond/branch/ring grammar.
  if (looksLikeSmiles(text)) return 'molecule';

  throw new UndetectableModalityError();
}

function stripToLetters(text: string): string {
  const body = text.replace(/^>.*$/gm, ' '); // drop FASTA headers
  return body.replace(/[^A-Za-z]/g, '').toUpperCase();
}

function fractionIn(letters: string, alphabet: string): number {
  if (!letters.length) return 0;
  let hits = 0;
  for (const ch of letters) if (alphabet.includes(ch)) hits++;
  return hits / letters.length;
}

function looksLikeSmiles(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t) || t.length < 2 || t.length > 600) return false; // SMILES is a single token
  if (!/[A-Za-z]/.test(t)) return false;
  // Bond/branch/ring grammar that sequences never contain.
  const grammar = /[()\[\]=#@+\-\\/.]|[0-9]/;
  const organic = /[BCNOPSFIbcnops]/;
  return grammar.test(t) && organic.test(t);
}

function looksLikePeakList(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 3) return false;
  let pairRows = 0;
  for (const row of rows) {
    // "mz<sep>intensity" with at least one decimal m/z value.
    if (/^\d+\.\d+[\s,;:\t]+\d+(\.\d+)?$/.test(row)) pairRows++;
  }
  return pairRows >= Math.max(3, Math.floor(rows.length * 0.6));
}

function looksLikeExpressionTable(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 2) return false;
  // gene:value or gene<tab/comma>value pairs, or a header with many gene-like columns.
  let geneValueRows = 0;
  for (const row of rows) {
    if (/^[A-Za-z][A-Za-z0-9_.-]{1,20}[\s,:=\t]+-?\d+(\.\d+)?$/.test(row)) geneValueRows++;
  }
  if (geneValueRows >= Math.max(2, Math.floor(rows.length * 0.5))) return true;
  return /\b(gene|cell|expression|counts?|umi|cluster|marker)\b/i.test(text) && /[,\t]/.test(text);
}

// Spatial transcriptomics grid: rows of "<x> <y> <gene>" (two numeric coordinates + a feature
// token), tolerating an optional "x y gene" header line. Whitespace/comma/tab separated.
function looksLikeSpatialGrid(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 3) return false;
  const headerLooksSpatial = /^x[\s,\t]+y\b/i.test(rows[0] ?? '');
  let gridRows = 0;
  for (const row of rows) {
    if (/^-?\d+(\.\d+)?[\s,\t]+-?\d+(\.\d+)?[\s,\t]+[A-Za-z][A-Za-z0-9_.-]*$/.test(row)) gridRows++;
  }
  const dataRows = rows.length - (headerLooksSpatial ? 1 : 0);
  return gridRows >= Math.max(2, Math.floor(dataRows * 0.6));
}

// Bare gene-marker list: 3+ lines, each a single gene-symbol-like token (HGNC style, contains an
// uppercase letter; rejects lowercase prose and multi-word lines).
function looksLikeMarkerList(text: string): boolean {
  const rows = nonEmptyLines(text);
  if (rows.length < 3) return false;
  let geneRows = 0;
  for (const row of rows) {
    if (/^[A-Za-z][A-Za-z0-9.-]{1,11}$/.test(row) && /[A-Z]/.test(row)) geneRows++;
  }
  return geneRows >= Math.max(3, Math.floor(rows.length * 0.8));
}

function hasCoordinateColumns(text: string): boolean {
  return /\b(x[_ ]?coord|y[_ ]?coord|spatial_?\d|array_(row|col)|imagerow|imagecol)\b/i.test(text);
}

/** Exponential backoff (base, 2×, 4×, …) capped at MAX_BACKOFF_MS. */
function backoffMs(attempt: number, base: number): number {
  return Math.min(base * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

/** Sleep that rejects (ClientAbortError) the moment the caller disconnects. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ClientAbortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ClientAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function extractText(payload: unknown): string {
  const choices = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices : [];
  const message = isRecord(choices[0]) && isRecord(choices[0].message) ? choices[0].message : {};
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) ? (asString(part.text) ?? asString(part.content) ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
