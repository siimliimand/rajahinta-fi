/**
 * Merchant-reliability aggregates materialization cron (task 2.1, change
 * merchant-reliability-materialized-aggregates) — the 2026-10 D1 billing
 * incident's layer-3 fix: keeps `merchant_reliability_aggregates`
 * (migration 0035) fresh so the product-page reliability embed never
 * re-derives per-merchant whole-catalog aggregates per request again.
 * The per-request read becomes a primary-key lookup over a handful of
 * rows; this handler re-runs the seed query on the aggregation cadence.
 *
 * ## Cost envelope
 *
 * The recompute is the unbounded ranked-CTE window query over
 * `retail_offers` — the one the embed used to run PER REQUEST (~818k
 * rows/read; PR #129's merchant-bounded variant still cost 534k). At 48
 * ticks/day that is ~39M rows/day, ~$0.04/day of D1 reads: the whole-
 * catalog scan is now paid on a schedule instead of per page view, and
 * the per-request cost is table-size regardless of catalog or history
 * growth.
 *
 * ## Source of truth
 *
 * The recompute SELECT below is extracted verbatim from migration 0035's
 * seed `INSERT … SELECT` — the deterministic-latest rule (one row per
 * merchant×product by `observed_at DESC, id DESC`, the SQLite
 * ROW_NUMBER() translation of the pg DISTINCT ON query), the NULL-safe
 * `IS NOT` ESTIMATED arm (degrade-don't-overstate), `rn = 1`, and the
 * `ORDER BY merchant ASC` insert order. Materialized rows are therefore
 * byte-equal to the live aggregate by construction — the incident's
 * core invariant (task 2.2 asserts it). The ONE deviation is
 * `computed_at`: the seed used `strftime('now')` (the migration
 * execution moment); the tick binds the handler clock's instant instead
 * — same ISO-8601 `YYYY-MM-DDTHH:MM:SS.sssZ` shape, injectable for
 * tests, one instant per refresh.
 *
 * ## Ordering — strictly after freshness-alert (router.ts)
 *
 * The same 30-minute tick first runs the freshness-alert handler, whose
 * VERIFIED → STALE ageing write-back (task 5.2, design D8) degrades aged
 * offers IN PLACE. This handler is registered after it so the recompute
 * reads the tick's own post-ageing statuses — without the ordering, the
 * materialized figures would carry pre-ageing VERIFIED counts until the
 * next tick, and the spec's "staleness bounded by one tick" contract
 * would leak a tick of overstatement onto every product page.
 *
 * ## Atomicity — one batch, delete + all inserts
 *
 * D1's `batch()` is its multi-statement transaction primitive: either
 * every statement commits or none does. The refresh is therefore ONE
 * batch — the DELETE-all plus one INSERT per merchant — so a kill
 * mid-run leaves either the previous refresh or the new one, never a
 * half-populated table, and merchants whose offers all vanished lose
 * their row with the same DELETE (an empty catalog honestly empties the
 * table; nothing is synthesized). The table's CHECK constraint (the
 * four status counts sum to offer_count) is the at-rest guard: a
 * violating insert rejects the batch and fails the tick loudly — the
 * dispatcher's per-handler isolation logs it and the previous refresh
 * stays intact — rather than being papered over here.
 *
 * `deps` is the test seam (task 2.2): `db` injects the node:sqlite D1
 * harness, `now` fixes the materialization instant.
 *
 * @module MerchantReliabilityAggregatesCron
 */

import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import type { Env } from '../env';
import type { Logger } from '../logger';

/**
 * The live per-merchant current-offer aggregate — migration 0035's seed
 * SELECT verbatim, minus the `computed_at` column the handler supplies
 * (see the module docblock for the one deviation). Yields one row per
 * merchant holding at least one current offer.
 */
const LIVE_AGGREGATE_SQL = `
  WITH ranked AS (
    SELECT merchant, reliability_status, observed_at,
           ROW_NUMBER() OVER (
             PARTITION BY merchant, product_id
             ORDER BY observed_at DESC, id DESC
           ) AS rn
      FROM retail_offers
  )
  SELECT merchant,
         COUNT(*) AS offer_count,
         SUM(CASE WHEN reliability_status = 'VERIFIED' THEN 1 ELSE 0 END)
           AS verified_count,
         SUM(CASE WHEN reliability_status IS NOT 'VERIFIED'
                  AND reliability_status IS NOT 'STALE'
                  AND reliability_status IS NOT 'UNAVAILABLE'
                 THEN 1 ELSE 0 END)
           AS estimated_count,
         SUM(CASE WHEN reliability_status = 'STALE' THEN 1 ELSE 0 END)
           AS stale_count,
         SUM(CASE WHEN reliability_status = 'UNAVAILABLE' THEN 1 ELSE 0 END)
           AS unavailable_count,
         MAX(observed_at) AS freshest_observed_at
    FROM ranked
   WHERE rn = 1
   GROUP BY merchant
   ORDER BY merchant ASC`;

