/**
 * Tests for the what-if excise simulator (task 8.1).
 *
 * HIGH-LIABILITY numeric contract (design R14): every cent value below
 * is computed by hand from the engine's own formula dispatch and
 * asserted exactly — rate substitution, gap, delta, and totals across
 * all six canonical beverage categories. Pure functions — no DB, no
 * mocks, no NestJS.
 *
 * @module WhatIfTests
 */
import { describe, it, expect } from 'vitest';
import { calculateWhatIfExcise } from '../whatif';
import {
  WHATIF_DISCLAIMER_FI,
  WHATIF_DISCLAIMER_EN,
} from '../whatif.disclaimer';
import {
  InvalidWhatIfInputError,
  MixedTaxDatasetVersionsError,
} from '../whatif.types';
import type {
  WhatIfBaselineRule,
  WhatIfProductInput,
  WhatIfProductLine,
  WhatIfScenarioInput,
} from '../whatif.types';
import {
  FORMULA_PER_CENTILITRE_ETHANOL,
  FORMULA_PER_LITRE_OF_ALCOHOL,
  FORMULA_PER_LITRE_OF_PRODUCT,
} from '../../tax/services/alcohol-excise.math';

// ---------------------------------------------------------------------------
// Fixtures — one product per canonical category
// ---------------------------------------------------------------------------

const VERSION = '2025.0-fi';
const HYPOTHETICAL_RATE = 18.1;

function rule(
  formulaRef: string,
  rate: number,
  ruleId: number | null,
  reliability: 'VERIFIED' | 'ESTIMATED' = 'VERIFIED',
): WhatIfBaselineRule {
  return { formulaRef, rate, taxDatasetVersion: VERSION, ruleId, reliability };
}

function product(overrides: Partial<WhatIfProductInput> & { id: string }): WhatIfProductInput {
  return {
    category: 'beer',
    abv: 0.047,
    volumeLitres: 1,
    alkoPriceCents: 1298,
    importPriceCents: 89,
    baselineRule: rule(FORMULA_PER_CENTILITRE_ETHANOL, 36.2, 101),
    ...overrides,
  };
}

const SIX_CATEGORY_PRODUCTS: readonly WhatIfProductInput[] = [
  // beer: 36.20 × 0.047 × 1 l = 1.7014 € → 170 c; hyp 18.10 × 0.047 × 1 = 0.8507 € → 85 c
  product({ id: 'beer-05' }),
  // wine_still: 0.355 × 0.75 l = 0.26625 € → 27 c; hyp 18.10 × 0.75 = 13.575 € → 1358 c
  product({
    id: 'wine-075',
    category: 'wine',
    abv: 0.12,
    volumeLitres: 0.75,
    alkoPriceCents: 999,
    importPriceCents: 299,
    baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 102),
  }),
  // wine_sparkling: 0.421 × 0.75 = 0.31575 € → 32 c; hyp 1358 c (same formula/volume as still wine)
  product({
    id: 'sparkling-075',
    category: 'kuohuviini',
    abv: 0.12,
    volumeLitres: 0.75,
    alkoPriceCents: 1499,
    importPriceCents: 599,
    baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.421, 103),
  }),
  // intermediate_products: 0.475 × 0.5 = 0.2375 € → 24 c; hyp 18.10 × 0.5 = 9.05 € → 905 c
  product({
    id: 'sherry-05',
    category: 'sherry',
    abv: 0.18,
    volumeLitres: 0.5,
    alkoPriceCents: 1099,
    importPriceCents: 399,
    baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.475, 104, 'ESTIMATED'),
  }),
  // other_fermented: 0.355 × 0.33 = 0.11715 € → 12 c; hyp 18.10 × 0.33 = 5.973 € → 597 c
  product({
    id: 'cider-033',
    category: 'cider',
    abv: 0.047,
    volumeLitres: 0.33,
    alkoPriceCents: 249,
    importPriceCents: 79,
    baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 105),
  }),
  // spirits: 50.50 × 0.40 × 0.5 = 10.1 € → 1010 c; hyp 18.10 × 0.40 × 0.5 = 3.62 € → 362 c
  product({
    id: 'vodka-05',
    category: 'spirits',
    abv: 0.4,
    volumeLitres: 0.5,
    alkoPriceCents: 2999,
    importPriceCents: 1299,
    baselineRule: rule(FORMULA_PER_LITRE_OF_ALCOHOL, 50.5, 106),
  }),
];

