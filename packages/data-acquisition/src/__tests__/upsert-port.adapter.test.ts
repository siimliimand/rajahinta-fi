import { describe, it, expect } from 'vitest';
import { DrizzleUpsertRepository } from '../adapters/upsert-port.adapter';
import type { UpsertOfferInput } from '../interfaces/upsert-port.interface';
import type { DrizzleDatabase } from '@rajahinta/data-platform';

// ---------------------------------------------------------------------------
// Test harness
//
// Package convention is no-DB unit tests. The adapter's only I/O is two
// awaited drizzle builders (latest-prior-row select, insert-returning), so a
// thenable chain stub that resolves queued results per await is enough to
// cover the change-detection semantics end to end.
// ---------------------------------------------------------------------------

/**
 * Chainable db stub: every builder method returns the stub; awaiting it
 * resolves the next queued value (select result first, insert result second).
 */
function createDbStub(awaitedResults: unknown[]): DrizzleDatabase {
  let idx = 0;
  const stub: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          const value = awaitedResults[Math.min(idx, awaitedResults.length - 1)];
          idx++;
          return (resolve: unknown, reject: unknown) =>
            Promise.resolve(value).then(resolve as never, reject as never);
        }
        if (typeof prop !== 'string') return undefined;
        return () => stub;
      },
    },
  );
  return stub as DrizzleDatabase;
}

function offerInput(overrides: Partial<UpsertOfferInput> = {}): UpsertOfferInput {
  return {
    merchant: 'systembolaget',
    country: 'SE',
    productId: 7,
    priceCents: 1499,
    currency: 'EUR',
    availability: 'in_stock',
    sourceUrl: 'https://example.com/p7',
    observedAt: new Date('2026-08-26T10:00:00Z'),
    reliabilityStatus: 'ESTIMATED',
    ...overrides,
  };
}

describe('DrizzleUpsertRepository.upsertOffer — offer-level change detection', () => {
  it('reports changed=true for a first sighting (no prior offer row)', async () => {
    const repo = new DrizzleUpsertRepository(
      createDbStub([[], [{ id: 900 }]]),
    );

    const result = await repo.upsertOffer(offerInput());

    expect(result).toEqual({ offerId: 900, changed: true });
  });

  it('reports changed=true when the price differs from the latest prior row', async () => {
    const repo = new DrizzleUpsertRepository(
      createDbStub([[{ priceCents: 1399 }], [{ id: 901 }]]),
    );

    const result = await repo.upsertOffer(offerInput({ priceCents: 1499 }));

    expect(result).toEqual({ offerId: 901, changed: true });
  });

  it('reports changed=false when the price matches the latest prior row (unchanged re-scrape)', async () => {
    const repo = new DrizzleUpsertRepository(
      createDbStub([[{ priceCents: 1499 }], [{ id: 902 }]]),
    );

    const result = await repo.upsertOffer(offerInput({ priceCents: 1499 }));

    expect(result).toEqual({ offerId: 902, changed: false });
  });
});
