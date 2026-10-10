/**
 * Unit tests for the pure preference-digest computation (spec
 * preference-digest): factual facts per followed category, deterministic
 * category-then-price order, stale-category omission, and the
 * empty-output send-nothing signal.
 */
import { describe, expect, it } from 'vitest';

import type { DigestCategory, DigestSummaryRow } from '../digest.types';
import { computePreferenceDigest } from '../compute';
import { InvalidDigestInputError } from '../digest.types';

// A 7-day window of daily bucket anchors, earliest first.
const DAYS = [
  '2026-10-05',
  '2026-10-06',
  '2026-10-07',
  '2026-10-08',
  '2026-10-09',
  '2026-10-10',
  '2026-10-11',
] as const;

function row(overrides: Partial<DigestSummaryRow>): DigestSummaryRow {
  return {
    category: 'beer',
    productId: 1,
    merchant: null,
    periodStart: DAYS[0],
    priceCloseCents: 199,
    ...overrides,
  };
}

describe('computePreferenceDigest — factual content', () => {
  it('states the category minimum with product and merchant citation', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['beer'],
      summaryRows: [
        row({ productId: 1, priceCloseCents: 249 }),
        row({ productId: 2, periodStart: DAYS[3], priceCloseCents: 189 }),
        row({ productId: 3, periodStart: DAYS[6], priceCloseCents: 209 }),
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual({
      category: 'beer',
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 189,
      productId: 2,
      merchant: null,
      periodStart: DAYS[3],
    });
  });

  it('breaks price ties by the category-minimum query rule — lowest product id', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['beer'],
      summaryRows: [
        row({ productId: 7, periodStart: DAYS[1], priceCloseCents: 199 }),
        row({ productId: 2, periodStart: DAYS[4], priceCloseCents: 199 }),
      ],
    });

    expect(facts[0].productId).toBe(2);
    expect(facts[0].periodStart).toBe(DAYS[4]);
  });

  it('carries the merchant citation through from the tripping row', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['wine_still'],
      summaryRows: [
        row({ category: 'wine_still', productId: 5, merchant: 'Example Merchant', priceCloseCents: 1299 }),
      ],
    });

    expect(facts[0].merchant).toBe('Example Merchant');
    expect(facts[0].productId).toBe(5);
  });

  describe('notable new low', () => {
    it('exists when the latest day is strictly cheaper than the earlier window', () => {
      const facts = computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [
          row({ productId: 1, periodStart: DAYS[0], priceCloseCents: 249 }),
          row({ productId: 2, periodStart: DAYS[5], priceCloseCents: 219 }),
          row({ productId: 3, periodStart: DAYS[6], priceCloseCents: 189 }),
        ],
      });

      expect(facts.map((f) => f.kind)).toEqual([
        'CATEGORY_MINIMUM',
        'NOTABLE_NEW_LOW',
      ]);
      // A new low IS the window minimum — both facts share the price,
      // the new low cites the fresh-end tripping row.
      expect(facts[1]).toEqual({
        category: 'beer',
        kind: 'NOTABLE_NEW_LOW',
        priceCloseCents: 189,
        productId: 3,
        merchant: null,
        periodStart: DAYS[6],
      });
    });

    it('does not exist when the latest day matches the earlier minimum', () => {
      const facts = computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [
          row({ productId: 1, periodStart: DAYS[0], priceCloseCents: 199 }),
          row({ productId: 2, periodStart: DAYS[6], priceCloseCents: 199 }),
        ],
      });

      expect(facts.map((f) => f.kind)).toEqual(['CATEGORY_MINIMUM']);
    });

    it('does not exist when the latest day is more expensive than the earlier minimum', () => {
      const facts = computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [
          row({ productId: 1, periodStart: DAYS[0], priceCloseCents: 159 }),
          row({ productId: 2, periodStart: DAYS[6], priceCloseCents: 189 }),
        ],
      });

      // The window minimum sits on an earlier day; no new low, and the
      // minimum fact cites that earlier row.
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({
        kind: 'CATEGORY_MINIMUM',
        priceCloseCents: 159,
        productId: 1,
        periodStart: DAYS[0],
      });
    });

    it('does not exist for a single-day window — no earlier part to be lower than', () => {
      const facts = computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [row({ productId: 1, periodStart: DAYS[6], priceCloseCents: 189 })],
      });

      expect(facts.map((f) => f.kind)).toEqual(['CATEGORY_MINIMUM']);
    });
  });
});

