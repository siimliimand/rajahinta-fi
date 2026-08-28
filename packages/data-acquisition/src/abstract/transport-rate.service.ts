import { Injectable } from '@nestjs/common';

/**
 * Result of a carrier transport-rate refresh.
 */
export interface TransportRateRefreshResult {
  /** Number of carrier rate observations appended this run. */
  readonly ratesUpdated: number;
  /**
   * Newest observedAt across transport offers after the refresh (null
   * when no offers exist) — the value the freshness alert
   * (`rajahinta_transport_newest_offer_age_seconds`) measures. Comes
   * from carrier publication timestamps, not fetch time.
   */
  readonly newestOfferObservedAt: Date | null;
}

/**
 * Refreshes carrier transport rates periodically through the
 * governance-gated pipeline.
 */
@Injectable()
export abstract class TransportRateService {
  abstract refreshCarrierRates(
    carrierId: string,
  ): Promise<TransportRateRefreshResult>;

  abstract schedulePeriodicRefresh(intervalMs: number): void;
}
