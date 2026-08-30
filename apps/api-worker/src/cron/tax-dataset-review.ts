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
 * The SNAPSHOT SOURCE therefore stays behind the `RateChangeSourcePort`
 * interface — which is exactly the swap point for task 4.4 ("rate
 * snapshot source reading from R2"). Until then the bound
 * {@link DisabledRateChangeSource} degrades to no-change, the documented
 * ConfigBacked behavior with no snapshot path. Detection NEVER
 * auto-publishes: a detection maps to `requiresConfirmation` (the
 * manual-review task) and, per the BullMQ worker, invalidates the
 * idempotency cache entries carrying the replaced dataset versions so
 * subsequent calculations re-compute with fresh data.
 *
 * @module TaxDatasetReviewCron
 */

import type { RateReviewResult } from '../../../../packages/data-acquisition/src/interfaces/rate-review.types';
import type { RateChangeSourcePort } from '../../../../packages/data-acquisition/src/interfaces/rate-review-repository.port';
import { idempotencyInvalidateVersions } from '../do/client';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const TAX_REVIEW_CRON = '0 2 * * *';

/**
 * Placeholder snapshot source until task 4.4 moves the rate snapshot to
 * R2: reports no change, the documented ConfigBacked semantics with no
 * snapshot path (no source configured — no detection possible).
 */
export class DisabledRateChangeSource implements RateChangeSourcePort {
  async checkForChanges(): Promise<RateReviewResult> {
    return { checkedAt: new Date().toISOString(), newRatesDetected: false };
  }
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

  const source = deps.rateChangeSource ?? new DisabledRateChangeSource();
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
