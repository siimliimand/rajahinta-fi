/**
 * Offer-change recorder hook — data-acquisition port adapter delegating
 * to the core-domain PriceObservationRecorderService (task 4.1, design
 * D6 + D4-amended).
 *
 * 1:1 port of `apps/backend/src/adapters/offer-change-recorder-hook.adapter.ts`
 * onto the Worker composition: the hook binds OFFER_CHANGE_HOOK so
 * observations are appended strictly on the background ingestion path —
 * one per CHANGED offer, through the R2 observation log
 * (R2PriceObservationPort). The hook fires from the pipeline only, never
 * from a request handler.
 *
 * Failure isolation lives in the CALLER (PipelineOrchestratorService):
 * this adapter deliberately does not swallow errors. The recorder's
 * documented rejections (ProductNotFound, classification-gate refusal)
 * must surface to the pipeline's per-offer isolation, which logs and
 * continues the run.
 *
 * @module OfferChangeRecorderHook
 */

import {
  PriceObservationRecorderService,
  type ReliabilityStatus,
} from '@rajahinta/core-domain';
import type {
  IOfferChangeHook,
  ChangedOfferEvent,
} from '../../../../packages/data-acquisition/src/interfaces/offer-change-hook.interface';

/**
 * Narrow the pipeline's free-string reliability status to the canonical
 * union — same policy as D1ProductDataPort: unknown or legacy values
 * degrade to ESTIMATED, reliability is never overstated.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}

export class OfferChangeRecorderHook implements IOfferChangeHook {
  constructor(private readonly recorder: PriceObservationRecorderService) {}

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
