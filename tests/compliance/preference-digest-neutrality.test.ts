/**
 * Compliance test: preference-digest neutrality (task 6.1, change
 * add-onboarding-preferences; spec preference-digest "Neutrality" +
 * design D1/D3). Mirrors the cross-package compliance layer's
 * conventions — neutrality-compliance.test.ts structure,
 * alko-benchmark-neutrality.test.ts source-scan pattern — and is
 * deliberately redundant with the per-package unit suites (the layer's
 * second-opinion role): apps/email-worker renders and core-domain
 * digest __tests__ already pin their own behavior; this suite runs in
 * CI as an independent opinion on the neutrality invariants.
 *
 * ## What is tested
 *
 * 1. **Digest copy vocabulary** — the rendered preference-digest email
 *    (subject / text / html, FI and EN, every canonical category, both
 *    fact kinds) passes the shared `isCompliant()`/`checkContent()`
 *    policy: factual sentences only, no promotional vocabulary, no
 *    urgency, no purchase advice.
 * 2. **Ordering determinism** — the digest order is a deterministic
 *    total order: category ascending, then price ascending, with
 *    fact-identity tiebreaks (kind, then product id). Deterministic
 *    across input shuffles; the preference tag filter narrows the
 *    candidate set and never reorders; empty inputs yield the
 *    send-nothing empty array.
 * 3. **No commercial signal** — the digest module's input/output types
 *    structurally cannot carry a ranking/benchmark/savings/commercial
 *    field (compile-time seal + runtime shape), the comparator reads
 *    only the four fact-identity keys, and the module's import graph
 *    contains no ranking/benchmark/savings module.
 *
 * ## Merchant-name experiment (data-as-copy boundary, pinned honestly)
 *
 * The email builder echoes merchant names verbatim as fact citations —
 * merchant names are data, not copy, and only CR/LF stripping plus a
 * length cap are applied (`sanitizeMerchant`). The shared policy scans
 * the whole rendered string, so the two interact:
 *
 * - A merchant named **"Halpa Tarjous Oy"** renders **compliantly**:
 *   the Finnish vocabulary polices superlatives and purchase advice
 *   ("paras", "edullisin", the phrase "paras tarjous"), not merchant
 *   proper nouns — the bare word "tarjous" is not banned, and this
 *   suite pins that observed behavior as-is.
 * - A merchant named **"Top Drinks Oy"** makes the whole-text check
 *   trip: "top" IS in the shared vocabulary, so the violation is the
 *   merchant's own token arriving inside the citation — a true
 *   positive of data-as-copy, and the only such path this suite could
 *   demonstrate. The copy-only guarantee is therefore pinned on
 *   non-merchant fragments: the subject (which carries no citations)
 *   and the identical rendering with the citation removed both stay
 *   compliant, proving the copy itself introduces zero violations.
 *
 * @module PreferenceDigestNeutralityComplianceTest
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContent, isCompliant } from '@rajahinta/frontend/lib/content-policy';
import { buildPreferenceDigestEmail } from '../../apps/email-worker/src/preference-digest-email';
import {
  DIGEST_CATEGORY_VALUES,
  type DigestCategory,
  type DigestFact,
  type DigestSummaryQuery,
  type DigestSummaryQueryPort,
  type DigestSummaryRow,
  type PreferenceDigestInput,
} from '@rajahinta/core-domain/digest/digest.types';
import { computePreferenceDigest } from '@rajahinta/core-domain/digest/compute';
import {
  compareDigestFacts,
  sortDigestFacts,
} from '@rajahinta/core-domain/digest/ordering';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WEEK = '2026-W41';
const ONBOARDING_URL = 'https://rajahinta.fi/onboarding';
const LOCALES = ['fi', 'en'] as const;

/**
 * Deterministic Fisher–Yates shuffle (LCG) — fixed seeds produce fixed
 * permutations, so every "across shuffles" assertion below is itself
 * reproducible run to run.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = () =>
    (state = (state * 1664525 + 1013904223) >>> 0) / 0x100000000;
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// ===========================================================================
// 1. Digest copy vocabulary — the rendered email passes the shared policy
// ===========================================================================

/**
 * Every canonical category, both fact kinds, and the citation shapes
 * from product-wide (merchant `null`) through neutral retailers to the
 * borderline "Halpa Tarjous Oy" (see module docs — rendered compliantly;
 * pinned as observed behavior).
 */
