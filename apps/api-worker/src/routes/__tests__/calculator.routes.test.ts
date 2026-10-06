/**
 * Calculator + calculations route parity tests (task 3.5).
 *
 * Expectations ported from the controller suites:
 * - packages/application-api/src/calculations/__tests__/calculations.controller.test.ts
 *   (the body-honoring excise / landed-cost math — high-liability),
 * - packages/application-api/src/calculator/__tests__/calculator-result.mapper.test.ts
 *   (GET result reconstruction),
 * - apps/backend/tests/e2e/calculator.test.ts (POST lifecycle + 404s).
 *
 * The POST lifecycle additionally pins the IdempotencyDO wiring: X-Cache
 * MISS on the first calculation, HIT with the same X-Content-Hash on an
 * identical repeat, and version-aware key isolation.
 *
 * @module CalculatorRoutesTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildApp,
  byteProxyWithoutMargin,
  expectEnvelope,
  MARGIN_LADDER_AS_OF,
  openMigratedD1,
  permissiveEnv,
  request,
  seedCalculationRecord,
  seedMarginLadder,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from './harness';
import type { CostLineCode } from '../../../../../packages/core-domain/src/calculator/calculator.types';

/** Beer excise math for the fixture rule: 0.3650 €/cl ethanol × abv × litres. */
function expectedBeerExciseCents(abv: number, volumeLitres: number): number {
  return Math.round(0.365 * abv * volumeLitres * 100);
}

const AGE = { 'x-age-confirmed': 'confirmed' };