/** Derived state — the whole table rewrites per tick (the outcome_margins precedent). */
const DELETE_ALL_AGGREGATES_SQL = `DELETE FROM merchant_reliability_aggregates`;

/** One merchant's materialized row (computed_at is the shared refresh instant). */
const INSERT_AGGREGATE_SQL = `
  INSERT INTO merchant_reliability_aggregates (
    merchant, offer_count, verified_count, estimated_count,
    stale_count, unavailable_count, freshest_observed_at, computed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

/** One recompute row — the live-aggregate SELECT's contract face. */
interface LiveAggregateRow {
  readonly merchant: string;
  readonly offer_count: number;
  readonly verified_count: number;
  readonly estimated_count: number;
  readonly stale_count: number;
  readonly unavailable_count: number;
  readonly freshest_observed_at: string;
}

/** One refresh's outcome — logged by the handler, asserted by tests. */
export interface MerchantReliabilityAggregatesResult {
  /** Merchants materialized this tick (0 on an empty catalog — the honest degrade). */
  readonly merchantsMaterialized: number;
  /** The shared materialization instant (ISO-8601 `…SS.sssZ`). */
  readonly computedAt: string;
  /** Wall-clock duration of the recompute + batch write. */
  readonly durationMs: number;
}

/** Injection seams (test overrides; defaults are the real ones). */
export interface MerchantReliabilityAggregatesDeps {
  /**
   * Defaults to the Worker's D1 binding (`env.DB`). Tests inject the
   * node:sqlite harness with the committed migrations applied.
   */
  db?: D1DatabaseLike;
  /** Defaults to `new Date()`. One instant per refresh — every inserted row's computed_at. */
  now?: () => Date;
}

/**
 * One aggregation-tick refresh of `merchant_reliability_aggregates`:
 * recompute the live aggregate (the migration-0035 seed query), then
 * replace the table's contents delete-then-insert in ONE
 * `batch()` — D1's implicit multi-statement transaction. Register on the
 * 30-minute aggregation tick (`AGGREGATION_CRON`, router.ts) strictly
 * after freshness-alert so the tick's VERIFIED → STALE ageing write-back
 * is reflected same-tick.
 *
 * Throws on failure — the router's per-handler isolation logs it and the
 * previous refresh stays intact (single-batch atomicity).
 */
export async function handleMerchantReliabilityAggregates(
  env: Env,
  log: Logger,
  deps: MerchantReliabilityAggregatesDeps = {},
): Promise<MerchantReliabilityAggregatesResult> {
  const db = deps.db ?? env.DB;
  const now = deps.now ?? (() => new Date());

  // Wall-clock bracket for the duration log — deliberately NOT the
  // injectable clock: a test-fixed `now` would collapse the duration to 0.
  const startedAt = Date.now();
  // One instant per refresh: every row inserted by this tick shares it,
  // so the table never mixes computed_at values within a refresh.
  const computedAt = now();

  const rows = (
    await db.prepare(LIVE_AGGREGATE_SQL).all<LiveAggregateRow>()
  ).results;

  // The whole refresh in ONE batch: the DELETE plus one INSERT per
  // merchant — either every statement commits or none does. An empty
  // catalog batches the DELETE alone, leaving the table honestly empty.
  const statements = [db.prepare(DELETE_ALL_AGGREGATES_SQL)];
  for (const row of rows) {
    statements.push(
      db
        .prepare(INSERT_AGGREGATE_SQL)
        .bind(
          row.merchant,
          row.offer_count,
          row.verified_count,
          row.estimated_count,
          row.stale_count,
          row.unavailable_count,
          row.freshest_observed_at,
          computedAt.toISOString(),
        ),
    );
  }
  await db.batch(statements);

  const durationMs = Date.now() - startedAt;
  log.info({
    message: `Merchant reliability aggregates refreshed — ${rows.length} merchants materialized`,
    merchantsMaterialized: rows.length,
    computedAt: computedAt.toISOString(),
    durationMs,
  });
  return {
    merchantsMaterialized: rows.length,
    computedAt: computedAt.toISOString(),
    durationMs,
  };
}