function sixCategoryInput(): WhatIfScenarioInput {
  return { hypotheticalRate: HYPOTHETICAL_RATE, products: SIX_CATEGORY_PRODUCTS };
}

function lineOf(result: { lines: readonly WhatIfProductLine[] }, id: string): WhatIfProductLine {
  const line = result.lines.find((l) => l.id === id);
  if (!line) throw new Error(`missing line ${id}`);
  return line;
}

// ---------------------------------------------------------------------------
// Exact vectors — all six categories
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — exact vectors across beverage categories', () => {
  const result = calculateWhatIfExcise(sixCategoryInput());

  it('beer (PER_CENTILITRE_ETHANOL): baseline 170 c → hypothetical 85 c, gap −1039 → −1124', () => {
    const line = lineOf(result, 'beer-05');
    expect(line.category).toBe('beer');
    expect(line.baseline.taxCents).toBe(170);
    expect(line.hypothetical.taxCents).toBe(85);
    expect(line.baseline.rateApplied).toBeCloseTo(1.7014, 12);
    expect(line.hypothetical.rateApplied).toBeCloseTo(0.8507, 12);
    expect(line.importTotalBaselineCents).toBe(259);
    expect(line.importTotalHypotheticalCents).toBe(174);
    expect(line.gapBaselineCents).toBe(-1039);
    expect(line.gapHypotheticalCents).toBe(-1124);
    expect(line.gapDeltaCents).toBe(-85);
  });

  it('wine_still (PER_LITRE_OF_PRODUCT): baseline 27 c → hypothetical 1358 c (13.575 € rounds half up)', () => {
    const line = lineOf(result, 'wine-075');
    expect(line.category).toBe('wine_still');
    expect(line.baseline.taxCents).toBe(27);
    expect(line.hypothetical.taxCents).toBe(1358);
    expect(line.baseline.rateApplied).toBe(0.355);
    expect(line.hypothetical.rateApplied).toBe(18.1);
    expect(line.importTotalBaselineCents).toBe(326);
    expect(line.importTotalHypotheticalCents).toBe(1657);
    expect(line.gapBaselineCents).toBe(-673);
    expect(line.gapHypotheticalCents).toBe(658);
    expect(line.gapDeltaCents).toBe(1331);
  });

  it('wine_sparkling: baseline 32 c → hypothetical 1358 c, gap −868 → 458', () => {
    const line = lineOf(result, 'sparkling-075');
    expect(line.category).toBe('wine_sparkling');
    expect(line.baseline.taxCents).toBe(32);
    expect(line.hypothetical.taxCents).toBe(1358);
    expect(line.importTotalBaselineCents).toBe(631);
    expect(line.importTotalHypotheticalCents).toBe(1957);
    expect(line.gapBaselineCents).toBe(-868);
    expect(line.gapHypotheticalCents).toBe(458);
    expect(line.gapDeltaCents).toBe(1326);
  });

  it('intermediate_products: baseline 24 c → hypothetical 905 c, gap −676 → 205', () => {
    const line = lineOf(result, 'sherry-05');
    expect(line.category).toBe('intermediate_products');
    expect(line.baseline.taxCents).toBe(24);
    expect(line.hypothetical.taxCents).toBe(905);
    expect(line.baseline.reliability).toBe('ESTIMATED');
    expect(line.importTotalBaselineCents).toBe(423);
    expect(line.importTotalHypotheticalCents).toBe(1304);
    expect(line.gapBaselineCents).toBe(-676);
    expect(line.gapHypotheticalCents).toBe(205);
    expect(line.gapDeltaCents).toBe(881);
  });

  it('other_fermented: baseline 12 c → hypothetical 597 c, gap −158 → 427', () => {
    const line = lineOf(result, 'cider-033');
    expect(line.category).toBe('other_fermented');
    expect(line.baseline.taxCents).toBe(12);
    expect(line.hypothetical.taxCents).toBe(597);
    expect(line.importTotalBaselineCents).toBe(91);
    expect(line.importTotalHypotheticalCents).toBe(676);
    expect(line.gapBaselineCents).toBe(-158);
    expect(line.gapHypotheticalCents).toBe(427);
    expect(line.gapDeltaCents).toBe(585);
  });

  it('spirits (PER_LITRE_OF_ALCOHOL): baseline 1010 c → hypothetical 362 c, gap −690 → −1338', () => {
    const line = lineOf(result, 'vodka-05');
    expect(line.category).toBe('spirits');
    expect(line.baseline.taxCents).toBe(1010);
    expect(line.hypothetical.taxCents).toBe(362);
    expect(line.baseline.rateApplied).toBeCloseTo(20.2, 12);
    expect(line.hypothetical.rateApplied).toBeCloseTo(7.24, 12);
    expect(line.importTotalBaselineCents).toBe(2309);
    expect(line.importTotalHypotheticalCents).toBe(1661);
    expect(line.gapBaselineCents).toBe(-690);
    expect(line.gapHypotheticalCents).toBe(-1338);
    expect(line.gapDeltaCents).toBe(-648);
  });

  it('totals sum the lines exactly (1275 / 4665 excise, −4104 / −714 gap)', () => {
    expect(result.totals).toEqual({
      baselineExciseCents: 1275,
      hypotheticalExciseCents: 4665,
      gapBaselineCents: -4104,
      gapHypotheticalCents: -714,
    });
  });

  it('gap delta per line equals hypothetical minus baseline excise (substitution effect isolated)', () => {
    for (const line of result.lines) {
      expect(line.gapDeltaCents).toBe(line.hypothetical.taxCents - line.baseline.taxCents);
    }
  });
});

