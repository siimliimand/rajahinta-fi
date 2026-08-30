/**
 * Click-counter flusher — the worker-side half of the alarm-driven
 * snapshot flush (design D5, task 3.4).
 *
 * ClickCounterDO keeps the counters and produces snapshot payloads on
 * its alarm cadence; this module moves a payload into D1: it calls the
 * DO's `drain` op and upserts the returned rows through
 * {@link D1ClickCounterSnapshotRepository} — the same repository the
 * legacy PostgreSQL snapshot wrote through (task 2.5), here over the
 * Worker's `env.DB` binding (the D1 provider path of task 2.4: the
 * binding satisfies the repository's `D1DatabaseLike` structurally, no
 * adapter in between). The DO itself stays free of D1 imports.
 *
 * ## Trigger path: cron, not request-driven
 *
 * The worker's `scheduled` handler (wrangler `triggers.crons`, legacy
 * six-hourly `@Cron` cadence) calls {@link flushClickCounters}. The
 * division of labor mirrors the legacy design one-to-one: the DO alarm
 * is the traffic-independent producer (payloads appear even when no
 * request arrives — the property the legacy cron snapshot documented
 * for itself), and the cron-triggered flusher is the dumb, retryable
 * mover. Request-driven flushing was rejected: idle merchants would
 * starve the archive (payloads would sit until traffic returned), and
 * it would couple D1 write latency to the outbound-redirect path.
 *
 * Failure semantics: if this flush crashes after the drain, the payload
 * is gone but no count is lost — the cumulative totals persist in the
 * DO and the next capture run carries the higher numbers, exactly like
 * a missed legacy cron tick. Rows converge on the
 * (merchant, url, capturedAt) unique key, so a retried capture upsert
 * overwrites instead of duplicating.
 *
 * @module ClickCounterFlusher
 */

// Source-relative import: the data-platform package has no exports map
// yet (its root index does not re-export the D1 repositories), and the
// dependency/lockfile surface is outside this task's scope. When the
// package gains subpath exports, switch to the package specifier.
import { D1ClickCounterSnapshotRepository } from '../../../../packages/data-platform/src/repositories/d1/click-counter-snapshot.repository';
import { drainClickCounter } from '../do/client';
import type { Env } from '../env';

/** Outcome of one flush attempt — logged by the scheduled handler. */
export interface ClickFlushResult {
  /** Whether a snapshot payload was taken from the DO. */
  readonly snapshotTaken: boolean;
  /** Snapshot rows written to `click_counter_snapshots` (D1). */
  readonly rowsWritten: number;
}

/**
 * Drain the ClickCounterDO's pending snapshot and upsert it into D1.
 * Safe to run on any cadence: with nothing pending it is a no-op, and
 * an empty payload never reaches the repository.
 */
export async function flushClickCounters(env: Env): Promise<ClickFlushResult> {
  const snapshot = await drainClickCounter(env);
  if (!snapshot || snapshot.rows.length === 0) {
    return { snapshotTaken: false, rowsWritten: 0 };
  }

  const repository = new D1ClickCounterSnapshotRepository(env.DB);
  const rowsWritten = await repository.appendBatch(
    snapshot.rows.map((row) => ({
      merchantId: row.merchantId,
      url: row.url,
      clickCount: row.clickCount,
      capturedAt: new Date(snapshot.capturedAt),
    })),
  );
  return { snapshotTaken: true, rowsWritten };
}
