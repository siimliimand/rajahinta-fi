/**
 * Dual-run parity harness tests (task 6.6, change migrate-to-cloudflare).
 *
 * Normalization (volatile-field stripping), deep payload diffing, enum
 * validation, case-runner behavior against stubbed endpoints (identical
 * payloads, mutated cents, status divergence, error-envelope parity), and
 * the golden-5 core sample — no live endpoints required.
 *
 * @module DualRunParityTests
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONFIDENCE_VALUES,
  GOLDEN_CASES,
  OriginPacer,
  RELIABILITY_VALUES,
  assertValidInput,
  diffNormalized,
  generateSampleFromBaseline,
  normalizePayload,
  parseSampleFile,
  runParity,
  runParityCase,
  validateEnums,
  type HttpResponse,
  type ParityRunHooks,
  type Transport,
} from '../dual-run-parity';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal but realistic CalculatorResult payload (200 responses). */
function resultPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemizedCosts: [
      { label: 'Retail price', category: 'basePrice', cents: 200, reliability: 'ESTIMATED' },
      { label: 'Transport', category: 'transportCost', cents: 150, reliability: 'VERIFIED' },
      { label: 'Excise duty', category: 'alcoholTax', cents: 91, reliability: 'VERIFIED' },
    ],
    excludedOffers: [],
    foreignRetailPrice: 200,
    transportCost: 150,
    alcoholExciseEstimate: 91,
    containerDutyEstimate: 0,
    totalCents: 441,
    currency: 'EUR',
    confidence: 'MEDIUM',
    confidenceBreakdown: [
      { status: 'ESTIMATED', detail: '[Price] Data point is estimated.' },
      { status: 'VERIFIED', detail: '[Excise] Data point is verified.' },
    ],
    disclaimer: { text: 'Selvitys, ei verotuspäätös.', language: 'fi', version: '1.0' },
    classification: {
      classification: 'DistanceSelling',
      confidence: 'HIGH',
      evidence: [{ observation: 'o', supportingData: 's', source: 'TravellerImport' }],
      evidenceSummary: 'summary',
    },
    metadata: {
      input: { productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' },
      calculationTimestamp: '2026-08-30T10:00:00.000Z',
      productMasterId: 1,
      retailOfferIds: [3],
      quantity: 1,
      destination: 'FI',
      productName: 'Karhu IV',
      volumeLitres: 0.33,
      alcoholByVolume: 4.7,
      category: 'beer',
      datasetVersions: ['v1.0-2024'],
    },
    ...overrides,
  };
}

const GATE_REJECTION_422 = {
  statusCode: 422,
  message: 'Product 4 lacks a regulatory classification',
  error: 'ClassificationGateRejection',
  productId: 4,
  reason: 'missing classification',
};

/** Stub transport serving canned responses per base URL. */
function stubTransport(responses: Record<string, { status: number; body: unknown }>): Transport {
  return async (url) => {
    for (const [prefix, response] of Object.entries(responses)) {
      if (url.startsWith(prefix)) {
        return { status: response.status, body: JSON.parse(JSON.stringify(response.body)) } as HttpResponse;
      }
    }
    throw new Error(`stubTransport: no stub for ${url}`);
  };
}

const ENDPOINTS = { baselineUrl: 'http://baseline.test', workerUrl: 'http://worker.test' };
const GOLDEN_CASE_1 = GOLDEN_CASES[0];

// ---------------------------------------------------------------------------
// Golden core sample
// ---------------------------------------------------------------------------

