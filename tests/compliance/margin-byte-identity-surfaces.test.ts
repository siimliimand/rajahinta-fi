/**
 * Compliance test: monetary byte-identity across all margin-touched
 * surfaces (task 5.1, change hedge-dedup-confidence-meter; design D4).
 *
 * The neutrality suite (empirical-margin-neutrality.test.ts, task 2.2)
 * fires the calculator across three margin-store states; the per-route
 * suites pin each surface in isolation. This file is the cross-surface
 * second opinion: ONE shared surface dataset, ONE calibrated ladder
 * instance, the SAME four requests fired against an EMPTY margins store
 * and the FULL three-rung ladder —
 *
 *   1. **Byte-identity per surface** — calculator, basket optimize, trip
 *      fill, and event calc produce byte-identical bodies with the
 *      margin field present and absent, once the inherently volatile
 *      per-compute clocks are stripped (the same proxy the neutrality
 *      suite uses, imported from the shared harness — extended, not
 *      replaced).
 *   2. **Non-vacuity + ladder geometry per surface** — the empty store
 *      carries no field on any surface; the full ladder resolves the
 *      DEEPEST floored rung for the calculator (category×carrier) and
 *      only the global rung for basket/trip/event (no single
 *      category/carrier to attribute — the composition documented in the
 *      routes). The field genuinely tracks the store on every surface.
 *   3. **Embed byte-identity** — the embed document for the SAME result
 *      is byte-identical with and without the margin field: the field is
 *      display-only even on the surface that renders no meter at all.
 *
 * Harness note: the api-worker route-test harness is imported by
 * relative path exactly the way empirical-margin-neutrality.test.ts is.
 * Pure, fast, no network — every composition is its own in-memory D1.
 *
 * @module MarginByteIdentitySurfacesComplianceTest
 */

