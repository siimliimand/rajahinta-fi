/**
 * Historical + reports + merchants route parity tests (task 3.6).
 *
 * Expectations ported from:
 * - packages/application-api/src/historical/__tests__/historical.controller.test.ts
 *   (validation messages, summaries-only series, attribution evidence),
 * - packages/application-api/src/reports/__tests__/reports.controller.test.ts
 *   (format vocabulary, JSON mirror, CSV/HTML shapes, 404),
 * - packages/application-api/src/merchants/__tests__/merchant-reliability.controller.test.ts
 *   (factual score list, flag gate).
 *
 * @module HistoricalReportsMerchantsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  expectEnvelope,
  issueSessionToken,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedAccount,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from './harness';
import {
  serializeObservationLog,
  type ObservationLogRecord,
} from '../../../../../packages/data-platform/src/d1/observation-log';

const AGE = { 'x-age-confirmed': 'confirmed' };

// ---------------------------------------------------------------------------
// In-memory R2 bucket — the OBSERVATION_LOG binding shape
// ---------------------------------------------------------------------------

function createMemoryR2(objects: Record<string, string> = {}): unknown {
  const store = new Map<string, string>(Object.entries(objects));
  return {
    async get(key: string) {
      const body = store.get(key);
      return body === undefined
        ? null
        : { text: async () => body };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      return { objects: keys.map((key) => ({ key })), truncated: false };
    },
  };
}

function observation(
  overrides: Partial<ObservationLogRecord> & { product_id: number; merchant: string },
): ObservationLogRecord {
  return {
    id: 1,
    retail_offer_id: 11,
    observed_at: '2026-03-01T10:00:00.000Z',
    foreign_retail_price_cents: 350,
    transport_cost_cents: 500,
    transport_offer_id: null,
    excise_rule_version_id: null,
    container_duty_rule_version_id: null,
    landed_cost_cents: 850,
    input_reliability: {
      retailPrice: 'VERIFIED',
      transport: 'ESTIMATED',
      exciseRule: 'VERIFIED',
      containerDutyRule: 'ESTIMATED',
    },
    confidence: 'MEDIUM',
    ...overrides,
  };
}

/** Seed one daily summary bucket and return its row shape. */
function seedSummary(
  db: import('node:sqlite').DatabaseSync,
  summary: {
    productId: number;
    periodStart: string;
    granularity?: string;
    merchant?: string | null;
    priceMin?: number;
    priceMax?: number;
    observationCount?: number;
  },
): void {
  db.prepare(
    `INSERT INTO price_history_summaries (
       id, granularity, period_start, product_id, merchant,
       price_open_cents, price_close_cents, price_min_cents, price_max_cents,
       price_avg_cents, landed_cost_open_cents, landed_cost_close_cents,
       landed_cost_min_cents, landed_cost_max_cents, landed_cost_avg_cents,
       observation_count, strictest_reliability
     ) VALUES (?, ?, ?, ?, ?, 350, 360, ?, ?, 355, 850, 860, 840, 870, 855, ?, 'ESTIMATED')`,
  ).run(
    Math.floor(Math.random() * 1_000_000) + 1,
    summary.granularity ?? 'daily',
    summary.periodStart,
    summary.productId,
    summary.merchant ?? null,
    summary.priceMin ?? 350,
    summary.priceMax ?? 360,
    summary.observationCount ?? 3,
  );
}

// ---------------------------------------------------------------------------
// Historical
// ---------------------------------------------------------------------------

