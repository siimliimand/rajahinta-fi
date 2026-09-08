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
  /**
   * Additive merchant-warnings block (trust-and-reach-roadmap task 2.2):
   * PUBLISHED blacklist entries matching the page's offer merchants.
   * Absent when nothing matches or the lookup fails — never null.
   * Strictly informational: never filters, reorders, or annotates items.
   */
  readonly merchantWarnings?: readonly MerchantWarning[];
}

/**
 * One public merchant warning — the display face of a PUBLISHED blacklist
 * entry joined additively into product/search/compare responses (mirrors
 * MerchantWarning in api-worker's merchant-warnings service).
 */
export interface MerchantWarning {
  /** Normalized domain of the warned merchant (entry identity, domain half). */
  readonly merchantDomain: string;
  /** Normalized name of the warned merchant (entry identity, name half). */
  readonly merchantName: string;
  /** The published-standard basis the operator published under. */
  readonly standardMet: string;
  /** When the entry was published (ISO-8601). */
  readonly publishedAt: string;
  /** The ranking-methodology page explaining what a warning means. */
  readonly methodologyUrl: string;
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
  /**
   * Read-time €/g ethanol metric for this offer (mirrors core-domain's
   * `UnitPriceResult`), attached by the API only while
   * enable_unit_price_eur_per_gram is on — key absent otherwise.
   */
  readonly eurPerGram?: UnitPriceResult;
}

// ---------------------------------------------------------------------------
// Unit-price metric (mirrors core-domain unitprice.types)
// ---------------------------------------------------------------------------

/** Why the €/g metric could not be produced (mirrors core-domain). */
export type UnitPriceUnavailableReason =
  | 'MISSING_VOLUME'
  | 'MISSING_ALCOHOL_FRACTION'
  | 'INVALID_VOLUME'
  | 'INVALID_ALCOHOL_FRACTION'
  | 'INVALID_PRICE';

/** Successful metric: value present, offer-price provenance attached. */
export interface UnitPriceValue {
  readonly status: 'computed' | 'ESTIMATED';
  /** Offer price in euro cents per gram of pure ethanol. */
  readonly centsPerGram: number;
  /** Grams of pure ethanol in one unit (volume × fraction × 789 g/l). */
  readonly ethanolGrams: number;
  /** Reliability of the offer price the metric was derived from. */
  readonly priceReliability: ReliabilityStatus;
}

/** Metric could not be produced: explicitly no value, with a reason. */
export interface UnitPriceUnavailable {
  readonly status: 'unavailable';
  readonly centsPerGram: null;
  readonly ethanolGrams: null;
  readonly reason: UnitPriceUnavailableReason;
}

/** Discriminated €/g result — discriminate on `status` (mirrors core-domain). */
export type UnitPriceResult = UnitPriceValue | UnitPriceUnavailable;

// ---------------------------------------------------------------------------
// Unit-price category ranking (GET /api/v1/unitprice/ranking)
// Mirrors the route's RankingRow projection (unitprice.routes.ts). Purely
// informational listing: the ascending €/g order is a read-model view and
// never feeds search order, default ordering, or any calculation input.
// ---------------------------------------------------------------------------

/** One ranked row — the minimal per-product facts the value page renders. */
export interface UnitPriceRankingItem {
  readonly productId: number;
  readonly name: string;
  readonly brand: string;
  /** The offer the ranked value was derived from (provenance). */
  readonly offerId: number;
  /** Offer price in euro cents per gram of pure ethanol, ascending order. */
  readonly centsPerGram: number;
  /** Grams of pure ethanol in one unit (volume × fraction × 789 g/l). */
  readonly ethanolGrams: number;
  /** Reliability of the offer price the ranked value was derived from. */
  readonly reliabilityStatus: 'VERIFIED' | 'ESTIMATED';
}

/** Response of the per-category ranking listing. */
export interface UnitPriceRankingResponse {
  /** The canonical category key the listing was requested for. */
  readonly category: string;
  readonly items: UnitPriceRankingItem[];
}