const COPY_FACTS: DigestFact[] = DIGEST_CATEGORY_VALUES.flatMap(
  (category, i): DigestFact[] => [
    {
      category,
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 500 + i * 13,
      productId: 101 + i,
      merchant: i % 2 === 0 ? null : 'Alko',
      periodStart: '2026-10-06',
    },
    {
      category,
      kind: 'NOTABLE_NEW_LOW',
      priceCloseCents: 490 + i * 13,
      productId: 201 + i,
      merchant: i % 3 === 0 ? 'Halpa Tarjous Oy' : 'S-market',
      periodStart: '2026-10-08',
    },
  ],
);

describe('digest copy passes the shared content policy (FI + EN, all categories)', () => {
  for (const locale of LOCALES) {
    it(`renders fully compliant subject, text and html (${locale})`, () => {
      const email = buildPreferenceDigestEmail({
        week: WEEK,
        facts: COPY_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      // The render is the real digest — the footer link and sign-off
      // prove we exercised the builder, not a projection of it.
      expect(email.text).toContain(ONBOARDING_URL);
      expect(email.text).toContain('rajahinta.fi');
      expect(isCompliant(email.subject)).toBe(true);
      expect(isCompliant(email.text)).toBe(true);
      expect(isCompliant(email.html)).toBe(true);
    });

    it(`every rendered line individually passes checkContent (${locale})`, () => {
      const email = buildPreferenceDigestEmail({
        week: WEEK,
        facts: COPY_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      const violatingLines = email.text
        .split('\n')
        .filter((line) => line.length > 0 && !isCompliant(line));
      expect(violatingLines).toEqual([]);
    });
  }

  it('the subject carries no fact citations, so it is copy-only by construction', () => {
    for (const locale of LOCALES) {
      const email = buildPreferenceDigestEmail({
        week: WEEK,
        facts: COPY_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      expect(email.subject).not.toContain('Tuote #');
      expect(email.subject).not.toContain('Product #');
      expect(checkContent(email.subject)).toEqual([]);
    }
  });
});

describe('merchant names are data, not copy — the data-as-copy boundary (pinned honestly)', () => {
  /** Facts citing the merchant whose name trips the shared vocabulary. */
  const MERCHANT_DATA_FACTS: DigestFact[] = [
    {
      category: 'beer',
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 320,
      productId: 301,
      merchant: 'Top Drinks Oy',
      periodStart: '2026-10-07',
    },
    {
      category: 'wine_still',
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 899,
      productId: 302,
      merchant: null,
      periodStart: '2026-10-06',
    },
  ];

  /** The identical facts with the citation removed (product-wide bucket). */
  const ANONYMIZED_FACTS: DigestFact[] = MERCHANT_DATA_FACTS.map(
    ({ merchant: _merchant, ...fact }) => ({ ...fact, merchant: null }),
  );

  it('"Halpa Tarjous Oy" renders compliantly — FI vocabulary polices superlatives and advice, not merchant nouns', () => {
    // Pinned observed behavior: the bare words "halpa" / "tarjous" are
    // not in the shared vocabulary (only the phrase "paras tarjous" is),
    // so this merchant citation passes. Documented, not endorsed.
    const email = buildPreferenceDigestEmail({
      week: WEEK,
      facts: COPY_FACTS,
      locale: 'fi',
      onboardingUrl: ONBOARDING_URL,
    });
    expect(email.text).toContain('Halpa Tarjous Oy');
    expect(isCompliant(email.text)).toBe(true);
  });

  it('the policy matcher is not vacuous — copy usage of the same vocabulary fires', () => {
    // The FI phrase is banned in COPY; the merchant noun alone is not.
    // Same word family, different surface — the boundary is the copy,
    // and this pair proves the matcher can fire on it.
    expect(checkContent('Tämän viikon paras tarjous oluelle.').length).toBeGreaterThanOrEqual(1);
    expect(checkContent('Tuote #201, Halpa Tarjous Oy')).toEqual([]);
  });

  it('"Top Drinks Oy" trips the whole-text check — the violations are the merchant\'s own token', () => {
    for (const locale of LOCALES) {
      const email = buildPreferenceDigestEmail({
        week: WEEK,
        facts: MERCHANT_DATA_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      const violations = checkContent(email.text);
      // True positive of data-as-copy: the citation is present verbatim
      // and every violation word is the merchant's, never the copy's.
      expect(email.text).toContain('Top Drinks Oy');
      expect(violations.length).toBeGreaterThanOrEqual(1);
      for (const violation of violations) {
        expect(violation.word).toBe('top');
        // The context brackets the match — "[Top] Drinks Oy".
        expect(violation.context).toContain('Drinks Oy');
      }
    }
  });

  it('the copy-only guarantee holds on non-merchant fragments — subject and citation-free rendering stay compliant', () => {
    for (const locale of LOCALES) {
      const cited = buildPreferenceDigestEmail({
        week: WEEK,
        facts: MERCHANT_DATA_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      const anonymized = buildPreferenceDigestEmail({
        week: WEEK,
        facts: ANONYMIZED_FACTS,
        locale,
        onboardingUrl: ONBOARDING_URL,
      });
      // Subject: no citations, pure copy — always compliant.
      expect(isCompliant(cited.subject)).toBe(true);
      // Same copy with the citation removed: fully compliant. The only
      // non-compliance source demonstrated above is echoed merchant data.
      expect(isCompliant(anonymized.subject)).toBe(true);
      expect(isCompliant(anonymized.text)).toBe(true);
      expect(isCompliant(anonymized.html)).toBe(true);
    }
  });
});

// ===========================================================================
// 2. Ordering determinism — category, then price; identity tiebreaks;
//    the tag filter narrows, never reorders
// ===========================================================================

/** One summary bucket; merchant defaults to the product-wide `null`. */
function summaryRow(
  overrides: Partial<DigestSummaryRow> & {
    category: DigestCategory;
    productId: number;
    priceCloseCents: number;
    periodStart: string;
  },
): DigestSummaryRow {
  return { merchant: null, ...overrides };
}

/**
 * Four followed categories over one window, shaped so every pin has a
 * dedicated row: beer yields a new low equal to its window minimum
 * (kind tiebreak), spirits ties its fresh end with the earlier minimum
 * (no new low), wine_sparkling ties two products on price (product-id
 * tiebreak), wine_still's minimum is not a new low, and one row is
 * unfollowed. The wine_still row also carries the borderline merchant
 * name — rows may enter with promotional-looking data; the computation
 * ignores what it does not cite.
 */
const ORDERING_ROWS: DigestSummaryRow[] = [
  summaryRow({ category: 'beer', productId: 11, priceCloseCents: 150, periodStart: '2026-10-01' }),
  summaryRow({ category: 'beer', productId: 12, priceCloseCents: 199, periodStart: '2026-10-05' }),
  summaryRow({
    category: 'beer',
    productId: 13,
    priceCloseCents: 120,
    periodStart: '2026-10-07',
    merchant: 'Alko',
  }),
  summaryRow({ category: 'spirits', productId: 21, priceCloseCents: 2500, periodStart: '2026-10-02' }),
  summaryRow({ category: 'spirits', productId: 22, priceCloseCents: 2500, periodStart: '2026-10-07' }),
  summaryRow({ category: 'wine_still', productId: 31, priceCloseCents: 899, periodStart: '2026-10-03' }),
  summaryRow({
    category: 'wine_still',
    productId: 32,
    priceCloseCents: 1050,
    periodStart: '2026-10-07',
    merchant: 'Halpa Tarjous Oy',
  }),
  summaryRow({ category: 'wine_sparkling', productId: 51, priceCloseCents: 1400, periodStart: '2026-10-04' }),
  summaryRow({ category: 'wine_sparkling', productId: 50, priceCloseCents: 1400, periodStart: '2026-10-06' }),
  // Not followed below — must never appear in any output.
  summaryRow({ category: 'other_fermented', productId: 41, priceCloseCents: 300, periodStart: '2026-10-07' }),
];

/** Deliberately scrambled relative to the canonical value order. */
const FOLLOWED_TAGS: DigestCategory[] = [
  'wine_sparkling',
  'beer',
  'wine_still',
  'spirits',
];

/** The expected computation: category asc (code-unit), then price asc. */
const EXPECTED_FACTS: DigestFact[] = [
  {
    category: 'beer',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 120,
    productId: 13,
    merchant: 'Alko',
    periodStart: '2026-10-07',
  },
  {
    // A new low IS the window minimum — same price, kind tiebreak keeps
    // the pair in one fixed order (CATEGORY_MINIMUM sorts first).
    category: 'beer',
    kind: 'NOTABLE_NEW_LOW',
    priceCloseCents: 120,
    productId: 13,
    merchant: 'Alko',
    periodStart: '2026-10-07',
  },
  {
    category: 'spirits',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 2500,
    productId: 21,
    merchant: null,
    periodStart: '2026-10-02',
  },
  {
    // 1400 vs 1400: the product-id tiebreak picks id 50, not 51.
    category: 'wine_sparkling',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 1400,
    productId: 50,
    merchant: null,
    periodStart: '2026-10-06',
  },
  {
    category: 'wine_still',
    kind: 'CATEGORY_MINIMUM',
    priceCloseCents: 899,
    productId: 31,
    merchant: null,
    periodStart: '2026-10-03',
  },
];

describe('computePreferenceDigest — deterministic, price/category-only order', () => {
  it('produces the category-then-price total order with the identity tiebreaks', () => {
    expect(computePreferenceDigest({
      categoryTags: FOLLOWED_TAGS,
      summaryRows: ORDERING_ROWS,
    })).toEqual(EXPECTED_FACTS);
  });

  it('category order is code-unit ascending — not the canonical value-set order', () => {
    // 'wine_sparkling' < 'wine_still' by code units ('p' < 't'), though
    // DIGEST_CATEGORY_VALUES declares wine_still first; the pinned order
    // above follows the code units. Determinism over locale collation
    // and declaration order alike.
    expect([...EXPECTED_FACTS.map((f) => f.category)]).toEqual([
      'beer',
      'beer',
      'spirits',
      'wine_sparkling',
      'wine_still',
    ]);
    expect([...DIGEST_CATEGORY_VALUES].sort()[4]).toBe('wine_sparkling');
  });

  it('is item-for-item identical across input row shuffles', () => {
    const baseline = computePreferenceDigest({
      categoryTags: FOLLOWED_TAGS,
      summaryRows: ORDERING_ROWS,
    });
    for (const seed of [1, 2, 3, 7, 4242]) {
      const out = computePreferenceDigest({
        categoryTags: FOLLOWED_TAGS,
        summaryRows: shuffled(ORDERING_ROWS, seed),
      });
      expect(out).toEqual(baseline);
    }
  });

  it('the preference tag order never reorders — any tag permutation yields the same output', () => {
    const baseline = computePreferenceDigest({
      categoryTags: FOLLOWED_TAGS,
      summaryRows: ORDERING_ROWS,
    });
    for (const seed of [5, 9, 11]) {
      expect(
        computePreferenceDigest({
          categoryTags: shuffled(FOLLOWED_TAGS, seed),
          summaryRows: ORDERING_ROWS,
        }),
      ).toEqual(baseline);
    }
  });

  it('the filter narrows, never reorders — dropping a followed tag only removes its facts', () => {
    const withoutSparkling = computePreferenceDigest({
      categoryTags: FOLLOWED_TAGS.filter((t) => t !== 'wine_sparkling'),
      summaryRows: ORDERING_ROWS,
    });
    expect(
      withoutSparkling.map((f) => `${f.category}/${f.kind}/${f.priceCloseCents}`),
    ).toEqual([
      'beer/CATEGORY_MINIMUM/120',
      'beer/NOTABLE_NEW_LOW/120',
      'spirits/CATEGORY_MINIMUM/2500',
      'wine_still/CATEGORY_MINIMUM/899',
    ]);
  });

  it('empty-input semantics — no tags, no rows, or no fresh window each yield the send-nothing empty array', () => {
    // No followed tags: nothing is reportable.
    expect(computePreferenceDigest({ categoryTags: [], summaryRows: ORDERING_ROWS })).toEqual([]);
    // Followed tags but no provided rows: omitted, never zero, never stale.
    expect(computePreferenceDigest({ categoryTags: FOLLOWED_TAGS, summaryRows: [] })).toEqual([]);
    // A single-day window has no earlier part and never yields a new low.
    const singleDay = computePreferenceDigest({
      categoryTags: ['beer'],
      summaryRows: ORDERING_ROWS.filter((r) => r.periodStart === '2026-10-07'),
    });
    expect(singleDay.map((f) => f.kind)).toEqual(['CATEGORY_MINIMUM']);
  });
});

describe('compareDigestFacts — the comparator reads only fact-identity keys', () => {
  it('sortDigestFacts is a fixed point across every permutation of a mixed fact set', () => {
    const facts = [...EXPECTED_FACTS];
    const baseline = sortDigestFacts(facts);
    for (const seed of [2, 6, 13, 99]) {
      expect(sortDigestFacts(shuffled(facts, seed))).toEqual(baseline);
    }
  });

  it('breaks (category, price) ties by kind, then product id — never by anything else', () => {
    const tied = [
      summaryRow({ category: 'beer', productId: 9, priceCloseCents: 100, periodStart: '2026-10-01' }),
      summaryRow({ category: 'beer', productId: 8, priceCloseCents: 100, periodStart: '2026-10-02' }),
    ].map((r) => ({
      category: r.category,
      kind: 'CATEGORY_MINIMUM' as const,
      priceCloseCents: r.priceCloseCents,
      productId: r.productId,
      merchant: r.merchant,
      periodStart: r.periodStart,
    }));
    const sorted = sortDigestFacts(tied);
    expect(sorted.map((f) => f.productId)).toEqual([8, 9]);

    // Same category + price + id, kinds differ: the kind tiebreak orders
    // CATEGORY_MINIMUM before NOTABLE_NEW_LOW.
    const kinds = sortDigestFacts([
      { ...tied[0]!, kind: 'NOTABLE_NEW_LOW' },
      { ...tied[0]!, kind: 'CATEGORY_MINIMUM' },
    ]);
    expect(kinds.map((f) => f.kind)).toEqual(['CATEGORY_MINIMUM', 'NOTABLE_NEW_LOW']);
  });

  it('no signal can move the order — facts decorated with commercial fields sort identically', () => {
    const plain: DigestFact[] = [
      {
        category: 'beer',
        kind: 'CATEGORY_MINIMUM',
        priceCloseCents: 700,
        productId: 1,
        merchant: null,
        periodStart: '2026-10-05',
      },
      {
        category: 'beer',
        kind: 'CATEGORY_MINIMUM',
        priceCloseCents: 700,
        productId: 2,
        merchant: null,
        periodStart: '2026-10-05',
      },
    ];
    // Product 2 carries every commercial-looking field at "promote me"
    // magnitudes; if the comparator read any of them, product 2 would
    // overtake product 1.
    const decorated: DigestFact[] = [
      plain[0]!,
      { ...plain[1]!, ...({ rankingScore: 1, boost: 999, sponsored: true } as object) },
    ];
    expect(
      sortDigestFacts(decorated).map((f) => f.productId),
    ).toEqual(sortDigestFacts(plain).map((f) => f.productId));
  });

  it('facts equal on the four keys compare as equal regardless of merchant or day', () => {
    const a: DigestFact = {
      category: 'beer',
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 100,
      productId: 5,
      merchant: 'Alko',
      periodStart: '2026-10-01',
    };
    const b: DigestFact = {
      category: 'beer',
      kind: 'CATEGORY_MINIMUM',
      priceCloseCents: 100,
      productId: 5,
      merchant: 'Halpa Tarjous Oy',
      periodStart: '2026-10-07',
    };
    expect(compareDigestFacts(a, b)).toBe(0);
    expect(compareDigestFacts(b, a)).toBe(0);
    expect(compareDigestFacts(a, a)).toBe(0);
  });

  it('sortDigestFacts returns a new array and never mutates its input', () => {
    const facts = [...EXPECTED_FACTS];
    const snapshot = facts.map((f) => f.productId);
    const sorted = sortDigestFacts(facts);
    expect(sorted).not.toBe(facts);
    expect(facts.map((f) => f.productId)).toEqual(snapshot);
  });
});

// ===========================================================================
// 3. No commercial signal — types, runtime shape, and import graph
// ===========================================================================

/**
 * Every commercial-signal key the platform has ever used or could use
 * for interference. If a digest type carries ANY of these, the mapped
 * probe below yields `true` for that key, the tuple check fails, the
 * seal resolves to `never`, and the const assignment stops compiling.
 */
type CommercialKey =
  | 'paidBoost'
  | 'sponsored'
  | 'promoBoost'
  | 'boostFactor'
  | 'rankingScore'
  | 'ranking'
  | 'boost'
  | 'benchmark'
  | 'savingsCents'
  | 'merchantPreference'
  | 'featured'
  | 'adSlot';

type CarriesAnyCommercialKey<T> = {
  [K in CommercialKey]: T extends { readonly [_ in K]: unknown } ? true : never;
}[CommercialKey];

type _DigestCommercialSeal = [
  CarriesAnyCommercialKey<DigestSummaryRow>,
  CarriesAnyCommercialKey<DigestSummaryQuery>,
  CarriesAnyCommercialKey<DigestSummaryQueryPort>,
  CarriesAnyCommercialKey<PreferenceDigestInput>,
  CarriesAnyCommercialKey<DigestFact>,
] extends [never, never, never, never, never]
  ? true
  : never;
const _digestCommercialSeal: _DigestCommercialSeal = true;
void _digestCommercialSeal;

describe('digest input/output types structurally carry no commercial field', () => {
  it('a row exposes exactly the five cited-fact fields and nothing else', () => {
    const row = summaryRow({
      category: 'beer',
      productId: 1,
      priceCloseCents: 100,
      periodStart: '2026-10-01',
    });
    expect(Object.keys(row).sort()).toEqual([
      'category',
      'merchant',
      'periodStart',
      'priceCloseCents',
      'productId',
    ]);
    for (const key of ['paidBoost', 'sponsored', 'promoBoost', 'rankingScore', 'benchmark', 'savingsCents']) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it('the computation input exposes exactly the preference filter and the fetched rows', () => {
    const input: PreferenceDigestInput = {
      categoryTags: ['beer'],
      summaryRows: ORDERING_ROWS,
    };
    expect(Object.keys(input).sort()).toEqual(['categoryTags', 'summaryRows']);
    for (const key of ['paidBoost', 'rankingScore', 'boost', 'merchantPreference', 'benchmark']) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it('a fact exposes exactly the six echoed fields and nothing else', () => {
    const fact = EXPECTED_FACTS[0]!;
    expect(Object.keys(fact).sort()).toEqual([
      'category',
      'kind',
      'merchant',
      'periodStart',
      'priceCloseCents',
      'productId',
    ]);
    for (const key of ['paidBoost', 'sponsored', 'ranking', 'score', 'boost', 'benchmark', 'savings']) {
      expect(fact).not.toHaveProperty(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Source-level scans (alko-benchmark-neutrality readFileSync pattern)
// ---------------------------------------------------------------------------

const DIGEST_DIR = path.resolve(
  import.meta.dirname,
  '../../packages/core-domain/src/digest',
);

/**
 * Commercial vocabulary — must appear in no digest declaration or import.
 * Substring matching on purpose: camelCase compound fields such as
 * `rankingScore` or `alkoBenchmark` carry no word boundary, so a
 * `\b`-bounded pattern would miss them. Over-matching is the safe
 * direction here — the scanned targets (comment-stripped declarations
 * and import specifiers) contain none of these tokens legitimately.
 */
const COMMERCIAL_VOCABULARY =
  /rank|score|boost|promo|sponsor|savings|benchmark|featured|deal|discount/i;

/** Remove comments so the scan sees declarations, not prose about them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Extract a braced `interface`/`type` declaration block (alko precedent). */
function extractDeclaration(source: string, name: string): string | null {
  const match = new RegExp(`\\b(?:export )?(?:interface|type) ${name}\\b`).exec(
    source,
  );
  if (match === null) return null;
  const open = source.indexOf('{', match.index);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(match.index, i + 1);
    }
  }
  return null;
}

describe('digest.types.ts declarations are commercial-free at source level', () => {
  it('the vocabulary matcher itself can fire — the scan cannot pass vacuously', () => {
    expect(COMMERCIAL_VOCABULARY.test('readonly rankingScore: number')).toBe(true);
    expect(COMMERCIAL_VOCABULARY.test('readonly alkoBenchmark: AlkoBenchmark')).toBe(true);
    expect(COMMERCIAL_VOCABULARY.test('readonly savingsCents: number')).toBe(true);
    expect(COMMERCIAL_VOCABULARY.test('readonly priceCloseCents: number')).toBe(false);
  });

  it.each(['DigestSummaryRow', 'DigestSummaryQuery', 'PreferenceDigestInput', 'DigestFact'] as const)(
    'the %s declaration mentions no commercial vocabulary',
    (name) => {
      const source = readFileSync(path.join(DIGEST_DIR, 'digest.types.ts'), 'utf8');
      const block = extractDeclaration(source, name);
      expect(block, `${name} declaration must exist`).not.toBeNull();
      expect(
        stripComments(block!),
        `${name} must not carry commercial vocabulary — the digest inputs structurally cannot carry a ranking/benchmark/savings surface`,
      ).not.toMatch(COMMERCIAL_VOCABULARY);
    },
  );

  it('the port type alias (no braces) is commercial-free too', () => {
    const source = readFileSync(path.join(DIGEST_DIR, 'digest.types.ts'), 'utf8');
    const stripped = stripComments(source);
    const alias = /export type DigestSummaryQueryPort[^;]*;/.exec(stripped);
    expect(alias, 'DigestSummaryQueryPort declaration must exist').not.toBeNull();
    expect(alias![0]).not.toMatch(COMMERCIAL_VOCABULARY);
  });
});

describe('the digest module imports no ranking/benchmark/savings module', () => {
  /** Import specifiers of one source file (static `from '...'` clauses). */
  function importSpecifiers(file: string): string[] {
    const source = readFileSync(path.join(DIGEST_DIR, file), 'utf8');
    return [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
  }

  it('the scan is non-vacuous — the expected pure module files exist', () => {
    const files = readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.ts'));
    expect(files).toEqual(expect.arrayContaining(['compute.ts', 'ordering.ts', 'digest.types.ts']));
  });

  it('every digest source file imports only its own relative modules', () => {
    const files = readdirSync(DIGEST_DIR).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      for (const spec of importSpecifiers(file)) {
        expect(
          spec.startsWith('.'),
          `${file} imports '${spec}' — the digest module must not import ranking/benchmark/savings/I/O modules (purity, design D1)`,
        ).toBe(true);
        expect(spec).not.toMatch(/ranking|benchmark|savings/i);
      }
    }
  });

  it('the types module imports nothing at all — pure declarations', () => {
    expect(importSpecifiers('digest.types.ts')).toEqual([]);
  });

  it('the email builder is rendering-only — its import surface is exactly the templates and the digest types', () => {
    // The builder docblock trades dependency-freedom explicitly (no
    // frontend, no Hono, no env types) — pin the exact set so any new
    // import (a ranking module, a benchmark formatter) fails here first.
    const source = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../apps/email-worker/src/preference-digest-email.ts',
      ),
      'utf8',
    );
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    expect(specifiers.sort()).toEqual([
      '../../../packages/core-domain/src/digest/digest.types',
      './templates',
    ]);
  });
});
