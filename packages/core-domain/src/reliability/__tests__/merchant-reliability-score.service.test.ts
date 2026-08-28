/**
 * MerchantReliabilityScoreService tests.
 *
 * High-liability coverage for the informational merchant score:
 *   - aggregation across EVERY status mix — all four single-status
 *     merchants, every mixed pair/triple/quad, and the zero-offer
 *     merchant (strictest UNAVAILABLE)
 *   - strictest-status composition lockstep against a real
 *     ReliabilityService.composeReliability (golden-dataset
 *     convention — real engines, no mocks)
 *   - share math exactness (count / offerCount)
 *   - input-contract rejection: unknown status keys, negative or
 *     non-integer counts, counts that do not sum to offerCount
 *   - passthrough fields (freshestObservedAt, governance status)
 *   - computedAt freshness
 *   - informational-only output shape (no grade, weight, or rank —
 *     the score must never grow a ranking input)
 *
 * @module MerchantReliabilityScoreServiceTest
 */

import { describe, it, expect } from 'vitest';
import { MerchantReliabilityScoreService } from '../merchant-reliability-score.service';
import {
  MerchantReliabilityInputError,
  type MerchantReliabilityScore,
  type MerchantReliabilityScoreInput,
} from '../merchant-reliability-score.types';
import { ReliabilityService } from '../reliability.service';
import {
  RELIABILITY_ORDER,
  type ReliabilityStatus,
} from '../reliability.types';
import type { PermissionStatus } from '../../governance/source-governance.types';

// ---------------------------------------------------------------------------
// Real instances (golden-dataset convention — no mocks)
// ---------------------------------------------------------------------------

const reliabilityService = new ReliabilityService();
const service = new MerchantReliabilityScoreService(reliabilityService);

// ---------------------------------------------------------------------------
// Status-mix enumeration — every non-empty subset of the four statuses
// ---------------------------------------------------------------------------

/**
 * Distinct positive weights assigned to the present statuses (in the
 * order they appear in RELIABILITY_ORDER) so every mix has a unique
 * count distribution and a non-trivial sum.
 */
const STATUS_WEIGHTS = [3, 1, 4, 2] as const;

interface StatusMixCase {
  /** Human-readable label, e.g. "VERIFIED + STALE". */
  label: string;
  /** Statuses with a positive count, in RELIABILITY_ORDER order. */
  present: ReliabilityStatus[];
  /** Full four-bucket counts (absent buckets zero-filled). */
  statusCounts: Record<ReliabilityStatus, number>;
  /** Sum of the counts — the valid offerCount for this mix. */
  offerCount: number;
  /** Independent oracle: the present status LATEST in RELIABILITY_ORDER. */
  expectedStrictest: ReliabilityStatus;
}

/** Build one case per non-empty subset of the four statuses (15 total). */
function buildStatusMixCases(): StatusMixCase[] {
  const cases: StatusMixCase[] = [];

  for (let mask = 1; mask < 1 << RELIABILITY_ORDER.length; mask++) {
    const present: ReliabilityStatus[] = [];
    const statusCounts: Record<ReliabilityStatus, number> = {
      VERIFIED: 0,
      ESTIMATED: 0,
      STALE: 0,
      UNAVAILABLE: 0,
    };
    let offerCount = 0;

    RELIABILITY_ORDER.forEach((status, index) => {
      if ((mask & (1 << index)) !== 0) {
        const weight = STATUS_WEIGHTS[present.length];
        present.push(status);
        statusCounts[status] = weight;
        offerCount += weight;
      }
    });

    // Independent oracle — NOT the service under test and NOT
    // ReliabilityService: the strictest status is the member of the
    // mix with the highest index in RELIABILITY_ORDER.
    const expectedStrictest = present.reduce((strictest, status) =>
      RELIABILITY_ORDER.indexOf(status) > RELIABILITY_ORDER.indexOf(strictest)
        ? status
        : strictest,
    );

    cases.push({
      label: present.join(' + '),
      present,
      statusCounts,
      offerCount,
      expectedStrictest,
    });
  }

  return cases;
}

const STATUS_MIX_CASES = buildStatusMixCases();

// ---------------------------------------------------------------------------
// Input fixture
// ---------------------------------------------------------------------------

