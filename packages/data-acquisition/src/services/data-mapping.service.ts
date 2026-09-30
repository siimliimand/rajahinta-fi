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
import { decodeHtmlEntities } from './html-entities';

/** Paired upsert inputs for a single feed record. */
export interface MappedPair {
  /**
   * Product upsert input widened with the feed weight (design D7,
   * change alks-feed-and-import-vat): the mapping persists the feed's
   * `weightGrams` onto the product master — null when the feed carries
   * no weight (Alko). Weight-unaware upsert implementations stay
   * source-compatible; weight-aware ones read the field.
   */
  readonly product: UpsertProductInput & { readonly weightGrams: number | null };
  readonly offerInput: Omit<UpsertOfferInput, 'productId'>;
  /**
   * Offer-gate failure messages — present exactly when the mapped offer
   * failed an ingestion plausibility gate (design D1, change
   * data-quality-and-publication-trust): the offer is then NEVER
   * published and the product upserts offer-less (it honestly sorts
   * last). The strings ride the pipeline's error collection, the same
   * surface as the feed parser's per-row correction failures, each
   * naming the gate and the offending source value.
   */
  readonly offerErrors?: readonly string[];
}

@Injectable()
export class DataMappingService {
  /**
   * Map a single raw feed record to upsert-ready product + offer inputs.
   *
   * @param record     Normalised feed record from the merchant adapter
   *                   (EUR-only per design D3 — offers can no longer be
   *                   unconvertible, and no FX provenance is carried).
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
    // WooCommerce feeds carry HTML-encoded display text (&#038;, &#8221;,
    // &#215;, …) — decoded once here at ingestion; render-time output
    // escaping elsewhere is unchanged (design D2). Single-pass decoding
    // keeps plain text and already-decoded input byte-identical.
    const productName = decodeHtmlEntities(record.productName);
    const brand = decodeHtmlEntities(record.brand);

    // Category + regulatory classification come from the feed adapter's
    // source-category normalization (task 7.1) — the adapter maps the
    // source-market string to the canonical tax-rule key. Placeholders
    // here would be rejected by the classification gate downstream.
    const product: MappedPair['product'] = {
      id: 0, // placeholder; the upsert adapter resolves the canonical ID
      name: productName,
      manufacturer: brand, // placeholder — feed adapter may provide actual manufacturer
      brand,
      category: record.category,
      containerType: record.containerType,
      // Canonical litres at ingestion (design D1) — String of the quotient
      // keeps the pinned shapes ("0.5", "0.75", "3", "0.15"); integer ml
      // inputs never produce exponent notation.
      unitVolume: String(record.volumeMl / 1000),
      alcoholByVolume:
        record.alcoholByVolume !== null
          ? String(record.alcoholByVolume)
          : null,
      ean: record.ean,
      regulatoryClassification: record.regulatoryClassification,
      depositSystemStatus: false,
      // D7 (alks-feed-and-import-vat): the feed weight lands on the
      // product master; a feed without weight persists null, never an
      // error.
      weightGrams: record.weightGrams ?? null,
    };

    // Price floor gate (design D1, data-quality-and-publication-trust):
    // plausibility is a mapping concern — the parser's `readMinorUnitCents`
    // stays structural (zero IS an integer), so a non-positive price is
    // price drift, rejected HERE with the source value named. The offer is
    // never published; the product stays (offer-less, honestly sorting
    // last). The rejection rides the pipeline's error collection, the same
    // failure-counting path the parser's non-EUR/invalid-price rows use.
    const offerErrors =
      record.priceCents <= 0
        ? [
            `Failed to map offer for product "${productName}" (merchant "${merchantId}"): ` +
              `price drift — minor-unit price "${record.priceCents}" is not a positive ` +
              'cent amount; offer rejected, the product stays offer-less (design D1)',
          ]
        : undefined;

    const offerInput: Omit<UpsertOfferInput, 'productId'> = {
      merchant: merchantId,
      // Registry-backed merchant market; the Finnish market default
      // matches the schema's own documented default for direct callers.
      country: country ?? 'FI',
      priceCents: record.priceCents,
      currency: record.currency,
      availability: 'in_stock',
      sourceUrl: record.sourceUrl,
      observedAt: new Date(),
      // D3 (alks-feed-and-import-vat): an offer whose ABV or volume the
      // feed left unresolved — null ABV or the parser's 0-ml encoding —
      // is keyed ESTIMATED so the calculator surfaces the uncertainty
      // instead of hiding the product. A fully-parsed scraped price is
      // also ESTIMATED at ingestion (ingestion never self-certifies
      // VERIFIED; the Alko flow pins that), so the keyed unresolved path
      // can never be silently promoted by a future resolved-path change.
      reliabilityStatus: 'ESTIMATED',
    };

    // The rejection channel stays ABSENT on the happy path — a pair
    // without gate failures is shape-identical to the pre-gate contract.
    return offerErrors === undefined
      ? { product, offerInput }
      : { product, offerInput, offerErrors };
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