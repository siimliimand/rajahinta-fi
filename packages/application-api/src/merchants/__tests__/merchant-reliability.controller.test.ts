/**
 * MerchantReliabilityController tests — endpoint shape and gating
 * (task 6.2, change phase2-advanced-features).
 *
 * Exercises the controller through a REAL MerchantReliabilityService wired
 * exactly like MerchantsModule does: the real core-domain
 * MerchantReliabilityScoreService (engine) over the real
 * SourceGovernanceService, an in-memory MerchantReliabilityRepository
 * double (plain class), and a no-records governance repository double —
 * which is precisely the state that exercises the documented PENDING
 * fallback (permission is never overstated). No vi.fn().
 *
 * Asserts the response mirrors the aggregate → score mapping with ISO
 * timestamps and controlled-vocabulary keys only, and (per the sibling
 * guard-regression convention) that the endpoint is dark while
 * ADVANCED_FEATURES is off and behind the PRICE_DATA launch gate.
 *
 * @module MerchantReliabilityControllerTest
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  MerchantReliabilityScoreService,
  ReliabilityService,
  SourceGovernanceService,
  type ISourceGovernanceRepository,
  type PermissionStatus,
} from '@rajahinta/core-domain';
import {
  MerchantReliabilityRepository,
  type MerchantReliabilityAggregate,
} from '@rajahinta/data-platform';
import { MerchantReliabilityService } from '../merchant-reliability.service';
import { MerchantReliabilityController } from '../merchants.controller';
import {
  FeatureFlagGuard,
  FeatureFlag,
  FEATURE_FLAG_KEY,
  LaunchGateGuard,
  LaunchGateType,
  LAUNCH_GATE_KEY,
} from '../../feature-flags';
import { FeatureFlagService } from '../../feature-flags/feature-flag.service';
import { LaunchGateService } from '../../feature-flags/launch-gate.service';
import { AgeGateGuard } from '../../age-gate/age-gate.guard';

// ---------------------------------------------------------------------------
// Fixtures — aggregates exactly as the Drizzle grouping emits them
// ---------------------------------------------------------------------------

const FRESHEST_A = new Date('2026-08-20T10:00:00.000Z');
const FRESHEST_B = new Date('2026-08-19T18:30:00.000Z');

const AGGREGATES: MerchantReliabilityAggregate[] = [
  {
    merchant: 'a-beverage-de',
    offerCount: 3,
    statusCounts: { VERIFIED: 2, ESTIMATED: 1, STALE: 0, UNAVAILABLE: 0 },
    freshestObservedAt: FRESHEST_A,
  },
  {
    merchant: 'b-systembolaget',
    offerCount: 3,
    statusCounts: { VERIFIED: 1, ESTIMATED: 0, STALE: 2, UNAVAILABLE: 0 },
    freshestObservedAt: FRESHEST_B,
  },
];

/** In-memory reliability-aggregate repository double (plain class). */
class InMemoryMerchantReliabilityRepository extends MerchantReliabilityRepository {
  constructor(private readonly rows: MerchantReliabilityAggregate[]) {
    super();
  }

  async findCurrentOfferAggregates(): Promise<
    MerchantReliabilityAggregate[]
  > {
    return [...this.rows];
  }
}

/**
 * Governance repository with NO registered sources — the factual state that
 * must surface as PENDING, never GRANTED.
 */
