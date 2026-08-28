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
    // Category + regulatory classification come from the feed adapter's
    // source-category normalization (task 7.1) — the adapter maps the
    // source-market string to the canonical tax-rule key. Placeholders
    // here would be rejected by the classification gate downstream.
    const product: UpsertProductInput = {
      id: 0, // placeholder; the upsert adapter resolves the canonical ID
      name: record.productName,
      manufacturer: record.brand, // placeholder — feed adapter may provide actual manufacturer
      brand: record.brand,
      category: record.category,
      containerType: record.containerType,
      unitVolume: String(record.volumeMl),
      alcoholByVolume:
        record.alcoholByVolume !== null
          ? String(record.alcoholByVolume)
          : null,
      ean: record.ean,
      regulatoryClassification: record.regulatoryClassification,
      depositSystemStatus: false,
    };

    const offerInput: Omit<UpsertOfferInput, 'productId'> = {
      merchant: merchantId,
      country: 'DE', // placeholder — derived from merchant config
      priceCents: record.priceCents,
      currency: record.currency,
      availability: 'in_stock',
      sourceUrl: record.sourceUrl,
      observedAt: new Date(),
      reliabilityStatus: 'ESTIMATED',
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