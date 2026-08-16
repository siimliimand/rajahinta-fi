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
  ProductRecord,
  MerchantOfferRecord,
} from '@rajahinta/data-platform';

// --------------------------------------------------------------------------
// Input shapes — pipeline-produced, upsert-consumed
// --------------------------------------------------------------------------

/**
 * Input shape for creating or updating a product.
 * The pipeline knows everything except the auto-generated fields.
 */
export type UpsertProductInput = Omit<ProductRecord, 'createdAt' | 'updatedAt'>;

/**
 * Input shape for recording a retail price observation.
 */
export type UpsertOfferInput = Omit<MerchantOfferRecord, 'id'>;

/** Result of an upsert operation. */
export interface UpsertResult {
  readonly productId: number;
  readonly created: boolean;
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
   * Record a retail price observation for a known product.
   *
   * If an offer with the same (merchantId, productId, observedAt) window
   * already exists, the existing row is updated with the latest price.
   */
  upsertOffer(input: UpsertOfferInput): Promise<number>;
}

/** Injection token for the upsert repository. */
export const UPSERT_REPOSITORY_TOKEN = 'UPSERT_REPOSITORY';