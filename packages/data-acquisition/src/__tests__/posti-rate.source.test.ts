/**
 * Posti curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from Posti's published price
 * tables, so the tests act as the transcription review. The first
 * transcription (2026-09-30, owner-provided consumer tables) landed the
 * weight-distinct domestic Small Parcel tier; these pins hold the
 * structural contract every later transcription must satisfy.
 *
 * @module PostiRateSourceTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildPostiRates,
  PostiCarrierRateSource,
  POSTI_OBSERVED_AT,
} from '../adapters/posti-rate.source';

const rates = buildPostiRates();

describe('Posti curated dataset (first transcription 2026-09-30)', () => {
  it('transcribes exactly the weight-distinct consumer tiers — no invented prices', () => {
    // The consumer tables publish no TO-Finland lanes and differentiate
    // S/M/L/XL only by dimensions (shared 25 kg cap), so the honest
    // transcription is the single weight-distinct domestic tier until a
    // lane-shaped source (the price-list JSON) becomes reachable.
    expect(rates).toHaveLength(1);
    expect(rates[0]).toEqual({
      carrier: 'posti',
      originCountry: 'FI',
      destinationCountry: 'FI',
      weightMinKg: 0,
      weightMaxKg: 2,
      packageTier: 'parcel',
      priceCents: 790,
      currency: 'EUR',
      sellerInvolvementIndicator: false,
      observedAt: POSTI_OBSERVED_AT,
    });
  });

  it('never fabricates inbound lanes — every row is on its source-published lane', () => {
    // The calculator's cross-border lanes (EE/DE → FI) stay honestly
    // absent: inverting outbound consumer rates would fabricate both the
    // direction and the merchant-contract price.
    for (const rate of rates) {
      expect(rate.originCountry).toBe('FI');
    }
  });

  it('keeps weight brackets unambiguous within a tier — first-DB-hit must never decide a price', () => {
    // Same rationale as the Fransberg bracket epsilon: two overlapping
    // brackets in one tier+lane would make the selector's first hit the
    // de-facto price. Also guards the data-quality floor: a curated
    // zero-priced row would be rejected by the pipeline's own gates.
    for (const rate of rates) {
      expect(rate.priceCents).toBeGreaterThan(0);
    }
    const byTierLane = new Map<string, { min: number; max: number }[]>();
    for (const rate of rates) {
      const key = `${rate.originCountry}:${rate.destinationCountry}:${rate.packageTier}`;
      const brackets = byTierLane.get(key) ?? [];
      for (const seen of brackets) {
        const overlap =
          rate.weightMinKg === null ||
          seen.max === null ||
          rate.weightMinKg <= seen.max;
        const covered =
          rate.weightMaxKg === null || seen.min === null || rate.weightMaxKg >= seen.min;
        expect(overlap && covered).toBe(false);
      }
      brackets.push({ min: rate.weightMinKg ?? -Infinity, max: rate.weightMaxKg ?? Infinity });
      byTierLane.set(key, brackets);
    }
  });

  it('stamps every row with the review-date constant the curated sync skip-check compares against', () => {
    expect(POSTI_OBSERVED_AT.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    for (const rate of rates) {
      expect(rate.observedAt).toBe(POSTI_OBSERVED_AT);
    }
  });
});

describe('PostiCarrierRateSource', () => {
  it('serves the curated rows with an empty error channel (a static dataset cannot fail to fetch)', async () => {
    const source = new PostiCarrierRateSource();
    expect(source.carrierId).toBe('posti');
    const result = await source.fetchRates();
    expect(result.errors).toEqual([]);
    expect(result.rates).toEqual(rates);
  });
});
