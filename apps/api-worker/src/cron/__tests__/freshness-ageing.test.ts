/**
 * Verified-ageing write-back tests (task 5.2, change
 * transport-confidence-unlock, design D8) — the freshness-job contract
 * that a VERIFIED offer never outlives its evidence:
 *
 * - the transition: aged VERIFIED → STALE through the SAME freshness
 *   window the data-quality classifier's `actualStatus` uses
 *   (ReliabilityService.stalenessThresholdFor('price'), boundary
 *   inclusive on the fresh side) — pinned behaviorally, no second
 *   constant;
 * - status-only: price, observed_at, and the verified_at/verified_by
 *   attribution pair (task 5.1) are never touched;
 * - idempotence: a re-run over already-STALE rows writes nothing, and
 *   ESTIMATED / UNAVAILABLE rows are never matched;
 * - the pass runs before the alerting-configuration gate (data hygiene,
 *   not paging) and a failed pass is logged without failing the tick;
 * - the reliability reflection: merchant-reliability aggregation picks
 *   the transition up through its ordinary stored-status aggregation —
 *   NO aggregation-code change (the service file is exercised as-is).
 *
 * Runs over the fake-D1 harness (node:sqlite + committed migrations),
 * the established pattern of savings-snapshots.test.ts.
 *
 * @module FreshnessAgeingTest
 */

import { describe, it, expect, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleFreshnessAlert,
  writeBackAgedVerifiedOffers,
} from '../freshness-alert';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { getReliabilityScores } from '../../services/merchant-reliability';
import { createLogger, type Logger } from '../../logger';
import { DEFAULT_STALENESS_THRESHOLDS } from '../../../../../packages/core-domain/src/reliability/reliability.types';
import type { Env } from '../../env';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed "now" — every observed_at fixture is computed from it. */
const NOW = new Date('2026-08-30T12:00:00.000Z');

/** The classifier's retail-offer window — 48 h (price domain). */
const PRICE_WINDOW_MS = DEFAULT_STALENESS_THRESHOLDS.price.milliseconds;

/** Aged past the window (one hour over) — must transition. */
const AGED_AT = new Date(NOW.getTime() - (PRICE_WINDOW_MS + 3_600_000));

/** Within the window (one hour of margin left) — must stay VERIFIED. */
const FRESH_AT = new Date(NOW.getTime() - (PRICE_WINDOW_MS - 3_600_000));

/** Exactly AT the boundary — assessDataRecency keeps it VERIFIED. */
const BOUNDARY_AT = new Date(NOW.getTime() - PRICE_WINDOW_MS);

/** One millisecond past the boundary — the first STALE instant. */
const JUST_PAST_AT = new Date(NOW.getTime() - (PRICE_WINDOW_MS + 1));

/** Attribution pair as the task-5.1 verify endpoint writes it. */
const VERIFIED_AT = '2026-08-20T09:00:00.000Z';
const VERIFIED_BY = 'ops-anna';

const LOG = createLogger('error');

function createDb(): { db: DatabaseSync; d1: ReturnType<typeof openMigratedD1>['d1'] } {
  const { db, d1 } = openMigratedD1();
  return { db, d1 };
}

async function seedProduct(db: DatabaseSync, id: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          alcohol_by_volume, unit_volume, container_type, regulatory_classification)
       VALUES (?, ?, 'Brewery', 'Brand', 'beer', 0.05, 0.33, 'can', 'beer')`,
    )
    .run(id, `Product ${id}`);
}

/** Seed one retail offer — verified ones carry the 5.1 attribution pair. */
async function seedOffer(
  db: DatabaseSync,
  id: number,
  merchant: string,
  observedAt: Date,
  status: 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE',
  priceCents = 250,
): Promise<void> {
  const attribution =
    status === 'VERIFIED' ? `, '${VERIFIED_AT}', '${VERIFIED_BY}'` : `, NULL, NULL`;
  await db
    .prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, observed_at, reliability_status, verified_at, verified_by)
       VALUES (?, ?, 'DE', 1, ?, 'EUR', ?, ?${attribution})`,
    )
    .run(id, merchant, priceCents, observedAt.toISOString(), status);
}

type OfferRow = {
  reliability_status: string;
  price_cents: number;
  observed_at: string;
  verified_at: string | null;
  verified_by: string | null;
};

async function readOffer(
  db: DatabaseSync,
  id: number,
): Promise<OfferRow> {
  return db
    .prepare(
      `SELECT reliability_status, price_cents, observed_at, verified_at, verified_by
         FROM retail_offers WHERE id = ?`,
    )
    .get(id) as OfferRow;
}