describe('POST /api/v1/calculator', () => {
  it('honors the guard stack: age gate, then handler', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    // No age confirmation → age gate denies.
    const noAge = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
    });
    await expectEnvelope(noAge, 403, {
      message: expect.stringMatching(/age confirmation required/i),
    });
  });

  it('rejects an invalid body with the controller’s joined validation message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: -1, quantity: 0, destination: 'FIN' }),
    });
    await expectEnvelope(res, 400, {
      message:
        'productId must be a positive integer; quantity must be a positive integer; ' +
        'destination must be a 2-letter ISO 3166-1 alpha-2 country code',
      error: 'ValidationError',
    });
  });

  it('404s an unknown product with the domain error message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 999, quantity: 1, destination: 'FI' }),
    });
    await expectEnvelope(res, 404, {
      message: 'Product 999 not found in product master',
    });
  });

  it('404s when the product has no retail offers', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 5 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 5, quantity: 1, destination: 'FI' }),
    });
    await expectEnvelope(res, 404, {
      message: 'No retail offers found for product 5',
    });
  });

  it('computes a MISS result, then serves an identical HIT from IdempotencyDO', async () => {
    const { db, d1 } = openMigratedD1();
    // NOT in the deposit system — an exempted container duty carries the
    // 'EXEMPTED' pseudo-version, whose entries legitimately never HIT
    // against the tax repo's active labels (Nest lookup parity).
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, { productId: 1, priceCents: 350 });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    // Distinct version labels: the live result carries both labels and
    // the lookup compares version sets — duplicate labels in this fixture
    // would legitimately produce length-mismatched misses (Nest parity).
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    const app = buildApp();
    const body = JSON.stringify({ productId: 1, quantity: 2, destination: 'FI' });
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body,
    };

    const env = permissiveEnv(d1);

    const first = await request(app, env, '/api/v1/calculator', init);
    expect(first.status).toBe(200);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const missHash = first.headers.get('X-Content-Hash');
    expect(missHash).toMatch(/^[0-9a-f]{64}$/);
    const missBody = (await first.json()) as Record<string, unknown>;

    // Shape parity with CalculatorResult — itemized, confident, disclaimed.
    expect(missBody.totalCents).toBeGreaterThan(0);
    expect(missBody.currency).toBe('EUR');
    expect(Array.isArray(missBody.itemizedCosts)).toBe(true);
    expect(missBody.calculationRecordId).toBeGreaterThan(0);

    const second = await request(app, env, '/api/v1/calculator', init);
    expect(second.status).toBe(200);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    expect(second.headers.get('X-Content-Hash')).toBe(missHash);
    const hitBody = (await second.json()) as Record<string, unknown>;
    expect(hitBody).toEqual(missBody);
  });

  it('resolves an Alko reference WITH observedAt into the live alkoBenchmark', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    // Cheapest non-alko offer becomes the calculated offer; the Alko row
    // is the benchmark reference selected by its pinned observedAt.
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'kauppa',
      priceCents: 250,
      observedAt: '2026-08-06T10:00:00.000Z',
    });
    seedOffer(db, {
      id: 12,
      productId: 1,
      merchant: 'alko',
      priceCents: 300,
      observedAt: '2026-08-05T10:00:00.000Z',
    });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 1, quantity: 1, destination: 'FI' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // 250 − 300 = −50 cents → −16.666…% → −16.7 (one decimal, half away
    // from zero). observedAt serializes to ISO 8601 on the snapshot.
    expect(body.alkoBenchmark).toEqual({
      status: 'available',
      referencePriceCents: 300,
      differenceCents: -50,
      differencePercent: -16.7,
      reliabilityStatus: 'VERIFIED',
      observedAt: '2026-08-05T10:00:00.000Z',
    });
  });

  it('pins the Koskenkorva 0.5 L case through the calculator mapping (task 1.4)', async () => {
    const { db, d1 } = openMigratedD1();
    // The seed fixture id 2 shape (packages/data-platform/src/seed/d1/
    // staging-fixtures.ts): the Koskenkorva row the 1.3 backfill and the
    // sweep both landed on — 0.5 stored litres, canonical end to end.
    seedProduct(db, {
      id: 2,
      name: 'Koskenkorva 38% 50cl PET x 10 pullon laatikko',
      manufacturer: 'Koskenkorva',
      brand: 'Koskenkorva',
      category: 'spirits',
      alcoholByVolume: 0.38,
      unitVolume: 0.5,
      containerType: 'plastic',
      regulatoryClassification: 'spirits',
      depositSystemStatus: 0,
    });
    seedOffer(db, { productId: 2, merchant: 'alks', country: 'EE', priceCents: 9870 });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'spirits',
      rate: 4.43, // €/cl ethanol — the litres under test are what matter
    });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 2, quantity: 1, destination: 'FI' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    // The stored 0.5 reaches the engines as 0.5 litres — not 500.
    expect(body.metadata.volumeLitres).toBe(0.5);
    // Excise: 4.43 €/cl × 38 % × 0.5 l = 84.17 ¢ → 84. The ml-shaped
    // regression (500 as "litres") produced 1000× this line.
    expect(body.alcoholExciseEstimate).toBe(Math.round(4.43 * 0.38 * 0.5 * 100));
    expect(body.alcoholExciseEstimate).toBe(84);
    // Container duty: 0.51 €/l × 0.5 l = 25.5 ¢ → 26 (ml bug: 2550).
    expect(body.containerDutyEstimate).toBe(26);
    // Plausibility: excise stays far below the €98.70 retail line — the
    // ≈108× artifact the plausibility rail exists for cannot appear.
    expect(body.alcoholExciseEstimate).toBeLessThan(0.05 * 9870);
  });

  it('gives a client-supplied idempotency key a verbatim cache entry', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { productId: 1 });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const init: RequestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'client-key-abc',
        ...AGE,
      },
      body: JSON.stringify({ productId: 1, quantity: 1, destination: 'FI' }),
    };

    const first = await request(app, env, '/api/v1/calculator', init);
    expect(first.headers.get('X-Cache')).toBe('MISS');
    const second = await request(app, env, '/api/v1/calculator', init);
    expect(second.headers.get('X-Cache')).toBe('HIT');

    // A different key forces a fresh calculation even for identical inputs.
    const third = await request(app, env, '/api/v1/calculator', {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'x-idempotency-key': 'other' },
    });
    expect(third.headers.get('X-Cache')).toBe('MISS');
  });

  it('rejects a classification-gate failure with 422 and the domain payload', async () => {
    const { db, d1 } = openMigratedD1();
    // 'unknown' is the canonical placeholder the gate rejects.
    seedProduct(db, { id: 1, regulatoryClassification: 'unknown' });
    seedOffer(db, { productId: 1 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 1, quantity: 1, destination: 'FI' }),
    });
    const body = await expectEnvelope(res, 422, {
      error: 'ClassificationGateRejection',
      productId: 1,
    });
    expect(typeof body.reason).toBe('string');
  });

  it('rejects a PERSONAL request with 409 NoPublishedAllowances when no allowance dataset is effective (trip-route parity)', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { productId: 1 });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
    });
    // No traveller_allowances rows at all — nothing PUBLISHED, nothing
    // effective on today (the transaction date the lookup resolves).
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        productId: 1,
        quantity: 1,
        destination: 'FI',
        transportArrangement: 'PERSONAL',
      }),
    });
    // Exact trip-routes envelope (NO_ALLOWANCE_DATASET → 409
    // NoPublishedAllowances): the message names the transaction date and
    // states no published dataset is effective — caps are never invented.
    const today = new Date().toISOString().slice(0, 10);
    await expectEnvelope(res, 409, {
      message:
        `No published traveller allowance dataset is effective on ${today} — ` +
        'a traveller-mode calculation cannot run without a bound',
      error: 'NoPublishedAllowances',
    });
  });

  it('keeps the delivery path fully available in the same no-dataset state', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1 });
    seedOffer(db, { productId: 1 });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
    });
    // Same empty-allowances state as the 409 test above.
    const app = buildApp();

    // An explicit delivery arrangement never reaches the allowance port —
    // it computes normally (design D3: delivery always available).
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        productId: 1,
        quantity: 2,
        destination: 'FI',
        transportArrangement: 'SELLER_ARRANGED',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalCents).toBeGreaterThan(0);
    expect(body.currency).toBe('EUR');
    expect(Array.isArray(body.itemizedCosts)).toBe(true);
    // No allowance bound rode along — delivery stays un-capped.
    expect(body.allowanceDatasetVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fi-locale-surface-hardening 2.2: the calculate wire carries the additive
// closed-set `code` beside the byte-identical English `label` on every
// cost line — live and on the idempotency HIT replay alike — while
// code-less legacy records keep serializing with the key absent.
// ---------------------------------------------------------------------------

/** The closed set every wire code must belong to (CostLineCode members). */
const COST_LINE_CODES: readonly CostLineCode[] = [
  'foreign_retail_price',
  'foreign_unit_price',
  'transport',
  'alcohol_excise',
  'container_duty',
  'alcohol_excise_within_allowance',
  'container_duty_within_allowance',
  'alcohol_excise_over_allowance',
  'container_duty_over_allowance',
  'import_vat',
  'import_vat_over_allowance',
  'import_vat_within_allowance',
];

/** Wire shape of one itemized cost line (the ItemizedCost surface). */
interface WireCostLine {
  label: string;
  code?: string;
  category: string;
  cents: number;
  reliability: string;
  breakdown?: WireCostLine[];
}

/** Depth-first flatten of a cost-line tree. */
function flattenCostLines(lines: readonly WireCostLine[]): WireCostLine[] {
  return lines.flatMap((line) => [
    line,
    ...(line.breakdown ? flattenCostLines(line.breakdown) : []),
  ]);
}

describe('POST /api/v1/calculator — cost-line wire contract (2.2)', () => {
  /** MISS/HIT fixture parity with the idempotency suite above. */
  async function seedCalculatableProductAndFire(): Promise<{
    missBody: Record<string, unknown>;
    hitBody: Record<string, unknown>;
  }> {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, { productId: 1, priceCents: 350 });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    const app = buildApp();
    const env = permissiveEnv(d1);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 1, quantity: 2, destination: 'FI' }),
    };

    const first = await request(app, env, '/api/v1/calculator', init);
    expect(first.status).toBe(200);
    const missBody = (await first.json()) as Record<string, unknown>;
    const second = await request(app, env, '/api/v1/calculator', init);
    expect(second.headers.get('X-Cache')).toBe('HIT');
    const hitBody = (await second.json()) as Record<string, unknown>;
    return { missBody, hitBody };
  }

  it('carries the closed-set code beside the byte-identical English label on every line', async () => {
    const { missBody } = await seedCalculatableProductAndFire();
    const lines = missBody.itemizedCosts as WireCostLine[];

    // Byte-identity: the pre-code English labels, verbatim and in order.
    expect(lines.map((line) => line.label)).toEqual([
      'Retail price',
      'Transport',
      'Alcohol excise',
      'Container duty',
    ]);
    // The additive codes — one closed-set member per line kind.
    expect(lines.map((line) => line.code)).toEqual([
      'foreign_retail_price',
      'transport',
      'alcohol_excise',
      'container_duty',
    ]);
    // The retail line's unit-price breakdown rides the same contract:
    // the label stays quantity-interpolated display copy, the code stays
    // the stable join key.
    expect(lines[0].breakdown).toEqual([
      {
        label: 'Unit price (x2)',
        code: 'foreign_unit_price',
        category: 'foreignRetailPrice',
        cents: lines[0].cents,
        reliability: lines[0].reliability,
      },
    ]);
    for (const line of flattenCostLines(lines)) {
      expect(COST_LINE_CODES).toContain(line.code);
    }
  });

  it('serves the same codes and labels on the idempotency HIT replay', async () => {
    const { missBody, hitBody } = await seedCalculatableProductAndFire();
    const missLines = flattenCostLines(missBody.itemizedCosts as WireCostLine[]);
    const hitLines = flattenCostLines(hitBody.itemizedCosts as WireCostLine[]);
    expect(hitLines.map((line) => [line.label, line.code, line.cents])).toEqual(
      missLines.map((line) => [line.label, line.code, line.cents]),
    );
    expect(hitLines.map((line) => line.code)).toContain('foreign_retail_price');
  });

  it('codes the import-VAT line and its base breakdown for a cross-border seller', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, {
      id: 2,
      name: 'Koskenkorva 38% 50cl PET x 10 pullon laatikko',
      category: 'spirits',
      alcoholByVolume: 0.38,
      unitVolume: 0.5,
      containerType: 'plastic',
      regulatoryClassification: 'spirits',
      depositSystemStatus: 0,
    });
    seedOffer(db, { productId: 2, merchant: 'alks', country: 'EE', priceCents: 9870 });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'spirits', rate: 4.43 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ productId: 2, quantity: 1, destination: 'FI' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const lines = body.itemizedCosts as WireCostLine[];

    expect(lines.map((line) => line.label)).toEqual([
      'Retail price',
      'Transport',
      'Alcohol excise',
      'Container duty',
      'Import VAT (estimated)',
    ]);
    expect(lines.map((line) => line.code)).toEqual([
      'foreign_retail_price',
      'transport',
      'alcohol_excise',
      'container_duty',
      'import_vat',
    ]);
    // The VAT base breakdown repeats the component codes (same kinds,
    // one code per kind across nesting).
    expect(lines[4].breakdown?.map((line) => line.label)).toEqual([
      'Retail price',
      'Transport',
      'Alcohol excise',
      'Container duty',
    ]);
    expect(lines[4].breakdown?.map((line) => line.code)).toEqual([
      'foreign_retail_price',
      'transport',
      'alcohol_excise',
      'container_duty',
    ]);
  });
});

