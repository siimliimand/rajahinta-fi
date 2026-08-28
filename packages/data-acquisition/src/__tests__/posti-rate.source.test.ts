/**
 * Posti rate-source tests — golden parser pins (task 7.4).
 *
 * High-liability: these rates enter every landed-cost calculation as the
 * transport component, and the freshness alert depends on observedAt
 * being the carrier's publication time. The golden fixture pins exact
 * parsed rows; malformed payloads and rows are rejected with reasons.
 *
 * @module PostiRateSourceTests
 */
import { describe, it, expect } from 'vitest';
import {
  parsePostiRates,
  PostiCarrierRateSource,
} from '../adapters/posti-rate.source';
import {
  POSTI_GOLDEN_PAYLOAD,
  POSTI_GOLDEN_EXPECTED_RATES,
} from '../adapters/__fixtures__/posti-rates.fixture';

describe('parsePostiRates — golden payload', () => {
  it('parses every valid row exactly as the fixture expects', () => {
    const { rates } = parsePostiRates(POSTI_GOLDEN_PAYLOAD);

    expect(rates).toEqual([...POSTI_GOLDEN_EXPECTED_RATES]);
  });

  it('carries the payload publication time as observedAt on every rate', () => {
    const { rates } = parsePostiRates(POSTI_GOLDEN_PAYLOAD);

    const observed = [...new Set(rates.map((r) => r.observedAt.getTime()))];
    expect(observed).toEqual([Date.parse('2026-08-26T06:00:00Z')]);
  });

  it('reports the two malformed rows and keeps the valid six', () => {
    const { rates, errors } = parsePostiRates(POSTI_GOLDEN_PAYLOAD);

    expect(rates).toHaveLength(6);
    expect(errors.filter((e) => e.includes('BAD-LANE'))).toHaveLength(1);
    expect(errors.filter((e) => e.includes('BAD-PRICE'))).toHaveLength(1);
  });
});

describe('parsePostiRates — payload-level rejection', () => {
  it('rejects a non-object payload', () => {
    const { rates, errors } = parsePostiRates('nope');
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('not a JSON object');
  });

  it('rejects a payload from the wrong source', () => {
    const { rates, errors } = parsePostiRates({ ...POSTI_GOLDEN_PAYLOAD, source: 'matkahuolto' });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('Unexpected payload source');
  });

  it('rejects a non-EUR price list — no silent FX conversion', () => {
    const { rates, errors } = parsePostiRates({ ...POSTI_GOLDEN_PAYLOAD, currency: 'SEK' });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('not EUR');
  });

  it('rejects a payload without a publication timestamp — freshness must measure carrier age', () => {
    const { rates, errors } = parsePostiRates({ ...POSTI_GOLDEN_PAYLOAD, publishedAt: undefined });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('publishedAt');
  });

  it('rejects a payload without a products array', () => {
    const { rates, errors } = parsePostiRates({ ...POSTI_GOLDEN_PAYLOAD, products: {} });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('no products array');
  });
});

describe('parsePostiRates — row-level validation', () => {
  const base = {
    source: 'posti',
    currency: 'EUR',
    publishedAt: '2026-08-26T06:00:00Z',
  };

  it('rejects an unknown package tier', () => {
    const { rates, errors } = parsePostiRates({
      ...base,
      products: [{ productCode: 'X', originCountry: 'FI', destinationCountry: 'FI', packageTier: 'envelope', weightBracket: { minKg: 0, maxKg: 1 }, priceIncludingVat: 1 }],
    });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('unknown package tier');
  });

  it('rejects a weight bracket where max ≤ min', () => {
    const { rates, errors } = parsePostiRates({
      ...base,
      products: [{ productCode: 'X', originCountry: 'FI', destinationCountry: 'FI', packageTier: 'parcel', weightBracket: { minKg: 5, maxKg: 5 }, priceIncludingVat: 1 }],
    });
    expect(rates).toEqual([]);
    expect(errors[0]).toContain('max ≤ min');
  });

  it('rounds prices to cents', () => {
    const { rates } = parsePostiRates({
      ...base,
      products: [{ productCode: 'X', originCountry: 'FI', destinationCountry: 'FI', packageTier: 'parcel', weightBracket: { minKg: 0, maxKg: 1 }, priceIncludingVat: 7.555 }],
    });
    expect(rates[0].priceCents).toBe(756);
  });

  it('treats sellerTransportPaid default as buyer-arranged (false)', () => {
    const { rates } = parsePostiRates({
      ...base,
      products: [{ productCode: 'X', originCountry: 'FI', destinationCountry: 'FI', packageTier: 'parcel', weightBracket: { minKg: 0, maxKg: 1 }, priceIncludingVat: 1 }],
    });
    expect(rates[0].sellerInvolvementIndicator).toBe(false);
  });
});

describe('PostiCarrierRateSource — fetch integration', () => {
  it('feeds the configured fetcher result through the parser', async () => {
    const source = new PostiCarrierRateSource(
      async () => POSTI_GOLDEN_PAYLOAD,
      'https://example.test/posti.json',
    );

    const result = await source.fetchRates();

    // Six valid rows through; the fixture's two malformed rows surface
    // as per-row errors — the same contract the live feed has.
    expect(result.rates).toEqual([...POSTI_GOLDEN_EXPECTED_RATES]);
    expect(result.errors).toHaveLength(2);
  });

  it('returns errors, never throws, when the fetch fails', async () => {
    const source = new PostiCarrierRateSource(
      async () => {
        throw new Error('HTTP 503: Service Unavailable');
      },
      'https://example.test/posti.json',
    );

    const result = await source.fetchRates();

    expect(result.rates).toEqual([]);
    expect(result.errors[0]).toContain('Posti fetch failed');
    expect(result.errors[0]).toContain('503');
  });
});
