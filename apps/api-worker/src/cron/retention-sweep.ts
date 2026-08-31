/**
 * Calculation-record retention cron handler (task 4.3, design D4 as
 * amended) — the BullMQ-era `CalculationRecordRetentionWorker` port.
 * Cadence: daily at 03:30 UTC (the @Cron fired 03:30 Europe/Helsinki;
 * wrangler crons are UTC-only — see the wrangler.jsonc note).
 *
 * Runs the D1 retention service of task 2.5 (D1CalculationRecordRetentionService):
 * anonymous 30-day window + the gate-review age cap (default 180 days),
 * both as bounded batch DELETEs. The window env names carry over
 * (`CALCULATION_RECORD_RETENTION_DAYS` / `CALCULATION_RECORD_AGE_CAP_DAYS`)
 * — on Workers they arrive as wrangler vars on {@link Env} and are passed
 * as explicit overrides (the service's own process.env lookup cannot see
 * them). Every step is idempotent, so a missed or failed run is simply
 * covered by the next one.
 *
 * @module RetentionSweepCron
 */

import { D1CalculationRecordRetentionService } from '../../../../packages/data-platform/src/repositories/d1/calculation-record-retention';
import type { D1RetentionRunResult } from '../../../../packages/data-platform/src/repositories/d1/calculation-record-retention';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** The cron pattern this handler registers under (wrangler triggers.crons). */
export const RETENTION_CRON = '30 3 * * *';

/** Parse a positive-integer day count from a wrangler var, else undefined. */
function parseDays(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
}

/**
 * One daily retention sweep.
 *
 * `deps` is a test seam (service/window overrides).
 */
export async function handleRetentionSweep(
  env: Env,
  log: Logger,
  deps: {
    service?: D1CalculationRecordRetentionService;
    now?: Date;
    retentionDays?: number;
    ageCapDays?: number;
    batchSize?: number;
  } = {},
): Promise<D1RetentionRunResult> {
  log.info({ message: 'Starting daily calculation-record retention sweep' });

  const retentionDays = deps.retentionDays ?? parseDays(env.CALCULATION_RECORD_RETENTION_DAYS);
  const ageCapDays = deps.ageCapDays ?? parseDays(env.CALCULATION_RECORD_AGE_CAP_DAYS);

  const result = await (deps.service ?? new D1CalculationRecordRetentionService(env.DB)).runRetention({
    ...(deps.now !== undefined ? { now: deps.now } : {}),
    ...(retentionDays !== undefined ? { retentionDays } : {}),
    ...(ageCapDays !== undefined ? { ageCapDays } : {}),
    ...(deps.batchSize !== undefined ? { batchSize: deps.batchSize } : {}),
  });

  log.info({
    message:
      `Retention sweep finished: pruned anonymous ${Object.entries(result.prunedAnonymous)
        .map(([table, count]) => `${table}=${count}`)
        .join(' ')}, age-capped ${Object.entries(result.ageCapped)
        .map(([table, count]) => `${table}=${count}`)
        .join(' ')} (anonymous cutoff ${result.anonymousCutoff.toISOString()}, ` +
      `age-cap cutoff ${result.ageCapCutoff.toISOString()}, batch ${result.batchSize})`,
    prunedAnonymous: result.prunedAnonymous,
    ageCapped: result.ageCapped,
  });

  return result;
}
