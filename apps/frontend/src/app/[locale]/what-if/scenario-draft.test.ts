/**
 * Scenario draft parsing tests (task 8.3) — the comma-decimal, integer
 * cents, and ABV-fraction rules the form relies on, plus the bounds the
 * API's zod schema enforces (the client never sends a doomed request).
 *
 * @module WhatIfScenarioDraftTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildScenarioRequest,
  draftRowsFromScenario,
  newProductDraft,
  parseAbvPercent,
  parseDecimalInput,
  parseEurToCents,
  parseVolumeLitres,
} from './scenario-draft';

function validRow(overrides: Partial<ReturnType<typeof newProductDraft>> = {}) {
  return {
    ...newProductDraft('product-1'),
    abvPercent: '4,7',
    volumeLitres: '1',
    alkoPriceEur: '12,98',
    importPriceEur: '0,89',
    ...overrides,
  };
}

describe('parseDecimalInput', () => {
  it('accepts the comma decimal separator', () => {
    expect(parseDecimalInput('4,7')).toBe(4.7);
    expect(parseDecimalInput('0.5')).toBe(0.5);
  });

  it.each(['', ' ', 'abc', '1.2.3', '-1'])('rejects %j', (raw) => {
    expect(parseDecimalInput(raw)).toBeNull();
  });
});

describe('parseEurToCents', () => {
  it('converts euros to integer cents', () => {
    expect(parseEurToCents('12,98')).toBe(1298);
    expect(parseEurToCents('0.89')).toBe(89);
    expect(parseEurToCents('0')).toBe(0);
  });

  it.each(['1.999', '1,999', '€5', '-1', '', '12.'])('rejects %j (finer than cents or malformed)', (raw) => {
    expect(parseEurToCents(raw)).toBeNull();
  });

  it('rejects prices over the API cap', () => {
    expect(parseEurToCents('100000.01')).toBeNull();
    expect(parseEurToCents('100000')).toBe(10_000_000);
  });
});

describe('parseAbvPercent', () => {
  it('converts percent to the API fraction', () => {
    expect(parseAbvPercent('4,7')).toBeCloseTo(0.047, 12);
    expect(parseAbvPercent('0')).toBe(0);
    expect(parseAbvPercent('100')).toBe(1);
  });

  it('rejects out-of-range percents', () => {
    expect(parseAbvPercent('100.1')).toBeNull();
    expect(parseAbvPercent('-0.1')).toBeNull();
  });
});

describe('parseVolumeLitres', () => {
  it('accepts within-cap litres', () => {
    expect(parseVolumeLitres('0,5')).toBe(0.5);
    expect(parseVolumeLitres('10000')).toBe(10_000);
  });

  it('rejects over-cap and malformed litres', () => {
    expect(parseVolumeLitres('10000.1')).toBeNull();
    expect(parseVolumeLitres('x')).toBeNull();
  });
});

describe('buildScenarioRequest', () => {
  it('builds the API request with parsed integer cents and fractions', () => {
    expect(buildScenarioRequest(20, [validRow()])).toEqual({
      hypotheticalRate: 20,
      products: [
        {
          id: 'product-1',
          category: 'beer',
          abv: 0.047,
          volumeLitres: 1,
          alkoPriceCents: 1298,
          importPriceCents: 89,
        },
      ],
    });
  });

  it('returns null while any started row is incomplete', () => {
    const blank = newProductDraft('product-1');
    expect(buildScenarioRequest(20, [blank])).toBeNull();
    expect(
      buildScenarioRequest(20, [validRow(), { ...newProductDraft('product-2'), abvPercent: '5' }]),
    ).toBeNull();
  });

  it('returns null for an out-of-bounds rate or an over-cap row count', () => {
    expect(buildScenarioRequest(1000.1, [validRow()])).toBeNull();
    expect(buildScenarioRequest(-1, [validRow()])).toBeNull();
    const tooMany = Array.from({ length: 21 }, (_, i) => validRow({ key: `product-${i}` }));
    expect(buildScenarioRequest(20, tooMany)).toBeNull();
  });
});

describe('draftRowsFromScenario', () => {
  it('maps a decoded share-token scenario back into editable rows (round trip)', () => {
    const scenario = buildScenarioRequest(18.1, [validRow()])!;
    const draft = draftRowsFromScenario(scenario);
    expect(draft.rate).toBe(18.1);
    expect(draft.rows[0]).toMatchObject({
      key: 'product-1',
      category: 'beer',
      abvPercent: '4.7',
      volumeLitres: '1',
      alkoPriceEur: '12.98',
      importPriceEur: '0.89',
    });
    // The rebuilt draft must build the same scenario again.
    expect(buildScenarioRequest(draft.rate, draft.rows)).toEqual(scenario);
  });
});