describe('GET /api/v1/calculator/result/:recordId — legacy code-less breakdown (2.2)', () => {
  it('replays code-less legacy lines with the key absent — never null, labels verbatim', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    // The fixture breakdown carries no `code` — the pre-code record shape.
    seedCalculationRecord(db, { id: 9, productMasterId: 1, totalCents: 873 });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator/result/9', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const lines = body.itemizedCosts as WireCostLine[];

    // Byte-identity: the seeded legacy labels and figures replay verbatim.
    expect(lines.map((line) => line.label)).toEqual([
      'Retail price',
      'Transport',
      'Alcohol excise',
      'Container duty',
    ]);
    expect(lines.map((line) => line.cents)).toEqual([350, 500, 6, 17]);
    // Absence is the legacy state — the key is omitted, never nulled.
    for (const line of lines) {
      expect(Object.prototype.hasOwnProperty.call(line, 'code')).toBe(false);
    }
  });
});

describe('GET /api/v1/calculator/result/:recordId', () => {
  it('reconstructs the LIVE response shape from the persisted record', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Karhu III' });
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    seedCalculationRecord(db, {
      id: 9,
      productMasterId: 1,
      exciseRuleVersionId: 1,
      totalCents: 873,
      confidence: 'MEDIUM',
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator/result/9', {
      headers: AGE,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Mapper parity: flat fields are sums of the persisted breakdown lines.
    expect(body.alcoholExciseEstimate).toBe(6);
    expect(body.containerDutyEstimate).toBe(17);
    expect(body.totalCents).toBe(873);
    expect(body.confidence).toBe('MEDIUM');
    // Classification degrades factually — it is not persisted.
    expect(body.classification).toMatchObject({
      classification: 'NotPersisted',
      confidence: 'LOW',
    });
    const metadata = body.metadata as Record<string, unknown>;
    expect(metadata.productName).toBe('Karhu III');
    expect(metadata.datasetVersions).toEqual(['v3.0-2026']);
    expect(body.calculationRecordId).toBe(9);
  });

  it('404s an unknown record', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator/result/404', {
      headers: AGE,
    });
    await expectEnvelope(res, 404, {
      message: 'Calculation record 404 not found',
    });
  });

  it('400s a non-numeric record id (ParseIntPipe parity)', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator/result/abc', {
      headers: AGE,
    });
    await expectEnvelope(res, 400, {
      message: 'Validation failed (numeric string is expected)',
      error: 'Bad Request',
    });
  });
});

