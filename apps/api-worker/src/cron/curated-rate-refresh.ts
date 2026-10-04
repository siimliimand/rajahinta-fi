/**
 * Monthly curated-rate refresh — the manual-dataset ingestion path for
 * every carrier whose rates live as an in-repo curated dataset (currently
 * fransberg, posti, and omniva; see the adapters' module docblocks).
 *
 * None of these carriers publishes a fetchable feed (fransberg.eu serves
 * an HTML page not worth scraping; Posti's JSON endpoint is CDN-blocked
 * for datacenter/Cloudflare egress), so this handler keeps the database
 * in sync with the repo datasets rather than polling carriers. It runs
 * monthly — the admin review cadence is a few times per year — and skips
 * per carrier while the newest stored observation still carries that
 * dataset's observedAt: the transport-offer write is append-only
 * history, and re-appending an unchanged dataset writes duplicate rows,
 * not new information.
 *
 * Admin procedure when a carrier changes (or on each periodic re-check):
 * edit the dataset, bump its OBSERVED_AT constant, deploy — the next
 * monthly tick appends the new rows. Out-of-band sync for local work:
 * `wrangler dev --test-scheduled` +
 * `curl "http://localhost:8787/__scheduled?cron=0+5+1+*+*"`.
 *
 * The governance gate still applies per carrier (`SourceGovernanceService`
 * inside the pipeline adapter): without a GRANTED record the carrier's
 * refresh appends nothing.
 *
 * @module CuratedRateRefreshCron
 */

import { PipelineTransportRateAdapter } from '../../../../packages/data-acquisition/src/adapters/pipeline-transport-rate.adapter';
import {
  FransbergCarrierRateSource,
  FRANSBERG_OBSERVED_AT,
} from '../../../../packages/data-acquisition/src/adapters/fransberg-rate.source';
import {
  PostiCarrierRateSource,
  POSTI_OBSERVED_AT,
} from '../../../../packages/data-acquisition/src/adapters/posti-rate.source';
import {
  OmnivaCarrierRateSource,
  OMNIVA_OBSERVED_AT,
} from '../../../../packages/data-acquisition/src/adapters/omniva-rate.source';
import type { ICarrierRateSource } from '../../../../packages/data-acquisition/src/interfaces/carrier-rate-source.port';
import { D1SourceGovernanceRepository } from '../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { composeGovernanceService } from '../queues/pipeline';
import { D1TransportOfferWritePort } from '../adapters/d1-domain-ports';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const CURATED_REFRESH_CRON = '0 5 1 * *';

const NEWEST_CARRIER_OBSERVED_AT_SQL =
  'SELECT MAX(observed_at) AS newest FROM transport_offers WHERE carrier = ?';

/** One curated carrier: its source plus the dataset's review date. */
interface CuratedCarrier {
  readonly source: ICarrierRateSource;
  readonly observedAt: Date;
}

/**
 * The curated carriers, keyed by carrierId. Add a carrier here (and its
 * dataset adapter) when transcribing another manual source.
 */
function composeCuratedCarriers(): Map<string, CuratedCarrier> {
  const fransberg = new FransbergCarrierRateSource();
  const posti = new PostiCarrierRateSource();
  const omniva = new OmnivaCarrierRateSource();
  const map = new Map<string, CuratedCarrier>();
  map.set(fransberg.carrierId, { source: fransberg, observedAt: FRANSBERG_OBSERVED_AT });
  map.set(posti.carrierId, { source: posti, observedAt: POSTI_OBSERVED_AT });
  map.set(omniva.carrierId, { source: omniva, observedAt: OMNIVA_OBSERVED_AT });
  return map;
}

/** One refresh pass's outcome — `skipped` names the datasets already current. */
export interface CuratedRefreshResult {
  readonly ratesUpdated: number;
  readonly skippedCarriers: readonly string[];
}

/**
 * One monthly curated-dataset sync with the per-carrier unchanged skip.
 *
 * `deps` is a test seam (stored-observation read + refresh override), the
 * same pattern the other cron handlers use.
 */
export async function handleCuratedRateRefresh(
  env: Env,
  log: Logger,
  deps: {
    refresh?: (carrierId: string) => Promise<{ ratesUpdated: number }>;
    storedNewestObservedAt?: (carrierId: string) => Promise<Date | null>;
  } = {},
): Promise<CuratedRefreshResult> {
  const storedNewestObservedAt =
    deps.storedNewestObservedAt ??
    (async (carrierId: string) => {
      const row = await env.DB.prepare(NEWEST_CARRIER_OBSERVED_AT_SQL)
        .bind(carrierId)
        .first<{ newest: string | null }>();
      return row?.newest ? new Date(row.newest) : null;
    });

  const carriers = composeCuratedCarriers();
  const skippedCarriers: string[] = [];
  let ratesUpdated = 0;

  for (const [carrierId, carrier] of carriers) {
    const newest = await storedNewestObservedAt(carrierId);
    if (newest !== null && newest.getTime() === carrier.observedAt.getTime()) {
      log.info({
        message:
          `Curated ${carrierId} dataset unchanged since ` + newest.toISOString() +
          ' — skipping the append (append-only history: unchanged data is not new history)',
      });
      skippedCarriers.push(carrierId);
      continue;
    }

    const refresh =
      deps.refresh ??
      ((id: string) => {
        const adapter = new PipelineTransportRateAdapter(
          // The gate MUST read the durable D1 source_governance store — the
          // no-arg composeGovernanceService() default is the empty in-memory
          // repo, fail-closed, which skips every carrier that reaches this
          // gate (the 2026-10 Posti append gap). Same wiring as
          // composeIngestionPipeline / the ingestion producer.
          composeGovernanceService(new D1SourceGovernanceRepository(env.DB)),
          new Map([[id, carriers.get(id)!.source]]),
          new D1TransportOfferWritePort(env.DB),
        );
        return adapter.refreshCarrierRates(id);
      });

    log.info({ message: `Running monthly curated rate refresh for ${carrierId}` });
    const result = await refresh(carrierId);
    ratesUpdated += result.ratesUpdated;
    log.info({
      message: `Refreshed ${result.ratesUpdated} curated ${carrierId} transport rates`,
      ratesUpdated: result.ratesUpdated,
    });
  }

  return { ratesUpdated, skippedCarriers };
}
