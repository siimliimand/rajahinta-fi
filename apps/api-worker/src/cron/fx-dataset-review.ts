/**
 * FX-dataset review cron handler (task 4.3, design D6) — the BullMQ
 * `FxDatasetReviewWorker` port. Cadence: daily at 03:00 UTC (the BullMQ
 * schedule fired 03:00 Europe/Helsinki; wrangler crons are UTC-only —
 * see the wrangler.jsonc note).
 *
 * Fetches the latest ECB reference-rate snapshot (config-driven URL —
 * ECB redistribution terms are an open legal-review item) and, on a new
 * reference date, creates a PENDING_CONFIRMATION dataset for operator
 * confirmation. This worker NEVER publishes and performs no cache
 * invalidation: an unconfirmed dataset is not effective, so nothing that
 * reads published rates can observe it yet. Invalidation on FX dataset
 * version change belongs to the operator confirmation path.
 *
 * @module FxDatasetReviewCron
 */

import { EcbReferenceRateSource } from '../../../../packages/data-acquisition/src/adapters/ecb-rate.source';
import { FX_RATE_SOURCE_URL_DEFAULT } from '../../../../packages/data-acquisition/src/interfaces/fx-rate-source.port';
import type { IFxRateSource } from '../../../../packages/data-acquisition/src/interfaces/fx-rate-source.port';
import { FxDatasetReviewService } from '../../../../packages/data-acquisition/src/services/fx-dataset-review.service';
import type { FxDatasetReviewResult } from '../../../../packages/data-acquisition/src/services/fx-dataset-review.service';
import { composeFxRateDatasetService } from '../queues/pipeline';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const FX_REVIEW_CRON = '0 3 * * *';

/**
 * One daily FX-dataset review pass.
 *
 * `deps` is a test seam (rate source override for fixtures).
 */
export async function handleFxDatasetReview(
  env: Env,
  log: Logger,
  deps: { rateSource?: IFxRateSource } = {},
): Promise<FxDatasetReviewResult> {
  log.info({
    message: 'Checking the FX rate source for newly available reference rates',
  });

  const rateSource =
    deps.rateSource ??
    new EcbReferenceRateSource(
      undefined,
      env.FX_RATE_SOURCE_URL ?? FX_RATE_SOURCE_URL_DEFAULT,
    );
  const fxReview = new FxDatasetReviewService(
    rateSource,
    composeFxRateDatasetService(env),
  );

  const result = await fxReview.checkForNewRates();

  if (result.errors.length > 0) {
    log.warn({
      message: `FX rate check reported ${result.errors.length} source error(s): ${result.errors.join('; ')}`,
    });
  }

  if (result.requiresConfirmation) {
    log.warn({
      message:
        `FX dataset ${result.detectedVersions.join(', ')} awaiting manual confirmation — ` +
        'no rates auto-published',
    });
  } else {
    log.info({
      message: `No new FX datasets (${result.datasetsFound} created this check)`,
    });
  }

  return result;
}
