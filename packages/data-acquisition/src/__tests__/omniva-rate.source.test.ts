/**
 * Omniva curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from Omniva's published
 * international-parcel price list (Standard service, EE→FI, valid from
 * 1.07.2025), so the tests act as the transcription review: the exact
 * 11-row bracket table, bracket continuity under the boundary epsilon,
 * monotone VAT-inclusive prices within the 30 kg cap, the boundary
 * behavior the shared bracket selector applies (an edge weight must
 * resolve to the cheaper band, deterministically), and the determinism
 * the curated refresh's unchanged-skip relies on.
 *
 * @module OmnivaRateSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildOmnivaRates,
  OmnivaCarrierRateSource,
  OMNIVA_OBSERVED_AT,
} from '../adapters/omniva-rate.source';
import type { CarrierRateOffer } from '../interfaces/carrier-rate-source.port';
import type { TransportOffer } from '@rajahinta/core-domain';
import { selectBestBracketOffer } from '@rajahinta/core-domain/dist/transport/bracket-selection';

/** Lift a curated row onto the core-domain read model the selector consumes. */
function toTransportOffer(rate: CarrierRateOffer, id: number): TransportOffer {
  return {
    id,
    carrier: rate.carrier,
    originCountry: rate.originCountry,
    destinationCountry: rate.destinationCountry,
    weightBracket: { minKg: rate.weightMinKg, maxKg: rate.weightMaxKg },
    packageTier: rate.packageTier,
    priceCents: rate.priceCents,
    currency: rate.currency,
    sellerInvolvementIndicator: rate.sellerInvolvementIndicator,
    observedAt: rate.observedAt,
    refreshedAt: rate.observedAt,
    reliabilityStatus: 'VERIFIED',
  };
}

const rates = buildOmnivaRates();
const offers = rates.map(toTransportOffer);

describe('Omniva curated dataset (Standard EE→FI, price list valid from 1.07.2025)', () => {
  it('transcribes the published Standard table — exactly 11 weight brackets with the listed prices', () => {
    // The published rows, verbatim: [bracket edge (kg), price (EUR cents)].
    // Lower bounds are the previous edge + the 1 g boundary epsilon (see
    // the adapter), which is why 0.251/0.501/… open the dearer brackets.
    expect(rates.map((r) => [r.weightMinKg, r.weightMaxKg, r.priceCents])).toEqual([
      [0, 0.25, 1240],
      [0.251, 0.5, 1251],
      [0.501, 1, 1272],
      [1.001, 2, 1315],
      [2.001, 3, 1358],
      [3.001, 5, 1443],
      [5.001, 10, 1747],
      [10.001, 15, 1961],
      [15.001, 20, 2174],
      [20.001, 25, 2388],
      [25.001, 30, 2601],
    ]);
    expect(rates).toHaveLength(11);
  });

  it('carries the single curated lane/tier, EUR, buyer-paid shipping, and the review date on every row', () => {
    for (const rate of rates) {
      expect(rate.carrier).toBe('omniva');
      expect(rate.originCountry).toBe('EE');
      expect(rate.destinationCountry).toBe('FI');
      expect(rate.packageTier).toBe('parcel');
      expect(rate.currency).toBe('EUR');
      expect(rate.sellerInvolvementIndicator).toBe(false);
      expect(rate.observedAt).toBe(OMNIVA_OBSERVED_AT);
    }
  });

  it('stamps every row with the transcription review date the curated sync skip-check compares against', () => {
    expect(OMNIVA_OBSERVED_AT.toISOString()).toBe('2026-10-04T00:00:00.000Z');
  });

  it('keeps brackets contiguous and unambiguous — the 1 g epsilon separates every consecutive pair', () => {
    for (let i = 1; i < rates.length; i++) {
      const weightMinKg = rates[i].weightMinKg ?? Number.NaN;
      const previousMaxKg = rates[i - 1].weightMaxKg ?? Number.NaN;
      const gap = weightMinKg - previousMaxKg;
      expect(gap).toBeCloseTo(0.001, 6);
      expect(gap).toBeGreaterThan(0);
    }
  });

  it('prices are positive and monotonically non-decreasing with weight', () => {
    for (const rate of rates) {
      expect(rate.priceCents).toBeGreaterThan(0);
    }
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i].priceCents).toBeGreaterThanOrEqual(rates[i - 1].priceCents);
    }
  });

  it('caps the bracket table at the published 30 kg maximum', () => {
    expect(rates[rates.length - 1].weightMaxKg).toBe(30);
    expect(rates.every((r) => r.weightMaxKg !== null && r.weightMaxKg <= 30)).toBe(
      true,
    );
  });

  it('resolves every listed edge weight to the cheaper band via selectBestBracketOffer', () => {
    // A basket at a bracket edge must not spill into the dearer bracket —
    // and the resolution must be EXACT, never the closest-midpoint fallback.
    const cheaperBandAtEdge: Array<[number, number]> = [
      [0.25, 1240],
      [0.5, 1251],
      [1, 1272],
      [2, 1315],
      [3, 1358],
      [5, 1443],
      [10, 1747],
      [15, 1961],
      [20, 2174],
      [25, 2388],
    ];
    for (const [weightKg, expectedCents] of cheaperBandAtEdge) {
      const selected = selectBestBracketOffer(offers, weightKg);
      expect(selected?.reliability).toBe('EXACT');
      expect(selected?.offer.priceCents).toBe(expectedCents);
    }
    // The 30 kg cap edge prices in the top bracket.
    const cap = selectBestBracketOffer(offers, 30);
    expect(cap?.reliability).toBe('EXACT');
    expect(cap?.offer.priceCents).toBe(2601);
  });

  it('resolves one gram above every edge into the dearer bracket — no gram weight lands in the epsilon gap', () => {
    for (let i = 1; i < rates.length; i++) {
      const justAbove = rates[i].weightMinKg ?? Number.NaN;
      const selected = selectBestBracketOffer(offers, justAbove);
      expect(selected?.reliability).toBe('EXACT');
      expect(selected?.offer.priceCents).toBe(rates[i].priceCents);
    }
  });

  it('is deterministic — the same rows every call (the unchanged-dataset skip relies on it)', () => {
    const again = buildOmnivaRates();
    expect(again).toEqual(rates);
    expect(again).not.toBe(rates);
  });
});

describe('OmnivaCarrierRateSource', () => {
  it('serves the curated rows with an empty error channel (a static dataset cannot fail to fetch)', async () => {
    const source = new OmnivaCarrierRateSource();
    expect(source.carrierId).toBe('omniva');
    const result = await source.fetchRates();
    expect(result.errors).toEqual([]);
    expect(result.rates).toEqual(rates);
  });
});
