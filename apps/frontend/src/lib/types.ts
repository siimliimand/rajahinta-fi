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
  /**
   * Factual per-merchant reliability scores for the offers' merchants.
   * Embedded by the API only while the enable_advanced_features flag is
   * on; absent otherwise (never null). Informational only — the offers'
   * order is never affected.
   */
  readonly merchantReliability?: Readonly<
    Record<string, MerchantReliabilityScore>
  >;
}

// ---------------------------------------------------------------------------
// Saved scenarios (GET/POST/DELETE /api/v1/account/scenarios)
// Mirrors SavedScenario/SavedScenarioInputs from the application-api and
// data-platform packages with Date fields as ISO strings. A scenario stores
// calculator inputs only — displaying a result always requires re-running
// the calculation against current data.
// ---------------------------------------------------------------------------

/** How transport is arranged (same union as TransportArrangement in basket.types). */
export type ScenarioTransportArrangement =
  | 'SELLER_ARRANGED'
  | 'INDEPENDENT_CARRIER'
  | 'PERSONAL';

/** Stored calculator inputs — exactly what is needed to re-run a calculation. */
export interface ScenarioInputs {
  readonly productId: number;
  readonly quantity: number;
  readonly destination: string;
  readonly transportMethod?: string;
  readonly transportArrangement?: ScenarioTransportArrangement;
}

