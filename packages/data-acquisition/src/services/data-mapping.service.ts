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
   * @param record     Normalised feed record from the merchant adapter
   *                   (currency already converted to EUR at ingestion,
   *                   task 1.4 — the original amount stays on the record
   *                   for display consumers).
   * @param merchantId Merchant identifier to stamp on the retail offer.
   * @param country    Merchant market (ISO 3166-1 alpha-2) from the
   *                   merchant registry row driving this run — what the
   *                   offer's country field records. Optional only for
   *                   backward compatibility with direct unit callers;
   *                   the pipeline always passes it.
   */
  mapToProductAndOffer(
    record: RawFeedRecord,
    merchantId: string,
    country?: string,
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
      // Registry-backed merchant market; the Finnish market default
      // matches the schema's own documented default for direct callers.
      country: country ?? 'FI',
      priceCents: record.priceCents,
      currency: record.currency,
      // Conversion provenance (task 1.4, design D2): the original
      // amount/currency stay next to the converted EUR cents, and the
      // FX dataset version records which governed dataset produced them.
      originalPriceCents: record.originalPriceCents,
      originalCurrency: record.originalCurrency,
      fxDatasetVersion: record.fxDatasetVersion ?? null,
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
    country?: string,
  ): MappedPair[] {
    return records.map((r) => this.mapToProductAndOffer(r, merchantId, country));
  }
}