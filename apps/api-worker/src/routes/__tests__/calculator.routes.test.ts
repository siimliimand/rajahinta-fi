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
  expectEnvelope,
  lockedEnv,
  openMigratedD1,
  permissiveEnv,
  request,
  seedCalculationRecord,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from './harness';

/** Beer excise math for the fixture rule: 0.3650 €/cl ethanol × abv × litres. */
function expectedBeerExciseCents(abv: number, volumeLitres: number): number {
  return Math.round(0.365 * abv * volumeLitres * 100);
}

const AGE = { 'x-age-confirmed': 'confirmed' };

describe('POST /api/v1/calculator', () => {
  it('honors the guard stack: launch gate, age gate, then handler', async () => {
    const { d1 } = openMigratedD1();
    const app = buildApp();

    // Gates closed → launch gate denies first (Nest guard order).
    const closed = await request(app, lockedEnv(d1), '/api/v1/calculator', {
      method: 'POST',
    });
    await expectEnvelope(closed, 403, {
      message: expect.stringMatching(/not yet publicly available/),
    });

    // Gates open, no age confirmation → age gate denies.
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
});