describe('computePreferenceDigest — ordering invariant (design D1)', () => {
  it('orders facts category ascending, then price ascending', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['spirits', 'beer', 'wine_still'],
      summaryRows: [
        row({ category: 'spirits', productId: 1, periodStart: DAYS[6], priceCloseCents: 5000 }),
        row({ category: 'beer', productId: 2, periodStart: DAYS[6], priceCloseCents: 275 }),
        row({ category: 'wine_still', productId: 3, periodStart: DAYS[6], priceCloseCents: 1299 }),
        row({ category: 'beer', productId: 4, periodStart: DAYS[6], priceCloseCents: 189 }),
        row({ category: 'wine_still', productId: 5, periodStart: DAYS[6], priceCloseCents: 999 }),
        row({ category: 'spirits', productId: 6, periodStart: DAYS[6], priceCloseCents: 4500 }),
      ],
    });

    expect(facts.map((f) => [f.category, f.priceCloseCents])).toEqual([
      ['beer', 189],
      ['spirits', 4500],
      ['wine_still', 999],
    ]);
  });

  it('orders the full output — within a category the minimum precedes its new low at the same price', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['wine_still', 'beer'],
      summaryRows: [
        row({ category: 'beer', productId: 1, periodStart: DAYS[0], priceCloseCents: 249 }),
        row({ category: 'beer', productId: 2, periodStart: DAYS[6], priceCloseCents: 189 }),
        row({ category: 'wine_still', productId: 3, periodStart: DAYS[0], priceCloseCents: 1299 }),
        row({ category: 'wine_still', productId: 4, periodStart: DAYS[6], priceCloseCents: 999 }),
      ],
    });

    expect(facts.map((f) => [f.category, f.kind, f.priceCloseCents])).toEqual([
      ['beer', 'CATEGORY_MINIMUM', 189],
      ['beer', 'NOTABLE_NEW_LOW', 189],
      ['wine_still', 'CATEGORY_MINIMUM', 999],
      ['wine_still', 'NOTABLE_NEW_LOW', 999],
    ]);
  });

  it('is independent of input row order — shuffled rows produce identical output', () => {
    const summaryRows = [
      row({ category: 'beer', productId: 1, periodStart: DAYS[0], priceCloseCents: 249 }),
      row({ category: 'wine_still', productId: 2, periodStart: DAYS[6], priceCloseCents: 999 }),
      row({ category: 'beer', productId: 3, periodStart: DAYS[6], priceCloseCents: 189 }),
      row({ category: 'spirits', productId: 4, periodStart: DAYS[3], priceCloseCents: 4500 }),
    ];
    const tags = ['beer', 'wine_still', 'spirits'] as const;

    const first = computePreferenceDigest({ categoryTags: [...tags], summaryRows });
    const second = computePreferenceDigest({ categoryTags: [...tags], summaryRows: [...summaryRows].reverse() });

    expect(second).toEqual(first);
    // Category ascending regardless of the tags' given order.
    expect(first.map((f) => f.category)).toEqual(['beer', 'beer', 'spirits', 'wine_still']);
  });

  it('produces item-for-item identical output when computed twice over the same summaries', () => {
    const input = {
      categoryTags: ['beer', 'wine_still'] as const,
      summaryRows: [
        row({ category: 'beer', productId: 1, periodStart: DAYS[0], priceCloseCents: 249 }),
        row({ category: 'beer', productId: 2, periodStart: DAYS[6], priceCloseCents: 189 }),
        row({ category: 'wine_still', productId: 3, periodStart: DAYS[2], priceCloseCents: 1299 }),
      ],
    };

    expect(computePreferenceDigest(input)).toEqual(computePreferenceDigest(input));
  });

  it('is a pure filter — two accounts with different tags share order and facts on shared categories', () => {
    const summaryRows = [
      row({ category: 'beer', productId: 1, periodStart: DAYS[6], priceCloseCents: 189 }),
      row({ category: 'wine_still', productId: 2, periodStart: DAYS[6], priceCloseCents: 999 }),
      row({ category: 'spirits', productId: 3, periodStart: DAYS[6], priceCloseCents: 4500 }),
    ];

    const beerWine = computePreferenceDigest({
      categoryTags: ['beer', 'wine_still'],
      summaryRows,
    });
    const beerOnly = computePreferenceDigest({
      categoryTags: ['beer'],
      summaryRows,
    });

    // The shared category (beer) carries the same facts; the tag set only
    // removes categories, it never reorders or reshapes facts.
    expect(beerWine.filter((f) => f.category === 'beer')).toEqual(
      beerOnly.filter((f) => f.category === 'beer'),
    );
    expect(beerOnly).toEqual([beerWine[0]]);
  });
});

