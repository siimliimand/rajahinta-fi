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
    expect(product.unitVolume).toBe('0.5');
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

// ---------------------------------------------------------------------------
// Canonical litres on unitVolume (task 1.1, change
// unit-integrity-and-result-trust) — source millilitres divide by 1000 at
// ingestion, the persisted string carries the litres shape
// ---------------------------------------------------------------------------

describe('DataMappingService — unitVolume in litres (task 1.1)', () => {
  const service = new DataMappingService();

  it('maps a standard 500 ml can to "0.5"', () => {
    const { product } = service.mapToProductAndOffer(eurRecord({ volumeMl: 500 }), 'alko', 'FI');

    expect(product.unitVolume).toBe('0.5');
  });

  it('maps a standard 750 ml bottle to "0.75"', () => {
    const { product } = service.mapToProductAndOffer(eurRecord({ volumeMl: 750 }), 'alko', 'FI');

    expect(product.unitVolume).toBe('0.75');
  });

  it('maps a 3 l BIB to "3"', () => {
    const { product } = service.mapToProductAndOffer(eurRecord({ volumeMl: 3000 }), 'alks', 'DE');

    expect(product.unitVolume).toBe('3');
  });

  it('maps a 150 ml miniature to "0.15" — no float artifacts', () => {
    const { product } = service.mapToProductAndOffer(eurRecord({ volumeMl: 150 }), 'alko', 'FI');

    expect(product.unitVolume).toBe('0.15');
  });

  it('maps the parser\'s 0-ml absent-volume encoding to "0"', () => {
    const { product } = service.mapToProductAndOffer(eurRecord({ volumeMl: 0 }), 'alko', 'FI');

    expect(product.unitVolume).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// HTML entity decoding on feed display text (task 1.2, change
// unit-integrity-and-result-trust) — decoded at ingestion; render-time
// output escaping elsewhere is unchanged
// ---------------------------------------------------------------------------

describe('DataMappingService — feed display-text entity decoding (task 1.2)', () => {
  const service = new DataMappingService();

  it('spec: name containing &#038; persists "&" — no entity literal', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ productName: 'Gin &#038; Tonic' }),
      'alks',
      'DE',
    );

    expect(product.name).toBe('Gin & Tonic');
    expect(product.name).not.toContain('&#038;');
  });

  it('spec: name containing &#8221; persists the typographic quote', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ productName: 'Koskenkorva &#8221;Sisu&#8221;' }),
      'alks',
      'DE',
    );

    expect(product.name).toBe('Koskenkorva \u201DSisu\u201D');
  });

  it('spec: name containing &#215; persists "×"', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ productName: 'Long Drink &#215; 24' }),
      'alks',
      'DE',
    );

    expect(product.name).toBe('Long Drink \u00D7 24');
  });

  it('spec: plain-text name passes through byte-identical', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ productName: 'Lapin Kulta IVA 4,7% 0,33 l' }),
      'alko',
      'FI',
    );

    expect(product.name).toBe('Lapin Kulta IVA 4,7% 0,33 l');
  });

  it('spec: an already-decoded "&" is not double-decoded or corrupted', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ productName: 'Fish & Chips' }),
      'alko',
      'FI',
    );

    expect(product.name).toBe('Fish & Chips');
  });

  it('decodes the brand into both brand and manufacturer fields', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ brand: 'Harboe &#038; Co' }),
      'alks',
      'DE',
    );

    expect(product.brand).toBe('Harboe & Co');
    expect(product.manufacturer).toBe('Harboe & Co');
  });
});

// ---------------------------------------------------------------------------
// Feed weight on the product master (task 3.1, design D7,
// change alks-feed-and-import-vat)
// ---------------------------------------------------------------------------