import type { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';

import {
  buildApp,
  byteProxyWithoutMargin,
  MARGIN_LADDER_AS_OF,
  openMigratedD1,
  permissiveEnv,
  request,
  seedMarginLadder,
  seedOffer,
  seedProduct,
  seedTaxRule,
} from '../../apps/api-worker/src/routes/__tests__/harness';
import { D1TravellerAllowancesRepository } from '../../packages/data-platform/src/repositories/d1/traveller-allowances.repository';
import { D1ConsumptionNormsRepository } from '../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { ConsumptionNormInsert } from '../../packages/data-platform/src/repositories/d1/consumption-norms.repository';
import type { D1DatabaseLike } from '../../packages/data-platform/src/d1/executor';
import { renderEmbedCalculatorHtml } from '@rajahinta/frontend/app/[locale]/embed/calculator/view';
import type { CalculatorResult } from '@rajahinta/frontend/lib/types';

// ---------------------------------------------------------------------------
// The ONE request set — identical bytes against both store states
// ---------------------------------------------------------------------------

const AGE = { 'x-age-confirmed': 'confirmed' };

const CALC_BODY = JSON.stringify({
  productId: 1,
  quantity: 1,
  destination: 'FI',
  transportMethod: 'posti',
});

const BASKET_BODY = JSON.stringify({
  items: [{ productId: 1, quantity: 2 }],
  destination: 'FI',
});

const FILL_BODY = JSON.stringify({
  travelDate: '2026-06-01',
  items: [
    { productId: 1, maxQuantity: 10 },
    { productId: 2, maxQuantity: 10 },
  ],
});

const EVENT_BODY = JSON.stringify({
  guests: 10,
  durationHours: 4,
  eventProfile: 'casual_gathering',
  eventDate: '2026-06-01',
});

// ---------------------------------------------------------------------------
// The ONE shared surface dataset (deterministic — observedAt pinned, it
// echoes into the responses). Ids stay clear of the margin ladder's
// fixture range (products/transports 81–83, records 81–83, accounts 201+).
// ---------------------------------------------------------------------------

const PINNED_OBSERVED_AT = '2026-08-06T10:00:00.000Z';
const CITATION = 'Test citation — https://example.invalid/cited';

function seedSharedSurfaces(db: DatabaseSync): void {
  seedProduct(db, {
    id: 1,
    name: 'Karhu III 0,5 l',
    unitVolume: 0.5,
    depositSystemStatus: 0,
  });
  seedProduct(db, {
    id: 2,
    name: 'Koskenkorva 0,5 l',
    category: 'spirits',
    regulatoryClassification: 'spirits',
    unitVolume: 0.5,
  });
  seedOffer(db, {
    id: 11,
    productId: 1,
    merchant: 'alko',
    country: 'DE',
    priceCents: 250,
    observedAt: PINNED_OBSERVED_AT,
  });
  seedOffer(db, {
    id: 12,
    productId: 1,
    merchant: 's-market',
    country: 'DE',
    priceCents: 300,
    observedAt: PINNED_OBSERVED_AT,
  });
  seedOffer(db, {
    id: 21,
    productId: 2,
    merchant: 'alko',
    country: 'DE',
    priceCents: 1000,
    observedAt: PINNED_OBSERVED_AT,
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
  // The posti transport offer the calculator request matches (DE → FI,
  // parcel up to 1 kg, seller-carried).
  db.prepare(
    `INSERT INTO transport_offers (id, carrier, origin_country, destination_country,
        weight_min_kg, weight_max_kg, package_tier, price_cents, seller_involvement_indicator)
     VALUES (90, 'posti', 'DE', 'FI', 0, 1, 'parcel', 150, 1)`,
  ).run();
}

/** Publish the traveller allowances the trip fill resolves (task-8.1 path). */
async function seedPublishedFillAllowances(d1: D1DatabaseLike): Promise<void> {
  const repo = new D1TravellerAllowancesRepository(d1);
  const effectiveFrom = '2026-01-01';
  const limits = [
    { category: 'beer', volumeCapLitres: 1, quantityCap: 3 },
    { category: 'spirits', volumeCapLitres: 2, quantityCap: 4 },
  ];
  const version = await repo.createPendingVersion(
    {
      versionLabel: 'allowances-fill-2026.1',
      sourceCitation: CITATION,
      effectiveFrom,
      effectiveTo: null,
    },
    limits.map((limit) => ({
      ...limit,
      sourceCitation: CITATION,
      effectiveFrom,
      effectiveTo: null,
    })),
  );
  const published = await repo.publish(version.dataset.id, 'ops-test');
  expect(published).not.toBeNull();
}

/** Publish the consumption norm the event calculator resolves (task-4.2 path). */
async function seedPublishedNorm(d1: D1DatabaseLike): Promise<void> {
  const repo = new D1ConsumptionNormsRepository(d1);
  const row: ConsumptionNormInsert = {
    versionLabel: 'norms-test-2026.1',
    drinkType: 'beer',
    eventProfile: 'casual_gathering',
    normValuePerGuestPerHour: 0.5,
    sourceCitation: CITATION,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
  };
  const [created] = await repo.createPendingVersion([row]);
  const published = await repo.publish(created.id, 'ops-test');
  expect(published).not.toBeNull();
}

/** The per-surface volatile fields each byte proxy strips (module doc). */
const VOLATILE_CALC = (clone: Record<string, any>): void => {
  clone.metadata.calculationTimestamp = '';
  clone.calculationRecordId = 0;
  for (const line of clone.itemizedCosts ?? []) {
    if (line.category === 'importVatEstimate') line.calculatedAt = '';
  }
};

/**
 * The basket body carries the per-compute clocks in THREE places: the
 * top-level metadata, the per-alternative metadata, and the import-VAT
 * line's `calculatedAt` inside every shipment (top-level and each
 * alternative). The route suite's single-offer fixture has no
 * alternatives; this shared dataset's second offer produces one, so the
 * mutator walks them all.
 */
const VOLATILE_BASKET = (clone: Record<string, any>): void => {
  const stripBody = (body: Record<string, any>): void => {
    if (body.metadata !== undefined) {
      body.metadata.calculationTimestamp = '';
      body.metadata.calculationRecordId = 0;
    }
    for (const shipment of body.shipments ?? []) {
      for (const line of shipment.items ?? []) {
        if (line.category === 'importVatEstimate') line.calculatedAt = '';
      }
    }
  };
  stripBody(clone);
  for (const alternative of clone.alternatives ?? []) stripBody(alternative);
};

const VOLATILE_FILL = (clone: Record<string, any>): void => {
  clone.metadata.calculationTimestamp = '';
};

// The event body carries no clock read — the whole bodies are compared.

/** One full composition serving all four surfaces. */
async function runState(
  store: 'empty' | 'full',
): Promise<Record<'calc' | 'basket' | 'fill' | 'event', Record<string, any>>> {
  const { db, d1 } = openMigratedD1();
  seedSharedSurfaces(db);
  await seedPublishedFillAllowances(d1);
  await seedPublishedNorm(d1);
  if (store === 'full') await seedMarginLadder(db, d1);

  const app = buildApp();
  const env = permissiveEnv(d1);
  const post = async (path: string, body: string, extraHeaders: Record<string, string> = {}) => {
    const res = await request(app, env, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, any>;
  };

  return {
    calc: await post('/api/v1/calculator', CALC_BODY, AGE),
    basket: await post('/api/v1/basket/optimize', BASKET_BODY),
    fill: await post('/api/v1/trip/fill', FILL_BODY),
    event: await post('/api/v1/event-calc', EVENT_BODY),
  };
}

// ===========================================================================
// 1–2. Byte-identity + non-vacuity across the four wire surfaces
// ===========================================================================

describe('monetary byte-identity across margin-touched surfaces (empty vs full ladder)', () => {
  const empty = {} as Record<'calc' | 'basket' | 'fill' | 'event', Record<string, any>>;
  const full = {} as Record<'calc' | 'basket' | 'fill' | 'event', Record<string, any>>;

  it('composes both store states', async () => {
    Object.assign(empty, await runState('empty'));
    Object.assign(full, await runState('full'));
    expect(Object.keys(empty)).toHaveLength(4);
    expect(Object.keys(full)).toHaveLength(4);
  });

  it('calculator: byte-identical figures; the full ladder resolves the category×carrier rung', () => {
    expect(empty.calc).not.toHaveProperty('empiricalMargin');
    expect(full.calc.empiricalMargin).toEqual({
      quantile: 0.01,
      sampleCount: 10,
      cell: { dimension: 'category_carrier', key: 'beer|posti' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    expect(byteProxyWithoutMargin(full.calc, VOLATILE_CALC)).toBe(
      byteProxyWithoutMargin(empty.calc, VOLATILE_CALC),
    );
  });

  it('basket: byte-identical figures; only the global rung is reachable', () => {
    expect(empty.basket).not.toHaveProperty('empiricalMargin');
    expect(full.basket.empiricalMargin).toEqual({
      quantile: 0.05,
      sampleCount: 16,
      cell: { dimension: 'global', key: 'global' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    expect(byteProxyWithoutMargin(full.basket, VOLATILE_BASKET)).toBe(
      byteProxyWithoutMargin(empty.basket, VOLATILE_BASKET),
    );
  });

  it('trip fill: byte-identical figures; only the global rung is reachable', () => {
    expect(empty.fill).not.toHaveProperty('empiricalMargin');
    expect(full.fill.empiricalMargin).toEqual({
      quantile: 0.05,
      sampleCount: 16,
      cell: { dimension: 'global', key: 'global' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    expect(byteProxyWithoutMargin(full.fill, VOLATILE_FILL)).toBe(
      byteProxyWithoutMargin(empty.fill, VOLATILE_FILL),
    );
  });

  it('event calc: whole bodies byte-identical (no clock read); only the global rung is reachable', () => {
    expect(empty.event).not.toHaveProperty('empiricalMargin');
    expect(full.event.empiricalMargin).toEqual({
      quantile: 0.05,
      sampleCount: 16,
      cell: { dimension: 'global', key: 'global' },
      asOf: MARGIN_LADDER_AS_OF.toISOString(),
    });
    expect(byteProxyWithoutMargin(full.event)).toBe(
      byteProxyWithoutMargin(empty.event),
    );
  });

  it('no margin vocabulary leaks into any surface breakdown with the field present', () => {
    expect(JSON.stringify(full.basket.alternatives ?? [])).not.toContain('empiricalMargin');
    expect(JSON.stringify(full.fill.lines ?? [])).not.toContain('quantile');
    expect(JSON.stringify(full.calc.itemizedCosts ?? [])).not.toContain('empiricalMargin');
    expect(JSON.stringify(full.event.lines ?? [])).not.toContain('quantile');
  });
});

// ===========================================================================
// 3. Embed byte-identity — display-only even where no meter renders
// ===========================================================================

describe('embed document byte-identity (the surface that renders no meter)', () => {
  /** Minimal result face the embed view reads. */
  const EMBED_RESULT = {
    itemizedCosts: [
      { label: 'Retail price', category: 'foreignRetailPrice', cents: 250, reliability: 'VERIFIED' },
      { label: 'Alcohol excise', category: 'alcoholExciseEstimate', cents: 91, reliability: 'VERIFIED' },
    ],
    totalCents: 6480,
    currency: 'EUR',
    confidence: 'MEDIUM',
    disclaimer: {
      text: 'Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.',
      language: 'fi',
      version: '1.0',
    },
    metadata: {
      productName: 'Testituote',
      quantity: 1,
      datasetVersions: [],
      input: { productId: 1, quantity: 1, destination: 'FI' },
    },
  } as unknown as CalculatorResult;

  const EMBED_MARGIN = {
    quantile: 0.05,
    sampleCount: 16,
    cell: { dimension: 'global', key: 'global' },
    asOf: MARGIN_LADDER_AS_OF.toISOString(),
  };

  it('the document is byte-identical with and without the margin field', () => {
    const without = renderEmbedCalculatorHtml('fi', {
      kind: 'result',
      result: EMBED_RESULT,
    });
    const withField = renderEmbedCalculatorHtml('fi', {
      kind: 'result',
      result: { ...EMBED_RESULT, empiricalMargin: EMBED_MARGIN },
    });
    expect(withField).toBe(without);
  });

  it('the embed banner stays intact — its own disclaimer renders exactly once', () => {
    const html = renderEmbedCalculatorHtml('fi', {
      kind: 'result',
      result: { ...EMBED_RESULT, empiricalMargin: EMBED_MARGIN },
    });
    expect(html.split('class="ec-disclaimer"').length - 1).toBe(1);
    expect(
      html.split('Arvioitu kokonaishinta on arvio, ei lopullinen verovelka.')
        .length - 1,
    ).toBe(1);
    // And no meter output exists anywhere in the embed.
    expect(html).not.toContain('confidence-meter');
    expect(html).not.toContain('±');
  });
});
