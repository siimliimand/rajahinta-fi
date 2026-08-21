/**
 * API response types for the landed-cost calculator frontend.
 *
 * These mirror the shapes returned by packages/application-api without
 * importing NestJS-coupled modules.
 *
 * @module CalculatorTypes
 */

// ---------------------------------------------------------------------------
// Product search (GET /api/v1/products)
// ---------------------------------------------------------------------------

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

export interface ProductSearchResult {
  readonly items: ProductSearchItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

// ---------------------------------------------------------------------------
// Product detail (GET /api/v1/products/:id)
// ---------------------------------------------------------------------------

export interface ProductDetail {
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
}

export interface RetailOffer {
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

export interface ProductDetailResponse {
  readonly product: ProductDetail;
  readonly offers: RetailOffer[];
}

// ---------------------------------------------------------------------------
// Calculator (POST /api/v1/calculator)
// ---------------------------------------------------------------------------

export interface CalculateRequest {
  readonly productId: number;
  readonly quantity: number;
  readonly destination: string;
  readonly transportMethod?: string;
  readonly sessionId?: string;
}

export type CostCategory =
  | 'foreignRetailPrice'
  | 'transportCost'
  | 'alcoholExciseEstimate'
  | 'containerDutyEstimate'
  | 'otherCharges';

export type ReliabilityStatus = 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';

export interface ItemizedCost {
  readonly label: string;
  readonly category: CostCategory;
  readonly cents: number;
  readonly reliability: ReliabilityStatus;
  readonly breakdown?: readonly ItemizedCost[];
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ConfidenceDetail {
  readonly status: ReliabilityStatus;
  readonly detail: string;
  readonly inputName?: string;
}

export interface ClassificationResult {
  readonly classification: 'DistanceSelling' | 'DistanceBuying' | 'TravellerImport';
  readonly confidence: ConfidenceLevel;
  readonly evidence: Array<{
    readonly observation: string;
    readonly supportingData: string;
    readonly source: string;
  }>;
  readonly evidenceSummary: string;
}

export interface Disclaimer {
  readonly text: string;
  readonly language: 'fi' | 'en';
  readonly version: string;
}

export interface CalculatorResult {
  readonly itemizedCosts: readonly ItemizedCost[];
  readonly foreignRetailPrice: number;
  readonly transportCost: number;
  readonly alcoholExciseEstimate: number;
  readonly containerDutyEstimate: number;
  readonly otherCharges: number;
  readonly totalCents: number;
  readonly currency: 'EUR';
  readonly confidence: ConfidenceLevel;
  readonly confidenceBreakdown: readonly ConfidenceDetail[];
  readonly disclaimer: Disclaimer;
  readonly classification: ClassificationResult;
  readonly metadata: {
    readonly input: {
      readonly productId: number;
      readonly quantity: number;
      readonly destination: string;
      readonly transportMethod?: string;
      readonly sessionId?: string;
    };
    readonly calculationTimestamp: string;
    readonly productMasterId: number;
    readonly retailOfferIds: readonly number[];
    readonly quantity: number;
    readonly destination: string;
    readonly productName: string;
    readonly volumeLitres: number;
    readonly alcoholByVolume: number;
    readonly category: string;
    readonly datasetVersions: readonly string[];
    readonly transportOfferId: number | null;
  };
  readonly calculationRecordId: number;
}

// ---------------------------------------------------------------------------
// API error response
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Basket types (mirrors account.types from application-api)
// ---------------------------------------------------------------------------

/** A single item in a saved basket. */
export interface BasketItem {
  readonly productId: number;
  readonly productName: string;
  readonly quantity: number;
}

/** A saved product selection (basket). */
export interface Basket {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly items: BasketItem[];
}

// ---------------------------------------------------------------------------
// Sort order for product ranking (mirrors SortOrder from core-domain)
// ---------------------------------------------------------------------------

export type SortOrder =
  | 'LOWEST_LANDED_COST'
  | 'LOWEST_PER_LITRE'
  | 'LOWEST_PER_UNIT'
  | 'ALPHABETICAL'
  | 'ALCOHOL_PERCENTAGE'
  | 'PRODUCT_CATEGORY';

// ---------------------------------------------------------------------------
// Ranking methodology (GET /api/v1/ranking/methodology)
// ---------------------------------------------------------------------------

export interface RankingMethodology {
  readonly introduction: string;
  readonly sortOrders: readonly SortOrderDescription[];
  readonly tiebreaker: string;
  readonly deterministic: boolean;
}

export interface SortOrderDescription {
  readonly name: SortOrder;
  readonly label: string;
  readonly description: string;
}

// ---------------------------------------------------------------------------
// Comparison item for side-by-side product views
// ---------------------------------------------------------------------------

export interface ComparisonProduct {
  readonly id: number;
  readonly name: string;
  readonly brand: string;
  readonly category: string;
  readonly unitVolume: string;
  readonly alcoholByVolume: number | null;
  readonly totalCents: number;
  readonly itemizedCosts: readonly ItemizedCost[];
  readonly confidence: ConfidenceLevel;
  readonly reliability: ReliabilityStatus;
  /** Optional retail-offer ID for the outbound redirect link */
  readonly offerId?: number;
  /** Optional merchant display name (shown as the link label) */
  readonly merchantName?: string;
}

// ---------------------------------------------------------------------------
// Data freshness entry
// ---------------------------------------------------------------------------

export interface DataFreshnessEntry {
  readonly label: string;
  readonly status: ReliabilityStatus;
  readonly timestamp: string | null;
  readonly detail: string;
}

export interface ApiError {
  readonly statusCode: number;
  readonly message: string;
  readonly error: string;
  readonly timestamp: string;
  readonly path: string;
}