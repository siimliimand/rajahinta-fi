/**
 * Reliability / Ranking neutrality lockstep tests.
 *
 * Verifies the merchant-reliability-scoring spec requirement: "The Ranking
 * & Sorting Module SHALL accept no score, reliability-aggregate, or
 * merchant-score field as input." The merchant reliability score is
 * informational only — it can never influence product placement.
 *
 * Mirrors the billing-isolation convention
 * (`packages/application-api/src/__tests__/billing-ranking-isolation.test.ts`).
 *
 * ## Enforcement layers
 *
 * 1. **Compile-time (type system):** `MerchantReliabilityScore` is
 *    structurally incompatible with `NeutralSortInput`, and
 *    `NeutralSortInput` declares no score, reliability-aggregate, or
 *    merchant-score field.
 *
 * 2. **Compile-time (module shape):** `RankingModule` and
 *    `RankingService` expose no score-computing or score-applying
 *    functionality.
 *
 * 3. **Runtime (guard):** `RankingService.rank()` rejects — via
 *    `guardNeutralInput()` — any item carrying a reliability-score
 *    property, including a real `MerchantReliabilityScore` computed by
 *    `MerchantReliabilityScoreService` (real instances, no mocks —
 *    golden-dataset convention).
 *
 * 4. **Runtime (static analysis):** source-file import scanning confirms
 *    the ranking module files contain no import (or reference) of the
 *    reliability score types, service, or module. The score output type
 *    shares no import path into the ranking module.
 *
 * 5. **Ordering invariance:** identical neutral inputs produce an
 *    identical order before and after the (parallel, external) merchant
 *    scores change — scores cannot alter placement even when held
 *    alongside the sort input.
 *
 * This test file itself imports the reliability score types to build
 * realistic score-carrying inputs — test files are not module source.
 *
 * @module ReliabilityRankingIsolationTests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RankingService } from '../ranking.service';
import { RankingModule } from '../ranking.module';
import type { NeutralSortInput, SortOrder } from '../ranking.types';

// Reliability score types/service — imported HERE (test file) only.
// The static import analysis below asserts the ranking module source
// never imports any of these.
import { MerchantReliabilityScoreService } from '../../reliability/merchant-reliability-score.service';
import { ReliabilityService } from '../../reliability/reliability.service';
import type {
  MerchantReliabilityScore,
  MerchantReliabilityScoreInput,
} from '../../reliability/merchant-reliability-score.types';

// ---------------------------------------------------------------------------
// Real instances (golden-dataset convention — no mocks)
// ---------------------------------------------------------------------------

const reliabilityService = new ReliabilityService();
const scoreService = new MerchantReliabilityScoreService(reliabilityService);
const rankingService = new RankingService();

/** Real score-input fixture — the shape produced by the data-platform repository. */
function scoreAggregateFixture(
  overrides: Partial<MerchantReliabilityScoreInput>,
): MerchantReliabilityScoreInput {
  return {
    merchant: 'estonian-wines',
    statusCounts: { VERIFIED: 8, STALE: 1, UNAVAILABLE: 1, ESTIMATED: 0 },
    offerCount: 10,
    freshestObservedAt: new Date('2026-08-20T08:00:00Z'),
    governancePermissionStatus: 'GRANTED',
    ...overrides,
  };
}

/** A real, computed merchant reliability score (informational output). */
const realScore: MerchantReliabilityScore = scoreService.computeScore(
  scoreAggregateFixture({}),
);

/** Neutral sort-input fixture — mirrors ranking.service.test.ts. */
function neutralItem(overrides?: Partial<NeutralSortInput>): NeutralSortInput {
  return {
    totalCents: 1990,
    volumeLitres: 0.5,
    quantity: 1,
    productName: 'Kotkan Vodka',
    alcoholByVolume: 37.5,
    category: 'spirits',
    ...overrides,
  };
}

/** Every objective sort order — mirrors tests/compliance/ranking-lockstep.test.ts. */
const ALL_SORT_ORDERS: SortOrder[] = [
  'LOWEST_LANDED_COST',
  'LOWEST_PER_LITRE',
  'LOWEST_PER_UNIT',
  'ALPHABETICAL',
  'ALCOHOL_PERCENTAGE',
  'PRODUCT_CATEGORY',
];

// ---------------------------------------------------------------------------
// Paths + patterns for static source-file analysis (billing-isolation mirror)
// ---------------------------------------------------------------------------

