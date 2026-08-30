/**
 * Cron dispatch (task 4.3, design D6) — one `triggers.crons` array,
 * routed by cron pattern.
 *
 * Wrangler invokes `scheduled` with the exact pattern that fired
 * (`event.cron`); the router maps each pattern to its handler set. The
 * 6-hourly pattern carries TWO handlers — the transport-rate refresh
 * (BullMQ EVERY_6_HOURS parity) and the click-counter snapshot flush of
 * task 3.4 — dispatched independently with per-handler error isolation:
 * one failing handler must not starve the others on the same tick, and
 * a throw inside one waitUntil must not mark the whole invocation dead.
 *
 * Cadences mirror the BullMQ repeat schedules where the jobs code
 * documents them (see wrangler.jsonc for the mapping and the UTC-vs-
 * Helsinki note). Cron-handled jobs are idempotent by design (upserts,
 * review checks, bounded deletes), so wrangler's at-least-once delivery
 * needs no extra dedupe — the ingestion producer additionally dedupes
 * per hour at the Queue consumer (task 4.1).
 *
 * @module CronRouter
 */

import type { Env } from '../env';
import { createLogger, type Logger } from '../logger';
import { flushClickCounters } from '../analytics/click-counter-flusher';
import { handleTransportRateRefresh, TRANSPORT_REFRESH_CRON } from './transport-rate-refresh';
import { handleTaxDatasetReview, TAX_REVIEW_CRON } from './tax-dataset-review';
import { handleFxDatasetReview, FX_REVIEW_CRON } from './fx-dataset-review';
import {
  handleTimeSeriesAggregation,
  AGGREGATION_CRON,
} from './time-series-aggregation';
import { handleRetentionSweep, RETENTION_CRON } from './retention-sweep';
import {
  INGESTION_PRODUCER_CRON,
  schedulePriceIngestions,
} from '../queues/ingestion-producer';

/** One named cron handler — `run` is the scheduled work for one tick. */
export interface CronHandler {
  /** Stable name for logs and tests. */
  readonly name: string;
  /** Run the handler's work. Errors are isolated by the dispatcher. */
  run(env: Env, log: Logger): Promise<unknown>;
}

/**
 * The routing table: cron pattern → handlers that fire on it. Kept as a
 * function (not a constant) so the handler modules' pattern constants
 * stay the single source of truth alongside wrangler.jsonc.
 */
export function cronRoutingTable(): ReadonlyMap<string, readonly CronHandler[]> {
  const table = new Map<string, CronHandler[]>();
  const add = (pattern: string, handler: CronHandler): void => {
    const existing = table.get(pattern);
    if (existing) {
      existing.push(handler);
    } else {
      table.set(pattern, [handler]);
    }
  };

  add(INGESTION_PRODUCER_CRON, {
    name: 'ingestion-producer',
    run: (env, log) => schedulePriceIngestions(env, { log }),
  });
  add(TRANSPORT_REFRESH_CRON, {
    name: 'transport-rate-refresh',
    run: (env, log) => handleTransportRateRefresh(env, log),
  });
  // The task-3.4 click-counter flush shares the 6-hourly pattern.
  add(TRANSPORT_REFRESH_CRON, {
    name: 'click-counter-flush',
    run: (env, log) =>
      flushClickCounters(env).then((result) => {
        log.info({
          message: 'Click-counter flush complete',
          snapshotTaken: result.snapshotTaken,
          rowsWritten: result.rowsWritten,
        });
        return result;
      }),
  });
  add(TAX_REVIEW_CRON, {
    name: 'tax-dataset-review',
    run: (env, log) => handleTaxDatasetReview(env, log),
  });
  add(FX_REVIEW_CRON, {
    name: 'fx-dataset-review',
    run: (env, log) => handleFxDatasetReview(env, log),
  });
  add(AGGREGATION_CRON, {
    name: 'time-series-aggregation',
    run: (env, log) => handleTimeSeriesAggregation(env, log),
  });
  add(RETENTION_CRON, {
    name: 'retention-sweep',
    run: (env, log) => handleRetentionSweep(env, log),
  });

  return table;
}

/** Handlers registered for one fired pattern (empty — nothing to run). */
export function handlersForCron(cron: string): readonly CronHandler[] {
  return cronRoutingTable().get(cron) ?? [];
}

/**
 * Dispatch one `scheduled` invocation: run every handler registered for
 * the fired pattern, each in its own waitUntil with isolated error
 * logging. Unknown patterns log and no-op — adding a wrangler cron
 * without a handler must be visible, not fatal.
 */
export function dispatchScheduled(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): void {
  const log = createLogger(env.LOG_LEVEL);
  const handlers = handlersForCron(event.cron);

  if (handlers.length === 0) {
    log.warn({
      message: `No cron handler registered for pattern "${event.cron}"`,
      cron: event.cron,
    });
    return;
  }

  runCronHandlers(handlers, event.cron, env, ctx, log);
}

/**
 * Run a handler set with per-handler isolation: each handler gets its
 * own waitUntil and its own catch — a failing handler must not starve
 * the others firing on the same tick, and a rejection inside one
 * waitUntil must not mark the whole invocation dead. Exported for tests.
 */
export function runCronHandlers(
  handlers: readonly CronHandler[],
  cron: string,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  log: Logger,
): void {
  for (const handler of handlers) {
    ctx.waitUntil(
      handler
        .run(env, log)
        .then(() => {
          log.info({ message: `Cron handler "${handler.name}" complete`, cron });
        })
        .catch((err: unknown) => {
          log.error({
            message: `Cron handler "${handler.name}" failed`,
            cron,
            error: err instanceof Error ? err.message : 'unknown error',
          });
        }),
    );
  }
}
