import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { createSciModalityRouterServer } from './server.js';
import { detectModality, EXPERT_MODEL } from './experts.js';
import type { ExpertConfig } from './experts.js';
import type { Modality, ModalityTranslation, ServiceResult } from './types.js';

const experts: ExpertConfig = {
  baseUrl: 'http://provider.test/v1',
  apiKey: 'test-key',
  timeoutMs: 5_000,
  maxAttempts: 1,
  retryBaseMs: 1,
};

// A fake OpenAI-compatible expert-translator. Echoes the requested expert model id so tests can
// assert the router selected the right expert; never invents scientific content.
function stubFetch(reply: { status?: number; content?: (model: string) => string } = {}): {
  fetch: typeof fetch;
  lastModel: () => string | undefined;
} {
  let lastModel: string | undefined;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    assert.ok(url.endsWith('/chat/completions'), `unexpected upstream url: ${url}`);
    const sent = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    lastModel = sent.model;
    const status = reply.status ?? 200;
    const content = reply.content ? reply.content(sent.model ?? '') : `[${sent.model}] real model evidence`;
    const payload = { choices: [{ message: { content } }] };
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: impl, lastModel: () => lastModel };
}

async function withServer(
  fetchImpl: typeof fetch,
  run: (base: string) => Promise<void>,
  cfg: ExpertConfig = experts,
): Promise<void> {
  const server = createSciModalityRouterServer({ experts: cfg, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function post(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/modality/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('health and version respond, version lists six modalities', async () => {
  await withServer(stubFetch().fetch, async (base) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    const version = await (await fetch(`${base}/version`)).json();
    assert.equal(version.service, 'sciforge.sci-modality-router');
    assert.equal(version.modalities.length, 6);
  });
});

test('explicit modality routes to its expert and returns a template ServiceResult', async () => {
  const stub = stubFetch();
  await withServer(stub.fetch, async (base) => {
    const res = await post(base, { modality: 'protein', payload: 'MKTAYIAKQR', instruction: 'what is this?' });
    assert.equal(res.status, 200);
    const result = (await res.json()) as ServiceResult<ModalityTranslation>;
    assert.ok(result.ok);
    assert.equal(result.data.modality, 'protein');
    assert.equal(result.data.model, 'esm2-protein');
    assert.equal(result.data.modalitySource, 'explicit');
    assert.equal(stub.lastModel(), 'esm2-protein');
    assert.equal(result.provenance?.serviceId, 'sciforge.sci-modality-router');
    assert.equal(result.provenance?.operation, 'modality_translate');
  });
});

test('auto-detection picks the right expert for each modality', async () => {
  const cases: Array<{ payload: string; expect: Modality }> = [
    { payload: '>sp|P1\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ', expect: 'protein' },
    { payload: '>seq1\nATGCGTACGTTAGCTAGCTAGCGATCGATCGATCGTAGCTAGC', expect: 'nucleotide' },
    { payload: 'CC(=O)OC1=CC=CC=C1C(=O)O', expect: 'molecule' },
    { payload: 'GENE1\t5\nGENE2\t12\nCD3D\t8\nMS4A1\t3\nLYZ\t20', expect: 'single_cell' },
    { payload: '149.0233 1000\n151.0390 540\n179.0344 333\n193.0500 120', expect: 'spectrometry' },
  ];
  const stub = stubFetch();
  await withServer(stub.fetch, async (base) => {
    for (const c of cases) {
      const res = await post(base, { payload: c.payload });
      const result = (await res.json()) as ServiceResult<ModalityTranslation>;
      assert.ok(result.ok, `expected ok for ${c.expect}`);
      assert.equal(result.data.modality, c.expect, `payload should detect as ${c.expect}`);
      assert.equal(result.data.modalitySource, 'detected');
      assert.equal(result.data.model, EXPERT_MODEL[c.expect]);
    }
  });
});

test('missing payload is rejected with INVALID_ARGUMENT', async () => {
  await withServer(stubFetch().fetch, async (base) => {
    const res = await post(base, { modality: 'protein' });
    assert.equal(res.status, 400);
    const result = (await res.json()) as ServiceResult<never>;
    assert.equal(result.ok === false && result.error.code, 'INVALID_ARGUMENT');
  });
});

test('undetectable payload is rejected with INVALID_ARGUMENT', async () => {
  await withServer(stubFetch().fetch, async (base) => {
    const res = await post(base, { payload: 'the quick brown fox jumps over the lazy dog?!' });
    assert.equal(res.status, 400);
    const result = (await res.json()) as ServiceResult<never>;
    assert.equal(result.ok === false && result.error.code, 'INVALID_ARGUMENT');
  });
});

test('unknown explicit modality is rejected', async () => {
  await withServer(stubFetch().fetch, async (base) => {
    const res = await post(base, { modality: 'quantum', payload: 'whatever' });
    assert.equal(res.status, 400);
  });
});

test('upstream auth failure maps to UNAUTHENTICATED', async () => {
  await withServer(stubFetch({ status: 401 }).fetch, async (base) => {
    const res = await post(base, { modality: 'molecule', payload: 'CCO' });
    assert.equal(res.status, 502);
    const result = (await res.json()) as ServiceResult<never>;
    assert.equal(result.ok === false && result.error.code, 'UNAUTHENTICATED');
  });
});

test('unknown expert (provider 404) maps to NOT_FOUND, not retried', async () => {
  const res404 = stubFetch({ status: 404 });
  await withServer(
    res404.fetch,
    async (base) => {
      const res = await post(base, { modality: 'spatial', payload: 'x_coord\ty_coord\tGENE1\n1\t2\t5' });
      assert.equal(res.status, 502);
      const result = (await res.json()) as ServiceResult<never>;
      assert.equal(result.ok === false && result.error.code, 'NOT_FOUND');
    },
    { ...experts, maxAttempts: 4, retryBaseMs: 1 },
  );
});

// A stateful provider that fails the first `failures` calls with `status`, then succeeds.
function flakyFetch(failures: number, status: number): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (async () => {
    calls++;
    if (calls <= failures) return new Response('upstream busy', { status });
    const payload = { choices: [{ message: { content: '[esm2-protein] mean NLL 2.13; pseudo-perplexity 8.4' } }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls: () => calls };
}

test('retries transient 5xx then succeeds (service owns robustness)', async () => {
  const flaky = flakyFetch(2, 503);
  await withServer(
    flaky.fetch,
    async (base) => {
      const res = await post(base, { modality: 'protein', payload: 'MKTAYIAKQR' });
      assert.equal(res.status, 200);
      const result = (await res.json()) as ServiceResult<ModalityTranslation>;
      assert.ok(result.ok && /perplexity/.test(result.data.summary));
    },
    { ...experts, maxAttempts: 4, retryBaseMs: 1 },
  );
  assert.equal(flaky.calls(), 3, 'retried twice, succeeded on the third attempt');
});

test('does NOT retry auth failures (non-retryable)', async () => {
  const flaky = flakyFetch(99, 403);
  await withServer(
    flaky.fetch,
    async (base) => {
      const res = await post(base, { modality: 'protein', payload: 'MKTAYIAKQR' });
      assert.equal(res.status, 502);
    },
    { ...experts, maxAttempts: 5, retryBaseMs: 1 },
  );
  assert.equal(flaky.calls(), 1, 'auth failure is not retried');
});

// Pure detection unit checks (no server) — guards the heuristic ordering.
test('detectModality unit cases', () => {
  assert.equal(detectModality('>x\nMKTAYIAKQRQISFVKSHFSRQLEERLG'), 'protein');
  assert.equal(detectModality('ATGCGTACGTTAGCTAGCTAGCGATCGAT'), 'nucleotide');
  assert.equal(detectModality('CC(=O)OC1=CC=CC=C1C(=O)O'), 'molecule');
  assert.equal(detectModality('m/z\tintensity\n149.02\t1000\n151.04\t540'), 'spectrometry');
  // single-cell: a bare gene-marker list (one HGNC-style symbol per line)
  assert.equal(detectModality('CD3D\nCD3E\nCD8A\nGZMB\nNKG7'), 'single_cell');
  // spatial: a coordinate+feature grid (x y gene rows)
  assert.equal(detectModality('x y GENE\n0 0 CD3D\n1 0 CD3E\n10 10 EPCAM\n11 10 KRT18\n0 11 MS4A1'), 'spatial');
  assert.throws(() => detectModality('hello world this is plain prose'));
});
