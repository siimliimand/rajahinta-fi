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

/**
 * Display-only savings embed on one catalog item (task 1.1, change
 * savings-first-catalog-and-prefill): the latest materialized day's
 * computed figures for this product, read from the savings snapshot at
 * the API's route layer. Present only when the product has a snapshot row
 * for the `savingsAsOf` day — no placeholder, no zero. Display face only:
 * never feeds a calculation, ranking input, or basket optimization.
 */
export interface ProductSavingsEmbed {
  readonly landedTotalCents: number;
  readonly alkoReferenceCents: number | null;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly reliability: string;
  readonly confidence: string;
}

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
  /**
   * Read-time €/g ethanol metric for this listing row (mirrors the API's
   * SearchItemResponse embed, honest-trust-surfaces task 2.2): computed
   * from the cheapest current-available single offer, labeled with that
   * offer's price reliability. Optional so the type tolerates cached
   * responses captured before the embed existed; an absent key or an
   * `unavailable` status renders nothing on the card — no placeholder,
   * no zero. Never reorders the listing.
   */
  readonly eurPerGram?: UnitPriceResult;
  /**
   * Display-only savings embed (task 1.1, change
   * savings-first-catalog-and-prefill): the product's landed total, Alko
   * reference, and gap figures from the latest materialized day. Optional
   * so the type tolerates cached responses captured before the embed
   * existed; absent when the product has no snapshot row for the
   * `savingsAsOf` day — no placeholder, no zero. Never reorders the
   * listing and never feeds a calculation.
   */
  readonly savings?: ProductSavingsEmbed;
}

export interface ProductSearchResult {
  readonly items: ProductSearchItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
  /**
   * The materialized day the items' `savings` embeds were read from
   * (task 1.1, change savings-first-catalog-and-prefill) — null while no
   * day has materialized. Optional in this mirror so cached responses
   * captured before the field existed still parse; the live API always
   * carries it.
   */
  readonly savingsAsOf?: string | null;
  /**
   * Additive merchant-warnings block (trust-and-reach-roadmap task 2.2):
   * PUBLISHED blacklist entries matching the page's offer merchants.
   * Absent when nothing matches or the lookup fails — never null.
   * Strictly informational: never filters, reorders, or annotates items.
   */
  readonly merchantWarnings?: readonly MerchantWarning[];
  /**
   * Zero-result did-you-mean candidate (task 3.3, change
   * finnish-first-client-experience): a brand token within the bounded
   * edit distance of the query. Attached by the API ONLY when the ranked
   * search returned zero items and a candidate was found — absent
   * otherwise (never null), and the original query fields are untouched.
   */
  readonly suggestion?: string;
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
  /**
   * Registry display name for `merchant` (fi-locale-surface-hardening
   * 2.5, additive) — resolved by the API from merchant_registry at read
   * time. Absent when the merchant is unregistered or the lookup
   * degraded: render `merchantName ?? merchant`, and keep `merchant` as
   * the id for links, filters, and analytics.
   */
  readonly merchantName?: string;
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

/**
 * Why the €/g metric could not be produced (mirrors core-domain).
 * `MISSING_PRICE` (no current-available offer to price) and
 * `ZERO_ETHANOL` (present, valid, zero ABV — no denominator) close the
 * gap to the domain union the API actually emits, as does
 * `INVALID_UNITS_PER_PACKAGE` (a supplied pack size that is not a
 * finite count ≥ 1 — pack rows price the package against its total
 * volume).
 */
export type UnitPriceUnavailableReason =
  | 'MISSING_VOLUME'
  | 'MISSING_ALCOHOL_FRACTION'
  | 'MISSING_PRICE'
  | 'INVALID_VOLUME'
  | 'INVALID_UNITS_PER_PACKAGE'
  | 'ZERO_ETHANOL'
  | 'INVALID_ALCOHOL_FRACTION'
  | 'INVALID_PRICE';

/** Successful metric: value present, offer-price provenance attached. */
export interface UnitPriceValue {
  readonly status: 'computed' | 'ESTIMATED';
  /** Offer price in euro cents per gram of pure ethanol. */
  readonly centsPerGram: number;
  /**
   * Grams of pure ethanol the priced package contains
   * (unit volume × units-per-package × fraction × 789 g/l).
   */
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
  /**
   * How transport is arranged (task 2.1, change
   * finnish-first-client-experience). Absent means `SELLER_ARRANGED` —
   * the delivery path, byte-identical to the pre-traveller-mode
   * payload. `PERSONAL` runs the traveller-allowance branch.
   */
  readonly transportArrangement?: ScenarioTransportArrangement;
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
  | 'containerDutyEstimate'
  /**
   * Import-VAT line (mirrors core-domain CostCategory; design D6).
   * Emitted when the offer's seller country differs from the
   * destination — traveller-mode results carry it for the taxed
   * surplus portion (task 2.1, change finnish-first-client-experience).
   */
  | 'importVatEstimate';

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
    /**
     * Machine-readable closed-set evidence code (additive, task 3.1 of
     * consumer-clarity-and-discovery; mirrors core-domain EvidenceDetail).
     * Optional: evidence appended outside the rule pipeline (the
     * calculator's traveller-allowance evidence) predates codes — clients
     * fall back to the unchanged `observation` when absent.
     */
    readonly code?: EvidenceCode;
  }>;
  readonly evidenceSummary: string;
}

