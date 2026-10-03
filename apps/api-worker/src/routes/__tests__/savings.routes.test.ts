/**
 * Savings listing route tests (task 2.3, change insight-surfaces) over
 * the FULL app composition (createApp() + registerSavingsRoutes — the
 * exact composition index.ts wires, age gate + SAVINGS limiter on the
 * route) on the fake-D1 harness.
 *
 * Pinning here: the deterministic listing order (gap bps desc, product
 * name ascending on equal gaps — twice-requested identical), the honest
 * zero state (unknown category → 200 with an empty list AND the counts,
 * never an error), the coverage counts on every response (evaluated =
 * registry count, with-reference = latest-day rows, listed = returned
 * rows), the latest-day-only read (an older day's row is invisible),
 * per-row reliability + confidence, the limit clamp (top-N by the same
 * order, capped at 100), category validation (400), the age gate
 * (403 without confirmation), and the mixed-provenance listing (task 4.3,
 * change alko-reference-matching-pipeline: direct and linked rows count,
 * order, and render identically — the link id never leaves D1).
 *
 * @module SavingsRoutesTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  buildApp,
  expectEnvelope,
  openMigratedD1,
  permissiveEnv,
  request,
  seedProduct,
} from './harness';
import { registerSavingsRoutes } from '../savings.routes';
import { D1SavingsSnapshotRepository } from '../../../../../packages/data-platform/src/repositories/d1/savings-snapshot.repository';
import type { SavingsSnapshotUpsertInput, SavingsReliabilityStatus, SavingsConfidenceGrade } from '../../../../../packages/data-platform/src/abstracts';
import type { Env } from '../../env';
import type { D1DatabaseLike } from '../../../../../packages/data-platform/src/d1/executor';

/**
 * index.ts registers the handler behind its per-route age gate and
 * SAVINGS limiter; the test composition mirrors that exactly.
 */
function savingsApp(): ReturnType<typeof buildApp> {
  const app = buildApp();
  registerSavingsRoutes(app);
  return app;
}

function savingsEnv(d1: D1DatabaseLike, overrides: Partial<Env> = {}): Env {
  return permissiveEnv(d1, overrides);
}

const AGE_OK = { 'x-age-confirmed': 'confirmed-test-token' };

const AS_OF = '2026-09-08';
const DAY_BEFORE = '2026-09-07';
const LINK_CONFIRMED_AT = '2026-09-01T00:00:00.000Z';

interface SavingsRowJson {
  productId: number;
  productName: string;
  category: string;
  merchant: string;
  merchantCountry: string;
  priceCents: number;
  observedAt: string;
  landedTotalCents: number;
  alkoReferenceCents: number;
  alkoObservedAt: string | null;
  gapCents: number;
  gapBasisPoints: number;
  reliability: string;
  confidence: string;
  taxDatasetVersion: string;
}

interface SavingsJson {
  asOf: string | null;
  category: string;
  coverage: { evaluated: number; withReference: number; listed: number };
  rows: SavingsRowJson[];
}

async function getBeerListing(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '?category=beer',
): Promise<Response> {
  return request(app, env, `/api/v1/savings${query}`, { headers: AGE_OK });
}

/** Seed one registry product plus its snapshot row (real repositories). */
async function seedSnapshot(
  db: DatabaseSync,
  d1: D1DatabaseLike,
  seed: {
    productId: number;
    name: string;
    category: string;
    gapBasisPoints: number;
    gapCents?: number;
    asOf?: string;
    reliability?: SavingsReliabilityStatus;
    confidence?: SavingsConfidenceGrade;
    merchant?: string;
    merchantCountry?: string;
    priceCents?: number;
    referenceLinkId?: number | null;
    /** Skip the product_master insert (the row already exists — a mixed-
     * provenance fixture seeds products first so the links' FK sides exist). */
    skipProductSeed?: boolean;
  },
): Promise<void> {
  if (!seed.skipProductSeed) {
    seedProduct(db, {
      id: seed.productId,
      name: seed.name,
      category: seed.category,
    });
  }
  const asOf = seed.asOf ?? AS_OF;
  const input: SavingsSnapshotUpsertInput = {
    asOf,
    productId: seed.productId,
    category: seed.category,
    bestMerchant: seed.merchant ?? 'saksoinet',
    bestMerchantCountry: seed.merchantCountry ?? 'EE',
    bestPriceCents: seed.priceCents ?? 500,
    bestObservedAt: new Date(`${asOf}T12:00:00.000Z`),
    alkoReferenceCents: 1000,
    alkoObservedAt: new Date(`${asOf}T09:00:00.000Z`),
    landedTotalCents: 1200,
    landedReliability: seed.reliability ?? 'ESTIMATED',
    confidence: seed.confidence ?? 'HIGH',
    gapCents: seed.gapCents ?? 200,
    gapBasisPoints: seed.gapBasisPoints,
    taxDatasetVersion: 'v3.0-2026',
    referenceLinkId: seed.referenceLinkId ?? null,
  };
  await new D1SavingsSnapshotRepository(d1).upsertSnapshot(input);
}

