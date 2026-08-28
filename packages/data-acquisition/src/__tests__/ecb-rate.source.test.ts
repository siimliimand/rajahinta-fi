/**
 * ECB reference-rate source tests (task 1.3, design D2).
 *
 * Pins the parser contract for the Frankfurter/ECB latest-rates
 * payload: EUR-base rates with a reference date become a snapshot;
 * a non-EUR base, a malformed date, or invalid entries are rejected
 * with recorded reasons — never guessed around. The HTTP wrapper
 * reports fetch failures instead of throwing.
 *
 * @module EcbReferenceRateSourceTest
 */
import { describe, it, expect } from 'vitest';
import {
  EcbReferenceRateSource,
  parseEcbReferenceRates,
} from '../adapters/ecb-rate.source';

function latestPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: 1,
    base: 'EUR',
    date: '2026-08-27',
    rates: { SEK: 11.294, DKK: 7.4658, GBP: 0.8571 },
    ...overrides,
  };
}

describe('parseEcbReferenceRates', () => {
  it('parses EUR-base reference rates into a snapshot with provenance', () => {
    const { snapshot, errors } = parseEcbReferenceRates(latestPayload());

    expect(errors).toEqual([]);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.sourceId).toBe('ecb');
    expect(snapshot!.sourceName).toBe('ecb-reference-rates');
    expect(snapshot!.referenceDate).toBe('2026-08-27');
    expect(snapshot!.rates).toEqual([
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.294 },
      { baseCurrency: 'EUR', quoteCurrency: 'DKK', rate: 7.4658 },
      { baseCurrency: 'EUR', quoteCurrency: 'GBP', rate: 0.8571 },
    ]);
  });

  it('rejects a non-EUR base — reference rates are EUR-based by contract', () => {
    const { snapshot, errors } = parseEcbReferenceRates(
      latestPayload({ base: 'USD' }),
    );

    expect(snapshot).toBeNull();
    expect(errors[0]).toContain('base "USD" is not EUR');
  });

  it('rejects a missing or malformed reference date', () => {
    const malformed = parseEcbReferenceRates(latestPayload({ date: '27.08.2026' }));
    expect(malformed.snapshot).toBeNull();
    expect(malformed.errors[0]).toContain('reference date');

    const missing = parseEcbReferenceRates(latestPayload({ date: undefined }));
    expect(missing.snapshot).toBeNull();
    expect(missing.errors[0]).toContain('reference date');
  });

  it('skips invalid rate entries per-entry and records the reason', () => {
    const { snapshot, errors } = parseEcbReferenceRates(
      latestPayload({
        rates: {
          SEK: 11.294,
          'X-invalid': 1,
          EUR: 1,
          JPY: 'not-a-number',
          NOK: -3,
        },
      }),
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rates).toEqual([
      { baseCurrency: 'EUR', quoteCurrency: 'SEK', rate: 11.294 },
    ]);
    expect(errors).toEqual([
      expect.stringContaining('X-invalid'),
      expect.stringContaining('EUR/EUR self-pair'),
      expect.stringContaining('JPY'),
      expect.stringContaining('NOK'),
    ]);
  });

  it('rejects a payload whose rates carry no valid entries', () => {
    const { snapshot, errors } = parseEcbReferenceRates(
      latestPayload({ rates: {} }),
    );

    expect(snapshot).toBeNull();
    expect(errors[0]).toContain('no valid rate entries');
  });

  it('rejects non-object payloads outright', () => {
    expect(parseEcbReferenceRates(null).snapshot).toBeNull();
    expect(parseEcbReferenceRates([1, 2]).errors[0]).toContain('not a JSON object');
  });
});

describe('EcbReferenceRateSource', () => {
  it('fetches and parses through the injected fetcher', async () => {
    const source = new EcbReferenceRateSource(
      async () => latestPayload(),
      'https://fixture.invalid/latest',
    );

    const { snapshot, errors } = await source.fetchLatestRates();

    expect(errors).toEqual([]);
    expect(snapshot?.referenceDate).toBe('2026-08-27');
  });

  it('reports fetch failures as errors instead of throwing', async () => {
    const source = new EcbReferenceRateSource(
      async () => {
        throw new Error('HTTP 503: unavailable');
      },
      'https://fixture.invalid/latest',
    );

    const { snapshot, errors } = await source.fetchLatestRates();

    expect(snapshot).toBeNull();
    expect(errors).toEqual([expect.stringContaining('ECB fetch failed: HTTP 503')]);
  });
});