describe('POST /api/v1/calculations/excise', () => {
  it('calculates excise from the posted category, ABV, and volume', async () => {
    const { db, d1 } = openMigratedD1();
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/excise', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        category: 'beer',
        volumeLitres: 3.3,
        alcoholByVolume: 0.047,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    // 0.3650 €/cl × 4.7 % × 3.3 l = 0.0566 € → 6 cents (rounded).
    expect(body.exciseAmountCents).toBe(expectedBeerExciseCents(0.047, 3.3));
    expect(body.exciseAmountCents).toBe(6);
    expect(body.category).toBe('beer');
    expect(body.rateVersionId).toBe('v3.0-2026');
    expect(body.evidence.volumeLitres).toBe(3.3);
    expect(body.evidence.alcoholByVolume).toBe(0.047);
    // Effective rate: 0.3650 × 0.047 = 0.017155 €/l → 2 cents/l.
    expect(body.evidence.rateAppliedCentsPerUnit).toBe(2);
  });

  it('reflects a different posted volume (the body drives the result)', async () => {
    const { db, d1 } = openMigratedD1();
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/excise', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        category: 'beer',
        volumeLitres: 33,
        alcoholByVolume: 0.047,
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    // 0.3650 €/cl × 4.7 % × 33 l ≈ 56.61 cents → 57; a hardcoded product
    // cannot pass this.
    expect(body.exciseAmountCents).toBe(expectedBeerExciseCents(0.047, 33));
    expect(body.exciseAmountCents).toBe(57);
  });

  it('falls back with FALLBACK provenance when no rule matches the category', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/excise', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        category: 'wine',
        volumeLitres: 0.75,
        alcoholByVolume: 0.12,
      }),
    });
    const body = (await res.json()) as Record<string, any>;
    expect(body.rateVersionId).toBe('FALLBACK');
  });

  it('rejects invalid input with the joined validation message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/excise', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        category: 'mead',
        volumeLitres: -1,
        alcoholByVolume: 2,
      }),
    });
    await expectEnvelope(res, 400, {
      message:
        'category must be one of: beer, wine, spirits, intermediate, other; ' +
        'volumeLitres must be a positive number; ' +
        'alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
      error: 'ValidationError',
    });
  });
});

