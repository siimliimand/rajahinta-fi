/**
 * DataMappingService tests (tasks 1.4/1.5 follow-through, FIX-F).
 *
 * Pins the conversion-provenance persistence contract: a RawFeedRecord
 * that was converted to EUR at ingestion must carry its original
 * amount/currency and the FX dataset version all the way into the
 * upsert input — nothing may drop them between the adapter and the
 * retail_offers row (design D2, fx-rate-dataset spec delta:
 * "Conversion at ingestion with provenance").
 *
 * @module DataMappingServiceTests
 */
import { describe, it, expect } from 'vitest';
import { DataMappingService } from '../services/data-mapping.service';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A Systembolaget-shaped record: SEK converted to EUR at ingestion. */
function sekRecord(overrides: Partial<RawFeedRecord> = {}): RawFeedRecord {
  return {
    productId: '12345',
    productName: 'Norrlands Guld Export',
    manufacturer: 'Norrlands',
    brand: 'Norrlands Guld',
    category: 'beer',
    alcoholByVolume: 0.052,
    volumeMl: 500,
    containerType: 'can',
    regulatoryClassification: 'beer',
    depositSystem: false,
    ean: null,
    // 15.90 SEK at EUR/SEK 11.29 → 141 ¢ (rounded half-up)
    priceCents: 141,
    currency: 'EUR',
    originalPriceCents: 1590,
    originalCurrency: 'SEK',
    fxDatasetVersion: 'ecb-2026-08-27.1',
    availability: 'in_stock',
    sourceUrl: null,
    ...overrides,
  };
}

/** An Alko-shaped record: EUR-native, no conversion happened. */
function eurNativeRecord(overrides: Partial<RawFeedRecord> = {}): RawFeedRecord {
  return {
    ...sekRecord(),
    productId: '000003',
    productName: 'Lapin Kulta',
    priceCents: 149,
    originalPriceCents: 149,
    originalCurrency: 'EUR',
    // EUR-native feeds carry no conversion provenance at all.
    fxDatasetVersion: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DataMappingService — conversion provenance (FIX-F)', () => {
  const service = new DataMappingService();

  it('persists original amount, original currency, and FX dataset version on the offer', () => {
    const { offerInput } = service.mapToProductAndOffer(
      sekRecord(),
      'systembolaget',
      'SE',
    );

    expect(offerInput.priceCents).toBe(141);
    expect(offerInput.currency).toBe('EUR');
    expect(offerInput.originalPriceCents).toBe(1590);
    expect(offerInput.originalCurrency).toBe('SEK');
    expect(offerInput.fxDatasetVersion).toBe('ecb-2026-08-27.1');
  });

  it('maps an EUR-native record with null FX version — no conversion to attribute', () => {
    const { offerInput } = service.mapToProductAndOffer(
      eurNativeRecord(),
      'alko',
      'FI',
    );

    expect(offerInput.originalPriceCents).toBe(149);
    expect(offerInput.originalCurrency).toBe('EUR');
    expect(offerInput.fxDatasetVersion).toBeNull();
  });

  it('defaults a missing FX version to null, never undefined (column semantics)', () => {
    const { fxDatasetVersion, ...withoutVersion } = sekRecord();
    expect(fxDatasetVersion).toBeDefined(); // fixture sanity

    const { offerInput } = service.mapToProductAndOffer(
      withoutVersion,
      'systembolaget',
      'SE',
    );

    expect(offerInput.fxDatasetVersion).toBeNull();
    expect(offerInput.originalPriceCents).toBe(1590);
  });
});

describe('DataMappingService — product and offer mapping', () => {
  const service = new DataMappingService();

  it('maps product fields including decimal-fraction ABV as a numeric string', () => {
    const { product } = service.mapToProductAndOffer(sekRecord(), 'systembolaget', 'SE');

    expect(product.name).toBe('Norrlands Guld Export');
    expect(product.brand).toBe('Norrlands Guld');
    expect(product.category).toBe('beer');
    expect(product.regulatoryClassification).toBe('beer');
    expect(product.unitVolume).toBe('500');
    expect(product.alcoholByVolume).toBe('0.052');
    expect(product.containerType).toBe('can');
    expect(product.ean).toBeNull();
  });

  it('maps null ABV through as null', () => {
    const { product } = service.mapToProductAndOffer(
      sekRecord({ alcoholByVolume: null }),
      'systembolaget',
      'SE',
    );

    expect(product.alcoholByVolume).toBeNull();
  });

  it('stamps the registry merchant market as the offer country', () => {
    const { offerInput } = service.mapToProductAndOffer(sekRecord(), 'systembolaget', 'SE');

    expect(offerInput.merchant).toBe('systembolaget');
    expect(offerInput.country).toBe('SE');
  });

  it('defaults the offer country to the Finnish market for direct unit callers', () => {
    const { offerInput } = service.mapToProductAndOffer(sekRecord(), 'alko');

    expect(offerInput.country).toBe('FI');
  });

  it('carries the source URL and a fresh observation timestamp', () => {
    const before = new Date();
    const { offerInput } = service.mapToProductAndOffer(
      sekRecord({ sourceUrl: 'https://www.systembolaget.se/p/12345' }),
      'systembolaget',
      'SE',
    );
    const after = new Date();

    expect(offerInput.sourceUrl).toBe('https://www.systembolaget.se/p/12345');
    expect(offerInput.observedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(offerInput.observedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    expect(offerInput.reliabilityStatus).toBe('ESTIMATED');
  });

  it('maps a batch record-for-record', () => {
    const pairs = service.mapBatch(
      [sekRecord(), eurNativeRecord()],
      'systembolaget',
      'SE',
    );

    expect(pairs).toHaveLength(2);
    expect(pairs[0].offerInput.fxDatasetVersion).toBe('ecb-2026-08-27.1');
    expect(pairs[1].offerInput.fxDatasetVersion).toBeNull();
  });
});
