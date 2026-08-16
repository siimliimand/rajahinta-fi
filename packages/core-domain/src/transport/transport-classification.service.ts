import { Injectable } from '@nestjs/common';
import type { TransactionTransportType } from './transport-classification.types';

/**
 * Classification logic to distinguish retailer-arranged transport from
 * independent carrier transport.
 *
 * The `sellerInvolvementIndicator` field already exists on `TransportOffer`
 * and signals whether the retailer/seller is involved in arranging shipping.
 * This service combines that signal with carrier identity to produce the
 * higher-level `TransactionTransportType` consumed by Transaction
 * Classification (task 6.x).
 */
@Injectable()
export class TransportClassificationService {
  /**
   * Classify a transaction's transport arrangement.
   *
   * @param sellerInvolvementIndicator  `true` when the seller selected/paid
   *                                    the carrier (from TransportOffer).
   * @param carrierId                   Carrier identifier (e.g., 'posti',
   *                                    'dhl', 'schenker', or an empty string
   *                                    when unknown).
   */
  classifyTransport(
    sellerInvolvementIndicator: boolean,
    carrierId: string,
  ): TransactionTransportType {
    if (sellerInvolvementIndicator) {
      return 'RETAILER_ARRANGED';
    }

    if (carrierId && carrierId.trim().length > 0) {
      return 'INDEPENDENT_CARRIER';
    }

    return 'UNKNOWN';
  }
}