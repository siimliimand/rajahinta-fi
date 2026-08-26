/**
 * Offer-change hook — notification port invoked by the ingestion pipeline
 * after a CHANGED retail offer is upserted.
 *
 * Purpose (change 2026-08-26-phase2-historical-price-intelligence, task 2.2):
 * the price-observation recorder must run once per changed offer, strictly
 * off the request path. Rather than coupling the acquisition pipeline to the
 * core-domain recorder, the pipeline exposes this port and the composition
 * root registers an adapter that delegates to
 * {@code PriceObservationRecorderService}. This mirrors the existing
 * {@code RATE_CHANGE_SOURCE_PORT} pattern: data-acquisition owns the
 * contract, the host app owns the implementation.
 *
 * Contract:
 * - Invoked exactly once per CHANGED offer (unchanged re-scrapes are never
 *   reported — the observation log grows with price changes, not with the
 *   full catalog on every hourly run).
 * - Invoked AFTER the offer row is durably upserted, so a hook failure can
 *   never lose or corrupt ingested data.
 * - Failures are isolated by the caller ({@code PipelineOrchestratorService}):
 *   an implementation may throw; the pipeline logs and continues with the
 *   remaining offers. Implementations must NOT retry or block.
 *
 * @module OfferChangeHook
 */

/**
 * A retail offer whose upsert changed the persisted state for its
 * (merchant, product) series.
 *
 * "Changed" means: no prior offer row exists for the (merchant, product)
 * pair, or the latest prior row carries a different price. Availability-only
 * flips are not reported — the downstream observation log is a price series
 * and carries no availability field.
 */
export interface ChangedOfferEvent {
  /** Canonical product the offer belongs to. */
  readonly productId: number;
  /** Row ID of the newly appended retail-offer row. */
  readonly offerId: number;
  /** Merchant identifier (same value stamped on the offer row). */
  readonly merchant: string;
  /** Origin country (ISO 3166-1 alpha-2) of the offer. */
  readonly country: string;
  /** Observed retail price in euro-cents. */
  readonly priceCents: number;
  /** Reliability status of the scraped price (free string; narrow on use). */
  readonly reliabilityStatus: string;
  /** When the offer was observed — tax rules resolve against this instant. */
  readonly observedAt: Date;
}

/**
 * Consumer notified once per changed offer during price ingestion.
 *
 * The concrete implementation is registered under
 * {@link OFFER_CHANGE_HOOK_TOKEN} at the application composition root.
 */
export interface IOfferChangeHook {
  /**
   * Handle one changed offer.
   *
   * Throwing is permitted (and expected for e.g. classification-gate
   * rejections); the pipeline isolates the failure and continues.
   */
  onOfferChanged(event: ChangedOfferEvent): Promise<void>;
}

/** Injection token for the offer-change hook. */
export const OFFER_CHANGE_HOOK_TOKEN = 'OFFER_CHANGE_HOOK';