describe('GOLDEN_CASES — the always-run core sample', () => {
  it('is exactly the golden 5 (tests/golden)', () => {
    expect(GOLDEN_CASES).toHaveLength(5);
    expect(GOLDEN_CASES.map((c) => c.input.productId)).toEqual([1, 2, 3, 4, 13]);
    // Case 3 must omit transportMethod (transport-unavailable path).
    expect(GOLDEN_CASES[2].input.transportMethod).toBeUndefined();
    // Case 4 is the gate rejection; case 5 the mixed-currency run.
    expect(GOLDEN_CASES[3].name).toContain('gate-rejection');
    expect(GOLDEN_CASES[4].input.productId).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe('normalizePayload', () => {
  it('strips only the volatile fields (wall-clock timestamp, stack-local record id)', () => {
    const payload = { ...resultPayload(), calculationRecordId: 9001 };
    const normalized = normalizePayload(payload) as Record<string, Record<string, unknown>>;
    expect(normalized['calculationRecordId']).toBeUndefined();
    expect(normalized.metadata['calculationTimestamp']).toBeUndefined();
    // Everything else survives untouched.
    expect(normalized.totalCents).toBe(441);
    expect(normalized.metadata['productName']).toBe('Karhu IV');
  });

  it('does not mutate the input payload', () => {
    const payload = resultPayload();
    normalizePayload(payload);
    const metadata = payload.metadata as Record<string, unknown>;
    expect(metadata['calculationTimestamp']).toBe('2026-08-30T10:00:00.000Z');
  });

  it('strips volatile fields inside every array element (defensive)', () => {
    const payload = {
      items: [
        { id: 1, calculationRecordId: 10, metadata: { calculationTimestamp: 't1' } },
        { id: 2, calculationRecordId: 11, metadata: { calculationTimestamp: 't2' } },
      ],
    };
    const normalized = normalizePayload(payload) as {
      items: Array<{ id: number; calculationRecordId?: number; metadata?: Record<string, unknown> }>;
    };
    expect(normalized.items[0]?.calculationRecordId).toBeUndefined();
    expect(normalized.items[1]?.metadata?.calculationTimestamp).toBeUndefined();
    expect(normalized.items[1]?.id).toBe(2);
  });

  it('strips the per-request timestamp/path stamp from error envelopes', () => {
    // Both stacks' exception filters (Nest api-error.filter, Worker error
    // boundary) stamp these per request — parity would always fail on them.
    const errorBody = {
      statusCode: 422,
      message: 'Product 4 lacks a regulatory classification',
      error: 'ClassificationGateRejection',
      productId: 4,
      reason: 'missing classification',
      timestamp: '2026-08-31T05:02:47.828Z',
      path: '/api/v1/calculator',
    };
    const normalized = normalizePayload(errorBody) as Record<string, unknown>;
    expect(normalized.timestamp).toBeUndefined();
    expect(normalized.path).toBeUndefined();
    // Everything parity-relevant survives.
    expect(normalized).toMatchObject({ statusCode: 422, productId: 4, reason: 'missing classification' });
  });
});

// ---------------------------------------------------------------------------
// Enum validation
// ---------------------------------------------------------------------------

describe('validateEnums', () => {
  it('accepts a valid payload (all enum values in the domain sets)', () => {
    expect(validateEnums(resultPayload())).toEqual([]);
    for (const value of CONFIDENCE_VALUES) {
      expect(validateEnums(resultPayload({ confidence: value }))).toEqual([]);
    }
    for (const value of RELIABILITY_VALUES) {
      expect(validateEnums(resultPayload({ itemizedCosts: [{ label: 'x', category: 'basePrice', cents: 1, reliability: value }] }))).toEqual([]);
    }
  });

  it('flags a bogus confidence with its path', () => {
    const violations = validateEnums(resultPayload({ confidence: 'SURE' }));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ path: 'confidence', value: 'SURE' });
    expect(violations[0].allowed).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });

  it('flags bogus reliability and confidenceBreakdown status values with paths', () => {
    const payload = resultPayload({
      itemizedCosts: [{ label: 'x', category: 'basePrice', cents: 1, reliability: 'EXACT' }],
    });
    (payload.confidenceBreakdown as unknown[]).push({ status: 'PERFECT', detail: 'd' });
    const violations = validateEnums(payload);
    expect(violations.map((v) => v.path)).toEqual(['itemizedCosts[0].reliability', 'confidenceBreakdown[2].status']);
  });

  it('rejects a lowercase (protocol-violating) enum even though it reads fine', () => {
    expect(validateEnums(resultPayload({ confidence: 'high' }))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Deep diff
// ---------------------------------------------------------------------------

describe('diffNormalized', () => {
  it('passes structurally identical payloads regardless of key order', () => {
    expect(diffNormalized({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });

  it('detects cent mismatches at their exact path', () => {
    const diffs = diffNormalized(resultPayload(), resultPayload({ totalCents: 442 }));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ path: 'totalCents', kind: 'value-mismatch', baseline: '441', worker: '442' });
  });

  it('detects missing fields on either side (field-set equality)', () => {
    const workerPayload = resultPayload();
    delete (workerPayload as Record<string, unknown>)['excludedOffers'];
    const diffs = diffNormalized(resultPayload(), workerPayload);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].kind).toBe('missing-in-worker');

    const extraWorker = { ...resultPayload(), workerOnlyField: true };
    expect(diffNormalized(resultPayload(), extraWorker)[0].kind).toBe('missing-in-baseline');
  });

  it('detects array length and nested element differences', () => {
    const workerPayload = resultPayload({
      itemizedCosts: [{ label: 'Retail price', category: 'basePrice', cents: 200, reliability: 'ESTIMATED' }],
    });
    const diffs = diffNormalized(resultPayload(), workerPayload);
    expect(diffs[0].path).toBe('itemizedCosts.length');
  });

  it('detects nested numeric drift (itemized cents)', () => {
    const workerPayload = resultPayload();
    (workerPayload.itemizedCosts as unknown[])[2] = {
      label: 'Excise duty',
      category: 'alcoholTax',
      cents: 92,
      reliability: 'VERIFIED',
    };
    const diffs = diffNormalized(resultPayload(), workerPayload);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].path).toBe('itemizedCosts[2].cents');
  });

  it('type mismatches are reported, not thrown', () => {
    expect(diffNormalized({ a: [1] }, { a: 'x' })[0].kind).toBe('type-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Case runner + full pass against stubbed endpoints
// ---------------------------------------------------------------------------

describe('runParityCase / runParity against stubbed endpoints', () => {
  it('passes when both stacks return identical payloads', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: resultPayload() },
      'http://worker.test': { status: 200, body: resultPayload() },
    });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(true);
    expect(result.diffs).toEqual([]);
    expect(result.baselineStatus).toBe(200);
    expect(result.workerStatus).toBe(200);
  });

  it('sends confirmed-client headers (age gate traversal) on both stacks', async () => {
    const seen: string[] = [];
    const transport: Transport = async (_url, init) => {
      seen.push(String(new Headers(init.headers).get('x-age-confirmed')));
      return { status: 200, body: resultPayload() };
    };
    await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(seen).toEqual(['1', '1']);
  });

  it('ignores volatile fields (different timestamps and record ids are NOT mismatches)', async () => {
    const workerPayload = resultPayload();
    (workerPayload.metadata as Record<string, unknown>)['calculationTimestamp'] = '2026-08-30T10:00:01.500Z';
    const payload = { ...workerPayload, calculationRecordId: 7777 };
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: resultPayload() },
      'http://worker.test': { status: 200, body: payload },
    });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(true);
  });

  it('fails with a readable diff when the Worker computes different cents', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: resultPayload() },
      'http://worker.test': { status: 200, body: resultPayload({ totalCents: 440, transportCost: 149 }) },
    });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(false);
    expect(result.diffs.map((d) => d.path).sort()).toEqual(['totalCents', 'transportCost']);
  });

  it('fails on status divergence between the stacks', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: resultPayload() },
      'http://worker.test': { status: 404, body: { statusCode: 404, message: 'not found' } },
    });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(false);
    expect(result.diffs[0]).toMatchObject({ path: 'HTTP status', baseline: '200', worker: '404' });
  });

  it('treats identical 422 gate rejections as parity (golden case 4)', async () => {
    const gateCase = GOLDEN_CASES[3];
    const transport = stubTransport({
      'http://baseline.test': { status: 422, body: GATE_REJECTION_422 },
      'http://worker.test': { status: 422, body: GATE_REJECTION_422 },
    });
    const result = await runParityCase(transport, ENDPOINTS, gateCase);
    expect(result.ok).toBe(true);
  });

  it('flags a divergent 422 error envelope (message/reason differ)', async () => {
    const gateCase = GOLDEN_CASES[3];
    const transport = stubTransport({
      'http://baseline.test': { status: 422, body: GATE_REJECTION_422 },
      'http://worker.test': {
        status: 422,
        body: { ...GATE_REJECTION_422, reason: 'different reason text' },
      },
    });
    const result = await runParityCase(transport, ENDPOINTS, gateCase);
    expect(result.ok).toBe(false);
    expect(result.diffs[0].path).toBe('reason');
  });

  it('fails when a stack returns a bogus-but-equal enum value', async () => {
    const bogus = resultPayload({ confidence: 'SURE' });
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: bogus },
      'http://worker.test': { status: 200, body: bogus },
    });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(false);
    expect(result.enumViolations.map((v) => v.side).sort()).toEqual(['baseline', 'worker']);
  });

  it('reports transport failures as failed cases, not crashes', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNREFUSED');
    };
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('runs a full pass: golden + samples, zero mismatches → failed = 0', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: resultPayload() },
      'http://worker.test': { status: 200, body: resultPayload() },
    });
    const cases = [
      ...GOLDEN_CASES,
      { name: 'sample-product-5', input: { productId: 5, quantity: 2, destination: 'FI' } },
    ];
    const report = await runParity(transport, ENDPOINTS, cases, { timeoutMs: 1000, concurrency: 4 });
    expect(report.totalCases).toBe(6);
    expect(report.failed).toBe(0);
    expect(report.passed).toBe(6);
    // Report order preserves the input order (golden first).
    expect(report.cases[0].name).toBe(GOLDEN_CASES[0].name);
  });

  it('a single mismatching sample fails the whole pass', async () => {
    const transport: Transport = async (url, init) => {
      const input = JSON.parse(String(init.body)) as { productId: number };
      // Fail exactly product 99 on the worker side.
      const mutate = input.productId === 99 && url.startsWith('http://worker.test');
      const body = mutate ? resultPayload({ totalCents: 1 }) : resultPayload();
      return { status: 200, body: JSON.parse(JSON.stringify(body)) };
    };
    const cases = [
      ...GOLDEN_CASES,
      { name: 'sample-product-99', input: { productId: 99, quantity: 1, destination: 'FI' } },
    ];
    const report = await runParity(transport, ENDPOINTS, cases, { timeoutMs: 1000, concurrency: 4 });
    expect(report.failed).toBe(1);
    expect(report.cases.find((c) => c.name === 'sample-product-99')!.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rate-limit coexistence — per-origin pacing + 429 absorption
// ---------------------------------------------------------------------------

describe('rate-limit coexistence', () => {
  it('OriginPacer spaces same-origin slots and never couples distinct origins', async () => {
    const pacer = new OriginPacer(40);
    await pacer.acquire('http://a.test');
    const start = Date.now();
    await Promise.all([pacer.acquire('http://a.test'), pacer.acquire('http://b.test')]);
    const elapsed = Date.now() - start;
    // The second a.test slot waited ~40ms; b.test must not have waited.
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  it('absorbs a single 429 with Retry-After backoff and reports the retried status', async () => {
    let calculatorCalls = 0;
    const transport: Transport = async (url) => {
      if (url.endsWith('/api/v1/calculator')) {
        calculatorCalls++;
        // Exactly one 429, on whichever side asks first; the retry succeeds.
        if (calculatorCalls === 1) {
          return { status: 429, body: { statusCode: 429, error: 'TooManyRequests', retryAfterSeconds: 3 } };
        }
      }
      return { status: 200, body: resultPayload() };
    };
    const sleeps: number[] = [];
    const hooks: ParityRunHooks = { sleep: async (ms) => void sleeps.push(ms) };
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1, hooks);
    expect(result.ok).toBe(true);
    expect(calculatorCalls).toBe(3); // 2 sides + the one retry
    expect(sleeps).toEqual([3000]); // min(retryAfterSeconds*1000, cap)
  });

  it('a persistently 429ing side surfaces as a status-parity failure', async () => {
    // Worker side is persistently limited (both attempts); baseline is fine.
    const transport: Transport = async (url) =>
      url.startsWith('http://worker.test')
        ? { status: 429, body: { message: 'slow down' } }
        : { status: 200, body: resultPayload() };
    const sleeps: number[] = [];
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1, {
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result.ok).toBe(false);
    expect(result.diffs[0]).toMatchObject({ path: 'HTTP status', baseline: '200', worker: '429' });
    expect(sleeps).toEqual([5000]); // fallback backoff, capped default
  });

  it('identical 429/429 on both stacks is parity (the limiter behaves the same)', async () => {
    const transport: Transport = async () => ({ status: 429, body: { statusCode: 429, error: 'TooManyRequests', retryAfterSeconds: 1 } });
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASE_1, {
      sleep: async () => {},
    });
    expect(result.ok).toBe(true); // same rule as the 422/422 gate-rejection case
  });

  it('does not retry non-429 statuses (422 gate rejection passes through once)', async () => {
    let calls = 0;
    const transport: Transport = async () => {
      calls++;
      return { status: 422, body: GATE_REJECTION_422 };
    };
    const hooks: ParityRunHooks = { sleep: async () => expect.unreachable('no backoff for non-429') };
    const result = await runParityCase(transport, ENDPOINTS, GOLDEN_CASES[3], hooks);
    expect(result.ok).toBe(true); // identical 422s are parity
    expect(calls).toBe(2); // baseline + worker, no retries
  });

  it('runParity threads the hooks through the concurrency pool', async () => {
    const transport: Transport = async () => ({ status: 200, body: resultPayload() });
    const report = await runParity(transport, ENDPOINTS, [...GOLDEN_CASES], {
      timeoutMs: 1000,
      concurrency: 4,
      hooks: { pacer: new OriginPacer(0) }, // zero spacing: structure only
    });
    expect(report.failed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Input validation and sampling
// ---------------------------------------------------------------------------

describe('sample input handling', () => {
  it('assertValidInput rejects malformed sample entries loudly', () => {
    expect(() => assertValidInput({ productId: 0, quantity: 1, destination: 'FI' }, 'a')).toThrow(/productId/);
    expect(() => assertValidInput({ productId: 1, quantity: 0, destination: 'FI' }, 'a')).toThrow(/quantity/);
    expect(() => assertValidInput({ productId: 1, quantity: 1, destination: 'FIN' }, 'a')).toThrow(/destination/);
    expect(() =>
      assertValidInput({ productId: 1, quantity: 1, destination: 'FI', transportArrangement: 'TELEPORT' }, 'a'),
    ).toThrow(/transportArrangement/);
    expect(assertValidInput({ productId: 1, quantity: 2, destination: 'SE', transportMethod: 'dhl' }, 'a'))
      .toMatchObject({ productId: 1, destination: 'SE' });
  });

  it('parseSampleFile reads a JSON array of inputs', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'parity-')), 'samples.json');
    writeFileSync(
      path,
      JSON.stringify([
        { productId: 5, quantity: 1, destination: 'FI' },
        { productId: 6, quantity: 4, destination: 'DE', transportArrangement: 'PERSONAL' },
      ]),
    );
    const cases = parseSampleFile(path);
    expect(cases).toHaveLength(2);
    expect(cases[1]).toMatchObject({ name: 'sample-file-1', input: { productId: 6, transportArrangement: 'PERSONAL' } });
  });

  it('parseSampleFile fails on non-array content', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'parity-')), 'bad.json');
    writeFileSync(path, JSON.stringify({ productId: 1 }));
    expect(() => parseSampleFile(path)).toThrow(/JSON array/);
  });

  it('generateSampleFromBaseline maps the product list to qty-1 FI inputs', async () => {
    const transport = stubTransport({
      'http://baseline.test': {
        status: 200,
        body: { items: [{ id: 11 }, { id: 12 }, { id: 13 }], total: 3 },
      },
    });
    const cases = await generateSampleFromBaseline(transport, ENDPOINTS.baselineUrl, 3);
    expect(cases).toHaveLength(3);
    expect(cases[2]).toMatchObject({ name: 'sample-product-13', input: { productId: 13, quantity: 1, destination: 'FI' } });
  });

  it('generateSampleFromBaseline fails loudly on a non-200 product listing', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 503, body: { message: 'down' } },
    });
    await expect(
      generateSampleFromBaseline(transport, ENDPOINTS.baselineUrl, 5),
    ).rejects.toThrow(/HTTP 503.*--sample-file/);
  });

  it('generateSampleFromBaseline fails loudly when no product ids come back', async () => {
    const transport = stubTransport({
      'http://baseline.test': { status: 200, body: { items: [] } },
    });
    await expect(
      generateSampleFromBaseline(transport, ENDPOINTS.baselineUrl, 5),
    ).rejects.toThrow(/no product ids/);
  });
});