export interface ProductDetailResponse {
  readonly product: ProductDetail;
  readonly offers: RetailOffer[];
  /**
   * Additive merchant-warnings block (trust-and-reach-roadmap task 2.2):
   * PUBLISHED blacklist entries matching this product's offer merchants.
   * Absent when nothing matches or the lookup fails — never null.
   * Strictly informational: the offers array and its order are untouched.
   */
  readonly merchantWarnings?: readonly MerchantWarning[];
  /**
   * Factual per-merchant reliability scores for the offers' merchants.
   * Absent when the API supplies none (never null). Informational only —
   * the offers' order is never affected.
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
// Mirrors declaration.dto.ts. The guidance field is optional (omitted,
// never null).
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

/**
 * Statutory liability flags under the 1 Sep 2024 joint-liability reform.
 * `null` for records computed before the reform.
 */
export interface DeclarationLiabilityNotice {
  readonly classification: 'DistanceSelling' | 'DistanceBuying' | 'TravellerImport';
  readonly buyerMustFileAdvanceNotice: boolean;
  readonly buyerJointlyLiable: boolean;
  readonly ruleSetVersion: string;
}

/** Advanced declaration guidance — informational, read-only. */
export interface DeclarationGuidance {
  readonly derivation: DeclarationDerivation;
  readonly deadline: DeclarationDeadline;
  /** Joint-liability / buyer-obligation flags, or `null` pre-reform. */
  readonly liabilityNotice: DeclarationLiabilityNotice | null;
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
  /** Optional; omitted (never null) when the API supplies none. */
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

/**
 * Machine-readable category for each itemized cost line.
 *
 * `otherCharges` was removed (task 10.3, mirroring core-domain): it was
 * a hardcoded zero and a dead contract.
 */
export type CostCategory =
  | 'foreignRetailPrice'
  | 'transportCost'
  | 'alcoholExciseEstimate'
  | 'containerDutyEstimate';

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
  /** 'NotPersisted' — older records were stored without the classification. */
  readonly classification:
    | 'DistanceSelling'
    | 'DistanceBuying'
    | 'TravellerImport'
    | 'NotPersisted';
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

/** Machine-readable reason an offer was excluded from a calculation. */
export type OfferExclusionReason = 'NO_VALID_EUR_CONVERSION';

/**
 * An offer excluded from the calculation because it lacked a valid EUR
 * conversion (mirrors core-domain, task 1.5) — stays visible with its
 * reason and original amount so a mixed-currency total can never
 * masquerade as EUR.
 */
export interface OfferExclusion {
  readonly offerId: number;
  readonly merchant: string;
  readonly country: string;
  readonly reason: OfferExclusionReason;
  readonly detail: string;
  readonly originalPriceCents: number | null;
  readonly originalCurrency: string | null;
}

/**
 * A pre-conversion price in its source currency — display-only data
 * carried alongside the EUR amounts (design D2).
 */
export interface OriginalPrice {
  readonly priceCents: number;
  readonly currency: string;
}

/**
 * Factual comparison of the calculated offer against the product's Alko
 * reference price (change drop-sweden-eur-only-alko-benchmark). Display
 * only: it never enters `totalCents` or the itemized breakdown.
 *
 * Absence handling: the API emits the key only when a reference offer
 * exists, so no `'unavailable'` variant exists — an omitted key is the
 * normal "no reference" state (pre-change records included), never an
 * error.
 */
export interface AlkoBenchmark {
  readonly status: 'available';
  /** Alko reference price in EUR cents. */
  readonly referencePriceCents: number;
  /** Calculated offer − reference, EUR cents (negative = import cheaper). */
  readonly differenceCents: number;
  /** Difference as percent of the reference, one decimal. */
  readonly differencePercent: number;
  readonly reliabilityStatus: ReliabilityStatus;
  /** Observation timestamp of the reference offer, ISO 8601. */
  readonly observedAt: string;
}

export interface CalculatorResult {
  readonly itemizedCosts: readonly ItemizedCost[];
  /** Offers excluded for lacking a valid EUR conversion (task 1.5). */
  readonly excludedOffers: readonly OfferExclusion[];
  /** Original (pre-conversion) price of the selected offer, when any. */
  readonly originalRetailPrice?: OriginalPrice;
  /**
   * Display-only Alko reference comparison — present only when the
   * product has Alko reference offers; absent otherwise (never null).
   */
  readonly alkoBenchmark?: AlkoBenchmark;
  readonly foreignRetailPrice: number;
  readonly transportCost: number;
  readonly alcoholExciseEstimate: number;
  readonly containerDutyEstimate: number;
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

/** Correction-flag list response (GET /api/v1/corrections, /ops/console/corrections). */
export interface CorrectionListResponse {
  readonly items: CorrectionItem[];
  readonly total: number;
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
// Price alerts (GET/POST/PATCH/DELETE /api/v1/account/alerts)
// Mirrors the serialization in api-worker alerts.routes.ts — ISO timestamps,
// accountId omitted (the list is always caller-scoped).
// ---------------------------------------------------------------------------

/** Alert delivery state: active alerts are evaluated, paused alerts are kept but mute. */
export type PriceAlertStatus = 'active' | 'paused';

/**
 * What triggers the alert (task 4.2, change trust-and-reach-roadmap):
 * PRICE is the original threshold watch; TAX_CHANGE fires when a
 * confirmed rate-version change moves the product's landed cost and
 * carries no threshold.
 */
export type PriceAlertKind = 'PRICE' | 'TAX_CHANGE';

/** A price alert row as served by the account API (ISO timestamps). */
export interface PriceAlert {
  readonly id: number;
  readonly productId: number;
  readonly kind: PriceAlertKind;
  /** PRICE alerts: threshold in integer euro cents (1–1,000,000). TAX_CHANGE alerts: always null. */
  readonly thresholdCents: number | null;
  readonly status: PriceAlertStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Operator console API (/ops/console/** — bearer-token realm)
// ---------------------------------------------------------------------------

/** Aggregated governance state of one registry merchant (console worklist). */
export interface OpsGovernanceMerchant {
  readonly merchantId: string;
  readonly name: string;
  readonly country: string;
  readonly feedUrl: string;
  readonly permissionStatus: 'GRANTED' | 'PENDING' | 'REVOKED' | 'EXPIRED';
  readonly sourceCount: number;
  readonly hasWarnings: boolean;
}

/** GET /ops/console/governance response. */
export interface OpsGovernanceListResponse {
  readonly items: OpsGovernanceMerchant[];
  readonly total: number;
}

/** Grant/revoke mutation result. */
export interface OpsGovernanceMutationResponse {
  readonly merchantId: string;
  readonly permissionStatus: 'GRANTED' | 'PENDING' | 'REVOKED' | 'EXPIRED';
  readonly updatedSources: number;
  readonly changed: boolean;
}

/** A pending tax rate-review entry. */
export interface OpsPendingTaxReview {
  readonly id: string;
  readonly createdAt: string;
  readonly description: string;
  readonly source: string;
  readonly versionLabel: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedRole: string | null;
}

/** GET /ops/console/confirmations response. */
export interface OpsConfirmationListResponse {
  readonly taxReviews: OpsPendingTaxReview[];
}

/** Tax review approval/rejection response. */
export interface OpsTaxReviewResolvedResponse {
  readonly id: string;
  readonly status: 'resolved';
  readonly resolution: 'approve' | 'reject';
  readonly resolvedAt: string;
}

/** One durable audit entry as surfaced in the console trail. */
export interface OpsAuditEntry {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly author: string;
  readonly reason: string;
  readonly timestamp: string;
}

/** GET /ops/console/audit response. */
export interface OpsAuditListResponse {
  readonly items: OpsAuditEntry[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Session (GET /api/v1/account/me — identity derived server-side)
// ---------------------------------------------------------------------------

/**
 * Identity of the signed-in account as derived by the server from the
 * httpOnly `rajahinta_session` cookie. The client never holds the token
 * itself. `verified` reports email-ownership confirmation — a status
 * badge, never a lockout (USER-GUIDE).
 */
export interface SessionStatus {
  readonly userId: string;
  readonly email: string;
  readonly verified: boolean;
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

/**
 * Compare-view sort orders: the shared contract above plus the €/g
 * ethanol option. EUR_PER_GRAM is a compare-view-only client-side order
 * (the backend ranking contract in core-domain does not include it), so
 * it deliberately lives here and not in SortOrder — the ranking
 * methodology page and its backend-lockstep description reference stay
 * untouched.
 */
export type CompareSortOrder = SortOrder | 'EUR_PER_GRAM';

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
  /**
   * €/g ethanol metric shown in the compare view's €/g column — the best
   * (lowest centsPerGram, then offer id) value across the product detail's
   * offers. Present only when the detail payload resolved; absent means
   * no value may be shown.
   */
  readonly eurPerGram?: UnitPriceResult;
  /** Optional retail-offer ID for the outbound redirect link */
  readonly offerId?: number;
  /** Optional merchant display name (shown as the link label) */
  readonly merchantName?: string;
  /**
   * Merchant names with current offers for this product (sorted, unique).
   * Feeds the factual data-freshness display; never affects ordering.
   */
  readonly merchants?: readonly string[];
  /**
   * PUBLISHED blacklist warnings joined from the product-detail payload
   * (trust-and-reach-roadmap task 2.4). Absent when the detail fetch
   * resolved nothing; rendered as a display-only notice per column.
   */
  readonly merchantWarnings?: readonly MerchantWarning[];
}

// ---------------------------------------------------------------------------
// Verified outcomes (GET /api/v1/accuracy, history ?outcomes=1, POST
// /api/v1/calculations/:id/outcome — trust-and-reach-roadmap tasks 3.2/3.3)
// ---------------------------------------------------------------------------

/**
 * Public accuracy statistic. `withinMarginShare` is a fraction in [0,1]
 * and is null EXACTLY when count is 0 — the honest empty state renders
 * "no outcomes yet", never a percentage (spec calculation-outcomes).
 */
export interface AccuracyStatistic {
  readonly count: number;
  readonly withinMarginShare: number | null;
  /** ISO-8601 read time of the aggregation. */
  readonly asOf: string;
  /**
   * The exact user-reported wording per locale, supplied by the API —
   * the UI renders it verbatim and never invents its own label.
   */
  readonly label: { readonly fi: string; readonly en: string };
}

/** One history record's outcome flag (GET /account/history?outcomes=1). */
export interface HistoryOutcomeFlag {
  readonly recordId: number;
  /** True when the account already reported an outcome for the record. */
  readonly outcomeReported: boolean;
}

/** Response of POST /api/v1/calculations/:id/outcome. */
export interface OutcomeReport {
  readonly id: number;
  readonly calculationRecordId: number;
  readonly estimatedTotalCents: number;
  readonly reportedTotalCents: number;
  /** Whether the report landed within the 5 % margin of the estimate. */
  readonly withinMargin: boolean;
  readonly reportedAt: string;
}

// ---------------------------------------------------------------------------
// Blog (GET /api/v1/blog/posts — trust-and-reach-roadmap task 5.1/5.2)
// ---------------------------------------------------------------------------

/** Index item of a PUBLISHED post — no body. */
export interface BlogPostIndexItem {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  /** The rate-dataset version the post documents, when version-keyed. */
  readonly rateDatasetVersion: string | null;
  readonly publishedAt: string | null;
}

/** GET /api/v1/blog/posts response (PUBLISHED only, one locale). */
export interface BlogPostListResponse {
  readonly items: readonly BlogPostIndexItem[];
  readonly total: number;
}

/** One full PUBLISHED post — body included. */
export interface BlogPost {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly rateDatasetVersion: string | null;
  readonly publishedAt: string | null;
  readonly bodyMarkdown: string;
}

// ---------------------------------------------------------------------------
// Share snapshots (GET /api/v1/share/:publicId — task 6.1/6.2)
// ---------------------------------------------------------------------------

/** The frozen public copy (mirrors ShareSnapshotPayload in core-domain). */
export interface ShareSnapshotPayload {
  readonly type: 'landed-cost-snapshot';
  readonly product: {
    readonly name: string;
    readonly brand: string | null;
    readonly category: string;
  };
  readonly quantity: number;
  readonly totalCents: number;
  readonly currency: string;
  /** Itemized estimate lines (JSON) — rendered defensively. */
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly destination: string;
  /** The structural disclaimer object copied at share time. */
  readonly disclaimer: unknown;
  readonly calculatedAt: string;
}

/** GET /api/v1/share/:publicId response — no account fields by contract. */
export interface ShareSnapshotResponse {
  readonly publicId: string;
  readonly snapshot: ShareSnapshotPayload;
  readonly createdAt: string;
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
  /**
   * Seconds until a retry is allowed. Present on 429 rate-limit
   * responses, mirroring the `Retry-After` response header the
   * rate-limit guard sets.
   */
  readonly retryAfterSeconds?: number;
  /**
   * Machine-readable error code for flows that react programmatically.
   * Present on 403 responses that require age (re)confirmation
   * (`AGE_GATE_REQUIRED`).
   */
  readonly code?: string;
}