// ---------------------------------------------------------------------------
// The transition — same window as the classifier, status-only
// ---------------------------------------------------------------------------

describe('writeBackAgedVerifiedOffers — the transition', () => {
  it('transitions an aged VERIFIED offer to STALE, touching nothing else', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');

    const changed = await writeBackAgedVerifiedOffers(d1, NOW);

    expect(changed).toBe(1);
    const row = await readOffer(db, 11);
    expect(row.reliability_status).toBe('STALE');
    // Status-only: the monetary field, the observation timestamp, and the
    // task-5.1 attribution pair all survive the transition untouched.
    expect(row.price_cents).toBe(250);
    expect(row.observed_at).toBe(AGED_AT.toISOString());
    expect(row.verified_at).toBe(VERIFIED_AT);
    expect(row.verified_by).toBe(VERIFIED_BY);
  });

  it('keeps a fresh VERIFIED offer VERIFIED', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', FRESH_AT, 'VERIFIED');

    const changed = await writeBackAgedVerifiedOffers(d1, NOW);

    expect(changed).toBe(0);
    expect((await readOffer(db, 11)).reliability_status).toBe('VERIFIED');
  });

  it('mirrors the classifier boundary: AT the window stays VERIFIED, 1 ms past flips', async () => {
    // assessDataRecency: elapsed <= threshold → VERIFIED. The SQL strict
    // `observed_at < cutoff` reproduces exactly that — this pin is what
    // keeps the write-back on the SAME window source, no second constant.
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', BOUNDARY_AT, 'VERIFIED');
    await seedOffer(db, 12, 'beverage-de', JUST_PAST_AT, 'VERIFIED');

    const changed = await writeBackAgedVerifiedOffers(d1, NOW);

    expect(changed).toBe(1);
    expect((await readOffer(db, 11)).reliability_status).toBe('VERIFIED');
    expect((await readOffer(db, 12)).reliability_status).toBe('STALE');
  });
});

// ---------------------------------------------------------------------------
// Idempotence and the untouched statuses
// ---------------------------------------------------------------------------

describe('writeBackAgedVerifiedOffers — idempotence and scope', () => {
  it('is idempotent: a re-run over already-STALE rows writes nothing', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');

    expect(await writeBackAgedVerifiedOffers(d1, NOW)).toBe(1);
    const afterFirst = await readOffer(db, 11);
    expect(afterFirst.reliability_status).toBe('STALE');

    expect(await writeBackAgedVerifiedOffers(d1, NOW)).toBe(0);
    expect(await readOffer(db, 11)).toEqual(afterFirst);
  });

  it('leaves aged ESTIMATED and UNAVAILABLE rows untouched — only VERIFIED ages', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'ESTIMATED');
    await seedOffer(db, 12, 'beverage-de', AGED_AT, 'UNAVAILABLE');

    const changed = await writeBackAgedVerifiedOffers(d1, NOW);

    expect(changed).toBe(0);
    expect((await readOffer(db, 11)).reliability_status).toBe('ESTIMATED');
    expect((await readOffer(db, 12)).reliability_status).toBe('UNAVAILABLE');
  });

  it('degrades only the matching rows in a mixed batch', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');
    await seedOffer(db, 12, 'beverage-de', FRESH_AT, 'VERIFIED');
    await seedOffer(db, 13, 'beverage-de', AGED_AT, 'ESTIMATED');
    await seedOffer(db, 14, 'beverage-de', AGED_AT, 'STALE');

    const changed = await writeBackAgedVerifiedOffers(d1, NOW);

    expect(changed).toBe(1);
    expect((await readOffer(db, 11)).reliability_status).toBe('STALE');
    expect((await readOffer(db, 12)).reliability_status).toBe('VERIFIED');
    expect((await readOffer(db, 13)).reliability_status).toBe('ESTIMATED');
    expect((await readOffer(db, 14)).reliability_status).toBe('STALE');
  });
});

// ---------------------------------------------------------------------------
// Handler wiring — the pass rides the existing freshness tick
// ---------------------------------------------------------------------------

/** Fresh in-memory DB env exercising the DEFAULT write-back dep. */
function dbEnv(d1: ReturnType<typeof openMigratedD1>['d1']): Env {
  return { DB: d1 } as unknown as Env;
}