/**
 * Insert one CONFIRMED product_reference_links row (migration 0026) — the
 * live edge a linked snapshot row names as provenance. CONFIRMED requires
 * attribution (conditional CHECK), so the fixture inserts it directly with
 * a fixed operator instant; the link lifecycle itself is task 1.2's
 * repository tests' subject.
 */
function seedConfirmedLink(
  db: DatabaseSync,
  link: { id: number; foreignProductId: number; alkoProductId: number },
): void {
  db.prepare(
    `INSERT INTO product_reference_links (
       id, foreign_product_id, alko_product_id, status,
       confirmed_by, confirmed_at
     ) VALUES (?, ?, ?, 'CONFIRMED', 'savings-route-test', ?)`,
  ).run(link.id, link.foreignProductId, link.alkoProductId, LINK_CONFIRMED_AT);
}

describe('GET /api/v1/savings — deterministic listing', () => {
  it('orders by gap bps desc with the product-name tiebreak, and repeats identically', async () => {
    const { db, d1 } = openMigratedD1();
    // Equal-gap pair breaks by name ascending; the wine row and the
    // previous-day row must stay out of the beer listing and its counts.
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: 500 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Borealis Porter', category: 'beer', gapBasisPoints: 500 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapBasisPoints: 900 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Merlot Fragment', category: 'wine', gapBasisPoints: 2000 });
    await seedSnapshot(db, d1, { productId: 5, name: 'Stale Ale', category: 'beer', gapBasisPoints: 5000, asOf: DAY_BEFORE });
    const app = savingsApp();
    const env = savingsEnv(d1);

    const first = await getBeerListing(app, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as SavingsJson;
    const second = (await (await getBeerListing(app, env)).json()) as SavingsJson;

    // Deterministic order, identical across reads.
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Cider Zest', // 900 bps first
      'Aurora Lager', // 500 bps, name asc…
      'Borealis Porter', // …Aurora < Borealis
    ]);
    expect(body.rows).toEqual(second.rows);
    expect(body.asOf).toBe(AS_OF);
    expect(body.category).toBe('beer');
    // Coverage: registry count / latest-day rows (the current-day wine
    // row counts here; the stale-day row does not) / returned rows.
    expect(body.coverage).toEqual({ evaluated: 5, withReference: 4, listed: 3 });
  });

  it('carries per-row reliability, confidence, and provenance fields', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, {
      productId: 1,
      name: 'Aurora Lager',
      category: 'beer',
      gapBasisPoints: 500,
      gapCents: 200,
      reliability: 'VERIFIED',
      confidence: 'MEDIUM',
      merchant: 'systembolaget',
      merchantCountry: 'SE',
      priceCents: 750,
    });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;

    expect(body.rows).toHaveLength(1);
    const row = body.rows[0]!;
    expect(row).toMatchObject({
      productId: 1,
      productName: 'Aurora Lager',
      category: 'beer',
      merchant: 'systembolaget',
      merchantCountry: 'SE',
      priceCents: 750,
      landedTotalCents: 1200,
      alkoReferenceCents: 1000,
      gapCents: 200,
      gapBasisPoints: 500,
      reliability: 'VERIFIED',
      confidence: 'MEDIUM',
      taxDatasetVersion: 'v3.0-2026',
    });
    expect(row.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.alkoObservedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('GET /api/v1/savings — mixed provenance (direct + linked rows)', () => {
  it('counts, orders, and renders linked rows exactly like direct rows', async () => {
    const { db, d1 } = openMigratedD1();
    // Two CONFIRMED links (migration 0026): the provenance the cron v2
    // stamps on linked snapshot rows. Seeded directly — the route reads
    // savings_snapshots, never the pass or the links. Fixture order follows
    // the FKs: product rows first (both links' sides), then links, then
    // the snapshot rows that name them.
    seedProduct(db, { id: 1, name: 'Aurora Lager', category: 'beer' });
    seedProduct(db, { id: 2, name: 'Borealis Porter', category: 'beer' });
    seedProduct(db, { id: 3, name: 'Cider Zest', category: 'beer' });
    seedProduct(db, { id: 90, name: 'Alko Vertti', category: 'beer' });
    seedProduct(db, { id: 91, name: 'Alko Vertti II', category: 'beer' });
    seedConfirmedLink(db, { id: 1, foreignProductId: 2, alkoProductId: 90 });
    seedConfirmedLink(db, { id: 2, foreignProductId: 3, alkoProductId: 91 });
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: 500, skipProductSeed: true });
    await seedSnapshot(db, d1, {
      productId: 2,
      name: 'Borealis Porter',
      category: 'beer',
      gapBasisPoints: 900,
      referenceLinkId: 1,
      reliability: 'VERIFIED',
      confidence: 'MEDIUM',
      skipProductSeed: true,
    });
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapBasisPoints: 500, referenceLinkId: 2, skipProductSeed: true });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;

    // Counts are provenance-blind: registry (5) / latest-day rows whether
    // direct or linked (3) / returned rows (3).
    expect(body.coverage).toEqual({ evaluated: 5, withReference: 3, listed: 3 });
    // The pinned order is untouched by provenance: 900 bps first, the
    // equal 500-bps pair by name ascending — linked, direct, linked,
    // interleaved purely by the sort rule.
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Borealis Porter',
      'Aurora Lager',
      'Cider Zest',
    ]);
    // Identical row shape across provenance — the frontend contract is
    // unchanged, and the link id stays in D1 (backend-only provenance).
    const expectedKeys = [
      'alkoObservedAt', 'alkoReferenceCents', 'category', 'confidence',
      'gapBasisPoints', 'gapCents', 'landedTotalCents', 'merchant',
      'merchantCountry', 'observedAt', 'priceCents', 'productId',
      'productName', 'reliability', 'taxDatasetVersion',
    ];
    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(expectedKeys);
    }
    // The per-row figures flow for linked rows exactly as for direct ones.
    expect(body.rows[0]).toMatchObject({
      productId: 2,
      merchant: 'saksoinet',
      merchantCountry: 'EE',
      reliability: 'VERIFIED',
      confidence: 'MEDIUM',
    });
  });
});

