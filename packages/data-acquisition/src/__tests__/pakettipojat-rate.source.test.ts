/**
 * Pakettipojat curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from Pakettipojat's published
 * price list (DE→FI, Wayback capture 2026-08-07, transcription review
 * 2026-10-09), so the tests act as the transcription review: the exact
 * 18 parcel + 9 pallet bracket rows, bracket continuity under the
 * boundary epsilon, monotone prices per tier, the verbatim irregular
 * rows (140 kg and the zone-9 endpoints), the caps, and the determinism
 * the curated refresh's unchanged-skip relies on.
 *
 * @module PakettipojatRateSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildPakettipojatRates,
  PakettipojatCarrierRateSource,
  PAKETTIPOJAT_OBSERVED_AT,
} from '../adapters/pakettipojat-rate.source';
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

const rates = buildPakettipojatRates();
const parcelRates = rates.filter((r) => r.packageTier === 'parcel');
const palletRates = rates.filter((r) => r.packageTier === 'pallet');
const offers = rates.map(toTransportOffer);

describe('Pakettipojat curated dataset (home delivery + zone-9 pallets DE→FI, transcribed 2026-10-09)', () => {
  it('transcribes the published tables — exactly 18 parcel and 9 pallet brackets', () => {
    expect(parcelRates).toHaveLength(18);
    expect(palletRates).toHaveLength(9);
    expect(rates).toHaveLength(27);
  });

  it('transcribes the home-delivery parcel table verbatim — 28 kg unit brackets to the 540 kg cap', () => {
    // The published rows, verbatim: [bracket edge (kg), price (EUR cents)].
    // Lower bounds are the previous edge + the 1 g boundary epsilon (see
    // the adapter), which is why 28.001/56.001/… open the dearer
    // brackets. The 140 kg (17950) and 392 kg (50260) rows deviate from
    // the ×36,90 unit pattern in the source — published values, pinned
    // so they cannot be silently "fixed".
    expect(parcelRates.map((r) => [r.weightMinKg, r.weightMaxKg, r.priceCents])).toEqual([
      [0, 28, 3690],
      [28.001, 56, 7380],
      [56.001, 84, 11070],
      [84.001, 112, 14760],
      [112.001, 140, 17950],
      [140.001, 168, 22140],
      [168.001, 196, 25830],
      [196.001, 224, 29520],
      [224.001, 252, 33210],
      [252.001, 280, 36900],
      [280.001, 308, 40590],
      [308.001, 336, 44280],
      [336.001, 364, 47970],
      [364.001, 392, 50260],
      [392.001, 450, 53850],
      [450.001, 480, 57440],
      [480.001, 510, 61030],
      [510.001, 540, 64620],
    ]);
  });

  it('transcribes the zone-9 pallet table verbatim — 740 kg to the 5180 kg cap', () => {
    // The most expensive postal zone (94000–97999) per the max-zone
    // rule; endpoints pinned against the capture.
    expect(palletRates.map((r) => [r.weightMinKg, r.weightMaxKg, r.priceCents])).toEqual([
      [0, 740, 39500],
      [740.001, 770, 42000],
      [770.001, 800, 44500],
      [800.001, 1480, 52900],
      [1480.001, 2220, 78500],
      [2220.001, 2960, 104500],
      [2960.001, 3700, 131500],
      [3700.001, 4440, 156500],
      [4440.001, 5180, 181500],
    ]);
  });

  it('pins the published zone-9 endpoints — 740 kg 395 € and 5180 kg 1815 €', () => {
    expect(palletRates[0].priceCents).toBe(39500);
    expect(palletRates[palletRates.length - 1].priceCents).toBe(181500);
    expect(palletRates[palletRates.length - 1].weightMaxKg).toBe(5180);
  });

  it('pins the irregular 140 kg home-delivery row to the published 179,50 € (17950 cents)', () => {
    // The ×36,90 unit pattern would say 18450; the carrier publishes
    // 179,50 €. Transcribed verbatim — this pin guards against a
    // well-meant "correction" repricing the row.
    const row = parcelRates.find((r) => r.weightMaxKg === 140);
    expect(row?.priceCents).toBe(17950);
  });

  it('carries the single curated lane, EUR, buyer-paid shipping, and the review date on every row', () => {
    for (const rate of rates) {
      expect(rate.carrier).toBe('pakettipojat');
      expect(rate.originCountry).toBe('DE');
      expect(rate.destinationCountry).toBe('FI');
      expect(['parcel', 'pallet']).toContain(rate.packageTier);
      expect(rate.currency).toBe('EUR');
      expect(rate.sellerInvolvementIndicator).toBe(false);
      expect(rate.observedAt).toBe(PAKETTIPOJAT_OBSERVED_AT);
    }
  });

  it('stamps every row with the transcription review date the curated sync skip-check compares against', () => {
    expect(PAKETTIPOJAT_OBSERVED_AT.toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('keeps brackets contiguous within each tier — the 1 g epsilon separates every consecutive pair', () => {
    for (const tierRates of [parcelRates, palletRates]) {
      expect(tierRates[0].weightMinKg).toBe(0);
      for (let i = 1; i < tierRates.length; i++) {
        const weightMinKg = tierRates[i].weightMinKg ?? Number.NaN;
        const previousMaxKg = tierRates[i - 1].weightMaxKg ?? Number.NaN;
        const gap = weightMinKg - previousMaxKg;
        expect(gap).toBeCloseTo(0.001, 6);
        expect(gap).toBeGreaterThan(0);
      }
    }
  });

  it('prices are positive and monotonically non-decreasing with weight within each tier', () => {
    for (const tierRates of [parcelRates, palletRates]) {
      for (const rate of tierRates) {
        expect(rate.priceCents).toBeGreaterThan(0);
        expect(Number.isInteger(rate.priceCents)).toBe(true);
      }
      for (let i = 1; i < tierRates.length; i++) {
        expect(tierRates[i].priceCents).toBeGreaterThanOrEqual(tierRates[i - 1].priceCents);
      }
    }
  });

  it('caps the tiers at the published maximums — 540 kg parcel, 5180 kg pallet', () => {
    expect(parcelRates.every((r) => r.weightMaxKg !== null && r.weightMaxKg <= 540)).toBe(true);
    expect(parcelRates[parcelRates.length - 1].weightMaxKg).toBe(540);
    expect(palletRates.every((r) => r.weightMaxKg !== null && r.weightMaxKg <= 5180)).toBe(true);
    expect(palletRates[palletRates.length - 1].weightMaxKg).toBe(5180);
  });

  it('resolves listed edge weights to the cheaper band via selectBestBracketOffer', () => {
    // A basket at a bracket edge must not spill into the dearer bracket —
    // and the resolution must be EXACT, never the closest-midpoint fallback.
    const cheaperBandAtEdge: Array<[string, number, number]> = [
      ['parcel', 28, 3690],
      ['parcel', 140, 17950],
      ['parcel', 540, 64620],
      ['pallet', 740, 39500],
      ['pallet', 800, 44500],
      ['pallet', 5180, 181500],
    ];
    for (const [packageTier, weightKg, expectedCents] of cheaperBandAtEdge) {
      const tierOffers = offers.filter((o) => o.packageTier === packageTier);
      const selected = selectBestBracketOffer(tierOffers, weightKg);
      expect(selected?.reliability).toBe('EXACT');
      expect(selected?.offer.priceCents).toBe(expectedCents);
    }
  });

  it('is deterministic — the same rows every call (the unchanged-dataset skip relies on it)', () => {
    const again = buildPakettipojatRates();
    expect(again).toEqual(rates);
    expect(again).not.toBe(rates);
  });
});

describe('PakettipojatCarrierRateSource', () => {
  it('serves the curated rows with an empty error channel (a static dataset cannot fail to fetch)', async () => {
    const source = new PakettipojatCarrierRateSource();
    expect(source.carrierId).toBe('pakettipojat');
    const result = await source.fetchRates();
    expect(result.errors).toEqual([]);
    expect(result.rates).toEqual(rates);
  });
});
