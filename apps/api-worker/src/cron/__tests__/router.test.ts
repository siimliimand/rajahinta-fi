/**
 * Cron dispatch routing tests (task 4.3) — right handler per cron pattern,
 * per-handler error isolation, and parity between the routing table and
 * the committed wrangler.jsonc triggers. The task-3.2 section pins the
 * retail-offers retention wiring: the shared retention pattern routes it
 * after the sweep and contact retention, still in the handler's default
 * dry-run mode.
 *
 * @module CronRouterTest
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cronRoutingTable,
  dispatchScheduled,
  handlersForCron,
  runCronHandlers,
} from '../router';
import { createLogger } from '../../logger';
import {
  RETAIL_OFFERS_RETENTION_CRON,
  type RetailOffersRetentionResult,
} from '../retail-offers-retention';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import type { Env } from '../../env';

function handlerNames(cron: string): string[] {
  return handlersForCron(cron).map((handler) => handler.name);
}

function routingPatterns(): string[] {
  return [...cronRoutingTable().keys()].sort();
}

/** Parse wrangler.jsonc by stripping // line comments (no block comments in our config). */
function readWranglerCrons(): string[] {
  const raw = readFileSync(
    new URL('../../../wrangler.jsonc', import.meta.url),
    'utf8',
  );
  const stripped = raw
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  return JSON.parse(stripped).triggers.crons;
}

describe('cron routing table (task 4.3 — BullMQ repeat-schedule parity)', () => {
  it('routes the hourly producer pattern', () => {
    expect(handlerNames('0 * * * *')).toEqual(['ingestion-producer']);
  });

  it('routes the aggregation, freshness alert, price-alert evaluation, savings snapshots, and outcome margins on the 30-minute pattern', () => {
    expect(handlerNames('*/30 * * * *')).toEqual([
      'time-series-aggregation',
      'freshness-alert',
      'price-alert-evaluation',
      'savings-snapshots',
      'outcome-margins',
    ]);
  });

  it('routes the transport refresh, click-counter flush, merchant-reliability aggregates, and data-quality gauges on the 6-hourly pattern (task 2.3, change d1-read-cost-reduction)', () => {
    // Order matters: the reliability refresh registers before the gauges
    // so the per-feed last-success gauge reads same-tick materialized
    // rows (design D3); both moved off the 30-minute tick — the 30-min
    // full-window scan was the 2026-10 billing period's largest single
    // read consumer, 6-hourly cuts it ~12× (design D2).
    expect(handlerNames('0 */6 * * *')).toEqual([
      'transport-rate-refresh',
      'click-counter-flush',
      'merchant-reliability-aggregates',
      'data-quality-gauges',
    ]);
  });

  it('routes the daily review + retention patterns', () => {
    expect(handlerNames('0 2 * * *')).toEqual(['tax-dataset-review']);
    expect(handlerNames('30 3 * * *')).toEqual([
      'retention-sweep',
      'contact-retention',
      'retail-offers-retention',
    ]);
  });

  it('routes the monthly curated-dataset refresh and the ferry-price refresh (task 2.2)', () => {
    expect(handlerNames('0 5 1 * *')).toEqual([
      'curated-rate-refresh',
      'ferry-price-refresh',
    ]);
  });

  it('routes the annual January calendar skeleton (task 3.1)', () => {
    expect(handlerNames('0 0 1 1 *')).toEqual(['calendar-skeleton']);
  });

  it('routes nothing for unknown patterns', () => {
    expect(handlerNames('15 23 29 2 *')).toEqual([]);
  });

  it('stays in parity with wrangler.jsonc triggers.crons', () => {
    const crons = readWranglerCrons();
    for (const cron of crons) {
      expect(handlerNames(cron).length).toBeGreaterThan(0);
    }
    expect(routingPatterns()).toEqual([...new Set(crons)].sort());
  });
});

// -----------------------------------------------------------------------------
// Task 3.2 (change d1-read-cost-reduction) — retail-offers retention wiring
// -----------------------------------------------------------------------------

