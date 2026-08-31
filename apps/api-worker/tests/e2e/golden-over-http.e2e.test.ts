/**
 * Golden dataset over the served API (task 3.9).
 *
 * Runs EVERY golden case from tests/golden/golden-dataset.test.ts and
 * tests/golden/per-category.test.ts as HTTP requests against the REAL
 * Worker app, with the golden fixtures seeded into the migrated D1 schema
 * (tests/e2e/golden-fixtures.ts) and read back through the production D1
 * adapters. The golden suites' closed-form expectations are the oracle —
 * this file only transports their inputs over HTTP and re-asserts their
 * published numbers; no tax math is recomputed or duplicated here.
 *
 * Proven by G3 in a scratch Worker (spikes/g3-vertical-slice.md: 5/5
 * golden correctness through wrangler dev); this suite proves the same
 * correctness through the REAL app composition.
 *
 * @module GoldenOverHttp
 */

import { describe, it, expect } from 'vitest';
import {
  buildE2EApp,
  e2eEnv,
  expectEnvelope,
  openMigratedD1,
  postJson,
  request,
} from './harness';
import {
  seedGoldenDataset,
  seedGoldenTransport,
  type GoldenTransportSeed,
} from './golden-fixtures';

const AGE = { 'x-age-confirmed': 'confirmed' };

// ---------------------------------------------------------------------------
// Golden transport offers — verbatim from tests/golden/golden-dataset.test.ts
// ---------------------------------------------------------------------------

const OFFER_CARRIER_A: GoldenTransportSeed = {
  id: 900,
  carrier: 'carrierA',
  originCountry: 'DE',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 1 },
  packageTier: 'can',
  priceCents: 150,
  sellerInvolvementIndicator: true,
};

const OFFER_CARRIER_B: GoldenTransportSeed = {
  id: 901,
  carrier: 'carrierB',
  originCountry: 'ES',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 2 },
  packageTier: 'glass',
  priceCents: 200,
  sellerInvolvementIndicator: false,
};

const OFFER_CARRIER_SE: GoldenTransportSeed = {
  id: 902,
  carrier: 'carrierSE',
  originCountry: 'SE',
  destinationCountry: 'FI',
  weightBracket: { minKg: 0, maxKg: 1 },
  packageTier: 'can',
  priceCents: 150,
  sellerInvolvementIndicator: true,
};

