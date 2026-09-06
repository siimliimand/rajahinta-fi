/**
 * D1ProductDataPort read-side tests (task 4.2, change
 * drop-sweden-eur-only-alko-benchmark).
 *
 * The port is the live D1 read side of the calculator's product-data
 * port. These tests pin the two read-model properties the Alko benchmark
 * depends on: `observedAt` flows through (the newest-reference selection
 * needs the observation axis), and the EUR-literal narrowing stays
 * exactly as the design D3 boundary defines it.
 *
 * The repository layer is proven separately
 * (product-search.repository.test.ts: "findOffers maps observed_at TEXT
 * → Date"); here a stub repository isolates the port's mapping.
 *
 * @module D1DomainPortsProductTest
 */

import { describe, it, expect } from 'vitest';
import { D1ProductDataPort } from '../d1-domain-ports';
import type { ProductRepository } from '../../../../../packages/data-platform/src/abstracts';
import type { RetailOfferRecord } from '../../../../../packages/data-platform/src/interfaces/repository-registry.interface';

function offerRow(
  overrides: Partial<RetailOfferRecord> = {},
): RetailOfferRecord {
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

function portWith(rows: RetailOfferRecord[]): D1ProductDataPort {
  const repo = {
    findById: async () => null,
    findOffers: async () => rows,
  };
  return new D1ProductDataPort(repo as unknown as ProductRepository);
}

describe('D1ProductDataPort.findRetailOffers', () => {
  it('emits observedAt so live Alko references carry the observation axis', async () => {
    const observedAt = new Date('2026-08-05T10:00:00.000Z');
    const offers = await portWith([offerRow({ observedAt })]).findRetailOffers(1);

    expect(offers).toHaveLength(1);
    expect(offers[0].observedAt).toEqual(observedAt);
  });

  it('maps the base offer fields unchanged', async () => {
    const offers = await portWith([
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

  it('keeps the EUR-literal narrowing: equality with the literal proves the value', async () => {
    const offers = await portWith([offerRow({ currency: 'EUR' })]).findRetailOffers(1);

    expect(offers[0].currency).toBe('EUR');
  });

  it('omits currency on a hypothetical non-EUR row — the contract reads absent as EUR', async () => {
    const offers = await portWith([offerRow({ currency: 'SEK' })]).findRetailOffers(1);

    expect('currency' in offers[0]).toBe(false);
    // The observation axis is independent of the currency narrowing.
    expect(offers[0].observedAt).toEqual(new Date('2026-08-05T10:00:00.000Z'));
  });

  it('degrades legacy reliability values to ESTIMATED — never overstated', async () => {
    const offers = await portWith([
      offerRow({ reliabilityStatus: 'EXACT' }),
    ]).findRetailOffers(1);

    expect(offers[0].reliabilityStatus).toBe('ESTIMATED');
  });
});
