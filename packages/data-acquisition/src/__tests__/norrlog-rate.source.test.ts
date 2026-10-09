/**
 * Norrlog curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from Norrlog's FI price page
 * (home delivery, DE→FI, transcribed 2026-10-09), so the tests act as
 * the transcription review: the exact 10-row carton ladder and 7-row
 * max-zone pallet table, bracket continuity under the boundary epsilon,
 * monotone non-decreasing prices within each tier (the published flat
 * €1,527 pallet step must pass), the single lane/EUR/buyer-paid-shipping
 * contract, and the determinism the curated refresh's unchanged-skip
 * relies on.
 *
 * @module NorrlogRateSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildNorrlogRates,
  NorrlogCarrierRateSource,
  NORRLOG_OBSERVED_AT,
} from '../adapters/norrlog-rate.source';

const rates = buildNorrlogRates();
const parcelRates = rates.filter((r) => r.packageTier === 'parcel');
const palletRates = rates.filter((r) => r.packageTier === 'pallet');

describe('Norrlog curated dataset (home delivery DE→FI, transcribed 2026-10-09)', () => {
  it('transcribes the published carton ladder — exactly 10 synthetic 25 kg brackets at €37 per carton', () => {
    // The published home-delivery price (€37.00 per 12-slot carton)
    // mapped onto synthetic brackets at the documented 25 kg carton cap,
    // capped at 10 cartons (250 kg). Lower bounds are the previous edge
    // + the 1 g boundary epsilon (see the adapter); the first bracket is
    // open-bounded below.
    expect(parcelRates.map((r) => [r.weightMinKg, r.weightMaxKg, r.priceCents])).toEqual([
      [null, 25, 3700],
      [25.001, 50, 7400],
      [50.001, 75, 11100],
      [75.001, 100, 14800],
      [100.001, 125, 18500],
      [125.001, 150, 22200],
      [150.001, 175, 25900],
      [175.001, 200, 29600],
      [200.001, 225, 33300],
      [225.001, 250, 37000],
    ]);
    expect(parcelRates).toHaveLength(10);
    for (let i = 0; i < parcelRates.length; i++) {
      expect(parcelRates[i].priceCents).toBe(3700 * (i + 1));
    }
  });

  it('transcribes the published max-zone (8*–9*) pallet table — exactly 7 brackets including the flat €1,527 step', () => {
    expect(palletRates.map((r) => [r.weightMinKg, r.weightMaxKg, r.priceCents])).toEqual([
      [null, 740, 44700],
      [740.001, 900, 50700],
      [900.001, 1480, 71600],
      [1480.001, 2220, 97700],
      [2220.001, 2960, 124700],
      [2960.001, 3700, 152700],
      [3700.001, 5000, 152700],
    ]);
    expect(palletRates).toHaveLength(7);
    // The published final two brackets share €1,527 — verbatim, not fixed.
    expect(palletRates[5].priceCents).toBe(152700);
    expect(palletRates[6].priceCents).toBe(152700);
  });

  it('carries the single curated lane, EUR, buyer-paid shipping, and integer cents on every row', () => {
    for (const rate of rates) {
      expect(rate.carrier).toBe('norrlog');
      expect(rate.originCountry).toBe('DE');
      expect(rate.destinationCountry).toBe('FI');
      expect(rate.currency).toBe('EUR');
      expect(rate.sellerInvolvementIndicator).toBe(false);
      expect(Number.isInteger(rate.priceCents)).toBe(true);
    }
    expect(rates).toHaveLength(17);
    expect(parcelRates).toHaveLength(10);
    expect(palletRates).toHaveLength(7);
  });

  it('stamps every row with the transcription date the curated sync skip-check compares against', () => {
    expect(NORRLOG_OBSERVED_AT.toISOString()).toBe('2026-10-09T00:00:00.000Z');
    for (const rate of rates) {
      expect(rate.observedAt).toBe(NORRLOG_OBSERVED_AT);
    }
  });

  it('keeps brackets contiguous within each tier — the first bracket is open-bounded and the 1 g epsilon separates every consecutive pair', () => {
    for (const tier of [parcelRates, palletRates]) {
      expect(tier[0].weightMinKg).toBeNull();
      for (let i = 1; i < tier.length; i++) {
        const weightMinKg = tier[i].weightMinKg ?? Number.NaN;
        const previousMaxKg = tier[i - 1].weightMaxKg ?? Number.NaN;
        const gap = weightMinKg - previousMaxKg;
        expect(gap).toBeCloseTo(0.001, 6);
        expect(gap).toBeGreaterThan(0);
      }
    }
  });

  it('prices are positive and monotonically non-decreasing within each tier (the flat €1,527 pallet step passes)', () => {
    for (const rate of rates) {
      expect(rate.priceCents).toBeGreaterThan(0);
    }
    for (const tier of [parcelRates, palletRates]) {
      for (let i = 1; i < tier.length; i++) {
        expect(tier[i].priceCents).toBeGreaterThanOrEqual(tier[i - 1].priceCents);
      }
    }
  });

  it('caps the parcel ladder at the 250 kg ceiling and the pallet table at the published 5,000 kg maximum', () => {
    expect(parcelRates[parcelRates.length - 1].weightMaxKg).toBe(250);
    expect(
      parcelRates.every((r) => r.weightMaxKg !== null && r.weightMaxKg <= 250),
    ).toBe(true);
    expect(palletRates[palletRates.length - 1].weightMaxKg).toBe(5000);
    expect(
      palletRates.every((r) => r.weightMaxKg !== null && r.weightMaxKg <= 5000),
    ).toBe(true);
  });

  it('pins the endpoints — first and last bracket of each tier carry the published prices', () => {
    expect(parcelRates[0]).toMatchObject({
      weightMinKg: null,
      weightMaxKg: 25,
      priceCents: 3700,
    });
    expect(parcelRates[parcelRates.length - 1]).toMatchObject({
      weightMinKg: 225.001,
      weightMaxKg: 250,
      priceCents: 37000,
    });
    expect(palletRates[0]).toMatchObject({
      weightMinKg: null,
      weightMaxKg: 740,
      priceCents: 44700,
    });
    expect(palletRates[palletRates.length - 1]).toMatchObject({
      weightMinKg: 3700.001,
      weightMaxKg: 5000,
      priceCents: 152700,
    });
  });

  it('is deterministic — the same rows every call (the unchanged-dataset skip relies on it)', () => {
    const again = buildNorrlogRates();
    expect(again).toEqual(rates);
    expect(again).not.toBe(rates);
  });
});

describe('NorrlogCarrierRateSource', () => {
  it('serves the curated rows with an empty error channel (a static dataset cannot fail to fetch)', async () => {
    const source = new NorrlogCarrierRateSource();
    expect(source.carrierId).toBe('norrlog');
    const result = await source.fetchRates();
    expect(result.errors).toEqual([]);
    expect(result.rates).toEqual(rates);
  });
});
