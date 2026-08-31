/**
 * D1MerchantTermsRepository — real-SQLite tests (task 2.5): missing row
 * means no known threshold, upsert replaces the commercial columns and
 * refreshes observedAt, null threshold round-trips.
 *
 * @module D1MerchantTermsRepositoryTest
 */
import { describe, it, expect } from 'vitest';
import { openMigratedD1 } from './d1-test-harness';
import { D1MerchantTermsRepository } from '../merchant-terms.repository';

const { d1 } = openMigratedD1();
const repo = new D1MerchantTermsRepository(d1);

describe('D1MerchantTermsRepository', () => {
  it('returns null when no terms are known — never a zero threshold', async () => {
    await expect(repo.findByMerchant('unknown-merchant')).resolves.toBeNull();
  });

  it('upserts a new row with threshold and provenance', async () => {
    const observedAt = new Date('2026-08-01T06:00:00.000Z');
    const row = await repo.upsert({
      merchantId: 'alko',
      minimumOrderValueCents: 2000,
      currency: 'EUR',
      sourceUrl: 'https://alko.fi/en/deliveries',
      reliabilityStatus: 'VERIFIED',
      observedAt,
    });

    expect(row.merchantId).toBe('alko');
    expect(row.minimumOrderValueCents).toBe(2000);
    expect(row.observedAt).toEqual(observedAt);

    const loaded = await repo.findByMerchant('alko');
    expect(loaded).toEqual(row);
  });

  it('replaces the commercial columns on conflict and refreshes observedAt', async () => {
    await repo.upsert({
      merchantId: 'systembolaget',
      minimumOrderValueCents: 1500,
      currency: 'EUR',
      sourceUrl: 'https://systembolaget.se',
    });
    const refreshed = new Date('2026-08-20T12:00:00.000Z');
    const updated = await repo.upsert({
      merchantId: 'systembolaget',
      minimumOrderValueCents: 2500,
      currency: 'EUR',
      sourceUrl: 'https://systembolaget.se/hjemleverans',
      reliabilityStatus: 'VERIFIED',
      observedAt: refreshed,
    });

    expect(updated.id).toBeGreaterThan(0);
    expect(updated.minimumOrderValueCents).toBe(2500);
    expect(updated.reliabilityStatus).toBe('VERIFIED');
    expect(updated.observedAt).toEqual(refreshed);

    // One row per merchant — the unique key converged, never duplicated.
    const all = (await d1
      .prepare('SELECT count(*) AS n FROM merchant_terms WHERE merchant_id = ?')
      .bind('systembolaget')
      .first()) as { n: number };
    expect(all.n).toBe(1);
  });

  it('stores a null threshold when the value is absent', async () => {
    const row = await repo.upsert({ merchantId: 'beermax', currency: 'EUR' });
    expect(row.minimumOrderValueCents).toBeNull();
    expect(row.reliabilityStatus).toBe('ESTIMATED');
    expect(row.observedAt).toBeInstanceOf(Date);
  });
});
