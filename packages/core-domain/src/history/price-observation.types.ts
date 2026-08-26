/**
 * Price-observation types — the self-contained record appended to the
 * append-only observation log at price-ingestion time.
 *
 * One observation snapshots a single merchant retail offer at a point in
 * time: the foreign retail price, the transport offer selected for the
 * baseline route, the excise and container-duty rule versions effective at
 * the observation timestamp, the resulting quantity=1 baseline landed cost,
 * and the reliability status of every input that produced it.
 *
 * Observations are analytical rows, never mutated after append — the
 * attribution service (tax-change classification) is computed later from
 * these immutable stored inputs.
 *
 * @module PriceObservationTypes
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';
import type { CalculatorRetailOfferData } from '../calculator/calculator.types';

// ---------------------------------------------------------------------------
// Rule-version snapshot
// ---------------------------------------------------------------------------

/**
 * The tax-rule version an observation was computed against.
 *
 * Derived from the engine result (`ruleId` + `taxDatasetVersion`) — the
 * exact rule the engine applied, not a re-query. `null` when the engine
 * fell back to compiled-in defaults or the input was exempt (no rule row
 * was applied; the reliability snapshot records the degraded status).
 */
export interface TaxRuleVersionSnapshot {
  /** Tax-rule row ID (foreign-key reference into the versioned tax rules). */
  readonly ruleId: number;
  /** Version label of the applied rule (e.g. "2024-01"). */
  readonly versionLabel: string;
}

// ---------------------------------------------------------------------------
// Per-input reliability snapshot
// ---------------------------------------------------------------------------

/**
 * Reliability status of each externally sourced input to the observation.
 *
 * Snapshotted at observation time so later source changes never rewrite
 * what was known when the row was recorded.
 */
export interface ObservationInputReliability {
  /** Retail price input — status of the scraped merchant offer. */
  readonly retailPrice: ReliabilityStatus;
  /** Transport input — status of the selected transport offer (UNAVAILABLE when none matched). */
  readonly transport: ReliabilityStatus;
  /** Excise-rule input — status of the excise rule version effective at observedAt. */
  readonly exciseRule: ReliabilityStatus;
  /** Container-duty-rule input — status of the container-duty rule effective at observedAt. */
  readonly containerDutyRule: ReliabilityStatus;
}

// ---------------------------------------------------------------------------
// Observation record
// ---------------------------------------------------------------------------

/**
 * A single appended price observation.
 *
 * The landed cost is the quantity=1 baseline: unit retail price + unit
 * excise + unit container duty + the per-shipment transport cost — the same
 * composition the landed-cost calculator produces for quantity=1 with
 * identical inputs, because both run the identical engine code paths.
 */
export interface PriceObservation {
  /** Canonical product the offer belongs to. */
  readonly productId: number;
  /** Merchant identifier of the observed offer. */
  readonly merchant: string;
  /** Retail-offer row that was observed. */
  readonly retailOfferId: number;
  /** When the offer was observed (ingestion time, not append time). */
  readonly observedAt: Date;
  /** Foreign retail price for one unit, in euro-cents. */
  readonly foreignRetailPriceCents: number;
  /** Transport offer selected for the baseline route, or null when none was available. */
  readonly transportOfferId: number | null;
  /** Cost of the selected transport offer, in euro-cents (0 when unavailable). */
  readonly transportCostCents: number;
  /** Excise rule version effective at observedAt, or null on engine fallback. */
  readonly exciseRuleVersion: TaxRuleVersionSnapshot | null;
  /** Container-duty rule version effective at observedAt, or null on engine fallback. */
  readonly containerDutyRuleVersion: TaxRuleVersionSnapshot | null;
  /** Quantity=1 baseline landed cost, in euro-cents. */
  readonly landedCostCents: number;
  /** Reliability status of each input, snapshotted at observation time. */
  readonly inputReliability: ObservationInputReliability;
  /** Aggregate confidence derived from the per-input statuses. */
  readonly confidence: ConfidenceLevel;
}

/**
 * A persisted observation with its assigned row ID.
 */
export type RecordedPriceObservation = PriceObservation & {
  readonly id: number;
};

// ---------------------------------------------------------------------------
// Recorder input
// ---------------------------------------------------------------------------

/**
 * Input to {@link PriceObservationRecorderService.record}.
 *
 * The caller (the price-ingestion background job) supplies the changed
 * offer directly — the recorder never re-selects among offers, because one
 * observation is appended per changed merchant offer, not per best offer.
 */
export interface RecordObservationInput {
  /** Canonical product the observed offer belongs to. */
  readonly productId: number;
  /** The changed retail offer, in the calculator's read-model shape. */
  readonly offer: CalculatorRetailOfferData;
  /** Timestamp the offer was observed; tax rules resolve against this instant. */
  readonly observedAt: Date;
}
