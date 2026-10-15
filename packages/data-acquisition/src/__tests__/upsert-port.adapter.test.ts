import { describe, it, expect } from 'vitest';
import { DrizzleUpsertRepository } from '../adapters/upsert-port.adapter';
import type {
  UpsertOfferInput,
  UpsertProductInput,
} from '../interfaces/upsert-port.interface';
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
 * `onValues` captures the payload handed to `.values()` so tests can pin
 * what the adapter actually persists; `onSet` captures `.set()` payloads
 * (UPDATE statements) the same way.
 */
function createDbStub(
  awaitedResults: unknown[],
  onValues?: (payload: unknown) => void,
  onSet?: (payload: unknown) => void,
): DrizzleDatabase {
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
        if (prop === 'values') {
          return (payload: unknown) => {
            onValues?.(payload);
            return stub;
          };
        }
        if (prop === 'set') {
          return (payload: unknown) => {
            onSet?.(payload);
            return stub;
          };
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
    merchant: 'alko',
    country: 'FI',
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

function productInput(
  overrides: Partial<UpsertProductInput> = {},
): UpsertProductInput {
  return {
    id: 0, // placeholder — the adapter resolves the canonical ID
    name: 'Glenfarclas 70 Year Old Single Malt',
    manufacturer: 'Glenfarclas',
    brand: 'Glenfarclas',
    category: 'whisky',
    alcoholByVolume: '0.7',
    unitVolume: '0.7',
    containerType: 'bottle',
    regulatoryClassification: 'whisky',
    depositSystemStatus: false,
    ean: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// upsertProduct — the name-quality gate at the persistence path (change
// product-name-quality-gate, task 2.3): `name` stores the annotation-stripped
// display form, `name_annotation` the commentary, `name_quality` the gate
// verdict. Quarantined rows are still WRITTEN — quarantine excludes from
// listings (task 2.4), it is not deletion.
// ---------------------------------------------------------------------------

describe('DrizzleUpsertRepository.upsertProduct — name-quality gate', () => {
  it('insert stores the stripped display name plus the annotation metadata', async () => {
    const inserted: unknown[] = [];
    const repo = new DrizzleUpsertRepository(
      createDbStub([[], [{ id: 42 }]], (payload) => inserted.push(payload)),
    );

    const result = await repo.upsertProduct(
      productInput({
        name: 'Glenfarclas 70 Year Old Single Malt (saatavuus 1 plo)',
      }),
    );

    expect(result).toEqual({ productId: 42, created: true });
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        name: 'Glenfarclas 70 Year Old Single Malt',
        nameAnnotation: 'saatavuus 1 plo',
        nameQuality: 'ok',
      }),
    );
  });

  it('writes token-only names quarantined — quarantine stores, never deletes', async () => {
    const inserted: unknown[] = [];
    const repo = new DrizzleUpsertRepository(
      createDbStub([[], [{ id: 43 }]], (payload) => inserted.push(payload)),
    );

    await repo.upsertProduct(productInput({ name: '40 %' }));

    expect(inserted[0]).toEqual(
      expect.objectContaining({
        name: '40 %',
        nameAnnotation: null,
        nameQuality: 'quarantined',
      }),
    );
  });

  it('EAN-match update refreshes the stripped name, verdict, and annotation', async () => {
    const updated: unknown[] = [];
    const repo = new DrizzleUpsertRepository(
      createDbStub([[{ id: 7 }]], undefined, (payload) => updated.push(payload)),
    );

    const result = await repo.upsertProduct(
      productInput({
        ean: '6420123456789',
        name: 'Glenfarclas 70 Year Old Single Malt (loppu)',
      }),
    );

    expect(result).toEqual({ productId: 7, created: false });
    expect(updated[0]).toEqual(
      expect.objectContaining({
        name: 'Glenfarclas 70 Year Old Single Malt',
        nameAnnotation: 'loppu',
        nameQuality: 'ok',
      }),
    );
  });

  it('compound-key hit stamps the verdict and annotation (a hit must not leave a quarantined row reading ok)', async () => {
    const updated: unknown[] = [];
    const repo = new DrizzleUpsertRepository(
      createDbStub([[{ id: 9 }]], undefined, (payload) => updated.push(payload)),
    );

    const result = await repo.upsertProduct(productInput({ name: '40 %' }));

    expect(result).toEqual({ productId: 9, created: false });
    expect(updated[0]).toEqual(
      expect.objectContaining({
        nameQuality: 'quarantined',
        nameAnnotation: null,
      }),
    );
    expect(updated[0]).not.toHaveProperty('name');
  });
});

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

  it('persists the EUR offer without any FX provenance fields (design D3)', async () => {
    const inserted: unknown[] = [];
    const repo = new DrizzleUpsertRepository(
      createDbStub([[], [{ id: 903 }]], (payload) => inserted.push(payload)),
    );

    await repo.upsertOffer(offerInput());

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toEqual(
      expect.objectContaining({
        priceCents: 1499,
        currency: 'EUR',
      }),
    );
    // The provenance columns are gone (migration 0012) and the upsert
    // input no longer carries the fields at all.
    expect(inserted[0]).not.toHaveProperty('originalPriceCents');
    expect(inserted[0]).not.toHaveProperty('originalCurrency');
    expect(inserted[0]).not.toHaveProperty('fxDatasetVersion');
  });
});