/**
 * Closed, machine-readable set of classification-evidence codes (mirrors
 * core-domain `EvidenceCode`, design D3 of
 * consumer-clarity-and-discovery). The frontend composes locale sentences
 * from `code + supportingData values`; adding a code in core-domain
 * without extending this union — and the frontend message mapping — fails
 * compilation.
 */
export type EvidenceCode =
  | 'BUYER_TRAVELLING'
  | 'PERSONAL_ALLOWANCE_APPLIES'
  | 'SELLER_CARRIAGE'
  | 'BUYER_CARRIAGE'
  | 'SELLER_NOT_INVOLVED'
  | 'SELLER_IDENTITY_CONFIRMED'
  | 'SELLER_IDENTITY_UNVERIFIED'
  | 'TRANSPORT_UNDETERMINED';

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

// ---------------------------------------------------------------------------
// Plausibility sanity rail (mirrors core-domain calculator.types, change
// unit-integrity-and-result-trust, task 2.1)
// ---------------------------------------------------------------------------

/**
 * Machine-readable code identifying which plausibility rail tripped.
 * One code per rail — the stable join key for consumers; never parsed
 * out of prose.
 */
export type SanityNoteCode =
  | 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY'
  | 'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY';

/**
 * A single plausibility-rail trip record. The rail never alters amounts —
 * a note explains a reliability/confidence downgrade by naming the actual
 * figures that breached the threshold.
 */
export interface SanityNote {
  /** Which rail tripped. */
  readonly code: SanityNoteCode;
  /** The result component the downgrade applies to. */
  readonly component: 'alcoholExciseEstimate' | 'containerDutyEstimate';
  /** Human-readable explanation naming the actual figures and threshold. */
  readonly detail: string;
  /** The figures behind the breach, in euro-cents. */
  readonly figures: {
    /** The implausible component's line amount (quantity-multiplied). */
    readonly lineComponentCents: number;
    /** The line's foreign retail price (quantity-multiplied). */
    readonly lineRetailPriceCents: number;
    /** The multiple above which a component is implausible. */
    readonly thresholdMultiple: number;
  };
}

/**
 * Delivery-mode traveller-alternative estimate (mirrors the core-domain
 * `TravellerAlternativeCallout`, task 1.2 of change
 * finnish-first-client-experience): the labelled out-of-pocket estimate
 * for ONE traveller carrying the same quantity within the effective
 * traveller allowance caps. Purely additive and display-only — it never
 * enters `totalCents`, the itemized breakdown, or any status. It is
 * computed live per request: present only on the POST response, never on
 * GET/persisted results.
 */
