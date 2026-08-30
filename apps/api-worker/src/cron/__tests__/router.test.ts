/**
 * Cron dispatch routing tests (task 4.3) — right handler per cron pattern,
 * per-handler error isolation, and parity between the routing table and
 * the committed wrangler.jsonc triggers.
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

  it('routes BOTH the aggregation and the task-6.3 freshness alert on the 30-minute pattern', () => {
    expect(handlerNames('*/30 * * * *')).toEqual([
      'time-series-aggregation',
      'freshness-alert',
    ]);
  });

  it('routes BOTH the transport refresh and the click-counter flush on the 6-hourly pattern', () => {
    expect(handlerNames('0 */6 * * *')).toEqual([
      'transport-rate-refresh',
      'click-counter-flush',
    ]);
  });

  it('routes the daily review + retention patterns', () => {
    expect(handlerNames('0 2 * * *')).toEqual(['tax-dataset-review']);
    expect(handlerNames('0 3 * * *')).toEqual(['fx-dataset-review']);
    expect(handlerNames('30 3 * * *')).toEqual(['retention-sweep']);
  });

  it('routes nothing for unknown patterns', () => {
    expect(handlerNames('0 0 1 1 *')).toEqual([]);
  });

  it('stays in parity with wrangler.jsonc triggers.crons', () => {
    const crons = readWranglerCrons();
    for (const cron of crons) {
      expect(handlerNames(cron).length).toBeGreaterThan(0);
    }
    expect(routingPatterns()).toEqual([...new Set(crons)].sort());
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
      { cron: '0 0 1 1 *' } as unknown as ScheduledController,
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
    expect(waitUntil).toHaveBeenCalledTimes(2);
  });
});
