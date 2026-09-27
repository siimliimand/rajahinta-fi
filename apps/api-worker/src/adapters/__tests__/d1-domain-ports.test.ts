/**
 * D1 domain-port tests (task 4.2, change drop-sweden-eur-only-alko-benchmark).
 *
 * D1ProductDataPort (read side): the port is the live D1 read side of the
 * calculator's product-data port. These tests pin the two read-model
 * properties the Alko benchmark depends on: `observedAt` flows through
 * (the newest-reference selection needs the observation axis), and the
 * EUR-literal narrowing stays exactly as the design D3 boundary defines
 * it. The repository layer is proven separately
 * (product-search.repository.test.ts: "findOffers maps observed_at TEXT
 * → Date"); here a stub repository isolates the port's mapping.
 *
 * D1CalculationRecordPort (write side): the benchmark snapshot the
 * orchestrator puts on CreateCalculationRecordInput must survive the
 * persist-then-read round trip byte-stable, and records without one must
 * read back NULL — the legacy shape every read mapper renders as an
 * absent key. Real migrated SQLite via the data-platform D1 harness.
 *
 * @module D1DomainPortsProductTest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  D1CalculationRecordPort,
  D1ProductDataPort,
  IMPLAUSIBLE_VOLUME_METRIC,
  implausibleVolumeRowCount,
  resetImplausibleVolumeRowCount,
} from '../d1-domain-ports';
import type { CreateCalculationRecordInput } from '@rajahinta/core-domain';
import type { ProductRepository } from '../../../../../packages/data-platform/src/abstracts';
import type { RetailOfferRecord } from '../../../../../packages/data-platform/src/interfaces/repository-registry.interface';
import { D1CalculationRecordRepository } from '../../../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
// The api-worker harness resolves the committed migrations dir relative to
// the module file; the data-platform d1-test-harness resolves via cwd and
// only works when vitest runs from the repo root / data-platform.
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';

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
    const offers = await portWith([offerRow({ currency: 'USD' })]).findRetailOffers(1);

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

  it('carries the persisted stock state through (task 4.1)', async () => {
    const offers = await portWith([
      offerRow({ id: 11, availability: 'in_stock' }),
      offerRow({ id: 12, availability: 'out_of_stock' }),
      offerRow({ id: 13, availability: 'low_stock' }),
    ]).findRetailOffers(1);

    expect(offers.map((o) => o.availability)).toEqual([
      'in_stock',
      'out_of_stock',
      'low_stock',
    ]);
  });

  it('degrades unknown availability values to unknown — never an exclusion on legacy data', async () => {
    const offers = await portWith([
      offerRow({ availability: 'SOME_LEGACY_VALUE' }),
    ]).findRetailOffers(1);

    expect(offers[0].availability).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// Volume guard (task 1.5, proposal D1) — litres canonical, ≥ 100 L degrades
// ---------------------------------------------------------------------------

/** Minimal product_master contract row — the fields the port reads. */
function productRow(
  overrides: Partial<Record<'id' | 'name' | 'unitVolume' | 'alcoholByVolume', string | number>> = {},
): Record<string, unknown> {
  return {
    id: 1,
    name: 'Koskenkorva 38% 50cl PET',
    manufacturer: 'Anora',
    brand: 'Koskenkorva',
    category: 'vodka',
    alcoholByVolume: '0.38',
    unitVolume: '0.5',
    containerType: 'plastic',
    regulatoryClassification: 'vodka',
    depositSystemStatus: null,
    ...overrides,
  };
}

function portWithProduct(
  findById: (id: number) => Record<string, unknown> | null,
  offers: RetailOfferRecord[] = [offerRow()],
): D1ProductDataPort {
  const repo = {
    findById: async (id: number) => findById(id),
    findOffers: async () => offers,
  };
  return new D1ProductDataPort(repo as unknown as ProductRepository);
}

