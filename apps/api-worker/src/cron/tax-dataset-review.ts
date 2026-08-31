/**
 * Tax-dataset review cron handler (task 4.3, design D6) — the BullMQ
 * `TaxDatasetReviewWorker` port. Cadence: daily at 02:00 UTC (the BullMQ
 * schedule fired 02:00 Europe/Helsinki; wrangler crons are UTC-only —
 * see the wrangler.jsonc note).
 *
 * ## RateReviewSchedulerService semantics, Worker-shaped
 *
 * The BullMQ worker's flow was: `checkForRateChanges` (via the
 * PipelineTaxDatasetReviewAdapter over RateReviewSchedulerService) → log
 * → invalidate cached calculations on detected versions. That flow is
 * reproduced here against the SAME `RateChangeSourcePort` seam, without
 * pulling the scheduler class itself into the bundle: the scheduler
 * module's Node built-ins (`fs/promises`, `crypto`, `path` — plus a
 * module-scope `path.join(__dirname, …)` for the file snapshot default)
 * cannot evaluate on Workers.
 *
 * ## Snapshot source (task 4.4 swap, design D6)
 *
 * {@link composeRateChangeSource} is the swap point 4.3 left behind.
 * With the RATE_SNAPSHOTS R2 binding present, detection runs through the
 * {@link R2RateSnapshotSource} — the R2 counterpart of
 * ConfigBackedRateChangeSource (same SHA-256-vs-last-reviewed-entry
 * semantics, hash parity pinned by tests; missing object = no-change +
 * warning, fail-safe). Without the binding the disabled placeholder
 * below degrades to no-change, the documented ConfigBacked behavior with
 * no source configured.
 *
 * Repository note: detection reads the last-reviewed hash through
 * `IRateReviewRepository`. No D1 rate-review table exists in the schema
 * yet (the same Phase-1 state as the backend), so the composition binds
 * the in-memory store: per-isolate memory resets between cron ticks, so
 * once an operator uploads a snapshot object, each daily pass detects it
 * (first-check semantics) until a persistent repository records review
 * hashes. The fail-safe direction is unaffected (missing object ⇒
 * no-change). Swapping in a D1 repository is a one-argument change here.
 *
 * Detection NEVER auto-publishes: a detection maps to
 * `requiresConfirmation` (the manual-review task) and, per the BullMQ
 * worker, invalidates the idempotency cache entries carrying the
 * replaced dataset versions so subsequent calculations re-compute with
 * fresh data.
 *
 * @module TaxDatasetReviewCron
 */

import type { RateReviewResult } from '../../../../packages/data-acquisition/src/interfaces/rate-review.types';
import type { RateChangeSourcePort } from '../../../../packages/data-acquisition/src/interfaces/rate-review-repository.port';
import { R2RateSnapshotSource, DEFAULT_RATE_SNAPSHOT_OBJECT_KEY } from '../../../../packages/data-acquisition/src/adapters/rate-snapshot.r2';
import { InMemoryRateReviewRepository } from '../../../../packages/data-acquisition/src/adapters/rate-review-repository.adapter';
import { idempotencyInvalidateVersions } from '../do/client';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const TAX_REVIEW_CRON = '0 2 * * *';

/**
 * Placeholder snapshot source when no RATE_SNAPSHOTS binding is
 * configured: reports no change, the documented ConfigBacked semantics
 * with no snapshot source (nothing configured — no detection possible).
 */
export class DisabledRateChangeSource implements RateChangeSourcePort {
  async checkForChanges(): Promise<RateReviewResult> {
    return { checkedAt: new Date().toISOString(), newRatesDetected: false };
  }
}

/**
 * Compose the rate-change snapshot source from the Worker bindings
 * (task 4.4): R2-backed when RATE_SNAPSHOTS is bound, disabled
 * placeholder otherwise. The object key is per-env config (design D9,
 * RATE_SNAPSHOT_OBJECT_KEY) with the file-era default as fallback.
 */
export function composeRateChangeSource(env: Env, log: Logger): RateChangeSourcePort {
  const bucket = env.RATE_SNAPSHOTS;
  if (!bucket) {
    return new DisabledRateChangeSource();
  }
  const objectKey =
    env.RATE_SNAPSHOT_OBJECT_KEY?.trim() || DEFAULT_RATE_SNAPSHOT_OBJECT_KEY;
  return new R2RateSnapshotSource(bucket, objectKey, new InMemoryRateReviewRepository(), {
    logger: log,
  });
}

/** The PipelineTaxDatasetReviewAdapter mapping of a check result. */
export interface TaxReviewCheckResult {
  readonly datasetsFound: number;
  readonly requiresConfirmation: boolean;
  readonly detectedVersions?: readonly string[];
}

/** Adapter mapping — PipelineTaxDatasetReviewAdapter.checkForNewPublishedRates parity. */
export function toTaxReviewCheckResult(
  result: RateReviewResult,
): TaxReviewCheckResult {
  if (result.newRatesDetected) {
    return {
      datasetsFound: 1,
      requiresConfirmation: true,
      detectedVersions: result.detectedVersions,
    };
  }
  return { datasetsFound: 0, requiresConfirmation: false };
}

/**
 * One daily tax-dataset review pass.
 *
 * `deps` is a test seam (rate-change source + invalidation override).
 */
export async function handleTaxDatasetReview(
  env: Env,
  log: Logger,
  deps: {
    rateChangeSource?: RateChangeSourcePort;
    invalidateVersions?: (versions: string[]) => Promise<number>;
  } = {},
): Promise<TaxReviewCheckResult> {
  log.info({ message: 'Checking for newly published official tax rates' });

  const source = deps.rateChangeSource ?? composeRateChangeSource(env, log);
  const result = toTaxReviewCheckResult(await source.checkForChanges());

  log.info({
    message: `Found ${result.datasetsFound} new dataset(s), requires confirmation: ${result.requiresConfirmation}`,
    datasetsFound: result.datasetsFound,
  });

  if (result.requiresConfirmation) {
    log.warn({
      message:
        'New tax datasets found requiring manual confirmation — no rates auto-published',
    });

    // Invalidate cached calculations that reference the replaced
    // dataset versions so subsequent lookups re-compute with fresh data.
    const versions = result.detectedVersions;
    if (versions !== undefined && versions.length > 0) {
      log.info({
        message: `Invalidating idempotency cache for versions: ${versions.join(', ')}`,
      });
      const invalidate =
        deps.invalidateVersions ??
        ((versions: string[]) => idempotencyInvalidateVersions(env, versions));
      await invalidate([...versions]);
    }
  }

  return result;
}