/** Ranking module source files to scan for reliability imports. */
const RANKING_DIR = resolve(__dirname, '..');
const RANKING_SOURCE_FILES = [
  resolve(RANKING_DIR, 'ranking.module.ts'),
  resolve(RANKING_DIR, 'ranking.service.ts'),
  resolve(RANKING_DIR, 'ranking.types.ts'),
  resolve(RANKING_DIR, 'ranking-config.service.ts'),
] as const;

/** Reliability-score import patterns (module paths, type/service names). */
const RELIABILITY_PATTERNS = [
  /from\s+['"].*reliability['"]/,
  /from\s+['"].*\/reliability/,
  /merchant-reliability-score/,
  /MerchantReliabilityScore/,
  /MerchantReliabilityInputError/,
  /ReliabilityService/,
  /ReliabilityModule/,
  /ReliabilityStatus/,
  /reliabilityScore/,
  /merchantReliabilityScore/,
] as const;

/**
 * Scan a source file for any of the given regex patterns.
 * Returns the list of matched lines (empty = clean).
 * Replicates the billing-isolation test's scanner exactly.
 */
function findMatchingLines(
  filePath: string,
  patterns: readonly RegExp[],
): { line: number; text: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const matches: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip comment lines and blank lines
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '') {
      continue;
    }
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        matches.push({ line: i + 1, text: trimmed });
        break;
      }
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// 1. Compile-time: type incompatibility
// ---------------------------------------------------------------------------

describe('compile-time type incompatibility', () => {
  it('proves MerchantReliabilityScore is NOT assignable to NeutralSortInput', () => {
    // @ts-expect-error — MerchantReliabilityScore has merchant, offerCount,
    // statusCounts etc., none of which are fields on NeutralSortInput. If
    // this assignment compiles without error, the score output type has
    // leaked into the ranking input contract.
    const _check: NeutralSortInput = realScore;
    expect(true).toBe(true);
  });

  it('proves a score-carrying literal is rejected by excess property checking', () => {
    // @ts-expect-error — merchantReliabilityScore is not a NeutralSortInput
    // field; the object literal fails excess property checking at the
    // assignment site.
    const _check: NeutralSortInput = { totalCents: 1990, volumeLitres: 0.5, quantity: 1, productName: 'Scored', alcoholByVolume: 37.5, category: 'spirits', merchantReliabilityScore: realScore };
    expect(true).toBe(true);
  });

  it('proves a score-carrying literal is rejected at the rank() call site', () => {
    // @ts-expect-error — reliabilityScore is not a NeutralSortInput field;
    // the type system rejects the argument before the runtime guard is
    // even reached. (The runtime guard catches the type-system bypass.)
    expect(() => rankingService.rank([{ totalCents: 1990, volumeLitres: 0.5, quantity: 1, productName: 'Scored', alcoholByVolume: 37.5, category: 'spirits', reliabilityScore: 0.9 }], 'ALPHABETICAL')).toThrow(TypeError);
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Compile-time: module shape — no score functionality on ranking
// ---------------------------------------------------------------------------

describe('compile-time module shape proof', () => {
  it('proves RankingModule does not expose score functionality', () => {
    const proto = RankingModule.prototype as Record<string, unknown>;

    // Score-computing/applying operations — if any exist on RankingModule,
    // the separation has been breached.
    const scoreMethods = [
      'computeScore',
      'scoreMerchant',
      'applyScore',
      'applyReliabilityWeight',
      'weightByReliability',
      'boostMerchant',
    ];
    for (const method of scoreMethods) {
      expect(proto).not.toHaveProperty(method);
    }
  });

  it('proves RankingService has no score-computing method', () => {
    const proto = RankingService.prototype as unknown as Record<string, unknown>;

    for (const method of [
      'computeScore',
      'scoreMerchant',
      'applyScore',
      'weightByReliability',
      'boostMerchant',
    ]) {
      expect(proto).not.toHaveProperty(method);
    }

    // The single sorting entrypoint remains rank().
    expect(proto).toHaveProperty('rank');
  });
});

// ---------------------------------------------------------------------------
// 3. Compile-time: no score fields leak into the ranking input type
// ---------------------------------------------------------------------------

describe('compile-time ranking input neutrality', () => {
  it('proves NeutralSortInput has no score-related field', () => {
    // If NeutralSortInput ever gains one of these fields, the conditional
    // type resolves to `never` and the assignment below fails to compile.
    type _NoScoreField = NeutralSortInput extends { score: number }
      ? never
      : true;
    type _NoReliabilityScoreField = NeutralSortInput extends {
      reliabilityScore: number;
    }
      ? never
      : true;
    type _NoMerchantScoreField = NeutralSortInput extends {
      merchantScore: number;
    }
      ? never
      : true;
    type _NoReliabilityAggregateField = NeutralSortInput extends {
      reliabilityAggregate: unknown;
    }
      ? never
      : true;
    type _NoMerchantReliabilityScoreField = NeutralSortInput extends {
      merchantReliabilityScore: MerchantReliabilityScore;
    }
      ? never
      : true;

    // Runtime assertion: all guards resolved to `true`
    const _scoreCheck: _NoScoreField = true;
    const _reliabilityScoreCheck: _NoReliabilityScoreField = true;
    const _merchantScoreCheck: _NoMerchantScoreField = true;
    const _aggregateCheck: _NoReliabilityAggregateField = true;
    const _merchantReliabilityCheck: _NoMerchantReliabilityScoreField = true;
    expect(
      _scoreCheck &&
        _reliabilityScoreCheck &&
        _merchantScoreCheck &&
        _aggregateCheck &&
        _merchantReliabilityCheck,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Runtime: guard rejects score-carrying inputs (spec scenario a)
// ---------------------------------------------------------------------------

describe('runtime guard: rank() rejects score-carrying input', () => {
  it('rejects an item carrying a real MerchantReliabilityScore under "merchantReliabilityScore"', () => {
    // `as` simulates a bypassed type system — the runtime guard must
    // still catch the leaked score.
    const items = [
      { ...neutralItem(), merchantReliabilityScore: realScore },
    ] as unknown as NeutralSortInput[];

    expect(() => rankingService.rank(items, 'LOWEST_LANDED_COST')).toThrow(
      TypeError,
    );
    expect(() => rankingService.rank(items, 'LOWEST_LANDED_COST')).toThrow(
      'NeutralSortInput guard: unknown property "merchantReliabilityScore"',
    );
  });

  it('rejects an item carrying a real MerchantReliabilityScore under "reliabilityScore"', () => {
    const items = [
      { ...neutralItem(), reliabilityScore: realScore },
    ] as unknown as NeutralSortInput[];

    expect(() => rankingService.rank(items, 'ALPHABETICAL')).toThrow(TypeError);
    expect(() => rankingService.rank(items, 'ALPHABETICAL')).toThrow(
      'NeutralSortInput guard: unknown property "reliabilityScore"',
    );
  });

  it('rejects the spec-named fields: score, reliabilityAggregate, merchantScore', () => {
    const specFields: Array<[string, unknown]> = [
      ['score', 0.87],
      ['reliabilityAggregate', realScore],
      ['merchantScore', 0.42],
    ];

    for (const [key, value] of specFields) {
      const items = [{ ...neutralItem(), [key]: value }] as NeutralSortInput[];
      expect(
        () => rankingService.rank(items, 'LOWEST_LANDED_COST'),
        `field "${key}" must be rejected`,
      ).toThrow(TypeError);
      expect(
        () => rankingService.rank(items, 'LOWEST_LANDED_COST'),
        `field "${key}" must be named in the error`,
      ).toThrow(`unknown property "${key}"`);
    }
  });

  it('rejects a bare MerchantReliabilityScore passed directly as a sort item', () => {
    const items = [realScore] as unknown as readonly NeutralSortInput[];
    expect(() => rankingService.rank(items, 'ALPHABETICAL')).toThrow(TypeError);
    expect(() => rankingService.rank(items, 'ALPHABETICAL')).toThrow(
      /NeutralSortInput guard: unknown property "/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Runtime: static import analysis — ranking → reliability prohibited
// ---------------------------------------------------------------------------

describe('static import analysis: ranking → reliability score', () => {
  for (const filePath of RANKING_SOURCE_FILES) {
    const fileName = filePath.split('/').pop()!;

    it(`${fileName} has no import of reliability score types/services`, () => {
      const matches = findMatchingLines(filePath, RELIABILITY_PATTERNS);
      expect(matches).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Write-path audit
// ---------------------------------------------------------------------------

describe('write-path audit', () => {
  it('rank() accepts exactly NeutralSortInput — no score item type', () => {
    type _RankItem = Parameters<RankingService['rank']>[0][number];

    // Mutual assignability proves the item type is exactly
    // NeutralSortInput (no widened score-carrying variant).
    type _RankItemIsNeutral = _RankItem extends NeutralSortInput
      ? NeutralSortInput extends _RankItem
        ? true
        : never
      : never;

    const _check: _RankItemIsNeutral = true;
    expect(_check).toBe(true);
  });

  it('a real MerchantReliabilityScore is not a rank() item', () => {
    type RankItem = Parameters<RankingService['rank']>[0][number];

    // @ts-expect-error — if this compiles, the score output type can be
    // passed straight into rank() and the isolation is breached.
    const _scoreItem: RankItem = realScore;

    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Runtime: ordering invariance — scores cannot alter placement
//    (spec scenario b: same products, same order before/after scores change)
// ---------------------------------------------------------------------------

describe('ordering invariance: merchant scores cannot alter placement', () => {
  // Neutral fixtures with a deliberate totalCents tie (Aalto/Valio at
  // 1490) so every sort order resolves fully via the alphabetical
  // tiebreaker — the expected order is deterministic.
  const items: NeutralSortInput[] = [
    { totalCents: 2500, volumeLitres: 0.75, quantity: 6, productName: 'Baltic Porter', alcoholByVolume: 7.2, category: 'beer' },
    { totalCents: 1490, volumeLitres: 0.5, quantity: 6, productName: 'Aalto Lager', alcoholByVolume: 4.7, category: 'beer' },
    { totalCents: 1890, volumeLitres: 0.33, quantity: 24, productName: 'Saaremaa Cider', alcoholByVolume: 4.5, category: 'cider' },
    { totalCents: 1490, volumeLitres: 1.0, quantity: 1, productName: 'Tallinna Glögi', alcoholByVolume: 12.0, category: 'wine' },
  ];

  /** Real per-merchant scores held in a PARALLEL record — never in the sort input. */
  function initialScores(): Record<string, MerchantReliabilityScore> {
    return {
      'Aalto Lager': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'aalto-olut',
        statusCounts: { VERIFIED: 10, STALE: 0, UNAVAILABLE: 0, ESTIMATED: 0 },
      })),
      'Baltic Porter': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'baltic-brew',
        statusCounts: { VERIFIED: 1, STALE: 5, UNAVAILABLE: 4, ESTIMATED: 0 },
      })),
      'Saaremaa Cider': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'saare-cider',
        statusCounts: { VERIFIED: 0, STALE: 2, UNAVAILABLE: 8, ESTIMATED: 0 },
      })),
      'Tallinna Glögi': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'tallinn-glogi',
        statusCounts: { VERIFIED: 5, STALE: 5, UNAVAILABLE: 0, ESTIMATED: 0 },
      })),
    };
  }

  /** The same merchants re-scored with every aggregate inverted (best↔worst). */
  function invertedScores(): Record<string, MerchantReliabilityScore> {
    return {
      'Aalto Lager': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'aalto-olut',
        statusCounts: { VERIFIED: 0, STALE: 2, UNAVAILABLE: 8, ESTIMATED: 0 },
      })),
      'Baltic Porter': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'baltic-brew',
        statusCounts: { VERIFIED: 10, STALE: 0, UNAVAILABLE: 0, ESTIMATED: 0 },
      })),
      'Saaremaa Cider': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'saare-cider',
        statusCounts: { VERIFIED: 9, STALE: 1, UNAVAILABLE: 0, ESTIMATED: 0 },
      })),
      'Tallinna Glögi': scoreService.computeScore(scoreAggregateFixture({
        merchant: 'tallinn-glogi',
        statusCounts: { VERIFIED: 0, STALE: 4, UNAVAILABLE: 6, ESTIMATED: 0 },
      })),
    };
  }

  it.each<SortOrder>(ALL_SORT_ORDERS)(
    '%s: identical order before and after merchant scores change',
    (order) => {
      const before = rankingService
        .rank(items, order)
        .map((item) => item.productName);

      // Scores change drastically between the two rank() calls —
      // computed here (between them) and held only in the parallel
      // record, never inside the sort input.
      const beforeScores = initialScores();
      const afterScores = invertedScores();
      expect(beforeScores['Aalto Lager'].statusShares.VERIFIED).toBe(1);
      expect(afterScores['Aalto Lager'].statusShares.VERIFIED).toBe(0);
      expect(afterScores['Baltic Porter'].statusShares.VERIFIED).toBe(1);

      const after = rankingService
        .rank(items, order)
        .map((item) => item.productName);

      expect(after).toEqual(before);
    },
  );

  it('ranked output items carry exactly the six neutral keys', () => {
    // Lockstep against the neutral key set: if ranking's input/output
    // shape ever gains a score key, this exact-equality check fails.
    const expectedKeys = new Set([
      'totalCents',
      'volumeLitres',
      'quantity',
      'productName',
      'alcoholByVolume',
      'category',
    ]);

    const sorted = rankingService.rank(items, 'LOWEST_LANDED_COST');
    expect(sorted).toHaveLength(items.length);
    for (const item of sorted) {
      expect(new Set(Object.keys(item))).toEqual(expectedKeys);
    }
  });
});