describe('GET /api/v1/savings — honest zero states and coverage', () => {
  it('returns 200 with an empty list AND the coverage counts for an unknown category', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: 500 });
    const app = savingsApp();

    const res = await request(app, savingsEnv(d1), '/api/v1/savings?category=mead', {
      headers: AGE_OK,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SavingsJson;
    expect(body.rows).toEqual([]);
    expect(body.asOf).toBe(AS_OF);
    expect(body.coverage).toEqual({ evaluated: 1, withReference: 1, listed: 0 });
  });

  it('answers with a null as-of and zeroed snapshot counts before the first pass', async () => {
    const { db, d1 } = openMigratedD1();
    seedProduct(db, { id: 1, name: 'Aurora Lager', category: 'beer' });
    const app = savingsApp();

    const res = await getBeerListing(app, savingsEnv(d1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as SavingsJson;
    expect(body.asOf).toBeNull();
    expect(body.rows).toEqual([]);
    expect(body.coverage).toEqual({ evaluated: 1, withReference: 0, listed: 0 });
  });
});

describe('GET /api/v1/savings — limit clamp', () => {
  async function seedThreeBeerRows(db: DatabaseSync, d1: D1DatabaseLike): Promise<void> {
    await seedSnapshot(db, d1, { productId: 1, name: 'Ale A', category: 'beer', gapBasisPoints: 100 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Ale B', category: 'beer', gapBasisPoints: 300 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Ale C', category: 'beer', gapBasisPoints: 200 });
  }

  it('returns the top-N rows in listing order for a small limit', async () => {
    const { db, d1 } = openMigratedD1();
    await seedThreeBeerRows(db, d1);
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=2')
    ).json()) as SavingsJson;
    expect(body.rows.map((r) => r.productName)).toEqual(['Ale B', 'Ale C']);
    expect(body.coverage.listed).toBe(2);
    // The counts stay honest above the clamp.
    expect(body.coverage.withReference).toBe(3);
  });

  it('falls back to the default on a malformed limit and caps at 100', async () => {
    const { db, d1 } = openMigratedD1();
    await seedThreeBeerRows(db, d1);
    const app = savingsApp();

    const malformed = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=potato')
    ).json()) as SavingsJson;
    expect(malformed.rows).toHaveLength(3);

    // 101 qualifying rows — the hard cap trims the listing to 100.
    for (let id = 10; id <= 110; id++) {
      await seedSnapshot(db, d1, {
        productId: id,
        name: `Bulk Ale ${id}`,
        category: 'beer',
        gapBasisPoints: id,
      });
    }
    const capped = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=500')
    ).json()) as SavingsJson;
    expect(capped.rows).toHaveLength(100);
    expect(capped.coverage.listed).toBe(100);
  });
});

describe('GET /api/v1/savings — validation and age gate', () => {
  it.each([
    ['missing', ''],
    ['blank', '?category=%20%20'],
  ])('rejects a %s category with 400', async (_label, query) => {
    const { d1 } = openMigratedD1();
    const app = savingsApp();
    await expectEnvelope(
      await request(app, savingsEnv(d1), `/api/v1/savings${query}`, {
        headers: AGE_OK,
      }),
      400,
      { error: 'ValidationError' },
    );
  });

  it('denies an unconfirmed caller with 403 AGE_GATE_REQUIRED and admits a confirmed one', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: 500 });
    const app = savingsApp();
    const env = savingsEnv(d1);

    await expectEnvelope(
      await request(app, env, '/api/v1/savings?category=beer', {}),
      403,
      { error: 'Forbidden', code: 'AGE_GATE_REQUIRED' },
    );
    const ok = await getBeerListing(app, env);
    expect(ok.status).toBe(200);
  });
});
