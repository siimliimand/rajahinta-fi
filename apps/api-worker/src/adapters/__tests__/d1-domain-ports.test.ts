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

import { describe, it, expect } from 'vitest';
import { D1CalculationRecordPort, D1ProductDataPort } from '../d1-domain-ports';
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
