/**
 * Ferry onboard-price curated refresh — the monthly sync between the
 * `ferry_price_observations` table and the in-repo curated dataset
 * (packages/data-acquisition/src/adapters/ferry-price.source.ts), the
 * ferry-price counterpart of the curated-rate-refresh: the ferry dataset
 * is not a transport-offer dataset (an onboard price is display-only,
 * never a landed-cost offer), so it runs as a parallel handler on the
 * same monthly first-of-month tick instead of a carrier entry there.
 *
 * Per-operator unchanged skip, same rationale as the carrier loop: the
 * observation write is append-only history keyed by observed_at, and
 * re-upserting an unchanged dataset overwrites computed columns on the
 * same rows — history is only created when the dataset's
 * {@link FERRY_OBSERVED_AT} moves.
 *
 * Governance is fail-closed per operator key (`tallink`, `viking`,
 * `eckero`, mirroring the curated carriers' per-carrier gate): the gate
 * reads the durable D1 source_governance store, and no records, a
 * governance error, or any status other than GRANTED ingests nothing.
 * The grants are operator-created runtime data registered through the
 * audited ops console (the araxes precedent) — docs/ingestion-runbook.md
 * (ferry section) documents the per-operator grant procedure. Until an
 * operator is granted, its dataset rows (if any) stay un-ingested: Viking
 * Line is the designed empty state (bot-gated shop, operator
 * transcription pending), so its gate being PENDING changes nothing
 * observable.
 *
 * Admin procedure when a dataset revision lands: edit the dataset, bump
 * FERRY_OBSERVED_AT, deploy — the next monthly tick upserts the new
 * observation set; out-of-band sync for local work mirrors the curated
 * refresh (`wrangler dev --test-scheduled` +
 * `curl "http://localhost:8787/__scheduled?cron=0+5+1+*+*"`).
 *
 * @module FerryPriceRefreshCron
 */

import { D1FerryPriceRepository } from '../../../../packages/data-platform/src/repositories/d1/ferry-price.repository';
import {
  buildFerryPriceObservations,
  FERRY_OBSERVED_AT,
  FERRY_OPERATOR_KEYS,
  type FerryOperatorKey,
} from '../../../../packages/data-acquisition/src/adapters/ferry-price.source';
import { D1SourceGovernanceRepository } from '../../../../packages/data-platform/src/repositories/d1/source-governance.repository';
import { composeGovernanceService } from '../queues/pipeline';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler rides (the curated monthly tick). */
export const FERRY_PRICE_REFRESH_CRON = '0 5 1 * *';

const NEWEST_OPERATOR_OBSERVED_AT_SQL =
  'SELECT MAX(observed_at) AS newest FROM ferry_price_observations WHERE operator = ?';

/** One refresh pass's outcome — `skipped` names the operators already current or not granted. */
export interface FerryPriceRefreshResult {
  readonly observationsUpdated: number;
  readonly skippedOperators: readonly string[];
}

/**
 * One monthly ferry-dataset sync with the per-operator unchanged skip and
 * the fail-closed governance gate. `deps` is a test seam (stored-
 * observation read, permission check, upsert override), the same pattern
 * the other cron handlers use.
 */
export async function handleFerryPriceRefresh(
  env: Env,
  log: Logger,
  deps: {
    upsertObservations?: (operator: FerryOperatorKey) => Promise<number>;
    storedNewestObservedAt?: (operator: string) => Promise<Date | null>;
    checkPermission?: (operator: string) => Promise<boolean>;
  } = {},
): Promise<FerryPriceRefreshResult> {
  const storedNewestObservedAt =
    deps.storedNewestObservedAt ??
    (async (operator: string) => {
      const row = await env.DB.prepare(NEWEST_OPERATOR_OBSERVED_AT_SQL)
        .bind(operator)
        .first<{ newest: string | null }>();
      return row?.newest ? new Date(row.newest) : null;
    });

  // The gate MUST read the durable D1 source_governance store — the
  // no-arg composeGovernanceService() default is the empty in-memory
  // repo, fail-closed, which would ingest nothing in production. Same
  // wiring as the curated-rate-refresh and the ingestion producer.
  const governance = composeGovernanceService(new D1SourceGovernanceRepository(env.DB));
  // No records, a non-GRANTED status, or a gate error all default to
  // PENDING — the fail-closed call-site wrap covers the composed gate and
  // any override alike, and isolates one operator's gate failure from the
  // others on the same tick.
  const checkPermission =
    deps.checkPermission ??
    (async (operator: string) => {
      const result = await governance.checkPermission(operator);
      if (result.sources.length === 0) {
        log.warn({
          message:
            `Skipping ferry operator "${operator}": no governance records found — ` +
            'defaulting to PENDING',
        });
        return false;
      }
      if (result.permissionStatus !== 'GRANTED') {
        log.warn({
          message:
            `Skipping ferry operator "${operator}": permission status is ` +
            result.permissionStatus,
        });
        return false;
      }
      return true;
    });

  const upsertObservations =
    deps.upsertObservations ??
    (async (operator: FerryOperatorKey) => {
      const repository = new D1FerryPriceRepository(env.DB);
      const observations = buildFerryPriceObservations(operator);
      for (const observation of observations) {
        await repository.upsertObservation(observation);
      }
      return observations.length;
    });

  const skippedOperators: string[] = [];
  let observationsUpdated = 0;

  for (const operator of FERRY_OPERATOR_KEYS) {
    const newest = await storedNewestObservedAt(operator);
    if (newest !== null && newest.getTime() === FERRY_OBSERVED_AT.getTime()) {
      log.info({
        message:
          `Ferry ${operator} dataset unchanged since ` + newest.toISOString() +
          ' — skipping the upsert (append-only history: unchanged data is not new history)',
      });
      skippedOperators.push(operator);
      continue;
    }

    if (!(await checkPermission(operator).catch((err: unknown) => {
      log.error({
        message:
          `Governance check failed for ferry operator "${operator}": ` +
          `${err instanceof Error ? err.message : 'Unknown governance error'} — ` +
          'defaulting to PENDING',
      });
      return false;
    }))) {
      // Fail-closed: a not-granted operator ingests nothing. Not added to
      // skippedOperators — the dataset may have moved; the gate, not the
      // unchanged-check, held the rows back.
      continue;
    }

    log.info({ message: `Running monthly ferry price refresh for ${operator}` });
    const count = await upsertObservations(operator);
    observationsUpdated += count;
    log.info({
      message: `Upserted ${count} curated ${operator} ferry price observations`,
      observationsUpdated: count,
    });
  }

  return { observationsUpdated, skippedOperators };
}