/** POST /calculator with golden input; returns the parsed CalculatorResult. */
async function goldenCalculate(
  env: ReturnType<typeof e2eEnv>,
  app: ReturnType<typeof buildE2EApp>,
  input: Record<string, unknown>,
): Promise<Record<string, any>> {
  const res = await postJson(app, env, '/api/v1/calculator', input, AGE);
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return JSON.parse(text) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// golden-dataset.test.ts — Cases 1–5
// ---------------------------------------------------------------------------

describe('Golden over HTTP — golden-dataset.test.ts', () => {
  it('Case 1 — beer qty=1 carrierA: total 441 = 200 + 150 + 91 + 0, DistanceSelling HIGH, MEDIUM confidence', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    seedGoldenTransport(db, [OFFER_CARRIER_A]);
    const app = buildE2EApp();

    const result = await goldenCalculate(
      e2eEnv(d1),
      app,
      { productId: 1, quantity: 1, destination: 'FI', transportMethod: 'carrierA' },
    );

    expect(result.foreignRetailPrice).toBe(200);
    expect(result.transportCost).toBe(150);
    expect(result.alcoholExciseEstimate).toBe(91);
    expect(result.containerDutyEstimate).toBe(0);
    expect(result.totalCents).toBe(441);
    expect(result.currency).toBe('EUR');
    expect(result.classification).toMatchObject({
      classification: 'DistanceSelling',
      confidence: 'HIGH',
    });
    expect(result.confidence).toBe('MEDIUM');
    // Dead contract key stays dead over the wire (task 10.3).
    expect(JSON.parse(JSON.stringify(result))).not.toHaveProperty('otherCharges');
    // The result was persisted — the record id is real, not the in-memory stub 9000.
    expect(result.calculationRecordId).toBeGreaterThan(0);
    expect(result.metadata).toMatchObject({
      productMasterId: 1,
      quantity: 1,
      destination: 'FI',
      transportOfferId: 900,
    });
    expect(result.metadata.datasetVersions).toContain('v1.0-2024');
  });

  it('Case 1b — the persisted golden result reconstructs over GET /calculator/result/:id', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    seedGoldenTransport(db, [OFFER_CARRIER_A]);
    const app = buildE2EApp();
    const env = e2eEnv(d1);

    const posted = await goldenCalculate(env, app, {
      productId: 1,
      quantity: 1,
      destination: 'FI',
      transportMethod: 'carrierA',
    });
    const res = await request(
      app,
      env,
      `/api/v1/calculator/result/${posted.calculationRecordId}`,
      { headers: AGE },
    );
    expect(res.status).toBe(200);
    const reconstructed = (await res.json()) as Record<string, any>;
    expect(reconstructed.totalCents).toBe(441);
    expect(reconstructed.alcoholExciseEstimate).toBe(91);
    expect(reconstructed.containerDutyEstimate).toBe(0);
    expect(reconstructed.calculationRecordId).toBe(posted.calculationRecordId);
  });

  it('Case 2 — wine qty=3 carrierB: retail 900, excise 1026, transport 200 (unscaled), total 2126, DistanceBuying', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    seedGoldenTransport(db, [OFFER_CARRIER_B]);
    const app = buildE2EApp();

    const result = await goldenCalculate(
      e2eEnv(d1),
      app,
      { productId: 2, quantity: 3, destination: 'FI', transportMethod: 'carrierB' },
    );

    expect(result.foreignRetailPrice).toBe(900); // 300 × 3
    expect(result.alcoholExciseEstimate).toBe(1026); // 342 × 3
    expect(result.containerDutyEstimate).toBe(0);
    expect(result.transportCost).toBe(200); // per-shipment, not × 3
    expect(result.totalCents).toBe(2126);
    expect(result.classification).toMatchObject({ classification: 'DistanceBuying' });
    expect(result.confidence).toBe('MEDIUM');
  });

  it('Case 3 — spirits qty=1, transport unavailable: transport 0, total 2034, LOW confidence', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    // No transport rows at all — the graceful-degradation path.
    const app = buildE2EApp();

    const result = await goldenCalculate(
      e2eEnv(d1),
      app,
      { productId: 3, quantity: 1, destination: 'FI' },
    );

    expect(result.transportCost).toBe(0);
    expect(result.totalCents).toBe(2034); // 500 + 0 + 1534 + 0
    expect(result.metadata.transportOfferId).toBeNull();
    expect(result.classification).toMatchObject({ classification: 'DistanceBuying' });
    expect(result.confidence).toBe('LOW');
  });

  it('Case 4 — unclassified product: 422 ClassificationGateRejection with productId and reason', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    const app = buildE2EApp();

    const res = await postJson(
      app,
      e2eEnv(d1),
      '/api/v1/calculator',
      { productId: 4, quantity: 1, destination: 'FI' },
      AGE,
    );
    const body = await expectEnvelope(res, 422, {
      error: 'ClassificationGateRejection',
      productId: 4,
    });
    expect(String(body.reason)).toContain('classification');
  });

  it('Case 5 — mixed currency: converted SEK offer wins (112), rogue offer 114 excluded, total 441 EUR', async () => {
    const { db, d1 } = openMigratedD1();
    seedGoldenDataset(db);
    seedGoldenTransport(db, [OFFER_CARRIER_SE]);
    const app = buildE2EApp();

    const result = await goldenCalculate(
      e2eEnv(d1),
      app,
      { productId: 13, quantity: 1, destination: 'FI', transportMethod: 'carrierSE' },
    );

    expect(result.metadata.retailOfferIds).toEqual([112]);
    expect(result.foreignRetailPrice).toBe(200);
    expect(result.totalCents).toBe(441); // 200 + 150 + 91 + 0
    expect(result.currency).toBe('EUR');
    expect(result.excludedOffers).toHaveLength(1);
    expect(result.excludedOffers[0]).toEqual({
      offerId: 114,
      merchant: 'shop-se-rogue',
      country: 'SE',
      reason: 'NO_VALID_EUR_CONVERSION',
      detail: expect.stringContaining('lacks a valid EUR conversion'),
      originalPriceCents: 900,
      originalCurrency: 'SEK',
    });
    expect(result.originalRetailPrice).toEqual({ priceCents: 2264, currency: 'SEK' });
    expect(result.metadata.datasetVersions).toContain('ecb-2026-08-27.1');
    expect(result.classification).toMatchObject({
      classification: 'DistanceSelling',
      confidence: 'HIGH',
    });
  });
});

// ---------------------------------------------------------------------------
// per-category.test.ts — every category through HTTP
//
// Each case uses a UNIQUE carrier so one carrier+route+tier holds exactly
// one offer (the in-memory suite builds a fresh single-offer query per
// case; uniqueness over a shared D1 reproduces that isolation). Origin
// countries and prices are verbatim from the in-memory cases.
// ---------------------------------------------------------------------------

interface PerCategoryCase {
  readonly name: string;
  readonly productId: number;
  readonly carrier: string;
  readonly originCountry: string;
  readonly packageTier: string;
  readonly transportPriceCents: number;
  /** Closed-form golden values (per-category.test.ts oracle). */
  readonly expectExciseCents: number;
  readonly expectContainerCents: number;
  /** retail + transport + excise + container. */
  readonly expectTotalCents: number;
}