describe('GET /api/v1/products/:id/price-history', () => {
  it('is flag-gated and age-gated (guard order: flag then age)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const off = await request(app, lockedEnv(d1), '/api/v1/products/1/price-history?from=2026-01-01&to=2026-01-31');
    await expectEnvelope(off, 403, {
      message: 'Feature "HISTORICAL_PRICE_INTELLIGENCE" is not enabled',
    });

    const noAge = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/1/price-history?from=2026-01-01&to=2026-01-31',
    );
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('validates the query: required dates, order, 365-day cap, merchant length', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);

    const missing = await request(
      app,
      env,
      '/api/v1/products/1/price-history',
      { headers: AGE },
    );
    await expectEnvelope(missing, 400, {
      message:
        'from is required and must be an ISO date (YYYY-MM-DD); ' +
        'to is required and must be an ISO date (YYYY-MM-DD)',
      error: 'ValidationError',
    });

    const badGranularity = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2026-01-01&to=2026-02-01&granularity=month',
      { headers: AGE },
    );
    await expectEnvelope(badGranularity, 400, {
      message: 'granularity must be one of: day, week',
    });

    const inverted = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2026-02-01&to=2026-01-01',
      { headers: AGE },
    );
    await expectEnvelope(inverted, 400, { message: 'to must not be before from' });

    const tooWide = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2025-01-01&to=2026-01-02',
      { headers: AGE },
    );
    await expectEnvelope(tooWide, 400, {
      message: 'requested range must not exceed 365 days',
    });

    const emptyMerchant = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2026-01-01&to=2026-01-31&merchant=',
      { headers: AGE },
    );
    await expectEnvelope(emptyMerchant, 400, {
      message: 'merchant must be a non-empty string of at most 128 characters',
    });
  });

  it('404s an unknown product', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/products/999/price-history?from=2026-01-01&to=2026-01-31',
      { headers: AGE },
    );
    await expectEnvelope(res, 404, { message: 'Product 999 not found' });
  });

  it('serves the series from summaries and attributes changes from the R2 log', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
    });
    seedSummary(db, { productId: 1, periodStart: '2026-03-01' });
    seedSummary(db, { productId: 1, periodStart: '2026-03-02' });

    // Two same-merchant observations — a price move with no tax-rule
    // boundary is a MERCHANT_PRICE_CHANGE with merchantPrice evidence.
    const day1 = serializeObservationLog([
      observation({ id: 1, product_id: 1, merchant: 'alko', observed_at: '2026-03-01T10:00:00.000Z', foreign_retail_price_cents: 350, landed_cost_cents: 850 }),
    ]);
    const day2 = serializeObservationLog([
      observation({ id: 2, product_id: 1, merchant: 'alko', observed_at: '2026-03-02T10:00:00.000Z', foreign_retail_price_cents: 360, landed_cost_cents: 860 }),
    ]);

    const env = permissiveEnv(d1, {
      OBSERVATION_LOG: createMemoryR2({
        'observations/2026-03-01.jsonl': day1,
        'observations/2026-03-02.jsonl': day2,
      }),
    } as never);
    const app = buildApp();

    const res = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2026-03-01&to=2026-03-02',
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.productId).toBe(1);
    expect(body.merchant).toBeNull();
    expect(body.metric).toBe('price');
    expect(body.granularity).toBe('day');
    expect(body.series).toHaveLength(2);
    expect(body.series[0]).toMatchObject({
      periodStart: '2026-03-01',
      openCents: 350,
      closeCents: 360,
      minCents: 350,
      maxCents: 360,
      avgCents: 355,
      observationCount: 3,
      reliability: 'ESTIMATED',
    });
    // Earliest available observation comes from the R2 log.
    expect(body.earliestAvailableObservationDate).toBe('2026-03-01T10:00:00.000Z');

    expect(body.attribution).toHaveLength(1);
    expect(body.attribution[0]).toMatchObject({
      merchant: 'alko',
      classification: 'MERCHANT_PRICE_CHANGE',
      fromObservedAt: '2026-03-01T10:00:00.000Z',
      toObservedAt: '2026-03-02T10:00:00.000Z',
    });
    expect(body.attribution[0].movedInputs).toMatchObject({
      merchantPrice: true,
      exciseRule: false,
      containerDutyRule: false,
      transport: false,
    });
    // Evidence, never conclusions — rule boundaries resolve to null when
    // no version boundary was crossed.
    expect(body.attribution[0].exciseRuleBoundary).toBeNull();
  });

  it('returns an empty attribution for a single observation (no steps)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    const day1 = serializeObservationLog([
      observation({ product_id: 1, merchant: 'alko' }),
    ]);
    const env = permissiveEnv(d1, {
      OBSERVATION_LOG: createMemoryR2({
        'observations/2026-03-01.jsonl': day1,
      }),
    } as never);
    const app = buildApp();

    const res = await request(
      app,
      env,
      '/api/v1/products/1/price-history?from=2026-03-01&to=2026-03-01',
      { headers: AGE },
    );
    const body = (await res.json()) as Record<string, any>;
    expect(body.attribution).toEqual([]);
    expect(body.earliestAvailableObservationDate).toBe('2026-03-01T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/:recordId', () => {
  function seedReportFixture(db: import('node:sqlite').DatabaseSync): void {
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedCalculationRecord(db, { id: 5, productMasterId: 1, totalCents: 873 });
  }

  it('gates: flag off → 403; age gate → 403; anonymous/FREE → 403 InsufficientEntitlement', async () => {
    const { db, d1 } = openMigratedD1();
    seedReportFixture(db);
    const app = buildApp();

    const flagOff = await request(app, lockedEnv(d1), '/api/v1/reports/5');
    await expectEnvelope(flagOff, 403, {
      message: 'Feature "ADVANCED_FEATURES" is not enabled',
    });

    const noAge = await request(app, permissiveEnv(d1), '/api/v1/reports/5');
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });

    const anonymous = await request(app, permissiveEnv(d1), '/api/v1/reports/5', {
      headers: AGE,
    });
    await expectEnvelope(anonymous, 403, {
      error: 'InsufficientEntitlement',
      requiredTier: 'calculation:export',
      currentTier: 'FREE',
    });

    seedAccount(db, { id: 7, userId: 'user-7', email: 'f@example.invalid', tier: 'FREE' });
    const freeToken = await issueSessionToken(d1, 7);
    const free = await request(app, permissiveEnv(d1), '/api/v1/reports/5', {
      headers: { ...AGE, cookie: `rajahinta_session=${freeToken}` },
    });
    await expectEnvelope(free, 403, { error: 'InsufficientEntitlement' });
  });

  it('serves a lossless JSON report for a PREMIUM session', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 11, userId: 'user-11', email: 'p@example.invalid', tier: 'PREMIUM' });
    seedReportFixture(db);
    const token = await issueSessionToken(d1, 11);
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/reports/5', {
      headers: { ...AGE, cookie: `rajahinta_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.format).toBe('json');
    expect(body.recordId).toBe(5);
    // The record mirrors the persisted figures verbatim.
    expect(body.record.alcoholExciseCents).toBe(6);
    expect(body.record.containerDutyCents).toBe(17);
    expect(body.record.totalCents).toBe(873);
    expect(body.record.disclaimerText).toBe('Hinnat ovat arvioita.');
    expect(body.record.disclaimerVersion).toBe('1.0');
    expect(body.record.productName).toBe('Karhu III');
  });

  it('serves an RFC-4180 CSV attachment and a printable HTML page', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 11, userId: 'user-11', email: 'p@example.invalid', tier: 'PREMIUM' });
    seedReportFixture(db);
    const token = await issueSessionToken(d1, 11);
    const app = buildApp();
    const headers = { ...AGE, cookie: `rajahinta_session=${token}` };

    const csv = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/reports/5?format=csv',
      { headers },
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('Content-Disposition')).toBe(
      'attachment; filename="rajahinta-calculation-5.csv"',
    );
    const csvText = await csv.text();
    const lines = csvText.split('\r\n');
    expect(lines[0]).toBe(
      'record_id,label,category,amount_cents,reliability,dataset_version,language,timestamp,detail',
    );
    // Figure rows carry the record's confidence; the disclaimer is the
    // structural trailing row.
    expect(lines[1]).toContain('Alcohol excise');
    expect(lines[2]).toContain('Container duty');
    expect(lines[3]).toContain('Total');
    expect(lines[4]).toContain('Disclaimer');
    expect(lines[4]).toContain('Hinnat ovat arvioita.');

    const html = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/reports/5?format=html',
      { headers },
    );
    expect(html.status).toBe(200);
    expect(html.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    const htmlText = await html.text();
    expect(htmlText).toContain('<!DOCTYPE html>');
    expect(htmlText).toContain('Calculation report 5');
    expect(htmlText).toContain('Karhu III');
    expect(htmlText).toContain('Hinnat ovat arvioita.');
  });

  it('404s an unknown record and 400s an unsupported format', async () => {
    const { db, d1 } = openMigratedD1();
    seedAccount(db, { id: 11, userId: 'user-11', email: 'p@example.invalid', tier: 'PREMIUM' });
    const token = await issueSessionToken(d1, 11);
    const app = buildApp();
    const headers = { ...AGE, cookie: `rajahinta_session=${token}` };

    const missing = await request(app, permissiveEnv(d1), '/api/v1/reports/999', { headers });
    await expectEnvelope(missing, 404, { message: 'Calculation record 999 not found' });

    // Format validation precedes the record read (a bad format on an
    // unknown record is a 400).
    const badFormat = await request(
      app,
      permissiveEnv(d1),
      '/api/v1/reports/999?format=pdf',
      { headers },
    );
    await expectEnvelope(badFormat, 400, {
      message: "Unsupported format 'pdf'. Supported formats: json, csv, html.",
    });
  });
});

// ---------------------------------------------------------------------------
// Merchants
// ---------------------------------------------------------------------------

describe('GET /api/v1/merchants/reliability', () => {
  it('carries the PRICE_DATA gate, age gate, and ADVANCED_FEATURES flag', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const closed = await request(app, lockedEnv(d1), '/api/v1/merchants/reliability');
    await expectEnvelope(closed, 403, {
      message: expect.stringMatching(/Price data is not yet publicly available/),
    });

    const flagOff = await request(
      app,
      permissiveEnv(d1, { FF_ADVANCED_FEATURES: undefined }),
      '/api/v1/merchants/reliability',
      { headers: AGE },
    );
    await expectEnvelope(flagOff, 403, {
      message: 'Feature "ADVANCED_FEATURES" is not enabled',
    });
  });

  it('returns one factual score per merchant with current offers', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedProduct(db, { id: 2 });
    seedOffer(db, { id: 11, productId: 1, merchant: 'alko', reliabilityStatus: 'VERIFIED' });
    seedOffer(db, { id: 22, productId: 2, merchant: 'systembolaget', reliabilityStatus: 'STALE' });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/merchants/reliability', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { merchants: Array<Record<string, any>> };

    expect(body.merchants.map((m) => m.merchant)).toEqual(['alko', 'systembolaget']);
    const alko = body.merchants[0]!;
    expect(alko.offerCount).toBe(1);
    expect(alko.statusCounts).toEqual({ VERIFIED: 1, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 });
    expect(alko.statusShares.VERIFIED).toBe(1);
    expect(alko.strictestStatus).toBe('VERIFIED');
    // Governance fail-closed: no D1 source-governance store → PENDING.
    expect(alko.governancePermissionStatus).toBe('PENDING');
    expect(typeof alko.computedAt).toBe('string');
  });

  it('reports no merchants when none hold current offers', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/merchants/reliability', {
      headers: AGE,
    });
    const body = (await res.json()) as { merchants: unknown[] };
    expect(body.merchants).toEqual([]);
  });
});
