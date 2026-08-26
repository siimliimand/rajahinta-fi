/**
 * Offer-Change Recorder Hook — data-acquisition port adapter that delegates
 * to the core-domain PriceObservationRecorderService.
 *
 * Binds OFFER_CHANGE_HOOK_TOKEN (data-acquisition) to the history recorder
 * (core-domain) at the composition root, per change
 * 2026-08-26-phase2-historical-price-intelligence task 2.2. The hook fires
 * from the ingestion pipeline only — never from a request handler — so
 * observations are appended strictly off the request path, one per changed
 * offer.
 *
 * Failure isolation lives in the CALLER (PipelineOrchestratorService): this
 * adapter deliberately does not swallow errors. The recorder's documented
 * rejections (ProductNotFound, classification-gate refusal) must surface to
 * the pipeline's per-offer isolation, which logs and continues the run.
 *
 * @module OfferChangeRecorderHook
 */

import { Injectable } from '@nestjs/common';
import {
  PriceObservationRecorderService,
  type ReliabilityStatus,
} from '@rajahinta/core-domain';
import type {
  IOfferChangeHook,
  ChangedOfferEvent,
} from '@rajahinta/data-acquisition';

/**
 * Narrow the pipeline's free-string reliability status to the canonical
 * union — same policy as ProductDataAdapter: unknown or legacy values
 * degrade to ESTIMATED, reliability is never overstated.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}

@Injectable()
export class OfferChangeRecorderHook implements IOfferChangeHook {
  constructor(
    private readonly recorder: PriceObservationRecorderService,
  ) {}

  /**
   * Map the changed-offer event to the recorder's input shape (the
   * calculator's retail-offer read model) and append one observation.
   */
  async onOfferChanged(event: ChangedOfferEvent): Promise<void> {
    await this.recorder.record({
      productId: event.productId,
      offer: {
        id: event.offerId,
        priceCents: event.priceCents,
        merchant: event.merchant,
        country: event.country,
        reliabilityStatus: toReliabilityStatus(event.reliabilityStatus),
      },
      observedAt: event.observedAt,
    });
  }
}