const PER_CATEGORY_CASES: PerCategoryCase[] = [
  {
    name: '2.7% beer → BEER_MID band: excise 25',
    productId: 5,
    carrier: 'pc-beer-low',
    originCountry: 'DE',
    packageTier: 'can',
    transportPriceCents: 100,
    expectExciseCents: 25, // round(28.35 × 0.027 × 0.33 × 100)
    expectContainerCents: 0, // deposit system → exempt
    expectTotalCents: 150 + 100 + 25 + 0,
  },
  {
    name: '8.5% beer → BEER_FULL band: excise 102',
    productId: 6,
    carrier: 'pc-beer-high',
    originCountry: 'DE',
    packageTier: 'glass',
    transportPriceCents: 100,
    expectExciseCents: 102, // round(36.20 × 0.085 × 0.33 × 100)
    expectContainerCents: 0,
    expectTotalCents: 250 + 100 + 102 + 0,
  },
  {
    name: '11% sparkling wine → wine bands: excise 342',
    productId: 7,
    carrier: 'pc-sparkling',
    originCountry: 'ES',
    packageTier: 'glass',
    transportPriceCents: 200,
    expectExciseCents: 342, // round(4.56 × 0.75 × 100)
    expectContainerCents: 0,
    expectTotalCents: 800 + 200 + 342 + 0,
  },
  {
    name: '15% intermediate → INTERMEDIATE_LOW: excise 284',
    productId: 8,
    carrier: 'pc-intermediate',
    originCountry: 'ES',
    packageTier: 'glass',
    transportPriceCents: 200,
    expectExciseCents: 284, // round(5.68 × 0.5 × 100)
    expectContainerCents: 0,
    expectTotalCents: 600 + 200 + 284 + 0,
  },
  {
    name: "5% other fermented → OTHER_BAND_2: excise 99",
    productId: 9,
    carrier: 'pc-other',
    originCountry: 'DE',
    packageTier: 'glass',
    transportPriceCents: 150,
    expectExciseCents: 99, // round(1.98 × 0.5 × 100)
    expectContainerCents: 0,
    expectTotalCents: 350 + 150 + 99 + 0,
  },
  {
    name: 'no-deposit beer → container duty 26',
    productId: 10,
    carrier: 'pc-no-deposit',
    originCountry: 'DE',
    packageTier: 'can',
    transportPriceCents: 150,
    expectExciseCents: 91,
    expectContainerCents: 26, // round(0.51 × 0.5 × 100)
    expectTotalCents: 180 + 150 + 91 + 26,
  },
  {
    name: '0% ABV beer → excise 0',
    productId: 11,
    carrier: 'pc-zero-abv',
    originCountry: 'DE',
    packageTier: 'can',
    transportPriceCents: 100,
    expectExciseCents: 0,
    expectContainerCents: 0,
    expectTotalCents: 120 + 100 + 0 + 0,
  },
  {
    name: 'null-deposit beer → container duty 26 ESTIMATED',
    productId: 12,
    carrier: 'pc-null-deposit',
    originCountry: 'DE',
    packageTier: 'can',
    transportPriceCents: 150,
    expectExciseCents: 91,
    expectContainerCents: 26,
    expectTotalCents: 190 + 150 + 91 + 26,
  },
];

describe('Golden over HTTP — per-category.test.ts', () => {
  for (const testCase of PER_CATEGORY_CASES) {
    it(`${testCase.name}`, async () => {
      const { db, d1 } = openMigratedD1();
      seedGoldenDataset(db);
      seedGoldenTransport(db, [
        {
          id: 10000 + testCase.productId,
          carrier: testCase.carrier,
          originCountry: testCase.originCountry,
          destinationCountry: 'FI',
          weightBracket: { minKg: 0, maxKg: 5 },
          packageTier: testCase.packageTier,
          priceCents: testCase.transportPriceCents,
          sellerInvolvementIndicator: false,
        },
      ]);
      const app = buildE2EApp();

      const result = await goldenCalculate(
        e2eEnv(d1),
        app,
        {
          productId: testCase.productId,
          quantity: 1,
          destination: 'FI',
          transportMethod: testCase.carrier,
        },
      );

      expect(result.alcoholExciseEstimate).toBe(testCase.expectExciseCents);
      expect(result.containerDutyEstimate).toBe(testCase.expectContainerCents);
      expect(result.transportCost).toBe(testCase.transportPriceCents);
      expect(result.totalCents).toBe(testCase.expectTotalCents);
      if (testCase.productId === 12) {
        const containerLine = (result.itemizedCosts as Array<Record<string, unknown>>).find(
          (line) => line.category === 'containerDutyEstimate',
        );
        expect(containerLine).toBeDefined();
        expect(containerLine!.reliability).toBe('ESTIMATED');
      }
    });
  }
});
