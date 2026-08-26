/**
 * Historical-data DTOs — request/response shapes for the price-history API.
 *
 * Pure interfaces with no NestJS or swagger coupling so they can be shared
 * with API client packages or alternative frontends (mirrored by
 * apps/frontend/src/lib in task 5.1).
 *
 * Guardrails embedded in the shape:
 * - every series point carries the reliability of the observations behind it
 *   (architecture rule: every externally sourced fact carries a reliability
 *   status and timestamp);
 * - attribution entries are evidence (which inputs moved, which rule-version
 *   labels bound the step), not conclusions — the API states what changed,
 *   never which merchant is "better";
 * - only the requested metric's numbers are returned (data minimization).
 *
 * @module HistoricalDto
 */

import type {
  ReliabilityStatus,
  StepClassification,
} from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Request vocabulary
// ---------------------------------------------------------------------------

/** Which summary series to return. */
export type PriceHistoryMetric = 'price' | 'landed-cost';

/** Bucket granularity (API vocabulary; summary rows store daily/weekly). */
export type PriceHistoryGranularity = 'day' | 'week';

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** One chart point, projected from a summary bucket for the requested metric. */
export interface PriceHistoryPoint {
  /** Bucket start anchor, ISO date 'YYYY-MM-DD' (Monday for weekly buckets). */
  readonly periodStart: string;
  /** Metric value (cents) at the bucket's earliest observation. */
  readonly openCents: number;
  /** Metric value (cents) at the bucket's latest observation. */
  readonly closeCents: number;
  /** Minimum metric value (cents) within the bucket. */
  readonly minCents: number;
  /** Maximum metric value (cents) within the bucket. */
  readonly maxCents: number;
  /** Average metric value (cents), rounded half-up by the aggregation job. */
  readonly avgCents: number;
  /** Number of raw observations aggregated into this bucket. */
  readonly observationCount: number;
  /** Strictest reliability among the bucket's observations. */
  readonly reliability: ReliabilityStatus;
}

/** Which cost inputs of an attributed step changed between two observations. */
export interface PriceHistoryMovedInputs {
  readonly exciseRule: boolean;
  readonly containerDutyRule: boolean;
  readonly merchantPrice: boolean;
  readonly transport: boolean;
}

/** Rule-version labels bounding a crossed version boundary. */
export interface PriceHistoryRuleBoundary {
  readonly fromVersionLabel: string | null;
  readonly toVersionLabel: string | null;
}

/**
 * One classified change between consecutive observations of a single
 * merchant series — evidence only, no comparison or ranking semantics.
 */
export interface PriceHistoryAttribution {
  /** Merchant whose observation series the step belongs to. */
  readonly merchant: string;
  readonly classification: StepClassification;
  /** ISO timestamp of the earlier observation in the pair. */
  readonly fromObservedAt: string;
  /** ISO timestamp of the later observation in the pair. */
  readonly toObservedAt: string;
  readonly movedInputs: PriceHistoryMovedInputs;
  readonly exciseRuleBoundary: PriceHistoryRuleBoundary | null;
  readonly containerDutyRuleBoundary: PriceHistoryRuleBoundary | null;
}

/** GET /api/v1/products/:id/price-history — chart series with provenance. */
export interface PriceHistoryResponse {
  readonly productId: number;
  /** Requested merchant filter, or null for the product-wide series. */
  readonly merchant: string | null;
  readonly metric: PriceHistoryMetric;
  readonly granularity: PriceHistoryGranularity;
  /** Effective range start, ISO date 'YYYY-MM-DD'. */
  readonly from: string;
  /** Effective range end (inclusive), ISO date 'YYYY-MM-DD'. */
  readonly to: string;
  /** Summary points for the requested metric — raw observations are never aggregated on the request path. */
  readonly series: readonly PriceHistoryPoint[];
  /** Classified changes within the range, ordered by toObservedAt ascending. */
  readonly attribution: readonly PriceHistoryAttribution[];
  /**
   * Earliest observation timestamp for this product (merchant-filtered when
   * a merchant was requested), or null when none exist — lets the UI show
   * "data available from" for truncated history.
   */
  readonly earliestAvailableObservationDate: string | null;
}