export interface TravellerAlternative {
  /** Allowed quantity × unit shelf price, in euro-cents. */
  readonly estimatedTotalCents: number;
  /** Whether the FULL requested quantity fits the category cap. */
  readonly withinAllowance: boolean;
  /** `versionLabel` of the allowance dataset the estimate resolves against. */
  readonly allowanceDatasetVersion: string;
  /** Canonical tax-rule category the cap was looked up with. */
  readonly categoryKey: string;
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
  /**
   * Plausibility-rail trip notes when a line's duty component breached
   * the plausibility threshold against the line's retail price (mirrors
   * core-domain). Key absent for a plausible calculation — render-nothing,
   * never null, never a placeholder.
   */
  readonly sanityNotes?: readonly SanityNote[];
  /**
   * Traveller-alternative estimate for delivery-mode results (task 2.2,
   * change finnish-first-client-experience). Present exactly when a
   * published allowance dataset resolved for the transaction date AND
   * the product's category has a boundable cap row AND the request was a
   * delivery arrangement. Every degrade case — no effective dataset, no
   * cap row, or a PERSONAL request — leaves the key ABSENT (never null,
   * never a placeholder): absence is the render-nothing state. Purely
   * additive display-only data; it never enters the delivery figures.
   * Live POST responses only — GET/persisted results never carry it.
   */
  readonly travellerAlternative?: TravellerAlternative | null;
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
    /**
     * `versionLabel` of the traveller-allowance dataset applied to this
     * computation (task 2.1, change finnish-first-client-experience).
     * Present exactly when the request was traveller-mode (`PERSONAL`)
     * and a published dataset resolved for the transaction date — key
     * absent for delivery computations (absence is the not-applied
     * state, never null). Mirrors core-domain's metadata contract.
     */
    readonly allowanceDatasetVersion?: string;
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
 * What triggers the alert (task 4.2, change trust-and-reach-roadmap;
 * LANDED_COST + CATEGORY task 1.2, change expand-alerts-accuracy-breakdowns):
 * PRICE is the original threshold watch; TAX_CHANGE fires when a confirmed
 * rate-version change moves the product's landed cost and carries no
 * threshold; LANDED_COST watches the product-wide landed-cost close against
 * a threshold; CATEGORY watches a whole canonical category's minimum shelf
 * price and carries a category instead of a product.
 */
export type PriceAlertKind = 'PRICE' | 'TAX_CHANGE' | 'LANDED_COST' | 'CATEGORY';

/**
 * Canonical product categories the CATEGORY kind accepts (mirrors
 * PRODUCT_CATEGORIES in the D1 schema; the API enforces the set and
 * answers 400 naming it for unknown values).
 */
export type AlertCategory =
  | 'beer'
  | 'wine_still'
  | 'wine_sparkling'
  | 'intermediate_products'
  | 'other_fermented'
  | 'spirits';

/** A price alert row as served by the account API (ISO timestamps). */
export interface PriceAlert {
  readonly id: number;
  /** Product-scoped kinds only — CATEGORY rows watch no product (null). */
  readonly productId: number | null;
  readonly kind: PriceAlertKind;
  /** CATEGORY rows carry the watched canonical category; product-scoped kinds serialize null. */
  readonly category: string | null;
  /** Threshold kinds (PRICE, LANDED_COST, CATEGORY): integer euro cents (1–1,000,000). TAX_CHANGE alerts: always null. */
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
 * True catalog coverage behind the accuracy statistic (change
 * honest-trust-surfaces, task 3.1): the stored product count, the total
 * offer observation count, and the latest ingestion watermark — read-time
 * D1 aggregates, true values only. Display-only on the UI side; no value
 * here feeds any calculation input.
 */
export interface AccuracyCoverage {
  readonly productCount: number;
  readonly offerObservations: number;
  /** ISO-8601 watermark of the latest fully materialized ingest; null = none yet. */
  readonly lastIngestAt: string | null;
}

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
  /**
   * Additive catalog-coverage block (honest-trust-surfaces task 3.1).
   * Optional so the type also tolerates responses captured before the
   * block existed.
   */
  readonly coverage?: AccuracyCoverage;
}

/** The two split dimensions the accuracy breakdown endpoint accepts. */
export type AccuracyBreakdownDimension = 'category' | 'carrier';

/**
 * Honesty state of one breakdown cell (change
 * expand-alerts-accuracy-breakdowns, design D5): `share` (n ≥ 10) carries
 * a numeric `withinMarginShare`; `count_only` (1–9) suppresses the share —
 * the percentage never enters the response, so no client can render a
 * below-floor percentage; `empty` (n = 0) is the honest empty state.
 */
export type AccuracyBreakdownCellState = 'share' | 'count_only' | 'empty';

/** One cell of the accuracy breakdown (GET /api/v1/accuracy?groupBy=…). */
export interface AccuracyBreakdownCell {
  /** The dimension's raw value — a canonical category or a carrier. */
  readonly key: string;
  readonly count: number;
  readonly withinMarginShare: number | null;
  readonly state: AccuracyBreakdownCellState;
}

/** Response of GET /api/v1/accuracy?groupBy=category|carrier. */
export interface AccuracyBreakdown {
  readonly dimension: AccuracyBreakdownDimension;
  readonly cells: readonly AccuracyBreakdownCell[];
  /** ISO-8601 read time of the aggregation. */
  readonly asOf: string;
  /** Same API-supplied user-reported wording as the global statistic. */
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