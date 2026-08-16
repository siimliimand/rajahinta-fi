/**
 * Search DTOs — request/response shapes for product search and discovery.
 *
 * @module SearchDto
 */

import type { SortOrder } from '@rajahinta/core-domain';

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/** GET /api/v1/products — query parameters for product search. */
export interface SearchProductsQuery {
  /** Free-text search term (basic substring matching). */
  readonly q?: string;
  /** Optional category filter. */
  readonly category?: string;
  /** Sort order for results (default: ALPHABETICAL). */
  readonly sort?: SortOrder;
  /** Page number (1-indexed, default: 1). */
  readonly page?: number;
  /** Results per page (default: 20, max: 100). */
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** A single product item in a search result listing. */
export interface ProductSearchItem {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: number | null;
  readonly unitVolume: string;
  readonly containerType: string;
  readonly lowestPriceCents: number | null;
  readonly merchantCount: number;
}

/** GET /api/v1/products — paginated search result. */
export interface ProductSearchResult {
  readonly items: ProductSearchItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

/** A single retail offer in the product detail response. */
export interface OfferItem {
  readonly id: number;
  readonly merchant: string;
  readonly country: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly availability: string;
  readonly sourceUrl: string | null;
  readonly observedAt: string;
  readonly reliabilityStatus: string;
}

/** GET /api/v1/products/:id — product detail with active offers. */
export interface ProductDetailResponse {
  readonly product: {
    readonly id: number;
    readonly name: string;
    readonly manufacturer: string;
    readonly brand: string;
    readonly category: string;
    readonly alcoholByVolume: number | null;
    readonly unitVolume: string;
    readonly containerType: string;
    readonly regulatoryClassification: string;
    readonly depositSystemStatus: boolean;
    readonly ean: string | null;
  };
  readonly offers: OfferItem[];
}