describe('POST /api/v1/calculations/landed-cost', () => {
  it('computes the real excise + container-duty math for the posted basket line', async () => {
    const { db, d1 } = openMigratedD1();
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        retailPriceCents: 350,
        transportCostCents: 500,
        exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047 },
        containerType: 'glass',
        containerVolumeLitres: 0.33,
        depositSystemVerified: false,
        transactionClass: 'distance-selling',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    expect(body.exciseDuty.exciseAmountCents).toBe(expectedBeerExciseCents(0.047, 0.33));
    expect(body.exciseDuty.category).toBe('beer');
    // 0.51 €/l × 0.33 l = 16.83 cents → 17.
    expect(body.containerDuty.dutyAmountCents).toBe(17);
    expect(body.containerDuty.reliability).toBe('EXACT');
    expect(body.totalCostCents).toBe(350 + 500 + body.exciseDuty.exciseAmountCents + 17);
    expect(body.currency).toBe('EUR');
    expect(body.disclaimer).toMatchObject({ language: 'fi' });
    expect(body.transactionClass).toBe('distance-selling');
  });

  it('rejects a container line missing its volume with the nested-then-joined message', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        retailPriceCents: 350,
        transportCostCents: 500,
        exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 5 },
        containerType: null,
        transactionClass: 'distance-selling',
      }),
    });
    const body = await expectEnvelope(res, 400, { error: 'ValidationError' });
    expect(body.message).toBe(
      'exciseBase: alcoholByVolume must be a decimal fraction between 0 and 1 (e.g. 0.047 for 4.7 %)',
    );
  });

  it('requires depositSystemVerified to be a boolean when containerType is present', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        retailPriceCents: 350,
        transportCostCents: 500,
        exciseBase: null,
        containerType: 'glass',
        containerVolumeLitres: 0.75,
        transactionClass: 'distance-selling',
      }),
    });
    await expectEnvelope(res, 400, {
      message: 'depositSystemVerified must be a boolean',
      error: 'ValidationError',
    });
  });

  it('carries the import-VAT term when sellerCountry differs from FI, and the total includes it', async () => {
    const { db, d1 } = openMigratedD1();
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    const app = buildApp();

    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        retailPriceCents: 350,
        transportCostCents: 500,
        exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047 },
        containerType: null,
        transactionClass: 'distance-selling',
        sellerCountry: 'DE',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;

    const exciseCents = expectedBeerExciseCents(0.047, 0.33); // 1
    const baseCents = 350 + 500 + exciseCents; // 851
    expect(body.importVat).not.toBeNull();
    // 851 × 25.5 % = 217.005 → 217 (round HALF-UP), current version.
    expect(body.importVat.vatCents).toBe(217);
    expect(body.importVat.baseCents).toBe(baseCents);
    expect(body.importVat.rateVersionId).toBe('import-vat-2024.2');
    expect(body.importVat.reliability).toBe('VERIFIED');
    expect(body.totalCostCents).toBe(baseCents + 217);
  });

  it('keeps importVat null for a domestic seller and when sellerCountry is omitted', async () => {
    const { db, d1 } = openMigratedD1();
    seedTaxRule(db, {
      taxType: 'excise',
      productCategory: 'beer',
      rate: 0.365,
    });
    const app = buildApp();
    const baseBody = {
      retailPriceCents: 350,
      transportCostCents: 500,
      exciseBase: { category: 'beer', volumeLitres: 0.33, alcoholByVolume: 0.047 },
      containerType: null,
      transactionClass: 'distance-selling',
    };

    const domestic = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({ ...baseBody, sellerCountry: 'FI' }),
    });
    expect(domestic.status).toBe(200);
    const domesticBody = (await domestic.json()) as Record<string, any>;
    expect(domesticBody.importVat).toBeNull();

    const omitted = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify(baseBody),
    });
    expect(omitted.status).toBe(200);
    const omittedBody = (await omitted.json()) as Record<string, any>;
    expect(omittedBody.importVat).toBeNull();
  });

  it('rejects a malformed sellerCountry with 400', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculations/landed-cost', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: JSON.stringify({
        retailPriceCents: 350,
        transportCostCents: 500,
        exciseBase: null,
        containerType: null,
        transactionClass: 'distance-selling',
        sellerCountry: 'DEU',
      }),
    });
    await expectEnvelope(res, 400, { error: 'ValidationError' });
  });
});

