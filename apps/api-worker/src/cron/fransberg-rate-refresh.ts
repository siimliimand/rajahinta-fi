/**
 * Monthly Fransberg rate refresh — the manual-dataset ingestion path.
 *
 * Fransberg's rates are a curated in-repo dataset (no live feed — see
 * `fransberg-rate.source.ts`), so this handler keeps the database in sync
 * with the repo file rather than polling a carrier. It runs monthly and
 * skips the append while the newest stored fransberg observation still
 * carries the current dataset's observedAt: the transport-offer write is
 * append-only history, and re-appending an unchanged dataset would write
 * duplicate history rows, not new information.
 *
 * Update procedure when fransberg.eu changes its pricing: edit the dataset
 * and bump FRANSBERG_OBSERVED_AT in the source file, deploy — the next
 * monthly tick appends the new rows. Out-of-band sync: `wrangler dev
 * --test-scheduled` + `curl "http://localhost:8787/__scheduled?cron=0+5+1+*+*"`.
 *
 * The governance gate still applies (`SourceGovernanceService` inside the
 * pipeline adapter): without a GRANTED record for carrier "fransberg" the
 * refresh appends nothing.
 *
 * @module FransbergRateRefreshCron
 */

import { PipelineTransportRateAdapter } from '../../../../packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter';
import {
  FransbergCarrierRateSource,
  FRANSBERG_OBSERVED_AT,
} from '../../../../packages/data-acquisition/src/adapters/fransberg-rate.source';
import type { ICarrierRateSource } from '../../../../packages/data-acquisition/src/interfaces/carrier-rate-source.port';
import { composeGovernanceService } from '../queues/pipeline';
import { D1TransportOfferWritePort } from '../adapters/d1-domain-ports';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const FRANSBERG_REFRESH_CRON = '0 5 1 * *';

const NEWEST_FRANSBERG_OBSERVED_AT_SQL =
  'SELECT MAX(observed_at) AS newest FROM transport_offers WHERE carrier = ?';

/** One refresh pass's outcome — `skipped` when the dataset was already current. */
export interface FransbergRefreshResult {
  readonly ratesUpdated: number;
  readonly skipped: boolean;
}

/**
 * One monthly Fransberg dataset sync + unchanged skip.
 *
 * `deps` is a test seam (stored-observation read + refresh override), the
 * same pattern the transport-rate-refresh handler uses.
 */
export async function handleFransbergRateRefresh(
  env: Env,
  log: Logger,
  deps: {
    refresh?: () => Promise<{ ratesUpdated: number }>;
    storedNewestObservedAt?: () => Promise<Date | null>;
  } = {},
): Promise<FransbergRefreshResult> {
  const storedNewestObservedAt =
    deps.storedNewestObservedAt ??
    (async () => {
      const row = await env.DB.prepare(NEWEST_FRANSBERG_OBSERVED_AT_SQL)
        .bind('fransberg')
        .first<{ newest: string | null }>();
      return row?.newest ? new Date(row.newest) : null;
    });

  const newest = await storedNewestObservedAt();
  if (newest !== null && newest.getTime() === FRANSBERG_OBSERVED_AT.getTime()) {
    log.info({
      message:
        'Fransberg dataset unchanged since ' + newest.toISOString() +
        ' — skipping the append (append-only history: unchanged data is not new history)',
    });
    return { ratesUpdated: 0, skipped: true };
  }

  const refresh =
    deps.refresh ??
    (() => {
      const source: ICarrierRateSource = new FransbergCarrierRateSource();
      const adapter = new PipelineTransportRateAdapter(
        composeGovernanceService(),
        new Map([[source.carrierId, source]]),
        new D1TransportOfferWritePort(env.DB),
      );
      return adapter.refreshCarrierRates(source.carrierId);
    });

  log.info({ message: 'Running monthly Fransberg rate refresh' });
  const result = await refresh();
  log.info({
    message: `Refreshed ${result.ratesUpdated} Fransberg transport rates`,
    ratesUpdated: result.ratesUpdated,
  });
  return { ratesUpdated: result.ratesUpdated, skipped: false };
}
