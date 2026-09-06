/**
 * ProductDataAdapter read-side tests (task 4.2, change
 * drop-sweden-eur-only-alko-benchmark).
 *
 * The adapter is the live Postgres read side of the calculator's
 * product-data port. These tests pin the two read-model properties the
 * Alko benchmark depends on: `observedAt` flows through (the
 * newest-reference selection needs the observation axis), and the
 * free-string `currency` column narrows to the contract's `'EUR'`
 * literal at this boundary — the same policy as the D1 adapter.
 *
 * @module ProductDataAdapterTest
 */

import { describe, it, expect } from 'vitest';
import { ProductDataAdapter } from '../adapters/product-data.adapter';
import type { ProductRepository } from '@rajahinta/data-platform';

/** A pg retail_offers row (typeof retailOffers.$inferSelect shape). */
function offerRow(
  overrides: Partial<{
    id: number;
    merchant: string;
    country: string;
    productId: number;
    priceCents: number;
    currency: string;
    availability: string;
    sourceUrl: string | null;
    observedAt: Date;
    reliabilityStatus: string;
  }> = {},
): Record<string, unknown> {
  return {
    id: 11,
    merchant: 'alko',
    country: 'FI',
    productId: 1,
    priceCents: 350,
    currency: 'EUR',
    availability: 'in_stock',
    sourceUrl: 'https://example.invalid/offer',
    observedAt: new Date('2026-08-05T10:00:00.000Z'),
    reliabilityStatus: 'VERIFIED',
    ...overrides,
  };
}

function adapterWith(rows: unknown[]): ProductDataAdapter {
  const repo = {
    findById: async () => null,
    findOffers: async () => rows,
  };
  return new ProductDataAdapter(repo as unknown as ProductRepository);
}

describe('ProductDataAdapter.findRetailOffers', () => {
  it('emits observedAt so live Alko references carry the observation axis', async () => {
    const observedAt = new Date('2026-08-05T10:00:00.000Z');
    const offers = await adapterWith([offerRow({ observedAt })]).findRetailOffers(1);

    expect(offers).toHaveLength(1);
    expect(offers[0].observedAt).toEqual(observedAt);
  });

  it('maps the base offer fields unchanged', async () => {
    const offers = await adapterWith([
      offerRow({ id: 11, priceCents: 350, merchant: 'alko', country: 'FI' }),
    ]).findRetailOffers(1);

    expect(offers[0]).toMatchObject({
      id: 11,
      priceCents: 350,
      merchant: 'alko',
      country: 'FI',
      reliabilityStatus: 'VERIFIED',
    });
  });

  it('narrows the free-string currency column to the EUR literal', async () => {
    const offers = await adapterWith([offerRow({ currency: 'EUR' })]).findRetailOffers(1);

    expect(offers[0].currency).toBe('EUR');
  });

  it('omits currency on a hypothetical non-EUR row — the contract reads absent as EUR', async () => {
    const offers = await adapterWith([offerRow({ currency: 'USD' })]).findRetailOffers(1);

    expect('currency' in offers[0]).toBe(false);
    // The observation axis is independent of the currency narrowing.
    expect(offers[0].observedAt).toEqual(new Date('2026-08-05T10:00:00.000Z'));
  });

  it('degrades legacy reliability values to ESTIMATED — never overstated', async () => {
    const offers = await adapterWith([
      offerRow({ reliabilityStatus: 'EXACT' }),
    ]).findRetailOffers(1);

    expect(offers[0].reliabilityStatus).toBe('ESTIMATED');
  });
});