describe('computePreferenceDigest — omission (design D4)', () => {
  it('omits a followed category with no provided rows — not zero, not stale, not an error', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['beer', 'wine_still'],
      summaryRows: [
        row({ category: 'beer', productId: 1, priceCloseCents: 189 }),
      ],
    });

    expect(facts).toHaveLength(1);
    expect(facts.every((f) => f.category !== 'wine_still')).toBe(true);
  });

  it('ignores rows outside the followed tags — the preference is a filter', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['beer'],
      summaryRows: [
        row({ category: 'beer', productId: 1, priceCloseCents: 189 }),
        row({ category: 'spirits', productId: 2, priceCloseCents: 4500 }),
      ],
    });

    expect(facts.map((f) => f.category)).toEqual(['beer']);
  });
});

describe('computePreferenceDigest — empty output signals send-nothing', () => {
  it('returns an empty array when no followed category has rows', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['beer', 'wine_still'],
      summaryRows: [],
    });

    expect(facts).toEqual([]);
  });

  it('returns an empty array when the account follows nothing', () => {
    const facts = computePreferenceDigest({
      categoryTags: [],
      summaryRows: [
        row({ category: 'beer', productId: 1, priceCloseCents: 189 }),
      ],
    });

    expect(facts).toEqual([]);
  });

  it('returns an empty array when rows exist but none are followed', () => {
    const facts = computePreferenceDigest({
      categoryTags: ['wine_still'],
      summaryRows: [
        row({ category: 'spirits', productId: 1, priceCloseCents: 4500 }),
      ],
    });

    expect(facts).toEqual([]);
  });
});

describe('computePreferenceDigest — input contract', () => {
  it('collapses duplicate tags and ignores tag order', () => {
    const summaryRows = [
      row({ category: 'beer', productId: 1, periodStart: DAYS[6], priceCloseCents: 189 }),
      row({ category: 'spirits', productId: 2, periodStart: DAYS[6], priceCloseCents: 4500 }),
    ];

    const facts = computePreferenceDigest({
      categoryTags: ['spirits', 'beer', 'spirits'],
      summaryRows,
    });

    expect(facts.map((f) => f.category)).toEqual(['beer', 'spirits']);
  });

  it('does not mutate its inputs', () => {
    const categoryTags: readonly DigestCategory[] = ['beer'];
    const summaryRows = [
      row({ category: 'beer', productId: 2, periodStart: DAYS[6], priceCloseCents: 189 }),
      row({ category: 'beer', productId: 1, periodStart: DAYS[0], priceCloseCents: 249 }),
    ];
    const tagsSnapshot = [...categoryTags];
    const rowsSnapshot = summaryRows.map((r) => ({ ...r }));

    computePreferenceDigest({ categoryTags, summaryRows });

    expect(categoryTags).toEqual(tagsSnapshot);
    expect(summaryRows).toEqual(rowsSnapshot);
  });

  it('throws on a tag outside the canonical value set', () => {
    expect(() =>
      computePreferenceDigest({
        categoryTags: ['cider' as never],
        summaryRows: [],
      }),
    ).toThrow(InvalidDigestInputError);
  });

  it('throws on a row with a non-integer or non-positive price close', () => {
    expect(() =>
      computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [row({ priceCloseCents: Number.NaN })],
      }),
    ).toThrow(InvalidDigestInputError);
    expect(() =>
      computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [row({ priceCloseCents: 0 })],
      }),
    ).toThrow(InvalidDigestInputError);
  });

  it('throws on a row with a non-integer product id or an empty bucket day', () => {
    expect(() =>
      computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [row({ productId: 1.5 })],
      }),
    ).toThrow(InvalidDigestInputError);
    expect(() =>
      computePreferenceDigest({
        categoryTags: ['beer'],
        summaryRows: [row({ periodStart: '' })],
      }),
    ).toThrow(InvalidDigestInputError);
  });
});
