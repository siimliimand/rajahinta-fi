/**
 * Calculator types — input/output contracts and port interfaces for the
 * LandedCostCalculatorService orchestrator.
 *
 * @module CalculatorTypes
 */

import type { ReliabilityStatus } from '../reliability/reliability.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';
import type { ConfidenceDetail } from '../reliability/confidence-framework.types';
import type { ClassificationResult } from '../classification/classification.types';
import type { AlkoBenchmarkAvailable } from '../benchmark/benchmark.types';

// ---------------------------------------------------------------------------
// Disclaimer — defined locally to avoid circular dependency through barrel
// ---------------------------------------------------------------------------

/**
 * Disclaimer associated with every calculation result.
 *
 * `version` follows semver — bump when the legal text changes materially
 * (e.g. a new regulation or updated boilerplate).
 */
export interface Disclaimer {
  readonly text: string;
  readonly language: 'fi' | 'en';
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * How transport is arranged for a cross-border purchase.
 *
 * - `SELLER_ARRANGED`:    The seller arranges and pays for transport (default).
 * - `INDEPENDENT_CARRIER`: The buyer arranges transport via a third-party carrier.
 * - `PERSONAL`:           The buyer physically carries goods across the border.
 */
export type TransportArrangement =
  | 'SELLER_ARRANGED'
  | 'INDEPENDENT_CARRIER'
  | 'PERSONAL';

// ---------------------------------------------------------------------------
// Shared offer-constrained computation types
// ---------------------------------------------------------------------------

/**
 * Transport-related context for the shared item-cost computation.
 *
 * WHY separate from the core:
 *   - The single-item calculator resolves transport via TransportEstimationService.
 *   - The basket optimizer computes per-store consolidated shipping via
 *     BasketShippingCalculator, which may differ from per-item transport.
 *   - Passing transport context as a parameter lets BOTH paths share every other
 *     engine step (tax, classification, confidence), guaranteeing structural
 *     consistency (T2.8) without constraining transport strategy.
 *
 * When null (transport unavailable), classification defaults and confidence
 * degrades gracefully.
 */
export interface ComputeItemCostsTransportContext {
  /** Reliability of the transport cost estimate. */
  readonly transportStatus: ReliabilityStatus;
  /** Whether the seller is involved in transport arrangements. */
  readonly sellerInvolvementIndicator: boolean;
  /** Carrier identifier (defaults to offer.merchant when absent). */
  readonly carrierId: string;
  /**
   * Transport amount in euro-cents for the consignment — a component of the
   * versioned import-VAT base (design D5/D6). Absent (basket candidate
   * enumeration, transport unavailable) contributes 0: the consolidated
   * basket shipping is resolved after per-item costs, so that surface's
   * VAT base names transport as 0 rather than guessing a figure.
   */
  readonly transportCents?: number;
}

/**
 * Result of the shared offer-constrained item-cost computation.
 *
 * Contains everything tax/classification/confidence-derived for a given
 * product + retail-offer pair, excluding transport. The caller (single-item
 * calculator or basket optimizer) adds transport-specific costs, assembles
 * the full itemized list, and persists.
 */
export interface ComputedItemCostsResult {
  readonly retailTotal: number;
  readonly retailStatus: ReliabilityStatus;

  readonly exciseTotal: number;
  readonly exciseStatus: ReliabilityStatus;
  readonly exciseRuleVersionId: number | null;

  readonly containerDutyTotal: number;
  readonly containerDutyStatus: ReliabilityStatus;
  readonly containerDutyRuleVersionId: number | null;

  readonly classificationResult: ClassificationResult;
  readonly classificationStatus: ReliabilityStatus;

  readonly confidenceOverall: ConfidenceLevel;
  readonly confidenceBreakdown: readonly ConfidenceDetail[];

  /**
   * Plausibility-rail trip notes when a line's duty component exceeded
   * the plausibility threshold against the line's retail price. Key
   * absent for a plausible calculation — absence is the healthy state,
   * never an empty list. Explains a confidence/reliability downgrade;
   * never accompanies an amount change.
   */
  readonly sanityNotes?: readonly SanityNote[];