describe('DataMappingService — feed weight on the product master (task 3.1, design D7)', () => {
  const service = new DataMappingService();

  it('spec: weight 0.53 kg → weightGrams 530 on the product input', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ weightGrams: 530 }),
      'alks',
      'DE',
    );

    expect(product.weightGrams).toBe(530);
  });

  it('spec: absent weight → weightGrams null, no error', () => {
    // Alko-shaped record: RawFeedRecord.weightGrams is optional and the
    // Alko feed never sends it.
    const { product } = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect(product.weightGrams).toBeNull();
  });

  it('an explicit null weight (the parser\'s absent encoding) maps to null', () => {
    const { product } = service.mapToProductAndOffer(
      eurRecord({ weightGrams: null }),
      'alks',
      'DE',
    );

    expect(product.weightGrams).toBeNull();
  });

  it('mapBatch carries each record\'s weight record-for-record', () => {
    const pairs = service.mapBatch(
      [eurRecord({ weightGrams: 1250 }), eurRecord()],
      'alks',
      'DE',
    );

    expect(pairs[0].product.weightGrams).toBe(1250);
    expect(pairs[1].product.weightGrams).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ESTIMATED offer on unresolved alcohol fields (task 3.1, design D3,
// change alks-feed-and-import-vat) — keyed off the parser's encoding:
// null ABV / 0 ml
// ---------------------------------------------------------------------------

describe('DataMappingService — ESTIMATED offer on unresolved alcohol fields (task 3.1, design D3)', () => {
  const service = new DataMappingService();

  it('spec: null ABV → the offer carries ESTIMATED', () => {
    const { offerInput } = service.mapToProductAndOffer(
      eurRecord({ alcoholByVolume: null }),
      'alks',
      'DE',
    );

    expect(offerInput.reliabilityStatus).toBe('ESTIMATED');
  });

  it('spec: 0 volume (the parser\'s absent-volume encoding) → the offer carries ESTIMATED', () => {
    const { offerInput } = service.mapToProductAndOffer(
      eurRecord({ volumeMl: 0 }),
      'alks',
      'DE',
    );

    expect(offerInput.reliabilityStatus).toBe('ESTIMATED');
  });

  it('a fully parsed record stays ESTIMATED — ingestion never self-certifies VERIFIED', () => {
    const { offerInput } = service.mapToProductAndOffer(
      eurRecord({ alcoholByVolume: 0.05, volumeMl: 330 }),
      'alks',
      'DE',
    );

    expect(offerInput.reliabilityStatus).toBe('ESTIMATED');
  });
});

// ---------------------------------------------------------------------------
// Price floor gate (task 1.1, design D1, change
// data-quality-and-publication-trust) — a non-positive price is price
// drift rejected at mapping time; the parser's minor-unit read stays
// structural. The offer is never published; the product stays offer-less.
// ---------------------------------------------------------------------------

describe('DataMappingService — price floor gate (task 1.1, design D1)', () => {
  const service = new DataMappingService();

  it('spec: minor-unit price "0" is rejected as price drift, naming the source value', () => {
    const pair = service.mapToProductAndOffer(
      eurRecord({ priceCents: 0, originalPriceCents: 0 }),
      'alks',
      'DE',
    );

    expect(pair.offerErrors).toHaveLength(1);
    expect(pair.offerErrors![0]).toContain('price drift');
    expect(pair.offerErrors![0]).toContain('"0"');
    expect(pair.offerErrors![0]).toContain('alks');
  });

  it('spec: a rejected price keeps the product — the product exists offer-less', () => {
    const pair = service.mapToProductAndOffer(
      eurRecord({ priceCents: 0, originalPriceCents: 0 }),
      'alks',
      'DE',
    );

    // D1: gates reject to absence, they never fix data — the product
    // still maps in full and honestly sorts last without an offer.
    expect(pair.product.name).toBe('Lapin Kulta');
    expect(pair.product.brand).toBe('Lapin Kulta');
    expect(pair.product.unitVolume).toBe('0.5');
  });

  it('spec: a negative price is rejected as price drift, naming the source value', () => {
    const pair = service.mapToProductAndOffer(
      eurRecord({ priceCents: -5, originalPriceCents: -5 }),
      'alko',
      'FI',
    );

    expect(pair.offerErrors).toHaveLength(1);
    expect(pair.offerErrors![0]).toContain('price drift');
    expect(pair.offerErrors![0]).toContain('"-5"');
  });

  it('spec: a valid price passes through unchanged — no rejection channel', () => {
    const pair = service.mapToProductAndOffer(eurRecord(), 'alko', 'FI');

    expect('offerErrors' in pair).toBe(false);
    expect(pair.offerInput.priceCents).toBe(149);
    expect(pair.offerInput.currency).toBe('EUR');
  });

  it('mapBatch keeps a rejected record in its slot with its product and its drift error', () => {
    const pairs = service.mapBatch(
      [
        eurRecord({ priceCents: 149 }),
        eurRecord({ productId: '000004', priceCents: 0, originalPriceCents: 0 }),
      ],
      'alks',
      'DE',
    );

    expect(pairs).toHaveLength(2);
    expect(pairs[0].offerErrors).toBeUndefined();
    expect(pairs[1].offerErrors?.[0]).toContain('price drift');
    expect(pairs[1].offerErrors?.[0]).toContain('"0"');
    expect(pairs[1].product.name).toBe('Lapin Kulta');
  });
});