describe('handleFreshnessAlert — verified ageing wiring', () => {
  it('runs the write-back before the alerting gate — even unconfigured', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');
    await seedOffer(db, 12, 'beverage-de', FRESH_AT, 'VERIFIED');

    // No email config at all: the tick still ages the aged row, then
    // reports alerting-off.
    const result = await handleFreshnessAlert(dbEnv(d1), LOG, {
      now: () => NOW,
    });

    expect(result.configured).toBe(false);
    expect(result.verifiedToStale).toBe(1);
    expect((await readOffer(db, 11)).reliability_status).toBe('STALE');
    expect((await readOffer(db, 12)).reliability_status).toBe('VERIFIED');
  });

  it('reports the write-back count when the alerting gate short-circuits', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');

    const result = await handleFreshnessAlert(dbEnv(d1), LOG, {
      now: () => NOW,
      measureStaleShare: async () => ({ stale: 1, total: 100, share: 0.01 }),
      findNewestObservedAt: async () => new Date(NOW.getTime() - 3_600_000),
    });

    expect(result.configured).toBe(false); // no email env → gate short-circuits
    expect(result.verifiedToStale).toBe(1);
    expect((await readOffer(db, 11)).reliability_status).toBe('STALE');
  });

  it('a failed write-back is logged, never thrown — the tick proceeds', async () => {
    const error = vi.fn();
    const log: Logger = { ...LOG, error };
    const env = {
      EMAIL_WORKER_URL: 'https://email.example.workers.dev',
      EMAIL_SEND_SECRET: 'secret',
      FRESHNESS_ALERT_EMAIL_TO: 'ops@example.com',
    } as unknown as Env;

    const result = await handleFreshnessAlert(env, log, {
      measureStaleShare: async () => ({ stale: 32, total: 100, share: 0.32 }),
      findNewestObservedAt: async () => new Date(NOW.getTime() - 3_600_000),
      writeBackAgedVerified: async () => {
        throw new Error('D1 unavailable');
      },
      send: async () => undefined,
      claim: async () => ({ status: 'claimed' }) as const,
      complete: async () => undefined,
    });

    expect(result.verifiedToStale).toBeNull();
    expect(result.configured).toBe(true);
    expect(result.alertsSent).toHaveLength(1); // alerting unaffected
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Verified-ageing write-back failed'),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Reliability reflection — aggregation picks the transition up unchanged
// ---------------------------------------------------------------------------

describe('merchant-reliability reflection (aggregation unchanged)', () => {
  it('reflects VERIFIED → STALE through ordinary stored-status aggregation', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    // Seeded aged AND verified: the aggregate reads the STORED status, so
    // pre-pass it reports VERIFIED even though the window has passed —
    // the write-back pass is what reconciles stored status with age.
    await seedOffer(db, 11, 'beverage-de', AGED_AT, 'VERIFIED');

    const before = await getReliabilityScores(d1);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      merchant: 'beverage-de',
      offerCount: 1,
      strictestStatus: 'VERIFIED',
      statusCounts: { VERIFIED: 1, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
    });

    await writeBackAgedVerifiedOffers(d1, NOW);

    const after = await getReliabilityScores(d1);
    expect(after[0]).toMatchObject({
      merchant: 'beverage-de',
      offerCount: 1,
      strictestStatus: 'STALE',
      statusCounts: { VERIFIED: 0, ESTIMATED: 0, STALE: 1, UNAVAILABLE: 0 },
      // The offer did not move: only its status bucket did.
      freshestObservedAt: AGED_AT.toISOString(),
      governancePermissionStatus: 'PENDING',
    });
  });

  it('flips the merchant strictest status only when the verified offer ages out', async () => {
    const { db, d1 } = createDb();
    await seedProduct(db, 1);
    // One fresh verified offer keeps the merchant green…
    await seedOffer(db, 11, 'beverage-de', FRESH_AT, 'VERIFIED');

    await writeBackAgedVerifiedOffers(d1, NOW);
    expect((await getReliabilityScores(d1))[0]?.strictestStatus).toBe('VERIFIED');

    // …and once that same offer ages past the window, the tick takes the
    // merchant's strictest status down with it — no aggregation change.
    await db
      .prepare('UPDATE retail_offers SET observed_at = ? WHERE id = 11')
      .run(AGED_AT.toISOString());
    await writeBackAgedVerifiedOffers(d1, NOW);

    const scores = await getReliabilityScores(d1);
    expect(scores[0]?.strictestStatus).toBe('STALE');
    expect(scores[0]?.statusCounts).toMatchObject({ STALE: 1, VERIFIED: 0 });
  });
});
