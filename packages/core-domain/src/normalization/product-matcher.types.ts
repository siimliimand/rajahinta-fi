/**
 * Product matcher types — match results and confidence levels.
 *
 * @module ProductMatcherTypes
 */

/** Confidence level of a product match. */
export type MatchConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/** Method used to arrive at a match. */
export type MatchMethod = 'ean' | 'fuzzy' | 'none';

/** A single candidate product with its fuzzy-match score (0–100). */
export interface ProductMatchCandidate {
  readonly productId: number;
  readonly score: number;
}

/** Result of a product matching attempt. */
export interface ProductMatchResult {
  /** True when a match was found (confidence ≥ HIGH). */
  readonly matched: boolean;
  /** The matched product master ID (undefined when not matched). */
  readonly productId?: number;
  /** Confidence in the match decision. */
  readonly confidence: MatchConfidence;
  /** Method used to produce the result. */
  readonly matchMethod: MatchMethod;
  /** All candidates considered, ranked by score descending. */
  readonly candidates: ProductMatchCandidate[];
}