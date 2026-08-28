/**
 * Transport-offer write port (task 7.4).
 *
 * The persistence boundary the transport-rate refresh pipeline writes
 * through. Kept separate from the read-side TransportOfferRepository
 * (data-platform) so the pipeline depends only on what it needs:
 * appending new carrier observations and reading the newest observation
 * timestamp for the freshness invariant.
 *
 * @module TransportOfferWritePort
 */

import type { CarrierRateOffer } from './carrier-rate-source.port';

/** Reliability status values transportOffers accepts. */
export type TransportReliabilityStatus = 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';

/** A carrier rate plus the reliability decision made at ingestion. */
export interface TransportOfferWrite {
  readonly rate: CarrierRateOffer;
  /**
   * Reliability of the external fact. Published carrier price lists are
   * VERIFIED with the observation timestamp carried on the rate.
   */
  readonly reliabilityStatus: TransportReliabilityStatus;
}

export interface ITransportOfferWritePort {
  /**
   * Append carrier rate observations. Offers are append-only — history
   * is never rewritten; a changed rate is a new row with a newer
   * observedAt.
   */
  insertOffers(offers: readonly TransportOfferWrite[]): Promise<{ inserted: number }>;

  /**
   * The newest observedAt across all transport offers (null when the
   * table is empty) — the freshness gauge source
   * (`rajahinta_transport_newest_offer_age_seconds`).
   */
  findNewestObservedAt(): Promise<Date | null>;
}

/** Injection token for the transport-offer write port. */
export const TRANSPORT_OFFER_WRITE_PORT = 'TRANSPORT_OFFER_WRITE_PORT';
