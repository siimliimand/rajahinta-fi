/**
 * Monthly curated-rate refresh handler tests — the in-repo dataset
 * ingestion contract (fransberg + posti + omniva):
 *
 * - a carrier whose stored newest observedAt matches its dataset date is
 *   skipped (append-only history: unchanged data is not new history);
 * - a changed dataset refreshes through the governance-gated adapter;
 * - an empty table (first sync) refreshes;
 * - router dispatch wiring for the monthly pattern.
 *
 * @module CuratedRateRefreshTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleCuratedRateRefresh,
  CURATED_REFRESH_CRON,
} from '../curated-rate-refresh';
import { FRANSBERG_OBSERVED_AT } from '../../../../../packages/data-acquisition/src/adapters/fransberg-rate.source';
import { POSTI_OBSERVED_AT } from '../../../../../packages/data-acquisition/src/adapters/posti-rate.source';
import { OMNIVA_OBSERVED_AT } from '../../../../../packages/data-acquisition/src/adapters/omniva-rate.source';
import { handlersForCron } from '../router';
import { createLogger, type Logger } from '../../logger';

const LOG: Logger = createLogger('error');

describe('handleCuratedRateRefresh', () => {
  it('skips carriers whose stored observation matches the dataset date and refreshes the rest', async () => {
    const refresh = vi.fn(async (carrierId: string) => ({
      ratesUpdated: carrierId === 'fransberg' ? 36 : 0,
    }));
    const storedNewestObservedAt = vi.fn(async (carrierId: string) =>
      carrierId === 'fransberg' ? FRANSBERG_OBSERVED_AT : null,
    );

    const result = await handleCuratedRateRefresh(
      {} as unknown as import('../../env').Env,
      LOG,
      { refresh, storedNewestObservedAt },
    );

    // Fransberg is current (skip); Posti's dataset is empty-but-dated —
    // an empty table still refreshes (first sync). Omniva has no stored
    // observation either (first sync).
    expect(storedNewestObservedAt).toHaveBeenCalledWith('fransberg');
    expect(storedNewestObservedAt).toHaveBeenCalledWith('posti');
    expect(storedNewestObservedAt).toHaveBeenCalledWith('omniva');
    expect(refresh).not.toHaveBeenCalledWith('fransberg');
    expect(refresh).toHaveBeenCalledWith('posti');
    expect(refresh).toHaveBeenCalledWith('omniva');
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ratesUpdated: 0, skippedCarriers: ['fransberg'] });
  });

  it('refreshes every curated carrier whose dataset date moved', async () => {
    const refresh = vi.fn(async () => ({ ratesUpdated: 5 }));
    const storedNewestObservedAt = vi.fn(async () => null);

    const result = await handleCuratedRateRefresh(
      {} as unknown as import('../../env').Env,
      LOG,
      { refresh, storedNewestObservedAt },
    );

    expect(refresh).toHaveBeenCalledWith('fransberg');
    expect(refresh).toHaveBeenCalledWith('posti');
    expect(refresh).toHaveBeenCalledWith('omniva');
    expect(result.skippedCarriers).toEqual([]);
  });

  it('skips carriers whose stored observation equals their dataset date even when another carrier changed', async () => {
    const refresh = vi.fn(async () => ({ ratesUpdated: 12 }));
    const storedNewestObservedAt = vi.fn(async (carrierId: string) => {
      if (carrierId === 'posti') return POSTI_OBSERVED_AT;
      if (carrierId === 'omniva') return OMNIVA_OBSERVED_AT;
      return null;
    });

    const result = await handleCuratedRateRefresh(
      {} as unknown as import('../../env').Env,
      LOG,
      { refresh, storedNewestObservedAt },
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('fransberg');
    expect(refresh).not.toHaveBeenCalledWith('posti');
    expect(refresh).not.toHaveBeenCalledWith('omniva');
    expect(result.ratesUpdated).toBe(12);
    expect(result.skippedCarriers).toEqual(['posti', 'omniva']);
  });
});

describe('router wiring', () => {
  it('rides the monthly first-of-month pattern', () => {
    expect(CURATED_REFRESH_CRON).toBe('0 5 1 * *');
    expect(handlersForCron(CURATED_REFRESH_CRON).map((h) => h.name)).toEqual([
      'curated-rate-refresh',
    ]);
  });
});