// ---------------------------------------------------------------------------
// Baseline citation (R11: the result names the dataset it started from)
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — baseline dataset version citation', () => {
  it('cites the baseline version on the aggregate result', () => {
    const result = calculateWhatIfExcise(sixCategoryInput());
    expect(result.baselineTaxDatasetVersion).toBe(VERSION);
    expect(result.hypotheticalRate).toBe(HYPOTHETICAL_RATE);
  });

  it('cites the baseline version and rule provenance on every line', () => {
    const result = calculateWhatIfExcise(sixCategoryInput());
    for (const line of result.lines) {
      expect(line.baseline.taxDatasetVersion).toBe(VERSION);
      expect(line.baseline.ruleId).not.toBeNull();
    }
    expect(lineOf(result, 'beer-05').baseline.ruleId).toBe(101);
    expect(lineOf(result, 'beer-05').baseline.reliability).toBe('VERIFIED');
  });

  it('echoes ruleId null for fallback baselines without inventing a version', () => {
    const input = sixCategoryInput();
    const result = calculateWhatIfExcise({
      ...input,
      products: [
        {
          ...input.products[0],
          baselineRule: rule(FORMULA_PER_CENTILITRE_ETHANOL, 36.2, null, 'ESTIMATED'),
        },
      ],
    });
    expect(result.baselineTaxDatasetVersion).toBe(VERSION);
    expect(result.lines[0].baseline.ruleId).toBeNull();
    expect(result.lines[0].baseline.reliability).toBe('ESTIMATED');
  });

  it('rejects a scenario whose baseline rules span multiple dataset versions', () => {
    const input = sixCategoryInput();
    const mixed: WhatIfScenarioInput = {
      ...input,
      products: [
        input.products[0],
        {
          ...input.products[1],
          baselineRule: { ...input.products[1].baselineRule, taxDatasetVersion: '2024.2-fi' },
        },
      ],
    };
    expect(() => calculateWhatIfExcise(mixed)).toThrow(MixedTaxDatasetVersionsError);
    expect(() => calculateWhatIfExcise(mixed)).toThrow(/2025\.0-fi.*2024\.2-fi|2024\.2-fi.*2025\.0-fi/s);
  });
});