  readonly datasetVersions: readonly string[];

  /**
   * Import VAT for the consignment when the offer's seller country differs
   * from the destination (design D6), in euro-cents. Key absent for
   * domestic offers — absence is the zero-contribution state, never a
   * displayed zero.
   */
  readonly importVatTotal?: number;
  /** Reliability of the import-VAT figure; present exactly when importVatTotal is. */
  readonly importVatStatus?: ReliabilityStatus;
  /** Import-VAT dataset version that produced the figure; same presence contract. */
  readonly importVatRateVersionId?: string;

  /**
   * `versionLabel` of the traveller-allowance dataset applied to this
   * computation (task 1.1, change finnish-first-client-experience).
   * Present exactly when the request was traveller-mode (`PERSONAL`) and
   * a published dataset resolved for the transaction date — key absent
   * for delivery computations (absence is the not-applied state).
   */
  readonly allowanceDatasetVersion?: string;

  /**
   * Itemized costs excluding transport: [retail, excise, container duty]
   * plus the import-VAT line when the transaction is an import. The
   * caller splices in the transport line at position 1. Traveller-mode
   * computations label the within-allowance / over-allowance portions
   * per line instead (same canonical categories, per-line labels).
   */
  readonly itemizedCosts: readonly ItemizedCost[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Input to a landed-cost calculation.
 */
export interface CalculatorInput {
  /** Product master ID for the item being calculated. */
  readonly productId: number;

  /** Quantity of units (defaults to 1). */
  readonly quantity: number;

  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;

  /**
   * Optional carrier override for transport estimation.
   * When omitted, the calculator selects the best-matching carrier
   * from the product's retail-offer context.
   */
  readonly transportMethod?: string;

  /**
   * How transport is arranged. Defaults to SELLER_ARRANGED when absent.
   * Set to PERSONAL for buyer-physically-carries (traveller import) semantics.
   */
  readonly transportArrangement?: TransportArrangement;

  /** Optional session identifier for grouping calculations in audit trail. */
  readonly sessionId?: string;

  /**
   * When the import transaction occurs, ISO 8601 — the effective-date
   * lookup for the versioned import-VAT dataset (design D5). Absent means
   * the version effective now. Only figures whose dataset is
   * date-resolved (import VAT) consume it.
   */
  readonly transactionDate?: string;

  /**
   * Optional Alko reference product override (design D4, change
   * alko-reference-matching-pipeline): when present, the display-only
   * Alko benchmark resolves from THAT product's Alko offers — with the
   * exact benchmark selection predicate (newest observation, ties to the
   * higher offer id) — while the retail best-offer selection keeps
   * running on {@link productId}'s own offers. This is the
   * CONFIRMED-reference-link path: the calculated (foreign) product need
   * not carry any Alko offer of its own. Absent → the benchmark resolves
   * from the calculated product's own offers, exactly as before. An
   * override product with no usable Alko offers yields benchmark absence
   * — the honest state, never a guessed reference.
   */
  readonly alkoReferenceProductId?: number;
}

// ---------------------------------------------------------------------------
// Product and offer data — read models from the product-data port
// ---------------------------------------------------------------------------

/**
 * Product data needed by the calculator, resolved from the product master
 * by the data-access layer.
 */
export interface CalculatorProductData {
  readonly id: number;
  readonly regulatoryClassification: string;
  readonly category: string;
  readonly volumeLitres: number;
  readonly alcoholByVolume: number;
  readonly containerType: string;
  readonly depositSystemStatus: boolean | null;
  /** Weight in kilograms (may be estimated from volume when unknown). */
  readonly weightKg: number;
  /**
   * Stored product weight in grams (`product_master.weight_grams`, design
   * D5, change transport-confidence-unlock) — the per-unit weight basis
   * for transport estimation when present and positive. Null/absent means
   * the feed carried no weight: the calculator keeps the volume estimate
   * (`weightKg`) and its ESTIMATED cap. Read models that predate the
   * column may omit the field, which reads exactly as null — absence is
   * the unknown state, never a fabricated weight.
   */
  readonly storedWeightGrams?: number | null;
  readonly normalizedName: string;
}

/**
 * Stock state of a retail offer, as persisted on `retail_offers.availability`.
 * The column is a free string in every store, so read models narrow it onto
 * this union; anything unrecognized reads as 'unknown' (the column default).
 */
export type RetailOfferAvailability =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'unknown';

/**
 * True only for a CONFIRMED out-of-stock offer. 'unknown' and 'low_stock'
 * stay eligible — default selection degrades on evidence, never on absence
 * of it.
 */
export function isOfferOutOfStock(
  availability: RetailOfferAvailability | undefined,
): boolean {
  return availability === 'out_of_stock';
}

/**
 * A single retail offer for the product.
 *
 * Offers are EUR-only (design D3, change
 * drop-sweden-eur-only-alko-benchmark): `priceCents` is always EUR cents
 * and the currency union is pinned to the `'EUR'` literal, so a future
 * non-EUR feed fails to compile until FX is reintroduced deliberately.
 */
export interface CalculatorRetailOfferData {
  readonly id: number;
  /** Retail price in EUR cents — the canonical summable amount. */
  readonly priceCents: number;
  /**
   * Canonical price currency — the `'EUR'` literal only. Absent means EUR
   * (legacy read models that predate the currency field).
   */
  readonly currency?: 'EUR';
  readonly merchant: string;
  readonly country: string;
  readonly reliabilityStatus: ReliabilityStatus;
  /**
   * Last observed stock state. Absent means unknown (legacy read models
   * that do not carry the column), which never excludes an offer — only a
   * persisted `out_of_stock` keeps it out of default selection (task 4.1).
   */
  readonly availability?: RetailOfferAvailability;
  /**
   * When the offer was observed. Alko reference rows carry it — the
   * benchmark's newest-reference selection needs the observation axis —
   * while legacy read models may omit it; a row without it cannot serve
   * as a benchmark reference.
   */
  readonly observedAt?: Date;
  /**
   * The carrier that ships this merchant's parcels
   * (`merchant_registry.carrier_id`, design D1, change
   * transport-confidence-unlock). Null/absent means the assignment is
   * unknown: the transport lookup falls back to the merchant name
   * honestly and degrades to UNAVAILABLE on a miss — the port never
   * guesses a carrier. Read models that predate the registry join may
   * omit the field, which reads exactly as null.
   */
  readonly carrierId?: string | null;
}

// ---------------------------------------------------------------------------
// Cost breakdown
// ---------------------------------------------------------------------------

/**
 * Machine-readable category for each itemized cost line.
 *
 * `otherCharges` was removed (design D3/D5, task 10.3): it was a
 * hardcoded zero and a dead contract. If a real other-charges source
 * appears later, the category returns with defined semantics.
 */
export type CostCategory =
  | 'foreignRetailPrice'
  | 'transportCost'
  | 'alcoholExciseEstimate'
  | 'containerDutyEstimate'
  | 'importVatEstimate';

/**
 * A single itemized cost line in the calculation result.
 */
export interface ItemizedCost {
  /** Human-readable label (e.g. "Retail price", "Transport", "Excise duty"). */
  readonly label: string;
  /** Machine-readable category identifying the cost component. */
  readonly category: CostCategory;
  /** Amount in euro-cents. */
  readonly cents: number;
  /** Reliability status of this cost component. */
  readonly reliability: ReliabilityStatus;
  /** Optional sub-items for further breakdown. */
  readonly breakdown?: readonly ItemizedCost[];
  /**
   * Versioned tax dataset identity that produced this line (e.g.
   * "import-vat-2024.2"). Present only on lines whose figure is resolved
   * against a versioned dataset.
   */
  readonly rateVersionId?: string;
  /**
   * When the figure was computed, ISO 8601 — JSON-stable so the persisted
   * breakdown replays verbatim (same convention as AlkoBenchmarkSnapshot).
   */
  readonly calculatedAt?: string;
}

// ---------------------------------------------------------------------------
// Plausibility sanity rail (change unit-integrity-and-result-trust, task 2.1)
// ---------------------------------------------------------------------------

/**
 * Machine-readable code identifying which plausibility rail tripped.
 * One code per rail — the code is the stable join key for consumers;
 * never parse it out of prose.
 */
export type SanityNoteCode =
  | 'LINE_EXCISE_EXCEEDS_RETAIL_PLAUSIBILITY'
  | 'LINE_CONTAINER_DUTY_EXCEEDS_RETAIL_PLAUSIBILITY';

/**
 * A single plausibility-rail trip record.
 *
 * The rail never alters amounts — a note explains a reliability/confidence
 * downgrade by naming the actual figures that breached the threshold
 * ("every number is explainable"). `component` joins to
 * {@link ItemizedCost.category}; `figures.lineComponentCents` matches the
 * amount on that itemized line byte-for-byte.
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

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The serialized, display-only Alko benchmark carried on results and
 * persisted records: the benchmark module's `AlkoBenchmarkAvailable`
 * variant with the observation timestamp as ISO 8601. Every field of the
 * result/record contract stays JSON-stable, so an idempotency-cache replay
 * returns the type the live path returned.
 *
 * The module's `unavailable` variant never reaches this contract — the
 * whole field is omitted instead: absence is the render-nothing state,
 * never a null and never a placeholder object.
 */
export type AlkoBenchmarkSnapshot = Omit<AlkoBenchmarkAvailable, 'observedAt'> & {
  /** Observation timestamp of the selected reference row, ISO 8601. */
  readonly observedAt: string;
  /**
   * Product master id whose Alko offers produced this benchmark —
   * present exactly when the request resolved the reference from a
   * LINKED reference product (`CalculatorInput.alkoReferenceProductId`,
   * design D4, change alko-reference-matching-pipeline) rather than the
   * calculated product's own offers. The explainability invariant for
   * linked-pair calculations: the result and the persisted record name
   * the product the reference came from. Absent for direct
   * calculations — key absence keeps those byte-identical.
   */
  readonly referenceProductId?: number;
};

/**
 * Delivery-mode traveller-alternative callout (task 1.2, change
 * finnish-first-client-experience): the labelled out-of-pocket estimate for
 * ONE traveller carrying the same quantity within the effective traveller
 * allowance caps — an invitation to try the trip calculator, computed in the
 * same request from the same allowance port read semantics as the PERSONAL
 * branch (one read, no extra I/O beyond it).
 *
 * Purely additive (design D4): the estimate never enters `totalCents`, the
 * itemized breakdown, any reliability status, or the confidence — the
 * delivery result's own figures are byte-identical with and without it.
 */
export interface TravellerAlternativeCallout {
  /**
   * The allowed quantity (requested quantity capped by the category cap,
   * trip-fill floor-plus-epsilon litres→quantity semantics) × the unit
   * shelf price already used for the result's retail line (best-offer
   * retail), in euro-cents.
   */
  readonly estimatedTotalCents: number;
  /** Whether the FULL requested quantity fits the category cap. */
  readonly withinAllowance: boolean;
  /** `versionLabel` of the allowance dataset the estimate resolves against. */
  readonly allowanceDatasetVersion: string;
  /** Canonical tax-rule category the cap was looked up with. */
  readonly categoryKey: string;
}

/**
 * Full result from the landed-cost calculator.
 */
export interface CalculatorResult {
  /** Itemized list of all cost components. */
  readonly itemizedCosts: readonly ItemizedCost[];

  // ---------------------------------------------------------------------------
  // Convenience breakdown — each component from the itemized list as a flat
  // field for quick access. The authoritative source is `itemizedCosts`.
  // ---------------------------------------------------------------------------

  /** Total price of items from the merchant, in euro-cents. */
  readonly foreignRetailPrice: number;
  /** Shipping/transport cost, in euro-cents. */
  readonly transportCost: number;
  /** Estimated excise duty, in euro-cents. */
  readonly alcoholExciseEstimate: number;
  /** Estimated container duty, in euro-cents. */
  readonly containerDutyEstimate: number;

  /**
   * Import VAT for the consignment, in euro-cents. Present only when the
   * offer's seller country differs from the destination — key absent for
   * domestic offers (render-nothing, never a displayed zero). The
   * authoritative line lives in `itemizedCosts` with its base breakdown.
   */
  readonly importVatEstimate?: number;

  /** Sum of all costs in euro-cents at the top level. */
  readonly totalCents: number;
  readonly currency: 'EUR';

  /** Aggregate confidence for the entire result. */
  readonly confidence: ConfidenceLevel;
  /** Per-data-point confidence breakdown with explanations. */
  readonly confidenceBreakdown: readonly ConfidenceDetail[];

  /**
   * Plausibility-rail trip notes when a line's duty component breached
   * the plausibility threshold against the line's retail price (the
   * confidence/excise downgrade's machine-readable explanation). Key
   * absent for a plausible calculation — same presence contract as
   * `alkoBenchmark`: render-nothing, never null, never a placeholder.
   * Every figure in a note is identical to the corresponding itemized
   * amount — the rail never alters any computed amount.
   */
  readonly sanityNotes?: readonly SanityNote[];

  /** The standing legal disclaimer. */
  readonly disclaimer: Disclaimer;

  /** Transaction classification outcome. */
  readonly classification: ClassificationResult;

  /**
   * Display-only Alko benchmark for the calculated offer. Present only
   * when the product has a usable Alko reference offer; omitted (key
   * absent) otherwise — never null, never a placeholder. Never enters
   * `totalCents`, the itemized breakdown, or any ranking input.
   */
  readonly alkoBenchmark?: AlkoBenchmarkSnapshot;

  /**
   * Traveller-alternative estimate for delivery-mode results (task 1.2,
   * change finnish-first-client-experience). Present exactly when a
   * published allowance dataset resolved for the transaction date AND the
   * product's category has a boundable cap row AND the request was a
   * delivery arrangement. In every degrade case — port unwired, no
   * effective dataset, no cap row for the category, or a PERSONAL request
   * (a PERSONAL result IS the traveller scenario) — the key is ABSENT:
   * absence is the render-nothing state (`?? null` for consumers, never a
   * displayed placeholder). Purely additive: never enters `totalCents`,
   * the itemized breakdown, statuses, or confidence (design D4).
   */
  readonly travellerAlternative?: TravellerAlternativeCallout | null;

  /** Calculation metadata. */
  readonly metadata: {
    readonly input: CalculatorInput;
    readonly calculationTimestamp: string; // ISO 8601
    readonly productMasterId: number;
    readonly retailOfferIds: readonly number[];

    // -- Input snapshot --
    /** Quantity used in the calculation. */
    readonly quantity: number;
    /** Destination country used in the calculation. */
    readonly destination: string;
    /** Normalized product name from the product master. */
    readonly productName: string;

    // -- Product attributes (for ranking/sorting) --
    /** Product volume in litres from the product master. */
    readonly volumeLitres: number;
    /** Alcohol by volume percentage (0–100). */
    readonly alcoholByVolume: number;
    /** Canonical product category. */
    readonly category: string;

    // -- Dataset provenance --
    /**
     * Dataset versions that were applied — the tax rule versions
     * (idempotency/cache keys derived from these invalidate on change).
     */
    readonly datasetVersions: readonly string[];
    /**
     * `versionLabel` of the traveller-allowance dataset whose caps bounded
     * this calculation (task 1.1). Present only for traveller-mode
     * (`PERSONAL`) results that resolved a published dataset — key absent
     * for delivery results. Kept OUT of `datasetVersions` deliberately:
     * that array feeds the idempotency version comparison, which keys on
     * the tax datasets the cache layer resolves on its own.
     */
    readonly allowanceDatasetVersion?: string;
    /** Transport offer ID that was used, or null when unavailable. */
    readonly transportOfferId: number | null;
  };

  /** ID of the persisted calculation record. */
  readonly calculationRecordId: number;
}

// ---------------------------------------------------------------------------
// Persistence input
// ---------------------------------------------------------------------------

/**
 * Data required to persist a calculation record.
 */
export interface CreateCalculationRecordInput {
  readonly productMasterId: number;
  readonly retailOfferIds: readonly number[];
  readonly transportOfferId: number | null;
  readonly exciseRuleVersionId: number | null;
  readonly containerDutyRuleVersionId: number | null;
  readonly totalCents: number;
  readonly breakdown: unknown;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: Disclaimer;
  readonly sessionId: string | null;
  /**
   * Display-only Alko benchmark persisted with the record when available.
   * Optional: reference-less calculations and pre-change records lack the
   * field, and consumers treat absence as normal.
   */
  readonly alkoBenchmark?: AlkoBenchmarkSnapshot;
}

// ---------------------------------------------------------------------------
// Ports — injected by the composition root (data-platform layer)
// ---------------------------------------------------------------------------

/**
 * Product-data lookup port.
 *
 * The data-platform layer provides an implementation that wires the
 * concrete product and retail-offer repositories.
 */
export interface IProductDataPort {
  /**
   * Look up a product by its master ID.
   * Returns null when the product does not exist.
   */
  findProductById(id: number): Promise<CalculatorProductData | null>;

  /**
   * Return retail offers for the given product.
   */
  findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]>;
}

/**
 * Calculation-record persistence port.
 *
 * Write-once: records are immutable after creation.
 */
export interface ICalculationRecordPort {
  /**
   * Persist a new calculation record.
   * Returns the assigned record ID.
   */
  create(record: CreateCalculationRecordInput): Promise<{ id: number }>;
}

// ---------------------------------------------------------------------------
// Injection tokens — used by the NestJS DI container
// ---------------------------------------------------------------------------

/** Injection token for IProductDataPort. */
export const PRODUCT_DATA_PORT = 'PRODUCT_DATA_PORT';

/** Injection token for ICalculationRecordPort. */
export const CALCULATION_RECORD_PORT = 'CALCULATION_RECORD_PORT';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the classification gate rejects the product.
 */
export class ClassificationGateRejectionError extends Error {
  readonly productId: number;
  readonly reason: string;

