/**
 * Data mapping service.
 *
 * Transforms normalised raw feed records into the canonical data-platform
 * shapes ({@link ProductMasterRecord}, {@link RetailOfferRecord}) that the
 * upsert repository consumes.
 *
 * No external dependencies — pure mapping logic, testable without a
 * NestJS testing module.
 *
 * @module DataMappingService
 */

import { Injectable } from '@nestjs/common';
import type { UpsertProductInput, UpsertOfferInput } from '../interfaces/upsert-port.interface';
import type { RawFeedRecord } from '../interfaces/feed-adapter.interface';

/** Paired upsert inputs for a single feed record. */
export interface MappedPair {
  readonly product: UpsertProductInput;
  readonly offerInput: Omit<UpsertOfferInput, 'productId'>;
}

@Injectable()
export class DataMappingService {
  /**
   * Map a single raw feed record to upsert-ready product + offer inputs.
   *
   * @param record     Normalised feed record from the merchant adapter.
   * @param merchantId Merchant identifier to stamp on the retail offer.
   */
  mapToProductAndOffer(
    record: RawFeedRecord,
    merchantId: string,
  ): MappedPair {
    const product: UpsertProductInput = {
      id: 0, // placeholder; the upsert adapter resolves the canonical ID
      name: record.productName,
      brand: record.brand,
      containerType: record.containerType,
      volumeLitres: String(record.volumeMl),
      alcoholByVolume:
        record.alcoholByVolume !== null
          ? String(record.alcoholByVolume)
          : null,
      ean: record.ean,
    };

    const offerInput: Omit<UpsertOfferInput, 'productId'> = {
      merchantId,
      priceCents: record.priceCents,
      currency: record.currency,
      sourceUrl: record.sourceUrl,
      reliability: 'ESTIMATED',
      observedAt: new Date(),
    };

    return { product, offerInput };
  }

  /**
   * Map a batch of raw feed records.
   */
  mapBatch(
    records: RawFeedRecord[],
    merchantId: string,
  ): MappedPair[] {
    return records.map((r) => this.mapToProductAndOffer(r, merchantId));
  }
}