// ---------------------------------------------------------------------------
// Substitution semantics — exemptions and zero rate
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — substitution semantics', () => {
  it('a zero-rate (exempt) baseline substitutes uniformly: 0 c → 85 c', () => {
    const result = calculateWhatIfExcise({
      hypotheticalRate: HYPOTHETICAL_RATE,
      products: [
        product({ id: 'exempt-beer', baselineRule: rule(FORMULA_PER_CENTILITRE_ETHANOL, 0, 201) }),
      ],
    });
    const line = result.lines[0];
    expect(line.baseline.taxCents).toBe(0);
    expect(line.hypothetical.taxCents).toBe(85);
    expect(line.gapBaselineCents).toBe(89 - 1298);
    expect(line.gapHypotheticalCents).toBe(174 - 1298);
    expect(line.gapDeltaCents).toBe(85);
  });

  it('hypotheticalRate 0 models full exemption: baseline 170 c → 0 c, gap shifts by −170', () => {
    const result = calculateWhatIfExcise({
      hypotheticalRate: 0,
      products: [product({ id: 'beer-05' })],
    });
    expect(result.lines[0].baseline.taxCents).toBe(170);
    expect(result.lines[0].hypothetical.taxCents).toBe(0);
    expect(result.lines[0].gapBaselineCents).toBe(-1039);
    expect(result.lines[0].gapHypotheticalCents).toBe(-1209);
    expect(result.lines[0].gapDeltaCents).toBe(-170);
    expect(result.totals.hypotheticalExciseCents).toBe(0);
  });

  it('the Alko side is never repriced — gaps move only by the import-side duty', () => {
    const result = calculateWhatIfExcise(sixCategoryInput());
    for (const line of result.lines) {
      expect(line.gapBaselineCents).toBe(
        line.importPriceCents + line.baseline.taxCents - line.alkoPriceCents,
      );
      expect(line.gapHypotheticalCents).toBe(
        line.importPriceCents + line.hypothetical.taxCents - line.alkoPriceCents,
      );
    }
  });

  it('gap sign convention: positive gap means importing is more expensive than Alko', () => {
    const result = calculateWhatIfExcise({
      hypotheticalRate: HYPOTHETICAL_RATE,
      products: [
        product({
          id: 'import-expensive',
          category: 'wine',
          abv: 0.12,
          volumeLitres: 0.75,
          alkoPriceCents: 500,
          importPriceCents: 1000,
          baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 102),
        }),
      ],
    });
    // 1000 + 27 − 500 = 527 > 0
    expect(result.lines[0].gapBaselineCents).toBe(527);
    expect(result.lines[0].gapBaselineCents).toBeGreaterThan(0);
  });

  it('normalises category aliases through the engine mapping (wine → wine_still, cider → other_fermented)', () => {
    const result = calculateWhatIfExcise(sixCategoryInput());
    expect(result.lines.map((l) => l.category)).toEqual([
      'beer',
      'wine_still',
      'wine_sparkling',
      'intermediate_products',
      'other_fermented',
      'spirits',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Structural HYPOTHETICAL disclaimer
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — structural disclaimer', () => {
  it('carries the disclaimer in the payload, structurally', () => {
    const result = calculateWhatIfExcise(sixCategoryInput());
    expect(result.disclaimer).toEqual(WHATIF_DISCLAIMER_EN);
    expect(result.disclaimer.language).toBe('en');
    expect(result.disclaimer.version).toBe('1.0');
  });

  it('the disclaimer states what the result is NOT: forecast, future prices, official statement', () => {
    expect(WHATIF_DISCLAIMER_EN.text).toContain('Hypothetical');
    expect(WHATIF_DISCLAIMER_EN.text).toContain('not a forecast');
    expect(WHATIF_DISCLAIMER_EN.text).toContain('not an estimate of future prices');
    expect(WHATIF_DISCLAIMER_EN.text).toContain('not an official statement');
    expect(WHATIF_DISCLAIMER_FI.text).toContain('Hypoteettinen');
    expect(WHATIF_DISCLAIMER_FI.text).toContain('ei ole ennuste');
    expect(WHATIF_DISCLAIMER_FI.text).toContain('eikä virallinen ilmoitus');
  });
});

// ---------------------------------------------------------------------------
// Purity — no mutation, deterministic
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — purity', () => {
  function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value as object)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
      Object.freeze(value);
    }
    return value;
  }

  it('does not mutate its input and returns identical results across runs', () => {
    const input = deepFreeze(sixCategoryInput());
    const first = calculateWhatIfExcise(input);
    const second = calculateWhatIfExcise(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(input));
    expect(Object.isFrozen(input.products[0]));
    expect(Object.isFrozen(input.products[0].baselineRule));
  });
});

