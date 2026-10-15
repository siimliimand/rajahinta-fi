/**
 * Savings listing route tests (task 2.3, change insight-surfaces) over
 * the FULL app composition (createApp() + registerSavingsRoutes — the
 * exact composition index.ts wires, age gate + SAVINGS limiter on the
 * route) on the fake-D1 harness.
 *
 * Pinning here: the deterministic listing order (gap bps asc — the
 * largest saving first — product name ascending on equal gaps —
 * twice-requested identical), the honest
 * zero state (unknown category → 200 with an empty list AND the counts,
 * never an error), the coverage counts on every response (evaluated =
 * registry count, with-reference = latest-day rows, listed = returned
 * rows), the honest-framing eligibility (change savings-honest-framing:
 * only negative-gap non-self-paired rows list, `hasFavourable` marks a
 * category with a surviving row, and /top's contract stays untouched),
 * the latest-day-only read (an older day's row is invisible),
 * per-row reliability + confidence, the limit clamp (top-N by the same
 * order, default 200, capped at 500), category validation (400), the
 * age gate (403 without confirmation), and the mixed-provenance listing
 * (task 4.3, change alko-reference-matching-pipeline: direct and linked
 * rows count, order, and render identically — the link id never leaves
 * D1).
 *
 * Fixture rows are import-favourable by default (negative gap — the
 * listing's subject); a dearer-than-reference row is seeded with an
 * explicit positive `gapCents`.
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
  hasFavourable: boolean;
  rows: SavingsRowJson[];
}

async function getBeerListing(
  app: ReturnType<typeof buildApp>,
  env: Env,
  query = '?category=beer',
): Promise<Response> {
  return request(app, env, `/api/v1/savings${query}`, { headers: AGE_OK });
}

/**
 * Seed one registry product plus its snapshot row (real repositories).
 * The default gap is import-favourable (negative) — the listing's
 * subject; a dearer-than-reference row passes an explicit positive
 * `gapCents`.
 */
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
    gapCents: seed.gapCents ?? -200,
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
  it('orders by gap bps asc (largest saving first) with the product-name tiebreak, and repeats identically', async () => {
    const { db, d1 } = openMigratedD1();
    // Equal-gap pair breaks by name ascending; the wine row and the
    // previous-day row must stay out of the beer listing and its counts.
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: -900 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Borealis Porter', category: 'beer', gapBasisPoints: -900 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapBasisPoints: -500 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Merlot Fragment', category: 'wine', gapBasisPoints: -2000 });
    await seedSnapshot(db, d1, { productId: 5, name: 'Stale Ale', category: 'beer', gapBasisPoints: -5000, asOf: DAY_BEFORE });
    const app = savingsApp();
    const env = savingsEnv(d1);

    const first = await getBeerListing(app, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as SavingsJson;
    const second = (await (await getBeerListing(app, env)).json()) as SavingsJson;

    // Deterministic order, identical across reads: gap ascending — the
    // −900-bps rows (the larger savings here) lead, name asc on the tie.
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Aurora Lager', // −900 bps first, name asc…
      'Borealis Porter', // …Aurora < Borealis
      'Cider Zest', // −500 bps (smallest saving) last
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
      gapBasisPoints: -500,
      gapCents: -200,
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
      gapCents: -200,
      gapBasisPoints: -500,
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
    await seedSnapshot(db, d1, { productId: 1, name: 'Aurora Lager', category: 'beer', gapBasisPoints: -900, skipProductSeed: true });
    await seedSnapshot(db, d1, {
      productId: 2,
      name: 'Borealis Porter',
      category: 'beer',
      gapBasisPoints: -500,
      referenceLinkId: 1,
      reliability: 'VERIFIED',
      confidence: 'MEDIUM',
      skipProductSeed: true,
    });
    await seedSnapshot(db, d1, { productId: 3, name: 'Cider Zest', category: 'beer', gapBasisPoints: -900, referenceLinkId: 2, skipProductSeed: true });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;

    // Counts are provenance-blind: registry (5) / latest-day rows whether
    // direct or linked (3) / returned rows (3).
    expect(body.coverage).toEqual({ evaluated: 5, withReference: 3, listed: 3 });
    // The pinned order is untouched by provenance: the equal −900-bps
    // pair by name ascending first, −500 bps last — direct, linked,
    // linked, interleaved purely by the sort rule.
    expect(body.rows.map((r) => r.productName)).toEqual([
      'Aurora Lager',
      'Cider Zest',
      'Borealis Porter',
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
    // The per-row figures flow for linked rows exactly as for direct ones
    // (the −500-bps linked row is last in ascending order).
    expect(body.rows[2]).toMatchObject({
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

describe('GET /api/v1/savings — honest-framing eligibility (savings-honest-framing)', () => {
  it('answers the honest zero state — empty rows, hasFavourable: false, populated counts — when the category holds no negative-gap row', async () => {
    const { db, d1 } = openMigratedD1();
    // Every beer row is dearer than its reference (positive gap): the
    // listing admits none of them — never the least-negative loss.
    await seedSnapshot(db, d1, { productId: 1, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Dearer Porter', category: 'beer', gapCents: 300, gapBasisPoints: 750 });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;

    expect(body.asOf).toBe(AS_OF);
    expect(body.rows).toEqual([]);
    expect(body.hasFavourable).toBe(false);
    // The counts stay populated: the rows materialized — they are just
    // not eligible savings.
    expect(body.coverage).toEqual({ evaluated: 2, withReference: 2, listed: 0 });
    // The marker sits between coverage and rows — the key order is
    // fixed by construction.
    expect(Object.keys(body)).toEqual([
      'asOf', 'category', 'coverage', 'hasFavourable', 'rows',
    ]);
  });

  it('excludes the self-paired row (Alko offer vs its own reference) while the cross-border sibling survives', async () => {
    const { db, d1 } = openMigratedD1();
    // The self-pair: an `alko` offer sits against Alko's own reference —
    // no cross-border comparison — so it stays out of the listing even
    // with the favourable gap sign.
    await seedSnapshot(db, d1, {
      productId: 1,
      name: 'Alko Own Ale',
      category: 'beer',
      gapCents: -400,
      gapBasisPoints: -1000,
      merchant: 'alko',
      merchantCountry: 'FI',
    });
    // The sibling: a genuine cross-border offer, same favourable sign.
    await seedSnapshot(db, d1, { productId: 2, name: 'Saksoinet Ale', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;

    expect(body.rows.map((r) => r.productName)).toEqual(['Saksoinet Ale']);
    expect(body.rows[0]).toMatchObject({ productId: 2, merchant: 'saksoinet', gapCents: -200 });
    // withReference counts BOTH rows — the self-pair is filtered from
    // the listing, not missing from the snapshot — while listed and
    // hasFavourable read the survivors only.
    expect(body.coverage).toEqual({ evaluated: 2, withReference: 2, listed: 1 });
    expect(body.hasFavourable).toBe(true);
  });

  it('keeps the surviving rows in the deterministic order — filtering never reorders — and repeats identically', async () => {
    const { db, d1 } = openMigratedD1();
    // Inserted out of sorted order on purpose: −500, then −900, then
    // −250. The route filters first and sorts after, so the survivors
    // must come out in the core-domain order (gap bps ascending, name
    // ascending, id as the final tie) — never insertion order — with the
    // ineligible rows (a dearer row, a self-pair) filtered away silently.
    await seedSnapshot(db, d1, { productId: 1, name: 'Mid Ale', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Best Ale', category: 'beer', gapCents: -400, gapBasisPoints: -900 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Small Ale', category: 'beer', gapCents: -100, gapBasisPoints: -250 });
    await seedSnapshot(db, d1, { productId: 4, name: 'Dearer Ale', category: 'beer', gapCents: 200, gapBasisPoints: 500 });
    await seedSnapshot(db, d1, {
      productId: 5,
      name: 'Self-Pair Ale',
      category: 'beer',
      gapCents: -600,
      gapBasisPoints: -1500,
      merchant: 'alko',
      merchantCountry: 'FI',
    });
    const app = savingsApp();
    const env = savingsEnv(d1);

    const first = await getBeerListing(app, env);
    expect(first.status).toBe(200);
    const body = (await first.json()) as SavingsJson;
    const second = (await (await getBeerListing(app, env)).json()) as SavingsJson;

    // Full field-by-field equality on the surviving three, in the
    // sorted order — the ineligible pair left no trace.
    expect(body.rows.map((r) => [r.productId, r.gapBasisPoints])).toEqual([
      [2, -900],
      [1, -500],
      [3, -250],
    ]);
    // Byte-stable across requests: identical rows, identical order.
    expect(body.rows).toEqual(second.rows);
    expect(body.hasFavourable).toBe(true);
    expect(body.coverage).toEqual({ evaluated: 5, withReference: 5, listed: 3 });
  });

  it('marks hasFavourable true when a survivor exists — the eligible set is read before the limit clamp', async () => {
    const { db, d1 } = openMigratedD1();
    await seedSnapshot(db, d1, { productId: 1, name: 'Cheap Ale', category: 'beer', gapCents: -300, gapBasisPoints: -750 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Cheaper Porter', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=1')
    ).json()) as SavingsJson;

    expect(body.rows).toHaveLength(1);
    expect(body.coverage.listed).toBe(1);
    // The marker reads the full eligible set, not the clamped list.
    expect(body.hasFavourable).toBe(true);
  });

  it('leaves /top untouched: no hasFavourable key, the prior shape, and the self-paired row still listed there', async () => {
    const { db, d1 } = openMigratedD1();
    // The same two-row fixture feeds both surfaces: the self-pair is
    // ineligible for the listing only — /top's contract (task 1.1,
    // change homepage-live-gap-hero) intentionally does not exclude it.
    await seedSnapshot(db, d1, {
      productId: 1,
      name: 'Alko Own Ale',
      category: 'beer',
      gapCents: -400,
      gapBasisPoints: -1000,
      merchant: 'alko',
      merchantCountry: 'FI',
    });
    await seedSnapshot(db, d1, { productId: 2, name: 'Saksoinet Ale', category: 'beer', gapCents: -200, gapBasisPoints: -500 });
    const app = savingsApp();

    const listing = (await (
      await getBeerListing(app, savingsEnv(d1))
    ).json()) as SavingsJson;
    expect(listing.rows.map((r) => r.productName)).toEqual(['Saksoinet Ale']);

    const top = (await (
      await request(app, savingsEnv(d1), '/api/v1/savings/top', { headers: AGE_OK })
    ).json()) as Record<string, unknown>;
    // The top-N shape is exactly as before the change: no hasFavourable
    // key, the same coverage keys — and the self-pair row still present,
    // most-negative gap first.
    expect(Object.keys(top)).toEqual(['asOf', 'coverage', 'rows']);
    expect(top.coverage).toEqual({ evaluated: 2, importFavourable: 2, listed: 2 });
    expect(
      (top.rows as { productName: string }[]).map((r) => r.productName),
    ).toEqual([
      'Alko Own Ale', // −1000 bps leads…
      'Saksoinet Ale', // …then −500 bps
    ]);
  });
});

describe('GET /api/v1/savings — limit clamp', () => {
  async function seedThreeBeerRows(db: DatabaseSync, d1: D1DatabaseLike): Promise<void> {
    await seedSnapshot(db, d1, { productId: 1, name: 'Ale A', category: 'beer', gapBasisPoints: -300 });
    await seedSnapshot(db, d1, { productId: 2, name: 'Ale B', category: 'beer', gapBasisPoints: -100 });
    await seedSnapshot(db, d1, { productId: 3, name: 'Ale C', category: 'beer', gapBasisPoints: -200 });
  }

  it('returns the top-N rows in listing order for a small limit', async () => {
    const { db, d1 } = openMigratedD1();
    await seedThreeBeerRows(db, d1);
    const app = savingsApp();

    const body = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=2')
    ).json()) as SavingsJson;
    // Gap ascending: −300 → −200 → −100 bps (largest saving first), so
    // the top-2 are Ale A and Ale C.
    expect(body.rows.map((r) => r.productName)).toEqual(['Ale A', 'Ale C']);
    expect(body.coverage.listed).toBe(2);
    // The counts stay honest above the clamp.
    expect(body.coverage.withReference).toBe(3);
  });

  it('falls back to the default (200) on a malformed limit, accepts 500, and clamps above 500', async () => {
    const { db, d1 } = openMigratedD1();
    await seedThreeBeerRows(db, d1);
    const app = savingsApp();

    const malformed = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=potato')
    ).json()) as SavingsJson;
    expect(malformed.rows).toHaveLength(3);

    // 508 qualifying rows — every limit number is exercised where it binds:
    // the absent/invalid default trims to 200, an explicit 500 is accepted
    // in full, and anything above the hard cap clamps to 500.
    for (let id = 10; id <= 514; id++) {
      await seedSnapshot(db, d1, {
        productId: id,
        name: `Bulk Ale ${id}`,
        category: 'beer',
        gapBasisPoints: -id,
      });
    }

    const defaulted = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=potato')
    ).json()) as SavingsJson;
    expect(defaulted.rows).toHaveLength(200);
    expect(defaulted.coverage.listed).toBe(200);
    // The counts stay honest above the clamp.
    expect(defaulted.coverage.withReference).toBe(508);

    const atMax = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=500')
    ).json()) as SavingsJson;
    expect(atMax.rows).toHaveLength(500);
    expect(atMax.coverage.listed).toBe(500);

    const overMax = (await (
      await getBeerListing(app, savingsEnv(d1), '?category=beer&limit=999')
    ).json()) as SavingsJson;
    expect(overMax.rows).toHaveLength(500);
    expect(overMax.coverage.listed).toBe(500);
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
