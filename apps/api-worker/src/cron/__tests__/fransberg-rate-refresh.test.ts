/**
 * Fransberg rate-refresh handler — unchanged-skip + refresh seam.
 *
 * @module FransbergRateRefreshTest
 */

import { describe, it, expect, vi } from 'vitest';
import {
  handleFransbergRateRefresh,
  FRANSBERG_REFRESH_CRON,
} from '../fransberg-rate-refresh';
import { FRANSBERG_OBSERVED_AT } from '../../../../../packages/data-acquisition/src/adapters/fransberg-rate.source';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

const log = createLogger('error');

function envOf(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

describe('handleFransbergRateRefresh', () => {
  it('skips the append while the stored newest fransberg observation carries the current dataset date', async () => {
    const refresh = vi.fn();
    const result = await handleFransbergRateRefresh(
      envOf(null),
      log,
      {
        refresh,
        storedNewestObservedAt: async () => FRANSBERG_OBSERVED_AT,
      },
    );
    expect(result).toEqual({ ratesUpdated: 0, skipped: true });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('runs the refresh when the dataset date is newer than the stored newest observation', async () => {
    const refresh = vi.fn().mockResolvedValue({ ratesUpdated: 36 });
    const result = await handleFransbergRateRefresh(
      envOf(null),
      log,
      {
        refresh,
        storedNewestObservedAt: async () => new Date('2026-01-01T00:00:00Z'),
      },
    );
    expect(result).toEqual({ ratesUpdated: 36, skipped: false });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads the stored newest observation from D1 scoped to the fransberg carrier', async () => {
    const first = vi.fn().mockResolvedValue({ newest: '2026-01-01T00:00:00.000Z' });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const refresh = vi.fn().mockResolvedValue({ ratesUpdated: 5 });

    await handleFransbergRateRefresh(envOf({ prepare }), log, { refresh });

    expect(prepare).toHaveBeenCalledWith(
      'SELECT MAX(observed_at) AS newest FROM transport_offers WHERE carrier = ?',
    );
    expect(bind).toHaveBeenCalledWith('fransberg');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('treats a fransberg-less table (null newest) as needing the initial append', async () => {
    const refresh = vi.fn().mockResolvedValue({ ratesUpdated: 36 });
    const result = await handleFransbergRateRefresh(
      envOf(null),
      log,
      {
        refresh,
        storedNewestObservedAt: async () => null,
      },
    );
    expect(result).toEqual({ ratesUpdated: 36, skipped: false });
  });
});

describe('cron registration', () => {
  it('registers under the monthly pattern declared in wrangler.jsonc', () => {
    expect(FRANSBERG_REFRESH_CRON).toBe('0 5 1 * *');
  });
});