// ---------------------------------------------------------------------------
// Validation — typed, first violation wins, nothing absorbed
// ---------------------------------------------------------------------------

describe('calculateWhatIfExcise — validation', () => {
  it('rejects a negative, non-finite hypothetical rate', () => {
    for (const bad of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateWhatIfExcise({ hypotheticalRate: bad, products: [product({ id: 'x' })] }))
        .toThrow(InvalidWhatIfInputError);
      try {
        calculateWhatIfExcise({ hypotheticalRate: bad, products: [product({ id: 'x' })] });
      } catch (error) {
        expect((error as InvalidWhatIfInputError).reason).toBe('INVALID_HYPOTHETICAL_RATE');
      }
    }
  });

  it('rejects an empty product list', () => {
    try {
      calculateWhatIfExcise({ hypotheticalRate: 1, products: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidWhatIfInputError);
      expect((error as InvalidWhatIfInputError).reason).toBe('EMPTY_PRODUCT_LIST');
      expect((error as InvalidWhatIfInputError).productId).toBeNull();
    }
  });

  it('reports scenario-level reasons before per-product ones (rate beats empty list)', () => {
    try {
      calculateWhatIfExcise({ hypotheticalRate: -1, products: [] });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidWhatIfInputError).reason).toBe('INVALID_HYPOTHETICAL_RATE');
    }
  });

  it('validates each product field with the product id attached', () => {
    const cases: ReadonlyArray<[Partial<WhatIfProductInput>, string, string | null]> = [
      [{ id: '' }, 'INVALID_PRODUCT_ID', null],
      [{ abv: 1.5 }, 'INVALID_ABV', 'p1'],
      [{ abv: -0.01 }, 'INVALID_ABV', 'p1'],
      [{ volumeLitres: -1 }, 'INVALID_VOLUME', 'p1'],
      [{ alkoPriceCents: -5 }, 'INVALID_ALKO_PRICE', 'p1'],
      [{ importPriceCents: -5 }, 'INVALID_IMPORT_PRICE', 'p1'],
      [
        { baselineRule: rule('', 0.355, 1) },
        'INVALID_FORMULA_REF',
        'p1',
      ],
      [
        { baselineRule: rule(FORMULA_PER_LITRE_OF_PRODUCT, -1, 1) },
        'INVALID_BASELINE_RATE',
        'p1',
      ],
      [
        { baselineRule: { ...rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 1), taxDatasetVersion: '' } },
        'MISSING_DATASET_VERSION',
        'p1',
      ],
      [
        {
          baselineRule: {
            ...rule(FORMULA_PER_LITRE_OF_PRODUCT, 0.355, 1),
            reliability: 'STALE' as 'VERIFIED' | 'ESTIMATED',
          },
        },
        'INVALID_RELIABILITY',
        'p1',
      ],
    ];

    for (const [override, reason, productId] of cases) {
      try {
        calculateWhatIfExcise({ hypotheticalRate: 1, products: [product({ id: 'p1', ...override })] });
        expect.unreachable(`expected ${reason} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidWhatIfInputError);
        const invalid = error as InvalidWhatIfInputError;
        expect(invalid.reason).toBe(reason);
        expect(invalid.productId).toBe(productId);
      }
    }
  });

  it('rejects duplicate product ids', () => {
    try {
      calculateWhatIfExcise({
        hypotheticalRate: 1,
        products: [product({ id: 'dup' }), product({ id: 'dup' })],
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidWhatIfInputError).reason).toBe('DUPLICATE_PRODUCT_ID');
      expect((error as InvalidWhatIfInputError).productId).toBe('dup');
    }
  });

  it('abv 0 and volume 0 are structurally valid (zero excise is exact, not an error)', () => {
    const result = calculateWhatIfExcise({
      hypotheticalRate: HYPOTHETICAL_RATE,
      products: [product({ id: 'alcohol-free', abv: 0 }), product({ id: 'zero-volume', volumeLitres: 0 })],
    });
    for (const line of result.lines) {
      expect(line.baseline.taxCents).toBe(0);
      expect(line.hypothetical.taxCents).toBe(0);
      expect(line.gapBaselineCents).toBe(line.importPriceCents - line.alkoPriceCents);
      expect(line.gapDeltaCents).toBe(0);
    }
  });
});
