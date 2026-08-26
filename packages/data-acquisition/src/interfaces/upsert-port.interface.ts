/**
 * Upsert port — write operations the pipeline needs from the data layer.
 *
 * The data-platform's {@code IRepositoryRegistry} exposes only read
 * operations.  This port defines what the acquisition pipeline requires
 * on the write side, keeping the data platform free of pipeline concerns.
 *
 * A concrete adapter is wired at the composition root (typically the
 * application's main module) and implements these operations against
 * the actual Drizzle repositories.
 *
 * @module UpsertRepository
 */

import type {
  ProductMasterRecord,
  RetailOfferRecord,
} from '@rajahinta/data-platform';

// --------------------------------------------------------------------------
// Input shapes — pipeline-produced, upsert-consumed
// --------------------------------------------------------------------------

/**
 * Input shape for creating or updating a product.
 * The pipeline knows everything except the auto-generated fields.
 */
export type UpsertProductInput = Omit<ProductMasterRecord, 'createdAt' | 'updatedAt'>;

/**
 * Input shape for recording a retail price observation.
 */
export type UpsertOfferInput = Omit<RetailOfferRecord, 'id'>;

/** Result of an upsert operation. */
export interface UpsertResult {
  readonly productId: number;
  readonly created: boolean;
}

/**
 * Result of an offer upsert.
 *
 * `changed` is the pipeline's offer-level change detection: true when this
 * insert is the first offer row for the (merchant, product) pair or its
 * price differs from the latest prior row. Consumers that append
 * per-change side effects (price observations) must do so only when
 * `changed` is true.
 */
export interface UpsertOfferResult {
  readonly offerId: number;
  readonly changed: boolean;
}

// --------------------------------------------------------------------------
// Injection token — concrete implementation wired at composition root
// --------------------------------------------------------------------------

/**
 * Write port for product and retail-offer persistence.
 *
 * This is a port interface (not a NestJS provider token).  The
 * concrete implementation is registered under the string token
 * {@link UPSERT_REPOSITORY_TOKEN} at the application composition root.
 */
export interface IUpsertRepository {
  /**
   * Insert a new product or update an existing one matched by EAN
   * or by (name, brand, containerType, volumeLitres) compound key.
   *
   * Returns the product's canonical ID and whether a new row was created.
   */
  upsertProduct(input: UpsertProductInput): Promise<UpsertResult>;

  /**
   * Append a retail price observation row for a known product.
   *
   * Every call inserts a new row (append-only price history); the result
   * reports the new row's ID and whether the offer CHANGED relative to the
   * latest prior row for the same (merchant, product) — first sighting or
   * price move. Unchanged re-scrapes still append the offer row but report
   * `changed: false` so downstream per-change side effects are skipped.
   */
  upsertOffer(input: UpsertOfferInput): Promise<UpsertOfferResult>;
}

/** Injection token for the upsert repository. */
export const UPSERT_REPOSITORY_TOKEN = 'UPSERT_REPOSITORY';