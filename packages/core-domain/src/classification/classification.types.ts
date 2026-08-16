/**
 * Transaction Classification types.
 *
 * The classification module is the platform's most important proprietary logic —
 * it determines the legal framework (distance selling, distance buying, or
 * traveller import) under which a cross-border beverage purchase falls.
 *
 * @module ClassificationTypes
 */

// ---------------------------------------------------------------------------
// Classification labels
// ---------------------------------------------------------------------------

/**
 * The three transaction classifications recognised by Finnish excise law for
 * cross-border alcohol purchases.
 *
 * - `DistanceSelling` — The seller arranges transport and is liable for
 *   Finnish excise duties (EU distance-selling rules, Alcohol Act 1102/2017).
 * - `DistanceBuying` — The buyer arranges transport and is liable for duties
 *   upon import (Tax Administration guidance VH/5088/00.01.00/2021).
 * - `TravellerImport` — The buyer physically carries goods across the border;
 *   duty-free allowances apply (Alcohol Act 1102/2017, chapter 5).
 */
export type ClassificationLabel = 'DistanceSelling' | 'DistanceBuying' | 'TravellerImport';

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Certainty of a classification result.
 *
 * - `HIGH` — All required signals present and unambiguous.
 * - `MEDIUM` — Most signals present but one dimension inferred or missing.
 * - `LOW` — Significant signal missing; classification is a best-effort guess.
 */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

// ---------------------------------------------------------------------------
// Module inputs
// ---------------------------------------------------------------------------

/**
 * All data required to classify a transaction.
 *
 * Designed for data minimisation — every field is consumed by at least one
 * rule in the current rule set.  Raw transport fields are passed to
 * {@link TransportClassificationService} internally; the consumer does not
 * need to pre-classify the transport type.
 */
export interface ClassificationInput {
  /** `true` when the seller selected/paid the carrier (from TransportOffer). */
  readonly sellerInvolvementIndicator: boolean;

  /** Carrier identifier (e.g. 'posti', 'dhl') or empty string when unknown. */
  readonly carrierId: string;

  /** ISO 3166-1 alpha-2 seller country code (e.g. 'DE', 'GB'). */
  readonly sellerCountry: string;

  /** ISO 3166-1 alpha-2 buyer country code (always 'FI' for this platform). */
  readonly buyerCountry: string;

  /**
   * Whether the buyer physically carried the goods across the border
   * (e.g. a shopper returning from Estonia).  `false` when unknown.
   */
  readonly buyerIsTravelling: boolean;

  /**
   * Seller identifier (e.g. business ID or name), used for future rule
   * versioning and known-seller short-circuit. May be empty when unknown.
   */
  readonly sellerId: string;
}

// ---------------------------------------------------------------------------
// Module output
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence supporting a classification decision.
 *
 * Every classification result must include at least one evidence detail.
 * Evidence is always phrased as an observed pattern with supporting data —
 * never as a bare legal conclusion.
 */
export interface EvidenceDetail {
  /**
   * Human-readable description of what was observed.
   *
   * Phrased as a factual observation, e.g.
   * "Buyer arranged transport via independent carrier" or
   * "Buyer indicated they are travelling".
   */
  readonly observation: string;

  /**
   * Specific data values supporting the observation.
   *
   * e.g. "carrier: dhl", "destination: DE", "duration: 3 days"
   */
  readonly supportingData: string;

  /**
   * Origin of this evidence — a rule name, field name, or service label.
   *
   * e.g. "TravellerImport", "buyerIsTravelling", "TransportClassification"
   */
  readonly source: string;
}

/**
 * The result of a classification decision.
 *
 * Every result includes:
 * - A structured `evidence` array with one or more observed patterns
 * - An auto-generated `evidenceSummary` paragraph derived from the evidence array
 *
 * The evidenceSummary can be shown directly to end users or auditors.
 * Never display a bare legal conclusion without its supporting evidence.
 */
export interface ClassificationResult {
  readonly classification: ClassificationLabel;
  readonly confidence: ConfidenceLevel;
  readonly evidence: EvidenceDetail[];
  readonly evidenceSummary: string;
}