/** Default valid aggregate — mirrors the shape produced by the repository. */
function scoreInput(
  overrides?: Partial<MerchantReliabilityScoreInput>,
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

// ---------------------------------------------------------------------------
// Aggregation across every status mix
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — aggregation across status mixes', () => {
  it.each(STATUS_MIX_CASES)('%s → strictest %s', (mix) => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: mix.statusCounts,
        offerCount: mix.offerCount,
      }),
    );

    // Independent-oracle assertion.
    expect(score.strictestStatus).toBe(mix.expectedStrictest);

    // Lockstep with the real ReliabilityService composition semantics.
    expect(score.strictestStatus).toBe(
      reliabilityService.composeReliability(mix.present),
    );

    // Normalized counts: all four buckets present, values preserved.
    expect(Object.keys(score.statusCounts).sort()).toEqual(
      [...RELIABILITY_ORDER].sort(),
    );
    for (const status of RELIABILITY_ORDER) {
      expect(score.statusCounts[status]).toBe(mix.statusCounts[status]);
    }
  });

  it.each(RELIABILITY_ORDER)('a pure %s merchant', (status) => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: {
          VERIFIED: 0,
          ESTIMATED: 0,
          STALE: 0,
          UNAVAILABLE: 0,
          [status]: 12,
        },
        offerCount: 12,
      }),
    );

    expect(score.strictestStatus).toBe(status);
    expect(score.statusShares[status]).toBe(1);
    for (const other of RELIABILITY_ORDER) {
      if (other !== status) {
        expect(score.statusShares[other]).toBe(0);
      }
    }
  });

  it('treats a zero-offer merchant as strictest UNAVAILABLE with all shares 0', () => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: { VERIFIED: 0, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
        offerCount: 0,
        freshestObservedAt: null,
      }),
    );

    // composeReliability([]) === 'UNAVAILABLE' — an empty merchant has no
    // better status to claim.
    expect(score.strictestStatus).toBe('UNAVAILABLE');
    expect(score.strictestStatus).toBe(
      reliabilityService.composeReliability([]),
    );
    for (const status of RELIABILITY_ORDER) {
      expect(score.statusShares[status]).toBe(0);
      expect(score.statusCounts[status]).toBe(0);
    }
    expect(score.freshestObservedAt).toBeNull();
  });

  it('defaults absent status keys to 0 in the normalized counts', () => {
    // The repository GROUP BY only emits rows for statuses that occur.
    const sparseCounts = { VERIFIED: 3 } as Record<ReliabilityStatus, number>;

    const score = service.computeScore(
      scoreInput({ statusCounts: sparseCounts, offerCount: 3 }),
    );

    expect(score.statusCounts).toEqual({
      VERIFIED: 3,
      ESTIMATED: 0,
      STALE: 0,
      UNAVAILABLE: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Share math exactness
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — share math', () => {
  it('computes binary-exact shares when the division terminates', () => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: { VERIFIED: 3, STALE: 1, ESTIMATED: 0, UNAVAILABLE: 0 },
        offerCount: 4,
      }),
    );

    expect(score.statusShares.VERIFIED).toBe(0.75);
    expect(score.statusShares.STALE).toBe(0.25);
    expect(score.statusShares.ESTIMATED).toBe(0);
    expect(score.statusShares.UNAVAILABLE).toBe(0);
  });

  it('computes the closest representable double for non-terminating shares', () => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: { VERIFIED: 1, STALE: 1, ESTIMATED: 1, UNAVAILABLE: 0 },
        offerCount: 3,
      }),
    );

    // Identical float operation (1 / 3) — exact equality is meaningful here.
    expect(score.statusShares.VERIFIED).toBe(1 / 3);
    expect(score.statusShares.STALE).toBe(1 / 3);
    expect(score.statusShares.ESTIMATED).toBe(1 / 3);
  });

  it.each(STATUS_MIX_CASES)('shares sum to 1 for mix %s', (mix) => {
    const score = service.computeScore(
      scoreInput({
        statusCounts: mix.statusCounts,
        offerCount: mix.offerCount,
      }),
    );

    const total = RELIABILITY_ORDER.reduce(
      (sum, status) => sum + score.statusShares[status],
      0,
    );
    expect(total).toBeCloseTo(1, 12);

    for (const status of RELIABILITY_ORDER) {
      expect(score.statusShares[status]).toBeGreaterThanOrEqual(0);
      expect(score.statusShares[status]).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — input contract', () => {
  it('rejects an unknown status key with MerchantReliabilityInputError', () => {
    // 'EXACT' is the documented legacy value persisted before the
    // vocabulary unification — it must be rejected, not coerced.
    const legacyCounts = {
      VERIFIED: 1,
      EXACT: 1,
    } as unknown as Record<ReliabilityStatus, number>;

    expect(() =>
      service.computeScore(scoreInput({ statusCounts: legacyCounts, offerCount: 2 })),
    ).toThrow(MerchantReliabilityInputError);
    expect(() =>
      service.computeScore(scoreInput({ statusCounts: legacyCounts, offerCount: 2 })),
    ).toThrow('Unknown reliability status "EXACT"');
  });

  it('rejects a negative count', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: -1, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 0,
        }),
      ),
    ).toThrow(MerchantReliabilityInputError);
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: -1, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 0,
        }),
      ),
    ).toThrow(/non-negative integer/);
  });

  it('rejects a non-integer count', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: 1, STALE: 1.5, ESTIMATED: 0, UNAVAILABLE: 0 },
          offerCount: 2,
        }),
      ),
    ).toThrow(MerchantReliabilityInputError);
  });

  it('rejects a NaN count', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: Number.NaN, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 1,
        }),
      ),
    ).toThrow(MerchantReliabilityInputError);
  });

  it('rejects counts that sum above offerCount', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: 5, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 4,
        }),
      ),
    ).toThrow(MerchantReliabilityInputError);
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: 5, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 4,
        }),
      ),
    ).toThrow('statusCounts sum (5) does not match offerCount (4)');
  });

  it('rejects counts that sum below offerCount', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: 3, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: 4,
        }),
      ),
    ).toThrow('statusCounts sum (3) does not match offerCount (4)');
  });

  it('rejects a negative offerCount via the sum invariant', () => {
    expect(() =>
      service.computeScore(
        scoreInput({
          statusCounts: { VERIFIED: 0, ESTIMATED: 0, STALE: 0, UNAVAILABLE: 0 },
          offerCount: -5,
        }),
      ),
    ).toThrow(MerchantReliabilityInputError);
  });

  it('treats a missing statusCounts record as all-zero (offerCount 0)', () => {
    const input = scoreInput({ offerCount: 0 });
    delete (input as { statusCounts?: unknown }).statusCounts;

    const score = service.computeScore(
      input as unknown as MerchantReliabilityScoreInput,
    );

    expect(score.strictestStatus).toBe('UNAVAILABLE');
    expect(score.offerCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Passthrough fields
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — passthrough fields', () => {
  it('passes freshestObservedAt through unchanged (Date and null)', () => {
    const observedAt = new Date('2026-08-25T12:00:00Z');

    const withDate = service.computeScore(
      scoreInput({ freshestObservedAt: observedAt }),
    );
    expect(withDate.freshestObservedAt).toBe(observedAt);

    const withoutDate = service.computeScore(
      scoreInput({ freshestObservedAt: null }),
    );
    expect(withoutDate.freshestObservedAt).toBeNull();
  });

  it.each<PermissionStatus>(['GRANTED', 'PENDING', 'REVOKED', 'EXPIRED'])(
    'passes governance status %s through unchanged',
    (governancePermissionStatus) => {
      const score = service.computeScore(scoreInput({ governancePermissionStatus }));
      expect(score.governancePermissionStatus).toBe(governancePermissionStatus);
    },
  );

  it('governance status never affects the aggregation', () => {
    const granted = service.computeScore(scoreInput({ governancePermissionStatus: 'GRANTED' }));
    const revoked = service.computeScore(scoreInput({ governancePermissionStatus: 'REVOKED' }));

    expect(revoked.strictestStatus).toBe(granted.strictestStatus);
    expect(revoked.statusShares).toEqual(granted.statusShares);
    expect(revoked.governancePermissionStatus).not.toBe(
      granted.governancePermissionStatus,
    );
  });

  it('passes merchant and offerCount through unchanged', () => {
    const score = service.computeScore(
      scoreInput({ merchant: 'baltic-brew', offerCount: 10 }),
    );
    expect(score.merchant).toBe('baltic-brew');
    expect(score.offerCount).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// computedAt freshness
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — computedAt freshness', () => {
  it('falls within the wall-clock window of the call', () => {
    const before = Date.now();
    const score = service.computeScore(scoreInput());
    const after = Date.now();

    expect(score.computedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(score.computedAt.getTime()).toBeLessThanOrEqual(after);
    expect(score.computedAt).toBeInstanceOf(Date);
  });

  it('is a fresh Date instance per computation', () => {
    const first = service.computeScore(scoreInput());
    const second = service.computeScore(scoreInput());

    expect(first.computedAt).not.toBe(second.computedAt);
  });
});

// ---------------------------------------------------------------------------
// Informational-only output shape
// ---------------------------------------------------------------------------

describe('MerchantReliabilityScoreService — informational-only shape', () => {
  it('carries exactly the documented fields — no grade, weight, or rank', () => {
    const score: MerchantReliabilityScore = service.computeScore(scoreInput());

    // Lockstep against the informational key set: if the score ever grows
    // a ranking-shaped field (weight, grade, boost, rank), this
    // exact-equality check fails.
    expect(new Set(Object.keys(score))).toEqual(
      new Set([
        'merchant',
        'offerCount',
        'statusCounts',
        'statusShares',
        'strictestStatus',
        'freshestObservedAt',
        'governancePermissionStatus',
        'computedAt',
      ]),
    );
  });
});
