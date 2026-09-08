/**
 * Blog-draft builder tests (task 5.1, change trust-and-reach-roadmap) —
 * FI + EN body construction, deterministic slug, typical-basket impact
 * math, and content-lint coverage of the generated bodies (spec
 * content-publication: bodies pass the content-policy lint).
 *
 * @module ContentTest
 */

import { describe, it, expect } from 'vitest';
import {
  buildRateChangeDrafts,
  estimateTypicalBasketImpactCents,
  rateChangeSlug,
  TYPICAL_BASKET,
} from '../content';
import { CONTENT_LOCALES, type RateChangeDraftInput } from '../content.types';
import { FORBIDDEN_TERMS, lintContentPolicy, passesContentPolicy } from '../content-lint';

const EXCISE_STEP: RateChangeDraftInput = {
  versionLabel: 'v2026-09',
  effectiveFrom: '2026-09-15',
  changes: [
    {
      taxType: 'alcohol_excise',
      productCategory: 'beer',
      formulaReference: 'PER_CENTILITRE_ETHANOL',
      fromRate: 1000,
      toRate: 1010,
    },
  ],
};

const DUTY_STEP: RateChangeDraftInput = {
  versionLabel: 'v2027-01',
  effectiveFrom: '2027-01-01',
  changes: [
    {
      taxType: 'container_duty',
      productCategory: 'beer',
      formulaReference: 'FLAT_PER_LITRE',
      fromRate: 51,
      toRate: 60,
    },
  ],
};

describe('buildRateChangeDrafts', () => {
  it('builds exactly one FI + EN draft pair sharing one version-keyed slug', () => {
    const drafts = buildRateChangeDrafts(EXCISE_STEP);
    expect(drafts.map((d) => d.locale)).toEqual([...CONTENT_LOCALES]);
    expect(new Set(drafts.map((d) => d.slug)).size).toBe(1);
    expect(drafts[0].slug).toBe(rateChangeSlug('v2026-09'));
    expect(drafts.every((d) => d.rateDatasetVersion === 'v2026-09')).toBe(true);
  });

  it('states what changed, the effective date, and the basket impact (FI)', () => {
    const fi = buildRateChangeDrafts(EXCISE_STEP).find((d) => d.locale === 'fi')!;
    expect(fi.title).toContain('v2026-09');
    expect(fi.bodyMarkdown).toContain('2026-09-15');
    expect(fi.bodyMarkdown).toContain('beer');
    expect(fi.bodyMarkdown).toContain('1000 → 1010');
    expect(fi.bodyMarkdown).toMatch(/esimerkkikorissa arviolta/);
    // Structural disclaimer sentence — estimates are not a tax liability.
    expect(fi.bodyMarkdown).toContain('ei lopullinen verovelka');
  });

  it('states what changed, the effective date, and the basket impact (EN)', () => {
    const en = buildRateChangeDrafts(EXCISE_STEP).find((d) => d.locale === 'en')!;
    expect(en.title).toContain('v2026-09');
    expect(en.bodyMarkdown).toContain('takes effect on 2026-09-15');
    expect(en.bodyMarkdown).toContain('What changes:');
    expect(en.bodyMarkdown).toMatch(/about €/);
    expect(en.bodyMarkdown).toContain('not a final tax liability');
  });

  it('is deterministic — the same input builds the same drafts', () => {
    expect(buildRateChangeDrafts(EXCISE_STEP)).toEqual(buildRateChangeDrafts(EXCISE_STEP));
  });

  it('builds nothing from an empty delta', () => {
    expect(buildRateChangeDrafts({ ...EXCISE_STEP, changes: [] })).toEqual([]);
  });
});

describe('estimateTypicalBasketImpactCents', () => {
  const litres = TYPICAL_BASKET.units * TYPICAL_BASKET.unitVolumeLitres;
  const ethanolCl = litres * TYPICAL_BASKET.alcoholFraction * 100;

  it('scales per-centilitre-ethanol deltas by the basket ethanol centilitres', () => {
    const impact = estimateTypicalBasketImpactCents(EXCISE_STEP.changes);
    expect(impact).toBe(Math.round(10 * ethanolCl));
  });

  it('scales flat-per-litre deltas by the basket litres', () => {
    const impact = estimateTypicalBasketImpactCents(DUTY_STEP.changes);
    expect(impact).toBe(Math.round(9 * litres));
  });

  it('ignores lines outside the basket category and unpriced formulas', () => {
    expect(
      estimateTypicalBasketImpactCents([
        {
          taxType: 'alcohol_excise',
          productCategory: 'wine',
          formulaReference: 'PER_CENTILITRE_ETHANOL',
          fromRate: 1,
          toRate: 2,
        },
        {
          taxType: 'alcohol_excise',
          productCategory: 'beer',
          formulaReference: 'SOME_OTHER_FORMULA',
          fromRate: 1,
          toRate: 2,
        },
      ]),
    ).toBeNull();
  });
});

describe('rateChangeSlug', () => {
  it('slugifies version labels deterministically', () => {
    expect(rateChangeSlug('v2026-09')).toBe('veromuutos-v2026-09');
    expect(rateChangeSlug('V 2026/09 Special')).toBe('veromuutos-v-2026-09-special');
  });
});

describe('content-lint coverage of post bodies (spec: bodies pass the lint)', () => {
  it('generated draft bodies and titles pass the content policy', () => {
    for (const input of [EXCISE_STEP, DUTY_STEP]) {
      for (const draft of buildRateChangeDrafts(input)) {
        expect(passesContentPolicy(draft.title), `${draft.locale} title`).toBe(true);
        expect(passesContentPolicy(draft.bodyMarkdown), `${draft.locale} body`).toBe(true);
      }
    }
  });

  it('flags the banned promotional vocabulary in both languages', () => {
    expect(lintContentPolicy('This is the best deal!')).toHaveLength(2);
    expect(lintContentPolicy('Tämä on paras tarjous')).toHaveLength(2);
    expect(lintContentPolicy('Halvin hinta kaupassa')).toHaveLength(1);
  });

  it('matches on word boundaries only (substrings pass)', () => {
    expect(lintContentPolicy('estoppel restarting')).toHaveLength(0);
  });

  it('carries a suggestion where one exists', () => {
    const violations = lintContentPolicy('the cheapest option');
    expect(violations[0].suggestion).toBeDefined();
  });

  it('keeps the lint vocabulary in sync with the map contract', () => {
    // Every entry is a lowercase term; the map is the single source.
    for (const term of FORBIDDEN_TERMS.keys()) {
      expect(term).toBe(term.toLowerCase());
    }
  });
});
