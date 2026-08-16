/**
 * Port interface for Product Master queries used by the matching engine.
 *
 * Core Domain owns this port so the ProductMatcherService depends on an
 * abstraction, not on a specific repository implementation. The concrete
 * adapter lives in the composition root (DataPlatform) and wires the actual
 * product master repository into this contract at bootstrap time.
 *
 * @module ProductMasterQueryPort
 */

import type { CanonicalCategory } from '../normalization.types';

/** Read-model shape — mirrors productMaster without ORM types. */
export interface ProductMasterRecord {
  readonly id: number;
  /** GTIN-13 / EAN barcode, null when unknown. */
  readonly ean: string | null;
  /** Normalised product display name. */
  readonly normalizedName: string;
  /** Normalised brand name. */
  readonly normalizedBrand: string;
  /** Canonical category assigned during normalisation. */
  readonly canonicalCategory: CanonicalCategory;
  /** Volume in litres. */
  readonly volumeLitres: number;
  /** Alcohol by volume as percentage 0–100. */
  readonly alcoholByVolume: number;
}

/** Injection token for the product master query port. */
export const PRODUCT_MASTER_QUERY_PORT = 'PRODUCT_MASTER_QUERY_PORT';

/**
 * Repository contract that the matching engine needs.
 *
 * Consumers inject this interface. An adapter in the composition root maps
 * the concrete data-platform repository to this port.
 */
export interface IProductMasterQuery {
  /**
   * Retrieve a product by its exact GTIN-13 / EAN barcode.
   * Returns null when no product carries this barcode.
   */
  findByEan(ean: string): Promise<ProductMasterRecord | null>;

  /**
   * Return candidate products that could match a normalised product.
   *
   * The implementation should apply broad filters (same category, same brand,
   * volume within ±5 %, ABV within ±1 %) so the in-memory scoring can
   * refine the list. The caller expects at most ~50 candidates.
   */
  findCandidates(params: {
    brand: string;
    category: CanonicalCategory;
    volumeLitres: number;
    abv: number;
  }): Promise<ProductMasterRecord[]>;
}