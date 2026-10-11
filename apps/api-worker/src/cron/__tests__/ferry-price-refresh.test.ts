/**
 * Monthly ferry-price refresh handler tests — the curated ferry dataset
 * ingestion contract (task 2.2, change ferry-onboard-prices):
 *
 * - an operator whose stored newest observedAt matches the dataset date
 *   is skipped (append-only history: unchanged data is not new history);
 * - a first sync (empty table) upserts;
 * - the governance gate is fail-closed per operator key — no records, a
 *   non-GRANTED status, or a governance error ingest nothing;
 * - operator isolation: one operator's gate state never touches another;
 * - router dispatch wiring for the monthly pattern.
 *
 * @module FerryPriceRefreshTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleFerryPriceRefresh,
  FERRY_PRICE_REFRESH_CRON,
} from '../ferry-price-refresh';
import { FERRY_OBSERVED_AT } from '../../../../../packages/data-acquisition/src/adapters/ferry-price.source';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';

const LOG: Logger = createLogger('error');
const ENV = {} as unknown as import('../../env').Env;

describe('handleFerryPriceRefresh', () => {
  it('skips operators whose stored observation matches the dataset date and upserts the rest', async () => {
    const upsert = vi.fn(async (operator: string) =>
      operator === 'tallink' ? 42 : operator === 'eckero' ? 28 : 0,
    );
    const storedNewestObservedAt = vi.fn(async (operator: string) =>
      operator === 'tallink' ? FERRY_OBSERVED_AT : null,
    );
    const checkPermission = vi.fn(async () => true);

    const result = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt,
      checkPermission,
    });

    expect(storedNewestObservedAt).toHaveBeenCalledWith('tallink');
    expect(storedNewestObservedAt).toHaveBeenCalledWith('viking');
    expect(storedNewestObservedAt).toHaveBeenCalledWith('eckero');
    // Tallink is current; Viking (0 rows) and Eckerö first-sync.
    expect(upsert).not.toHaveBeenCalledWith('tallink');
    expect(upsert).toHaveBeenCalledWith('viking');
    expect(upsert).toHaveBeenCalledWith('eckero');
    expect(result).toEqual({ observationsUpdated: 28, skippedOperators: ['tallink'] });
  });

  it('upserts every operator on a first sync (empty table)', async () => {
    const upsert = vi.fn(async () => 0);
    const storedNewestObservedAt = vi.fn(async () => null);

    const result = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt,
      checkPermission: async () => true,
    });

    expect(upsert).toHaveBeenCalledTimes(3);
    expect(result.skippedOperators).toEqual([]);
  });

  it('ingests nothing for a PENDING operator — fail-closed governance, even with a moved dataset', async () => {
    const upsert = vi.fn(async () => 10);
    const granted = new Set(['tallink']); // viking + eckero PENDING (the pre-grant reality)

    const result = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt: async () => null,
      checkPermission: async (operator) => granted.has(operator),
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('tallink');
    expect(result.observationsUpdated).toBe(10);
    // Not "skipped" as unchanged — the gate held the rows back.
    expect(result.skippedOperators).toEqual([]);
  });

  it('treats no governance records and a governance error as PENDING (fail-closed)', async () => {
    // The seam stands in for the composed service's behavior — these two
    // shapes are what the D1-backed gate produces for an unregistered
    // operator and a failing store; the handler must ingest neither.
    const upsert = vi.fn(async () => 5);
    const noRecords = vi.fn(async () => false);
    const failing = vi.fn(async () => {
      throw new Error('D1 unavailable');
    });

    const a = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt: async () => null,
      checkPermission: noRecords,
    });
    const b = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt: async () => null,
      checkPermission: failing,
    });

    expect(upsert).not.toHaveBeenCalled();
    expect(a.observationsUpdated).toBe(0);
    expect(b.observationsUpdated).toBe(0);
    expect(a.skippedOperators).toEqual([]);
    expect(b.skippedOperators).toEqual([]);
  });

  it('isolates operators: an unchanged+pending operator does not block a granted one', async () => {
    const upsert = vi.fn(async (operator: string) =>
      operator === 'eckero' ? 28 : 0,
    );
    const storedNewestObservedAt = vi.fn(async (operator: string) =>
      operator === 'viking' ? FERRY_OBSERVED_AT : null,
    );

    const result = await handleFerryPriceRefresh(ENV, LOG, {
      upsertObservations: upsert,
      storedNewestObservedAt,
      checkPermission: async (operator) => operator === 'eckero',
    });

    // viking: unchanged → skip before the gate. tallink: granted-false →
    // gate skip. eckero: granted → upsert.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith('eckero');
    expect(result).toEqual({ observationsUpdated: 28, skippedOperators: ['viking'] });
  });
});

describe('router wiring', () => {
  it('rides the monthly first-of-month pattern beside the curated rate refresh', () => {
    expect(FERRY_PRICE_REFRESH_CRON).toBe('0 5 1 * *');
    expect(handlersForCron(FERRY_PRICE_REFRESH_CRON).map((h) => h.name)).toEqual([
      'curated-rate-refresh',
      'ferry-price-refresh',
    ]);
  });
});