describe('D1ProductDataPort volume guard (task 1.5, proposal D1)', () => {
  beforeEach(() => resetImplausibleVolumeRowCount());
  afterEach(() => vi.restoreAllMocks());

  it('reads the Koskenkorva 0.5 L row as litres — status untouched, no metric', async () => {
    const port = portWithProduct(() => productRow());

    const product = await port.findProductById(1);
    expect(product?.volumeLitres).toBe(0.5);
    expect(product?.weightKg).toBe(0.5);

    const offers = await port.findRetailOffers(1);
    expect(offers[0].reliabilityStatus).toBe('VERIFIED');
    expect(implausibleVolumeRowCount()).toBe(0);
  });

  it('passes an implausible row through UNDIVIDED, degrades its offers, counts the row', async () => {
    const warn = vi.spyOn(console, 'warn');
    const port = portWithProduct(() => productRow({ unitVolume: '500' }));

    // Passthrough: the guard degrades visibility, it never divides.
    const product = await port.findProductById(1);
    expect(product?.volumeLitres).toBe(500);

    const offers = await port.findRetailOffers(1);
    expect(offers[0].reliabilityStatus).toBe('ESTIMATED');
    expect(implausibleVolumeRowCount()).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(IMPLAUSIBLE_VOLUME_METRIC),
    );
  });

  it('is downgrade-only: STALE and UNAVAILABLE offers keep the stricter status', async () => {
    const port = portWithProduct(() => productRow({ unitVolume: '500' }), [
      offerRow({ id: 21, reliabilityStatus: 'STALE' }),
      offerRow({ id: 22, reliabilityStatus: 'UNAVAILABLE' }),
    ]);
    await port.findProductById(1);

    const offers = await port.findRetailOffers(1);
    expect(offers.map((o) => o.reliabilityStatus)).toEqual([
      'STALE',
      'UNAVAILABLE',
    ]);
  });

  it('trips at exactly 100 L — the guard is ≥', async () => {
    const port = portWithProduct(() => productRow({ unitVolume: '100' }));
    await port.findProductById(1);

    expect(implausibleVolumeRowCount()).toBe(1);
    expect((await port.findRetailOffers(1))[0].reliabilityStatus).toBe(
      'ESTIMATED',
    );
  });

  it('does not trip just below the boundary (99.9 L)', async () => {
    const port = portWithProduct(() => productRow({ unitVolume: '99.9' }));
    await port.findProductById(1);

    expect(implausibleVolumeRowCount()).toBe(0);
    expect((await port.findRetailOffers(1))[0].reliabilityStatus).toBe(
      'VERIFIED',
    );
  });

  it('scopes degradation to the tripped product id', async () => {
    const port = portWithProduct((id) =>
      id === 1 ? productRow({ unitVolume: '500' }) : productRow({ id: 2, unitVolume: '0.33' }),
    );
    await port.findProductById(1);

    expect((await port.findRetailOffers(2))[0].reliabilityStatus).toBe(
      'VERIFIED',
    );
    expect((await port.findRetailOffers(1))[0].reliabilityStatus).toBe(
      'ESTIMATED',
    );
  });
});

// ---------------------------------------------------------------------------
// D1CalculationRecordPort — the alkoBenchmark write-side round trip
// ---------------------------------------------------------------------------

/** The JSON-stable snapshot the orchestrator builds (ISO observedAt). */
const BENCHMARK_SNAPSHOT = {
  status: 'available',
  referencePriceCents: 300,
  differenceCents: -50,
  differencePercent: -16.7,
  reliabilityStatus: 'VERIFIED',
  observedAt: '2026-08-05T10:00:00.000Z',
} as const;

function recordInput(
  overrides: Partial<CreateCalculationRecordInput> = {},
): CreateCalculationRecordInput {
  return {
    productMasterId: 1,
    retailOfferIds: [11],
    transportOfferId: null,
    exciseRuleVersionId: null,
    containerDutyRuleVersionId: null,
    totalCents: 499,
    breakdown: [
      {
        label: 'Retail price',
        category: 'foreignRetailPrice',
        cents: 350,
        reliability: 'VERIFIED',
      },
    ],
    confidence: 'HIGH',
    quantity: 1,
    destination: 'FI',
    disclaimer: {
      text: 'Arvioitu kokonaiskustannus Suomessa.',
      language: 'fi',
      version: '1.0',
    },
    sessionId: null,
    ...overrides,
  };
}

describe('D1CalculationRecordPort — alkoBenchmark round trip', () => {
  it('persists the benchmark and reads back the exact snapshot', async () => {
    const { db, d1 } = openMigratedD1();
    db.prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (1, 'Karhu III', 'm', 'b', 'beer', 0.33, 'can', 'beer')`,
    ).run();

    const port = new D1CalculationRecordPort(d1);
    const { id } = await port.create(
      recordInput({ alkoBenchmark: BENCHMARK_SNAPSHOT }),
    );

    const loaded = await new D1CalculationRecordRepository(d1).findById(id);
    // Byte-stable round trip: figures, reliability, and the ISO string —
    // observedAt stays a JSON string, never revived into a Date.
    expect(loaded?.alkoBenchmark).toEqual(BENCHMARK_SNAPSHOT);
    expect(
      (loaded?.alkoBenchmark as { observedAt: string }).observedAt,
    ).toBe('2026-08-05T10:00:00.000Z');
  });

  it('writes NULL when the record has no benchmark — the legacy read shape', async () => {
    const { db, d1 } = openMigratedD1();
    db.prepare(
      `INSERT INTO product_master (id, name, manufacturer, brand, category,
          unit_volume, container_type, regulatory_classification)
       VALUES (1, 'Karhu III', 'm', 'b', 'beer', 0.33, 'can', 'beer')`,
    ).run();

    const port = new D1CalculationRecordPort(d1);
    const { id } = await port.create(recordInput());

    const loaded = await new D1CalculationRecordRepository(d1).findById(id);
    // NULL column on read — the read mapper turns this into an ABSENT
    // key, so the response matches every pre-change record.
    expect(loaded?.alkoBenchmark).toBeNull();
  });
});
