/**
 * Fransberg curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from fransberg.eu/pricing, so the
 * tests act as the transcription review: row counts per lane/tier, the
 * DE/HR price divergence (only the 4-package row differs), the
 * count→weight-bracket mapping at the 31.5 kg package maximum, and the
 * boundary behavior the bracket matcher applies (a weight of exactly
 * N × 31.5 kg must resolve to the N-package bracket, not N+1).
 *
 * @module FransbergRateSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildFransbergRates,
  FransbergCarrierRateSource,
  FRANSBERG_OBSERVED_AT,
  FRANSBERG_MAX_PARCEL_KG,
  FRANSBERG_PALLET_KG,
} from '../adapters/fransberg-rate.source';
import type { CarrierRateOffer } from '../interfaces/carrier-rate-source.port';

/** Inclusive-on-both-ends bracket match — mirrors core-domain `inBracket`. */
function inBracket(offer: CarrierRateOffer, weightKg: number): boolean {
  if (offer.weightMinKg !== null && weightKg < offer.weightMinKg) return false;
  if (offer.weightMaxKg !== null && weightKg > offer.weightMaxKg) return false;
  return true;
}

/** First-match bracket selection over one lane+tier, ascending dataset order. */
function selectFor(
  rates: readonly CarrierRateOffer[],
  originCountry: string,
  packageTier: string,
  weightKg: number,
): CarrierRateOffer | undefined {
  return rates.find(
    (r) =>
      r.originCountry === originCountry &&
      r.packageTier === packageTier &&
      inBracket(r, weightKg),
  );
}

const rates = buildFransbergRates();

describe('Fransberg curated dataset (2026-09-17 transcription)', () => {
  it('transcribes 15 parcel rows per origin plus 3 pallet rows per origin', () => {
    expect(rates.filter((r) => r.originCountry === 'DE' && r.packageTier === 'parcel')).toHaveLength(15);
    expect(rates.filter((r) => r.originCountry === 'HR' && r.packageTier === 'parcel')).toHaveLength(15);
    expect(rates.filter((r) => r.originCountry === 'DE' && r.packageTier === 'pallet')).toHaveLength(3);
    expect(rates.filter((r) => r.originCountry === 'HR' && r.packageTier === 'pallet')).toHaveLength(3);
    expect(rates).toHaveLength(36);
  });

  it('carries the dataset review date, EUR, buyer-paid shipping, and the FI destination on every row', () => {
    for (const rate of rates) {
      expect(rate.carrier).toBe('fransberg');
      expect(rate.destinationCountry).toBe('FI');
      expect(rate.currency).toBe('EUR');
      expect(rate.sellerInvolvementIndicator).toBe(false);
      expect(rate.observedAt).toBe(FRANSBERG_OBSERVED_AT);
      expect(rate.observedAt.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    }
  });

  it('matches the home-delivery table — only the 4-package row differs between DE and HR', () => {
    const de = rates.filter((r) => r.originCountry === 'DE' && r.packageTier === 'parcel');
    const hr = rates.filter((r) => r.originCountry === 'HR' && r.packageTier === 'parcel');

    const expectedHomeDeliveryCents = [
      3499, 6799, 10199, 13199, 15599, 18699, 22299, 24999, 26999, 27999,
      29999, 31999, 32999, 33999, 34999,
    ];
    expect(de.map((r) => r.priceCents)).toEqual(expectedHomeDeliveryCents);

    // Croatia undercuts Germany only at 4 packages (123,99 € vs 131,99 €).
    const hrExpected = [...expectedHomeDeliveryCents];
    hrExpected[3] = 12399;
    expect(hr.map((r) => r.priceCents)).toEqual(hrExpected);
    expect(de.filter((r, i) => r.priceCents !== hr[i].priceCents).map((r) => r.weightMaxKg)).toEqual([
      4 * FRANSBERG_MAX_PARCEL_KG,
    ]);
  });

  it('prices pallets 389,99 / 699,99 / 899,99 € identically from both origins', () => {
    for (const origin of ['DE', 'HR'] as const) {
      expect(
        rates
          .filter((r) => r.originCountry === origin && r.packageTier === 'pallet')
          .map((r) => r.priceCents),
      ).toEqual([38999, 69999, 89999]);
    }
  });

  it('maps package count N onto the bracket [(N−1)·31.5, N·31.5]', () => {
    const de = rates.filter((r) => r.originCountry === 'DE' && r.packageTier === 'parcel');
    de.forEach((rate, index) => {
      const count = index + 1;
      const expectedMin = count === 1 ? 0 : (count - 1) * FRANSBERG_MAX_PARCEL_KG + 0.001;
      expect(rate.weightMinKg).toBeCloseTo(expectedMin, 6);
      expect(rate.weightMaxKg).toBeCloseTo(count * FRANSBERG_MAX_PARCEL_KG, 6);
    });
    // The 15-package ceiling — above it only the pallet tier applies.
    expect(de[14].weightMaxKg).toBeCloseTo(472.5, 6);
  });

  it('maps pallet count N onto the page’s 720 kg-per-pallet brackets', () => {
    const de = rates.filter((r) => r.originCountry === 'DE' && r.packageTier === 'pallet');
    expect(de.map((r) => [r.weightMinKg, r.weightMaxKg])).toEqual([
      [0, 720],
      [720.001, 1440],
      [1440.001, 2160],
    ]);
  });

  it('resolves a boundary weight (exactly 31.5 kg) to the cheaper one-package bracket', () => {
    // 31.5 kg is one full package — it must NOT spill into the 2-package row.
    expect(selectFor(rates, 'DE', 'parcel', FRANSBERG_MAX_PARCEL_KG)?.priceCents).toBe(3499);
    // One gram over needs a second package.
    expect(selectFor(rates, 'DE', 'parcel', FRANSBERG_MAX_PARCEL_KG + 0.001)?.priceCents).toBe(6799);
    // Same rule on the pallet tier.
    expect(selectFor(rates, 'DE', 'pallet', FRANSBERG_PALLET_KG)?.priceCents).toBe(38999);
    expect(selectFor(rates, 'DE', 'pallet', FRANSBERG_PALLET_KG + 0.001)?.priceCents).toBe(69999);
  });

  it('serves a representative basket weight from the expected bracket', () => {
    // 100 kg → ceil(100 / 31.5) = 4 packages → DE home delivery 131,99 €.
    expect(selectFor(rates, 'DE', 'parcel', 100)?.priceCents).toBe(13199);
    // The same weight from Croatia takes the cheaper 4-package row.
    expect(selectFor(rates, 'HR', 'parcel', 100)?.priceCents).toBe(12399);
    // 500 kg exceeds the parcel ceiling and lands on one pallet.
    expect(selectFor(rates, 'DE', 'pallet', 500)?.priceCents).toBe(38999);
  });
});

describe('FransbergCarrierRateSource', () => {
  it('serves the curated rows with an empty error channel (a static dataset cannot fail to fetch)', async () => {
    const source = new FransbergCarrierRateSource();
    expect(source.carrierId).toBe('fransberg');
    const result = await source.fetchRates();
    expect(result.errors).toEqual([]);
    expect(result.rates).toEqual(rates);
  });
});