/** A saved scenario row as served by the account API (ISO timestamps). */
export interface SavedScenario {
  readonly id: number;
  readonly name: string;
  readonly inputs: ScenarioInputs;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** POST /api/v1/account/scenarios body — upsert by (account, name). */
export interface SaveScenarioRequest {
  readonly name: string;
  readonly inputs: ScenarioInputs;
}

// ---------------------------------------------------------------------------
// Merchant reliability (GET /api/v1/merchants/reliability)
// Mirrors merchants.dto.ts — factual fields only: counts, shares, statuses,
// timestamps. No grade, weighting, or endorsement; informational only.
// ---------------------------------------------------------------------------

/** Governance permission status of a merchant's data sources. */
export type PermissionStatus = 'GRANTED' | 'PENDING' | 'REVOKED' | 'EXPIRED';

/** Factual reliability score for one merchant (ISO-string mirror of the DTO). */
export interface MerchantReliabilityScore {
  readonly merchant: string;
  readonly offerCount: number;
  readonly statusCounts: Readonly<Record<ReliabilityStatus, number>>;
  readonly statusShares: Readonly<Record<ReliabilityStatus, number>>;
  readonly strictestStatus: ReliabilityStatus;
  readonly freshestObservedAt: string | null;
  readonly governancePermissionStatus: PermissionStatus;
  readonly computedAt: string;
}

/** GET /api/v1/merchants/reliability — one score per merchant with offers. */
export interface MerchantReliabilityListResponse {
  readonly merchants: readonly MerchantReliabilityScore[];
}

// ---------------------------------------------------------------------------
// Declaration guidance (GET /api/v1/declaration/:recordId)
// Mirrors declaration.dto.ts. The guidance field is present only while the
// enable_advanced_features flag is on (omitted, never null, otherwise).
// ---------------------------------------------------------------------------

/** One applied-duty line of the derivation walkthrough. */
export interface DeclarationAppliedRateDetail {
  readonly kind: 'alcoholExcise' | 'containerDuty';
  readonly amountCents: number;
  readonly ratePerUnit: number | null;
  readonly rateUnit: string | null;
  readonly ruleVersionLabel: string | null;
  readonly formulaReference: string | null;
  readonly formulaExpression: string | null;
}

/** Derivation walkthrough — product facts and applied rates behind the totals. */
export interface DeclarationDerivation {
  readonly category: string;
  readonly abvPercent: number;
  readonly volumePerUnitLitres: number;
  readonly quantity: number;
  readonly totalVolumeLitres: number;
  readonly appliedRates: readonly DeclarationAppliedRateDetail[];
}

/** Advance-notice deadline computed from the calculation timestamp. */
export interface DeclarationDeadline {
  readonly required: boolean;
  readonly deadlineDays: number | null;
  readonly calculatedFrom: string;
  readonly dueDate: string | null;
}

/** A link to an official guidance source. */
export interface DeclarationOfficialSourceLink {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/** Advanced declaration guidance — informational, read-only. */
export interface DeclarationGuidance {
  readonly derivation: DeclarationDerivation;
  readonly deadline: DeclarationDeadline;
  readonly checklist: readonly string[];
  readonly caveats: readonly string[];
  readonly officialSources: readonly DeclarationOfficialSourceLink[];
}

/** GET /api/v1/declaration/:recordId — response wrapper. */
export interface DeclarationSummaryResponse {
  readonly product: {
    readonly name: string;
    readonly brand: string | null;
    readonly category: string;
    readonly abv: number;
    readonly volumeLitres: number;
  };
  readonly units: number;
  readonly container: {
    readonly type: string;
    readonly volumeLitres: number;
    readonly depositSystemStatus: boolean | null;
  };
  readonly transport: {
    readonly carrier: string | null;
    readonly origin: string | null;
    readonly destination: string | null;
  };
  readonly estimatedExcise: {
    readonly alcoholExciseCents: number;
    readonly containerDutyCents: number;
    readonly totalCents: number;
    readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  readonly advanceNoticeInfo: {
    readonly required: boolean;
    readonly deadlineDays?: number;
  };
  readonly myTaxLink: string;
  readonly declarationDate: string;
  readonly disclaimer: Disclaimer;
  /** Present only while the enable_advanced_features flag is on. */
  readonly guidance?: DeclarationGuidance;
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
// Correction / flagging (POST /api/v1/corrections)
// ---------------------------------------------------------------------------

/** A correction flag returned by the API. */
export interface CorrectionItem {
  /** Unique correction flag identifier. */
  readonly id: number;
  /** The kind of target being flagged. */
  readonly targetType: 'calculation' | 'data_point';
  /** Identifier of the target record. */
  readonly targetId: number;
  /** Human-readable reason supplied at creation time. */
  readonly reason: string;
  /** Current review status. */
  readonly status: 'open' | 'resolved';
  /** ISO-8601 timestamp of flag creation. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of resolution, null while open. */
  readonly resolvedAt: string | null;
  /** Resolution notes recorded when the flag was closed, null while open. */
  readonly resolution: string | null;
}

// ---------------------------------------------------------------------------
// Price history (GET /api/v1/products/:id/price-history)
// Mirrors historical.dto.ts from application-api (task 5.1).
// Reliability is first-class: every series point carries the strictest
// reliability of its source observations (DESIGN.md); attribution entries
// are evidence (moved inputs + bounding rule-version labels), never
// conclusions — no ranking or comparison semantics in these shapes.
// ---------------------------------------------------------------------------

/** Which summary series to return. */
export type PriceHistoryMetric = 'price' | 'landed-cost';

/** Bucket granularity (API vocabulary). */
export type PriceHistoryGranularity = 'day' | 'week';

/**
 * Classification of a change step between consecutive observations.
 * Mirrors StepClassification from core-domain; the API never emits
 * UNCHANGED steps (they carry no chart information), but the vocabulary
 * is kept whole to match the contract.
 */
export type PriceHistoryStepClassification =
  | 'TAX_RULE_CHANGE'
  | 'MERCHANT_PRICE_CHANGE'
  | 'TRANSPORT_CHANGE'
  | 'MIXED'
  | 'UNCHANGED';

/** Query parameters for the price-history endpoint (from/to are required). */
export interface PriceHistoryQuery {
  /** Series to return (default: price). */
  readonly metric?: PriceHistoryMetric;
  /** Bucket granularity (default: day). */
  readonly granularity?: PriceHistoryGranularity;
  /** Range start, ISO date 'YYYY-MM-DD' (required). */
  readonly from: string;
  /** Range end (inclusive), ISO date 'YYYY-MM-DD' (required; range capped at 365 days). */
  readonly to: string;
  /** Optional merchant filter; omit for the product-wide series. */
  readonly merchant?: string;
}

/** One chart point, projected from a summary bucket for the requested metric. */
export interface PriceHistoryPoint {
  /** Bucket start anchor, ISO date 'YYYY-MM-DD' (Monday for weekly buckets). */
  readonly periodStart: string;
  readonly openCents: number;
  readonly closeCents: number;
  readonly minCents: number;
  readonly maxCents: number;
  readonly avgCents: number;
  readonly observationCount: number;
  /** Strictest reliability among the bucket's observations. */
  readonly reliability: ReliabilityStatus;
}

/** Which cost inputs of an attributed step changed between two observations. */
export interface PriceHistoryMovedInputs {
  readonly exciseRule: boolean;
  readonly containerDutyRule: boolean;
  readonly merchantPrice: boolean;
  readonly transport: boolean;
}

/** Rule-version labels bounding a crossed version boundary. */
export interface PriceHistoryRuleBoundary {
  readonly fromVersionLabel: string | null;
  readonly toVersionLabel: string | null;
}

/** One classified change within a single merchant series — evidence only. */
export interface PriceHistoryAttribution {
  readonly merchant: string;
  readonly classification: PriceHistoryStepClassification;
  readonly fromObservedAt: string;
  readonly toObservedAt: string;
  readonly movedInputs: PriceHistoryMovedInputs;
  readonly exciseRuleBoundary: PriceHistoryRuleBoundary | null;
  readonly containerDutyRuleBoundary: PriceHistoryRuleBoundary | null;
}

/** GET /api/v1/products/:id/price-history — chart series with provenance. */
export interface PriceHistoryResponse {
  readonly productId: number;
  /** Requested merchant filter, or null for the product-wide series. */
  readonly merchant: string | null;
  readonly metric: PriceHistoryMetric;
  readonly granularity: PriceHistoryGranularity;
  readonly from: string;
  readonly to: string;
  readonly series: readonly PriceHistoryPoint[];
  /** Classified changes within the range, ordered by toObservedAt ascending. */
  readonly attribution: readonly PriceHistoryAttribution[];
  /**
   * Earliest observation timestamp (merchant-filtered when a merchant was
   * requested), or null when none exist — drives "data available from".
   */
  readonly earliestAvailableObservationDate: string | null;
}

// ---------------------------------------------------------------------------
// Feature flags (GET /api/v1/feature-flags)
// ---------------------------------------------------------------------------

/**
 * Public feature-flag states for UI gating. Only the flags the frontend
 * consumes are declared — the API response is a superset keyed by flag
 * identifier, and unknown keys are ignored.
 */
export interface FeatureFlagsResponse {
  readonly flags: {
    /**
     * enable_historical_price_intelligence — gates the price-history API
     * and the charts on the calculator result view / compare page.
     */
    readonly HISTORICAL_PRICE_INTELLIGENCE: boolean;
    /**
     * enable_basket_optimization — gates the multi-item basket
     * optimization API and the compare page's basket section.
     */
    readonly BASKET_OPTIMIZATION: boolean;
    /**
     * enable_advanced_features — Phase 2 rollout flag: gates the scenario
     * endpoints/UI, report exports, merchant reliability display, and the
     * declaration guidance panel.
     */
    readonly ADVANCED_FEATURES: boolean;
  };
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
  /**
   * Merchant names with current offers for this product (sorted, unique).
   * Feeds the factual data-freshness display; never affects ordering.
   */
  readonly merchants?: readonly string[];
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