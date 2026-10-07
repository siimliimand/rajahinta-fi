/**
 * Compliance test: margin-content lint + fi/en parity (task 5.1, change
 * hedge-dedup-confidence-meter).
 *
 * A test-level second opinion on the copy this change touched, independent
 * of the lint script (`lint:content`) and the catalog tests
 * (`messages.test.ts` — which pin the WHOLE catalogs). What this file
 * adds at compliance scope:
 *
 * 1. **Namespace key-tree parity** — the namespaces this change touched
 *    (CalculatorResult incl. the plain category labels the sanity notes
 *    reuse, ConfidenceMeter, Ranking, BasketResults incl. the coded line
 *    labels the share page localizes through) have IDENTICAL dotted key
 *    trees in fi and en. A margin key added to one catalog only fails
 *    here even if the whole-catalog test were skipped.
 * 2. **Content policy on the touched namespaces** — every leaf string in
 *    BOTH locales passes `checkContent` (the same vocabulary the lint
 *    script polices): neutral, factual copy — no promotional adjectives,
 *    no purchase advice, on either side of the ± figure.
 * 3. **Meter honesty copy** — the ConfidenceMeter namespace carries
 *    exactly the five basis keys (label, percent, sample count, as-of,
 *    methodology link), and the Ranking margin block states the N ≥ 10
 *    floor ("no figure is invented") and the display-only invariant in
 *    BOTH locales — the copy alone must not overclaim.
 * 4. **Label de-qualification (design D2)** — the tax-line category
 *    labels are the plain official names (no "Arvio"/"estimate"
 *    qualifier) in both locales, the coded basket/share line labels
 *    likewise, and the retired sanity-note framing label
 *    ("Luotettavuus alennettu…") exists in NEITHER catalog.
 *
 * @module MarginContentParityComplianceTest
 */

import { describe, it, expect } from 'vitest';
import { checkContent, type ContentViolation } from '@rajahinta/frontend/lib/content-policy';
import fiCatalog from '@rajahinta/frontend/messages/fi.json';
import enCatalog from '@rajahinta/frontend/messages/en.json';

// ---------------------------------------------------------------------------
// Catalog walking — dotted key paths to string leaves
// ---------------------------------------------------------------------------

/** Recursively collect the dotted key paths of every string leaf. */
function stringKeys(value: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (typeof value === 'string') return prefix === '' ? out : [prefix];
  if (value === null || typeof value !== 'object') return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    out.push(...stringKeys(child, path));
  }
  return out;
}

type Catalog = Record<string, unknown>;

const FI = fiCatalog as unknown as Catalog;
const EN = enCatalog as unknown as Catalog;

/** The namespaces this change touched (task 5.1 scope). */
const TOUCHED_NAMESPACES = [
  'CalculatorResult',
  'ConfidenceMeter',
  'Ranking',
  'BasketResults',
] as const;

function namespace(catalog: Catalog, ns: string): Catalog {
  const node = catalog[ns];
  if (node === undefined || typeof node !== 'object' || node === null) {
    throw new Error(`namespace ${ns} missing from a catalog`);
  }
  return node as Catalog;
}

/** Every string leaf of a namespace with its dotted key, sorted. */
function leaves(catalog: Catalog, ns: string): Array<[string, string]> {
  const node = namespace(catalog, ns);
  return stringKeys(node)
    .sort()
    .map((key) => [`  ${ns}.${key}`, node[key] as unknown as string]);
}

function formatViolations(violations: Array<Record<string, unknown>>): string {
  return violations
    .map((v) => JSON.stringify(v))
    .join('\n');
}

// ===========================================================================
// 1. Namespace key-tree parity — fi ↔ en
// ===========================================================================

describe('touched-namespace key-tree parity (fi ↔ en)', () => {
  for (const ns of TOUCHED_NAMESPACES) {
    it(`${ns}: identical key trees in both locales`, () => {
      const fiKeys = stringKeys(namespace(FI, ns)).sort();
      const enKeys = stringKeys(namespace(EN, ns)).sort();
      expect(
        fiKeys.filter((k) => !enKeys.includes(k)),
        `keys only in fi.${ns}`,
      ).toEqual([]);
      expect(
        enKeys.filter((k) => !fiKeys.includes(k)),
        `keys only in en.${ns}`,
      ).toEqual([]);
      expect(fiKeys.length).toBeGreaterThan(0);
    });
  }
});

// ===========================================================================
// 2. Content policy on the touched namespaces — both locales
// ===========================================================================

describe('content policy on the touched namespaces (both locales)', () => {
  for (const [locale, catalog] of [
    ['fi', FI],
    ['en', EN],
  ] as const) {
    for (const ns of TOUCHED_NAMESPACES) {
      it(`${locale}.${ns}: every string passes checkContent`, () => {
        const violations: ContentViolation[] = [];
        for (const [key, text] of leaves(catalog, ns)) {
          const found = checkContent(text);
          for (const violation of found) {
            violations.push({ key, word: violation.word, context: violation.context });
          }
        }
        expect(formatViolations(violations)).toBe('');
      });
    }
  }
});

// ===========================================================================
// 3. Meter honesty copy — the basis keys, the floor, the display-only note
// ===========================================================================

describe('ConfidenceMeter namespace copy honesty', () => {
  it('carries exactly the five basis keys in both locales', () => {
    const expected = [
      'asOfLine',
      'label',
      'methodologyLink',
      'percentLine',
      'sampleLine',
    ].sort();
    for (const catalog of [FI, EN]) {
      expect(Object.keys(namespace(catalog, 'ConfidenceMeter')).sort()).toEqual(
        expected,
      );
    }
  });

  it('every basis slot is a placeholder-bearing template — the basis is always rendered, never dropped', () => {
    for (const catalog of [FI, EN]) {
      const meter = namespace(catalog, 'ConfidenceMeter');
      expect(meter.percentLine).toContain('{percent}');
      expect(meter.sampleLine).toContain('{count}');
      expect(meter.asOfLine).toContain('{date}');
    }
  });
});

