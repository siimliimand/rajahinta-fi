/**
 * Posti curated rate source — dataset sanity pins.
 *
 * The dataset is transcribed by hand from Posti's published price
 * tables, so the tests act as the transcription review. The dataset
 * starts EMPTY (2026-09-28 — no authoritative price source was reachable
 * for the initial transcription; see the module docblock); these pins
 * hold the structural contract the first transcription must satisfy.
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

describe('Posti curated dataset (empty until the first transcription)', () => {
  it('starts empty — no invented prices may ship as data', () => {
    expect(rates).toEqual([]);
  });

  it('carries the review-date constant the curated sync skip-check compares against', () => {
    expect(POSTI_OBSERVED_AT.toISOString()).toBe('2026-09-28T00:00:00.000Z');
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