  constructor(productId: number, reason: string) {
    super(`Product ${productId} rejected by classification gate: ${reason}`);
    this.name = 'ClassificationGateRejectionError';
    this.productId = productId;
    this.reason = reason;
  }
}

/**
 * Thrown when the product master does not contain the requested product.
 */
export class ProductNotFoundError extends Error {
  readonly productId: number;

  constructor(productId: number) {
    super(`Product ${productId} not found in product master`);
    this.name = 'ProductNotFoundError';
    this.productId = productId;
  }
}

/**
 * Thrown when no retail offers are available for the product.
 */
export class NoRetailOffersError extends Error {
  readonly productId: number;

  constructor(productId: number) {
    super(`No retail offers found for product ${productId}`);
    this.name = 'NoRetailOffersError';
    this.productId = productId;
  }
}

/**
 * Thrown when a traveller-mode (`PERSONAL`) calculation cannot resolve a
 * PUBLISHED traveller-allowance dataset effective on the transaction date
 * (task 1.1, design D3). Sibling of
 * {@link ClassificationGateRejectionError}: the request is refused rather
 * than computed with invented caps — the delivery path stays fully
 * available. Carries the resolved calendar date (`YYYY-MM-DD`) the lookup
 * used, so the route layer (task 1.3) can mirror the trip routes'
 * no-dataset message shape.
 */
export class NoAllowanceDatasetError extends Error {
  /** The transaction date the allowance lookup used, `YYYY-MM-DD`. */
  readonly transactionDate: string;

  constructor(transactionDate: string) {
    super(
      `No published traveller allowance dataset is effective on ${transactionDate} — ` +
        'a traveller-mode calculation cannot run without a bound',
    );
    this.name = 'NoAllowanceDatasetError';
    this.transactionDate = transactionDate;
  }
}