class NoRecordsGovernanceRepository implements ISourceGovernanceRepository {
  async create(): Promise<never> {
    throw new Error('not used in this test');
  }
  async updateStatus(): Promise<null> {
    return null;
  }
  async revokeAllByMerchantId(): Promise<number> {
    return 0;
  }
  async findByMerchantId(): Promise<never[]> {
    return [];
  }
  async findById(): Promise<null> {
    return null;
  }
  async checkPermission(merchantId: string): Promise<{
    merchantId: string;
    permissionStatus: PermissionStatus;
    sources: never[];
    hasWarnings: boolean;
  }> {
    return {
      merchantId,
      permissionStatus: 'PENDING',
      sources: [],
      hasWarnings: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Harness — real service pipeline, controller-level
// ---------------------------------------------------------------------------

function createController(
  rows: MerchantReliabilityAggregate[] = AGGREGATES,
): MerchantReliabilityController {
  return new MerchantReliabilityController(
    new MerchantReliabilityService(
      new InMemoryMerchantReliabilityRepository(rows),
      new MerchantReliabilityScoreService(new ReliabilityService()),
      new SourceGovernanceService(new NoRecordsGovernanceRepository()),
    ),
  );
}

/** The four-status controlled vocabulary in canonical order. */
const STATUS_KEYS = ['VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE'];

// ---------------------------------------------------------------------------
// Tests — response shape
// ---------------------------------------------------------------------------

describe('MerchantReliabilityController — GET /api/v1/merchants/reliability', () => {
  it('wraps the scores in { merchants }', async () => {
    const response = await createController().getReliability();
    expect(Object.keys(response)).toEqual(['merchants']);
    expect(response.merchants).toHaveLength(2);
  });

  it('returns one score per merchant, ordered by merchant ascending', async () => {
    const { merchants } = await createController().getReliability();
    expect(merchants.map((m) => m.merchant)).toEqual([
      'a-beverage-de',
      'b-systembolaget',
    ]);
  });

  it('each score carries exactly the DTO keys — nothing more', async () => {
    const { merchants } = await createController().getReliability();
    for (const score of merchants) {
      expect(Object.keys(score).sort()).toEqual([
        'computedAt',
        'freshestObservedAt',
        'governancePermissionStatus',
        'merchant',
        'offerCount',
        'statusCounts',
        'statusShares',
        'strictestStatus',
      ]);
    }
  });

  it('statusCounts uses only the controlled vocabulary and sums to offerCount', async () => {
    const { merchants } = await createController().getReliability();
    for (const score of merchants) {
      expect(Object.keys(score.statusCounts).sort()).toEqual([...STATUS_KEYS].sort());
      const sum = STATUS_KEYS.reduce(
        (acc, key) => acc + score.statusCounts[key as keyof typeof score.statusCounts],
        0,
      );
      expect(sum).toBe(score.offerCount);
    }
  });

  it('statusShares are exact ratios in [0, 1] summing to 1', async () => {
    const { merchants } = await createController().getReliability();
    for (const score of merchants) {
      let shareSum = 0;
      for (const key of STATUS_KEYS) {
        const share = score.statusShares[key as keyof typeof score.statusShares];
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
        shareSum += share;
      }
      expect(shareSum).toBeCloseTo(1, 10);
    }
  });

  it('maps the aggregate verbatim: counts, shares, and strictest status', async () => {
    const { merchants } = await createController().getReliability();
    const [a, b] = merchants as [
      (typeof merchants)[number],
      (typeof merchants)[number],
    ];

    // a-beverage-de: 2 VERIFIED + 1 ESTIMATED → shares 2/3, 1/3, strictest ESTIMATED.
    expect(a.offerCount).toBe(3);
    expect(a.statusCounts).toEqual({
      VERIFIED: 2,
      ESTIMATED: 1,
      STALE: 0,
      UNAVAILABLE: 0,
    });
    expect(a.statusShares.ESTIMATED).toBeCloseTo(1 / 3, 10);
    expect(a.statusShares.VERIFIED).toBeCloseTo(2 / 3, 10);
    expect(a.strictestStatus).toBe('ESTIMATED');

    // b-systembolaget: STALE dominates → strictest STALE.
    expect(b.strictestStatus).toBe('STALE');
    expect(b.statusShares.STALE).toBeCloseTo(2 / 3, 10);
  });

  it('serializes every date as an ISO 8601 string — Date never crosses the boundary', async () => {
    const { merchants } = await createController().getReliability();
    for (const score of merchants) {
      expect(score.freshestObservedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(score.computedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      expect(new Date(score.computedAt).getTime()).not.toBeNaN();
    }
  });

  it('freshestObservedAt mirrors the aggregate value', async () => {
    const { merchants } = await createController().getReliability();
    expect(merchants[0].freshestObservedAt).toBe(FRESHEST_A.toISOString());
    expect(merchants[1].freshestObservedAt).toBe(FRESHEST_B.toISOString());
  });

  it('governance with no records degrades to PENDING — never GRANTED', async () => {
    const { merchants } = await createController().getReliability();
    for (const score of merchants) {
      expect(score.governancePermissionStatus).toBe('PENDING');
    }
  });

  it('returns an empty list when no merchant holds a current offer', async () => {
    const response = await createController([]).getReliability();
    expect(response.merchants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests — gating (launch gate, flag, age gate) per the guard-regression
// convention
// ---------------------------------------------------------------------------

/** NestJS internal metadata key for guards applied via @UseGuards. */
const GUARDS_METADATA = '__guards__';

const HANDLER = MerchantReliabilityController.prototype.getReliability;

function context(
  request: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getHandler: () => HANDLER,
    getClass: () => MerchantReliabilityController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: () => undefined }),
    }),
    getArgs: () => [],
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

describe('MerchantReliabilityController — gating', () => {
  const reflector = new Reflector();
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FF_ADVANCED_FEATURES;
    delete process.env.LAUNCH_GATES_OVERRIDE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('class guard order is LaunchGateGuard → AgeGateGuard → FeatureFlagGuard', () => {
    const guards = reflector.getAllAndOverride<unknown[]>(GUARDS_METADATA, [
      HANDLER,
      MerchantReliabilityController,
    ]);
    expect(guards).toHaveLength(3);
    expect(guards).toEqual([LaunchGateGuard, AgeGateGuard, FeatureFlagGuard]);
  });

  it('carries the PRICE_DATA launch gate and the ADVANCED_FEATURES flag', () => {
    expect(
      reflector.getAllAndOverride<LaunchGateType>(LAUNCH_GATE_KEY, [
        HANDLER,
        MerchantReliabilityController,
      ]),
    ).toBe(LaunchGateType.PRICE_DATA);
    expect(
      reflector.getAllAndOverride<FeatureFlag>(FEATURE_FLAG_KEY, [
        HANDLER,
        MerchantReliabilityController,
      ]),
    ).toBe(FeatureFlag.ADVANCED_FEATURES);
  });

  it('LaunchGateGuard rejects while the launch gates are closed (default)', () => {
    const guard = new LaunchGateGuard(reflector, new LaunchGateService());
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
  });

  it('LaunchGateGuard allows with LAUNCH_GATES_OVERRIDE=true', () => {
    process.env.LAUNCH_GATES_OVERRIDE = 'true';
    const guard = new LaunchGateGuard(reflector, new LaunchGateService());
    expect(guard.canActivate(context())).toBe(true);
  });

  it('FeatureFlagGuard rejects with 403 while ADVANCED_FEATURES is off', () => {
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
    try {
      guard.canActivate(context());
      expect.unreachable('Expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toMatch(/ADVANCED_FEATURES/);
    }
  });

  it('FeatureFlagGuard allows once FF_ADVANCED_FEATURES=true', () => {
    process.env.FF_ADVANCED_FEATURES = 'true';
    const guard = new FeatureFlagGuard(reflector, new FeatureFlagService());
    expect(guard.canActivate(context())).toBe(true);
  });
});