describe('Ranking margin copy honesty', () => {
  const MARGIN_KEYS = [
    'marginTitle',
    'marginBody1',
    'marginLadderIntro',
    'marginLadder1',
    'marginLadder2',
    'marginLadder3',
    'marginFloorNote',
    'marginDisplayNote',
  ];

  it('carries exactly the eight margin keys in both locales', () => {
    for (const catalog of [FI, EN]) {
      const ranking = namespace(catalog, 'Ranking');
      for (const key of MARGIN_KEYS) {
        expect(typeof ranking[key]).toBe('string');
      }
      const extra = Object.keys(ranking).filter(
        (k) => k.startsWith('margin') && !MARGIN_KEYS.includes(k),
      );
      expect(extra).toEqual([]);
    }
  });

  it('the floor note states the N ≥ 10 honesty in both locales — below the floor NO figure shows and none is invented', () => {
    expect(FI.Ranking.marginFloorNote).toContain('10');
    expect(EN.Ranking.marginFloorNote).toContain('10');
    expect(FI.Ranking.marginFloorNote).toContain('näytetä lainkaan');
    expect(EN.Ranking.marginFloorNote).toContain('no ± figure is shown at all');
  });

  it('the display note states the display-only invariant in both locales', () => {
    expect(FI.Ranking.marginDisplayNote).toContain('ei vaikuta');
    expect(EN.Ranking.marginDisplayNote).toContain('never affects');
  });

  it('names the figure honestly — "observed spread", never a precision claim', () => {
    expect(FI.Ranking.marginTitle).toContain('Havaittu hajonta');
    expect(EN.Ranking.marginTitle).toContain('Observed spread');
  });
});

// ===========================================================================
// 4. Label de-qualification (design D2) — plain names, no hedge re-crept
// ===========================================================================

describe('plain category labels (design D2)', () => {
  /** The five canonical CostCategory label keys. */
  const CATEGORY_KEYS = [
    'foreignRetailPrice',
    'transportCost',
    'alcoholExciseEstimate',
    'containerDutyEstimate',
    'importVatEstimate',
  ];

  it('CalculatorResult.category has exactly the five canonical keys in both locales', () => {
    for (const catalog of [FI, EN]) {
      expect(Object.keys(namespace(catalog, 'CalculatorResult').category as Catalog).sort()).toEqual(
        [...CATEGORY_KEYS].sort(),
      );
    }
  });

  it('the tax-line labels are the de-qualified official names in fi', () => {
    const category = namespace(FI, 'CalculatorResult').category as Catalog;
    expect(category.alcoholExciseEstimate).toBe('Alkoholin valmistevero');
    expect(category.containerDutyEstimate).toBe('Pakkausvero');
    expect(category.importVatEstimate).toBe('Tuonnin arvonlisävero');
    // No estimate qualifier re-crept into ANY category label.
    for (const value of Object.values(category)) {
      expect(String(value).toLowerCase()).not.toContain('arvio');
    }
  });

  it('the tax-line labels are the de-qualified official names in en', () => {
    const category = namespace(EN, 'CalculatorResult').category as Catalog;
    expect(category.alcoholExciseEstimate).toBe('Alcohol excise');
    expect(category.containerDutyEstimate).toBe('Container duty');
    expect(category.importVatEstimate).toBe('Import VAT');
    for (const value of Object.values(category)) {
      expect(String(value).toLowerCase()).not.toContain('estimat');
    }
  });
});

describe('coded basket/share line labels (design D2)', () => {
  /**
   * Mirror of core-domain CostLineCode — the same closed set the share
   * page's COST_LINE_CODES set carries (the coded-line localization path).
   */
  const LINE_CODES = [
    'foreign_retail_price',
    'foreign_unit_price',
    'transport',
    'alcohol_excise',
    'container_duty',
    'alcohol_excise_within_allowance',
    'container_duty_within_allowance',
    'alcohol_excise_over_allowance',
    'container_duty_over_allowance',
    'import_vat',
    'import_vat_over_allowance',
    'import_vat_within_allowance',
  ];

  it('BasketResults.line covers exactly the closed code set in both locales', () => {
    for (const catalog of [FI, EN]) {
      const line = namespace(catalog, 'BasketResults').line as Catalog;
      expect(Object.keys(line).sort()).toEqual([...LINE_CODES].sort());
    }
  });

  it('the import-VAT line label is plain in both locales — no qualifier on the coded path', () => {
    const fiLine = namespace(FI, 'BasketResults').line as Catalog;
    const enLine = namespace(EN, 'BasketResults').line as Catalog;
    expect(fiLine.import_vat).toBe('Tuonnin arvonlisävero');
    expect(enLine.import_vat).toBe('Import VAT');
  });
});

describe('sanity-note framing (design D2 / task 3.1)', () => {
  it('the retired framing label exists in NEITHER catalog — the notes name the degraded input, no hedging prose around them', () => {
    expect(JSON.stringify(FI)).not.toContain('Luotettavuus alennettu');
    expect(JSON.stringify(EN)).not.toContain('Reliability reduced');
  });

  it('the sanity notes reuse the shared category labels — no separate de-qualified copy exists', () => {
    // SanityNoteList leads each note with t(`category.${note.code}`) from
    // the CalculatorResult namespace; there is no parallel "sanityNotes"
    // label namespace to drift from it.
    expect(FI.CalculatorResult).not.toHaveProperty('sanityNotes');
    expect(EN.CalculatorResult).not.toHaveProperty('sanityNotes');
  });
});
