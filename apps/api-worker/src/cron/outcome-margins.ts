/**
 * Outcome-margins cron handler (task 1.2, change
 * hedge-dedup-confidence-meter; design D3, spec: calculation-outcomes
 * delta "Persisted empirical margins") — recomputes the empirical-margin
 * ladder from the stored calculation outcomes and persists it into
 * `outcome_margins` (migration 0029).
 *
 * Shares the 30-minute aggregation tick ({@link AGGREGATION_CRON}; the
 * freshness-alert / savings-snapshots precedent): the routing table
 * runs every handler on the tick with per-handler error isolation, so
 * a failure here cannot starve the price aggregation — and the margin
 * write touches only its own table, never the aggregates the sibling
 * handlers maintain (AccuracyStat reads calculation_outcomes directly,
 * so a margin run cannot alter it by construction).
 *
 * The whole ladder is recomputed per run — read the corpus, calibrate
 * every enumerated cell through core-domain's ladder math, replace the
 * persisted rows delete-then-insert in one batch. Degradation is
 * honest by construction: an empty outcome corpus enumerates no
 * qualifying cells and the run persists no rows (no synthesized
 * values); a below-floor cell is skipped the same way (the margin
 * never renders at or under the sample floor). Re-runs converge —
 * same corpus, same rows, whatever the tick count.
 *
 * @module OutcomeMarginsCron
 */

import {
  D1OutcomeMarginRepository,
} from '../../../../packages/data-platform/src/repositories/d1/outcome-margin.repository';
import { computeOutcomeMarginCells } from '../../../../packages/core-domain/src/outcomes/margin-calibration';
import type { Env } from '../env';
import type { Logger } from '../logger';

/** One margin-refresh run's outcome — logged by the handler, asserted by tests. */
export interface OutcomeMarginsRunResult {
  /** Outcome reports read from the corpus this run. */
  readonly reports: number;
  /** Margin cells persisted this run (0 on an empty or under-floor corpus). */
  readonly cellsWritten: number;
  /** The as-of instant the margins were computed for (ISO string). */
  readonly asOf: string;
}

/**
 * One margin-ladder refresh over the Worker's D1 binding. `deps` is a
 * test seam (repository/clock overrides).
 */
export async function handleOutcomeMargins(
  env: Env,
  log: Logger,
  deps: {
    repository?: D1OutcomeMarginRepository;
    asOf?: Date;
  } = {},
): Promise<OutcomeMarginsRunResult> {
  const repository = deps.repository ?? new D1OutcomeMarginRepository(env.DB);
  const asOf = deps.asOf ?? new Date();

  const reports = await repository.readOutcomeMarginReports();
  const cells = computeOutcomeMarginCells(reports, asOf);
  const cellsWritten = await repository.persistMargins(cells);

  log.info({
    message: `Outcome margins refreshed — ${cellsWritten} cells from ${reports.length} reports`,
    reports: reports.length,
    cellsWritten,
  });
  return { reports: reports.length, cellsWritten, asOf: asOf.toISOString() };
}
