/**
 * Merchant reliability scoring (tasks 3.5–3.6) — worker re-host of
 * MerchantReliabilityService (packages/application-api/src/merchants/).
 *
 * Assembles each score from the factual inputs available on D1:
 * - per-merchant offer aggregates over CURRENT offers
 *   (D1MerchantReliabilityRepository, task 2.5),
 * - the domain scoring rules (MerchantReliabilityScoreService — shares,
 *   strictest status),
 * - the merchant's governance permission status.
 *
 * GOVERNANCE FAIL-CLOSED (task 3.6 scope note): the source-governance
 * store has no D1 counterpart yet (no `source_governance` table was
 * ported in task 2.5), so the per-merchant permission check cannot
 * resolve. Exactly like the Nest service's unwired-port path (check
 * throws → caught → PENDING), every merchant degrades to PENDING —
 * permission is never overstated. The check resumes once the governance
 * table lands; see the ops governance route port for the same policy.
 *
 * Neutrality: scores are informational only — never a ranking input.
 *
 * @module MerchantReliabilityService
 */

import type { PermissionStatus } from '../../../../packages/core-domain/src/governance/source-governance.types';
import type { MerchantReliabilityScore } from '../../../../packages/core-domain/src/reliability/merchant-reliability-score.types';
import {
  MerchantReliabilityScoreService,
  ReliabilityService,
} from '../adapters/core-domain-bridge';
import { D1MerchantReliabilityRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-reliability.repository';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** Factual default when no governance record exists or the check fails. */
const UNKNOWN_PERMISSION_STATUS: PermissionStatus = 'PENDING';

/** Serialized score DTO — dates as ISO strings (merchants.dto parity). */
export interface MerchantReliabilityScoreDto {
  readonly merchant: string;
  readonly offerCount: number;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly statusShares: Readonly<Record<string, number>>;
  readonly strictestStatus: string;
  readonly freshestObservedAt: string | null;
  readonly governancePermissionStatus: PermissionStatus;
  readonly computedAt: string;
}

export type MerchantReliabilityMap = Record<string, MerchantReliabilityScoreDto>;

/** Serialize the domain score — dates become ISO strings (toDto parity). */
function toDto(score: MerchantReliabilityScore): MerchantReliabilityScoreDto {
  return {
    merchant: score.merchant,
    offerCount: score.offerCount,
    statusCounts: { ...score.statusCounts },
    statusShares: { ...score.statusShares },
    strictestStatus: score.strictestStatus,
    freshestObservedAt:
      score.freshestObservedAt === null
        ? null
        : score.freshestObservedAt.toISOString(),
    governancePermissionStatus: score.governancePermissionStatus,
    computedAt: score.computedAt.toISOString(),
  };
}

/** Score one aggregate — the governance input resolves fail-closed PENDING. */
function scoreAggregate(
  scoreService: MerchantReliabilityScoreService,
  aggregate: {
    merchant: string;
    offerCount: number;
    statusCounts: Readonly<Record<string, number>>;
    freshestObservedAt: Date;
  },
): MerchantReliabilityScoreDto {
  return toDto(
    scoreService.computeScore({
      merchant: aggregate.merchant,
      statusCounts: aggregate.statusCounts as MerchantReliabilityScore['statusCounts'],
      offerCount: aggregate.offerCount,
      freshestObservedAt: aggregate.freshestObservedAt,
      governancePermissionStatus: UNKNOWN_PERMISSION_STATUS,
    }),
  );
}

/**
 * Score DTOs for every merchant holding at least one current offer,
 * ordered by merchant ascending (the repository's deterministic order).
 */
export async function getReliabilityScores(
  d1: D1DatabaseLike,
): Promise<MerchantReliabilityScoreDto[]> {
  const scoreService = new MerchantReliabilityScoreService(new ReliabilityService());
  const aggregates = await new D1MerchantReliabilityRepository(d1).findCurrentOfferAggregates();
  return aggregates.map((aggregate) => scoreAggregate(scoreService, aggregate));
}

/**
 * Score map covering exactly the requested merchants that have
 * aggregates — a merchant with no current offers is simply absent.
 * Returns undefined when scoring fails — the search detail embed is
 * informational, so it is omitted rather than failing the response.
 */
export async function getMerchantReliabilityMap(
  d1: D1DatabaseLike,
  merchants: ReadonlySet<string>,
): Promise<MerchantReliabilityMap | undefined> {
  try {
    const scores = (await getReliabilityScores(d1)).filter((score) =>
      merchants.has(score.merchant),
    );
    const map: MerchantReliabilityMap = {};
    for (const score of scores) {
      map[score.merchant] = score;
    }
    return map;
  } catch {
    return undefined;
  }
}