// ---------------------------------------------------------------------------
// empiricalMargin — read-time composition (task 2.2, change
// hedge-dedup-confidence-meter): display-only, after the idempotency
// store/hash, resolved from the persisted ladder — the shared fixture's
// beer|posti (0.01, 10) is the deepest floored rung for a beer result
// carried by posti. Byte-identity of every monetary figure with the
// field present vs absent is pinned in the compliance suite AND here.
// ---------------------------------------------------------------------------

describe('empiricalMargin — calculator composition (hedge-dedup-confidence-meter 2.2)', () => {
  /** The identical request every scenario fires (posti-carried beer). */
  const CALC_BODY = JSON.stringify({
    productId: 1,
    quantity: 1,
    destination: 'FI',
    transportMethod: 'posti',
  });

  /** The per-run volatile fields the byte proxy strips (alko-suite proxy). */
  const VOLATILE = (clone: Record<string, any>): void => {
    clone.metadata.calculationTimestamp = '';
    clone.calculationRecordId = 0;
    // The import-VAT line embeds its own per-compute clock read (task
    // 4.3's line shape) — the same volatile class as the top-level
    // timestamp, never a margin effect.
    for (const line of clone.itemizedCosts ?? []) {
      if (line.category === 'importVatEstimate') line.calculatedAt = '';
    }
  };

  function seedCalculableDataset(
    db: ReturnType<typeof openMigratedD1>['db'],
    offerCountry: 'DE' | 'FI' = 'DE',
  ): void {
    seedProduct(db, { id: 1, depositSystemStatus: 0 });
    seedOffer(db, {
      id: 11,
      productId: 1,
      merchant: 'kauppa',
      country: offerCountry,
      priceCents: 250,
      observedAt: '2026-08-06T10:00:00.000Z',
    });
    seedTaxRule(db, { taxType: 'excise', productCategory: 'beer', rate: 0.365 });
    seedTaxRule(db, {
      id: 2,
      taxType: 'container_duty',
      productCategory: 'all_beverages',
      rate: 0.51,
      verified: false,
      versionLabel: 'v2.0-2025',
    });
    // Independent carriage (no seller involvement): the result carries no
    // import-VAT term, so the version-aware idempotency store/lookup
    // agree on the active tax labels and a repeat can HIT — the D1
    // schema's tax_rules CHECK admits only excise/container_duty labels,
    // so an import-VAT result could never HIT in this world. The
    // transport route follows the seller country (offer country → FI),
    // so the origin tracks it too.
    db.prepare(
      `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
          weight_min_kg, weight_max_kg, package_tier, price_cents, seller_involvement_indicator)
       VALUES (90, 'posti', ?, 'FI', 0, 1, 'parcel', 150, 0)`,
    ).run(offerCountry);
  }

  async function postCalculator(
    app: ReturnType<typeof buildApp>,
    d1: ReturnType<typeof openMigratedD1>['d1'],
  ): Promise<Record<string, any>> {
    const res = await request(app, permissiveEnv(d1), '/api/v1/calculator', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: CALC_BODY,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, any>;
  }

  it('attaches the deepest floored rung with its basis beside the quantile', async () => {
    const { db, d1 } = openMigratedD1();
    seedCalculableDataset(db);
    await seedMarginLadder(db, d1);

    const body = await postCalculator(buildApp(), d1);
    expect(body.empiricalMargin).toEqual({
      quantile: 0.01,
      sampleCount: 10,
      cell: { dimension: 'category_carrier', key: 'beer|posti' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    // Display-only: the field is beside the numbers, never inside them.
    expect(Array.isArray(body.itemizedCosts)).toBe(true);
    expect(body.itemizedCosts.length).toBeGreaterThan(0);
    expect(JSON.stringify(body.itemizedCosts)).not.toContain('empiricalMargin');
  });

  it('an empty margins store leaves the key absent — never null, never a placeholder', async () => {
    const { db, d1 } = openMigratedD1();
    seedCalculableDataset(db);

    const body = await postCalculator(buildApp(), d1);
    expect(body).not.toHaveProperty('empiricalMargin');
  });

  it('the margin rides the HIT payload too — resolved fresh from the snapshot per read', async () => {
    const { db, d1 } = openMigratedD1();
    // Domestic seller: no import-VAT term, so the stored versions are
    // exactly the active labels and the repeat can HIT (module comment
    // on seedCalculableDataset).
    seedCalculableDataset(db, 'FI');
    await seedMarginLadder(db, d1);
    const app = buildApp();
    const env = permissiveEnv(d1);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...AGE },
      body: CALC_BODY,
    };

    const miss = await request(app, env, '/api/v1/calculator', init);
    expect(miss.headers.get('X-Cache')).toBe('MISS');
    const hit = await request(app, env, '/api/v1/calculator', init);
    expect(hit.headers.get('X-Cache')).toBe('HIT');
    const hitBody = (await hit.json()) as Record<string, any>;
    expect(hitBody.empiricalMargin).toEqual({
      quantile: 0.01,
      sampleCount: 10,
      cell: { dimension: 'category_carrier', key: 'beer|posti' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
  });

  it('GET result/:id attaches the same margin the live result carried', async () => {
    const { db, d1 } = openMigratedD1();
    seedCalculableDataset(db);
    await seedMarginLadder(db, d1);
    const app = buildApp();
    const env = permissiveEnv(d1);

    const posted = await postCalculator(app, d1);
    const res = await request(
      app,
      env,
      `/api/v1/calculator/result/${posted.calculationRecordId}`,
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.empiricalMargin).toEqual(posted.empiricalMargin);
  });

  it('every monetary figure is byte-identical with the field present vs absent', async () => {
    // Two fully separate compositions (fresh DO namespaces → both MISS),
    // identical seeding except the persisted ladder.
    const withLadder = openMigratedD1();
    seedCalculableDataset(withLadder.db);
    await seedMarginLadder(withLadder.db, withLadder.d1);
    const withoutLadder = openMigratedD1();
    seedCalculableDataset(withoutLadder.db);

    const present = await postCalculator(buildApp(), withLadder.d1);
    const absent = await postCalculator(buildApp(), withoutLadder.d1);

    expect(present.empiricalMargin).toBeDefined();
    expect(absent).not.toHaveProperty('empiricalMargin');
    // Totals, itemized lines, taxes, confidence, classification — the
    // whole projection minus volatile fields is byte-equal.
    expect(byteProxyWithoutMargin(present, VOLATILE)).toBe(
      byteProxyWithoutMargin(absent, VOLATILE),
    );
  });
});
