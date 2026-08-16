/**
 * Repository registry contract.
 *
 * Groups every data-platform repository behind a single injectable registry.
 * Consumers (Application API, Data Acquisition) depend on this interface
 * rather than on individual repository tokens, making the data layer
 * extractable to a separate package or microservice without changes to
 * the consuming code.
 *
 * @module RepositoryRegistry
 */

// --------------------------------------------------------------------------
// Read-model shapes – defined here so consumers do NOT import Drizzle ORM
// --------------------------------------------------------------------------

/** Product Master — canonical product record. */
export interface ProductMasterRecord {
  readonly id: number;
  /** Display name from merchant feed. */
  readonly name: string;
  /** Manufacturer from feed adapter — product disambiguation. */
  readonly manufacturer: string;
  /** Brand from feed adapter — mapped by DataMappingService. */
  readonly brand: string;
  /** Product category — maps to taxRules.productCategory for rule lookup. */
  readonly category: string;
  /** Alcohol by volume (decimal) — required by excise engine. */
  readonly alcoholByVolume: string | null;
  /** Unit volume in litres — required for per-volume tax formulas. */
  readonly unitVolume: string;
  /** Container type (glass/plastic/metal/carton) — determines container duty rate. */
  readonly containerType: string;
  /** Regulatory classification — used for tax classification matching. */
  readonly regulatoryClassification: string;
  /** True if packaging participates in Finnish deposit-return system. */
  readonly depositSystemStatus: boolean;
  /** EAN-13 barcode — primary product identification key for upsert matching. */
  readonly ean: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Retail offer — scraped price point from an external retailer. */
export interface RetailOfferRecord {
  readonly id: number;
  /** Merchant identifier (e.g. "alko", "systembolaget"). */
  readonly merchant: string;
  /** Market/origin country (ISO 3166-1 alpha-2). */
  readonly country: string;
  /** FK to product_master. */
  readonly productId: number;
  /** Retail price in smallest currency unit (cents). */
  readonly priceCents: number;
  /** Price currency — default EUR. */
  readonly currency: string;
  /** Stock status — filters out-of-stock from comparisons. */
  readonly availability: string;
  /** Provenance link to source product page. */
  readonly sourceUrl: string | null;
  /** When price was observed — used for freshness calculations. */
  readonly observedAt: Date;
  /** Data freshness indicator (EXACT/ESTIMATED/STALE). */
  readonly reliabilityStatus: string;
}

/** Versioned tax rule — never mutated in place. */
export interface TaxRuleRecord {
  readonly id: number;
  /** Tax type discriminator: "excise_duty" or "container_duty". */
  readonly taxType: string;
  /** Matches productMaster.category for rule lookup. */
  readonly productCategory: string;
  /** Rate value (meaning depends on taxType). */
  readonly rate: string;
  /** Start of rate validity window (inclusive). */
  readonly effectiveFrom: Date;
  /** End of rate validity window (exclusive, null = current). */
  readonly effectiveTo: Date | null;
  /** JSON exemption rules evaluated by deposit-checker. */
  readonly exemptionConditions: unknown;
  /** Math function key — selects calculation formula in tax engine. */
  readonly calculationFormulaReference: string;
  /** Authoritative publication URL — auditability. */
  readonly officialSource: string;
  /** When rate was verified — null = unverified/ESTIMATED. */
  readonly verificationDate: Date | null;
  /** Human-readable version label (e.g. "v1.0-2024"). */
  readonly versionLabel: string;
  readonly createdAt: Date;
}

/** Transport offer from a carrier. */
export interface TransportOfferRecord {
  readonly id: number;
  /** Carrier identifier (e.g. "matkahuolto", "posti"). */
  readonly carrier: string;
  /** Shipping origin country (ISO 3166-1 alpha-2). */
  readonly originCountry: string;
  /** Shipping destination — default "FI". */
  readonly destinationCountry: string;
  /** Weight bracket lower bound in kg — null = no lower limit. */
  readonly weightMinKg: string | null;
  /** Weight bracket upper bound in kg — null = no upper limit. */
  readonly weightMaxKg: string | null;
  /** Package tier (parcel/box/pallet) — matches basket dominant type. */
  readonly packageTier: string;
  /** Shipping cost in cents. */
  readonly priceCents: number;
  /** Price currency — default EUR. */
  readonly currency: string;
  /** True if seller pays shipping (affects landed-cost attribution). */
  readonly sellerInvolvementIndicator: boolean;
  /** When rate was observed from carrier. */
  readonly observedAt: Date;
  /** When carrier rates were last refreshed — batch refresh tracking. */
  readonly refreshedAt: Date;
  /** Data freshness indicator (EXACT/ESTIMATED/STALE). */
  readonly reliabilityStatus: string;
}

/** Input for recording a calculation in the audit trail. */
export interface CalculationAuditEntry {
  readonly sessionId: string;
  readonly inputSnapshot: unknown;
  readonly resultSnapshot: unknown;
  readonly rateVersionId: number | null;
  readonly disclaimerLanguage: string;
  readonly calculatedAt?: Date;
}

/**
 * Calculation record — a persisted landed-cost result.
 *
 * Immutable once written. Enables auditability, correction, and
 * confidence-based ranking.
 */
export interface CalculationRecord {
  readonly id: number;
  /** FK to product_master. */
  readonly productMasterId: number;
  /** JSON array of retail_offer_ids — basket may have multiple offers. */
  readonly retailOfferIds: unknown | null;
  /** FK to transport_offers — the shipping option used. */
  readonly transportOfferId: number | null;
  /** FK to tax_rules — excise rule version applied. */
  readonly exciseRuleVersionId: number | null;
  /** FK to tax_rules — container duty rule version applied. */
  readonly containerDutyRuleVersionId: number | null;
  /** Final landed cost in cents. */
  readonly totalCents: number;
  /** Structured cost breakdown — "every number is explainable". */
  readonly breakdown: unknown;
  /** Confidence level (HIGH/MEDIUM/LOW) — used by ranking system. */
  readonly confidence: string;
  /** Number of units in the calculation. */
  readonly quantity: number;
  /** Destination country code (ISO 3166-1 alpha-2). */
  readonly destination: string;
  /** Structural disclaimer text — required by architecture rule. */
  readonly disclaimer: string;
  /** Session identifier — groups calculations for audit trail. */
  readonly sessionId: string | null;
  /** When calculation was performed. */
  readonly calculatedAt: Date;
}

// --------------------------------------------------------------------------
// Individual repository contracts
// --------------------------------------------------------------------------

export interface IProductRepository {
  findById(id: number): Promise<ProductMasterRecord | null>;
  findOffers(productId: number): Promise<RetailOfferRecord[]>;
}

export interface ITaxRateRepository {
  findEffectiveVersion(asOf: Date): Promise<TaxRuleRecord | null>;
  findVersionById(id: number): Promise<TaxRuleRecord | null>;
}

export interface ITransportOfferRepository {
  findByCarrier(carrierId: string): Promise<TransportOfferRecord[]>;
  findActive(): Promise<TransportOfferRecord[]>;
}

export interface IAuditRepository {
  recordCalculation(entry: CalculationAuditEntry): Promise<void>;
}

/**
 * Repository for calculation records.
 *
 * Write-once, read-many. Supports lookup by ID and session for
 * audit-trail display and correction workflows.
 */
export interface ICalculationRecordRepository {
  create(
    record: Omit<CalculationRecord, 'id' | 'calculatedAt'>,
  ): Promise<CalculationRecord>;
  findById(id: number): Promise<CalculationRecord | null>;
  findBySession(sessionId: string): Promise<CalculationRecord[]>;
}

// --------------------------------------------------------------------------
// Unified registry – one dependency for consuming layers
// --------------------------------------------------------------------------

/**
 * Registry that exposes every repository the data platform manages.
 *
 * Consumers inject `IRepositoryRegistry` instead of three separate tokens.
 * When the data layer is extracted behind an RPC boundary, this registry
 * becomes the single facade to replace.
 */
export interface IRepositoryRegistry {
  readonly products: IProductRepository;
  readonly taxRates: ITaxRateRepository;
  readonly transportOffers: ITransportOfferRepository;
  /** @deprecated Use `calculationRecords` instead. */
  readonly audit: IAuditRepository;
  readonly calculationRecords: ICalculationRecordRepository;
}