describe('retail-offers-retention registration (task 3.2, change d1-read-cost-reduction)', () => {
  it('routes the shared retention pattern to the new handler alongside retention-sweep and contact-retention', () => {
    expect(RETAIL_OFFERS_RETENTION_CRON).toBe('30 3 * * *');
    expect(handlerNames(RETAIL_OFFERS_RETENTION_CRON)).toEqual([
      'retention-sweep',
      'contact-retention',
      'retail-offers-retention',
    ]);
  });

  it('registers the handler with no deps override — the default dry-run mode survives dispatch', async () => {
    const { db, d1 } = openMigratedD1();
    await db
      .prepare(
        `INSERT INTO product_master (id, name, manufacturer, brand, category,
            alcohol_by_volume, unit_volume, container_type, regulatory_classification)
         VALUES (?, ?, 'Brewery', 'Brand', 'beer', 0.05, 0.33, 'can', 'beer')`,
      )
      .run(1, 'Product 1');
    const insertOffer = db.prepare(
      `INSERT INTO retail_offers (id, merchant, country, product_id, price_cents,
          currency, observed_at, reliability_status)
       VALUES (?, ?, 'DE', ?, 250, 'EUR', ?, 'ESTIMATED')`,
    );
    // A superseded row far past the 30-day window plus its newer same-pair
    // latest — exactly one deletable candidate for the dry-run to report.
    await insertOffer.run(11, 'beverage-de', 1, '2020-01-01T00:00:00.000Z');
    await insertOffer.run(12, 'beverage-de', 1, '2026-10-20T00:00:00.000Z');

    const handler = handlersForCron(RETAIL_OFFERS_RETENTION_CRON).find(
      (candidate) => candidate.name === 'retail-offers-retention',
    );
    if (!handler) {
      throw new Error(
        'retail-offers-retention is not registered on the retention pattern',
      );
    }

    // The routing table's own run — exactly what the nightly tick calls.
    const result = (await handler.run(
      { DB: d1 } as unknown as Env,
      createLogger('error'),
    )) as RetailOffersRetentionResult;

    expect(result.mode).toBe('dry-run');
    expect(result.deleted).toBe(0);
    expect(result.candidates).toBe(1);
    expect(
      (
        db.prepare('SELECT id FROM retail_offers ORDER BY id').all() as {
          id: number;
        }[]
      ).map((row) => row.id),
    ).toEqual([11, 12]);
  });
});

describe('runCronHandlers — per-handler error isolation', () => {
  function makeCtx(): {
    ctx: Pick<ExecutionContext, 'waitUntil'>;
    pending: Promise<unknown>[];
  } {
    const pending: Promise<unknown>[] = [];
    return {
      ctx: { waitUntil: (promise) => pending.push(promise) },
      pending,
    };
  }

  it('runs every handler for the pattern', async () => {
    const { ctx, pending } = makeCtx();
    const runs: string[] = [];
    runCronHandlers(
      [
        { name: 'a', run: async () => void runs.push('a') },
        { name: 'b', run: async () => void runs.push('b') },
      ],
      '0 1 * * *',
      {} as Env,
      ctx,
      createLogger('error'),
    );
    await Promise.all(pending);
    expect(runs.sort()).toEqual(['a', 'b']);
  });

  it('a rejecting handler never starves its siblings (isolation)', async () => {
    const { ctx, pending } = makeCtx();
    const runs: string[] = [];
    runCronHandlers(
      [
        { name: 'boom', run: () => Promise.reject(new Error('handler exploded')) },
        { name: 'fine', run: async () => void runs.push('fine') },
      ],
      '0 2 * * *',
      {} as Env,
      ctx,
      createLogger('error'),
    );
    // Every waitUntil promise settles (rejections are caught inside the
    // dispatch), and the healthy handler still completed.
    await Promise.all(pending);
    expect(runs).toEqual(['fine']);
  });
});

describe('dispatchScheduled — entry wiring', () => {
  it('no-ops with a warning on unregistered patterns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const waitUntil = vi.fn();
    dispatchScheduled(
      { cron: '15 23 29 2 *' } as unknown as ScheduledController,
      {} as Env,
      { waitUntil } as unknown as ExecutionContext,
    );
    expect(waitUntil).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('No cron handler'),
      }),
    );
    warn.mockRestore();
  });

  it('registers one waitUntil per handler for the fired pattern', () => {
    const waitUntil = vi.fn();
    dispatchScheduled(
      { cron: '0 */6 * * *' } as unknown as ScheduledController,
      { LOG_LEVEL: 'error' } as Env,
      { waitUntil } as unknown as ExecutionContext,
    );
    // transport-rate-refresh, click-counter-flush,
    // merchant-reliability-aggregates, data-quality-gauges.
    expect(waitUntil).toHaveBeenCalledTimes(4);
  });
});
