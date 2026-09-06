/**
 * DataMappingService tests.
 *
 * Pins the EUR-only offer mapping contract (change
 * drop-sweden-eur-only-alko-benchmark, design D3): a normalised feed
 * record maps onto the upsert input with its EUR cents and currency, and
 * carries NO FX conversion provenance — those fields no longer exist on
 * the upsert input, so a non-EUR feed cannot sneak provenance back in.
 *
 * @module DataMappingServiceTests
 */
import { describe, it, expect } from 'vitest';
import { DataMappingService } from '../services/data-mapping.service';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An Alko-shaped record: EUR-native offer. */
function eurRecord(overrides: Partial<RawFeedRecord> = {}): RawFeedRecord {
  return {
    productId: '000003',
    productName: 'Lapin Kulta',
    manufacturer: 'Hartwall',
    brand: 'Lapin Kulta',
    category: 'beer',
    alcoholByVolume: 0.047,
    volumeMl: 500,
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystem: false,
    ean: null,
    priceCents: 149,
    currency: 'EUR',
    // RawFeedRecord still declares the pre-conversion fields until the
    // leftover-reference sweep removes them; the mapping no longer
    // consumes them (design D3).
    originalPriceCents: 149,
    originalCurrency: 'EUR',
    availability: 'in_stock',
    sourceUrl: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataMappingService — EUR-only offer mapping (design D3)', () => {
  const service = new DataMappingService();

  it('maps the EUR price and currency onto the upsert input', () => {
    const { offerInput } = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect(offerInput.priceCents).toBe(149);
    expect(offerInput.currency).toBe('EUR');
  });

  it('carries no FX conversion provenance — the fields no longer exist', () => {
    const { offerInput } = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect('originalPriceCents' in offerInput).toBe(false);
    expect('originalCurrency' in offerInput).toBe(false);
    expect('fxDatasetVersion' in offerInput).toBe(false);
  });
});

describe('DataMappingService — product and offer mapping', () => {
  const service = new DataMappingService();

  it('maps product fields including decimal-fraction ABV as a numeric string', () => {
    const { product } = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect(product.name).toBe('Lapin Kulta');
    expect(product.brand).toBe('Lapin Kulta');
    expect(product.category).toBe('beer');
    expect(product.regulatoryClassification).toBe('beer');
    expect(product.unitVolume).toBe('500');
    expect(product.alcoholByVolume).toBe('0.047');
    expect(product.containerType).toBe('can');
    expect(product.ean).toBeNull();
  });

  it('maps null ABV through as null', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ alcoholByVolume: null }),
      'alko',
      'FI',
    );

    expect(product.alcoholByVolume).toBeNull();
  });

  it('stamps the registry merchant market as the offer country', () => {
    const { offerInput } = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect(offerInput.merchant).toBe('alko');
    expect(offerInput.country).toBe('FI');
  });

  it('defaults the offer country to the Finnish market for direct unit callers', () => {
    const { offerInput } = service.mapToProductAndOffer(eurRecord(), 'alko');

    expect(offerInput.country).toBe('FI');
  });

  it('carries the source URL and a fresh observation timestamp', () => {
    const before = new Date();
    const { offerInput } = service.mapToProductAndOffer(
      eurRecord({ sourceUrl: 'https://www.alko.fi/tuotteet/000003' }),
      'alko',
      'FI',
    );
    const after = new Date();

    expect(offerInput.sourceUrl).toBe('https://www.alko.fi/tuotteet/000003');
    expect(offerInput.observedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(offerInput.observedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(offerInput.reliabilityStatus).toBe('ESTIMATED');
  });

  it('maps a batch record-for-record', () => {
    const pairs = service.mapBatch(
      [eurRecord(), eurRecord({ productId: '000004', priceCents: 259 })],
      'alko',
      'FI',
    );

    expect(pairs).toHaveLength(2);
    expect(pairs[0].offerInput.priceCents).toBe(149);
    expect(pairs[1].offerInput.priceCents).toBe(259);
    expect(pairs[1].product.name).toBe('Lapin Kulta');
  });
});
