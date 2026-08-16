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
  readonly name: string;
  readonly manufacturer: string;
  readonly brand: string;
  readonly category: string;
  readonly alcoholByVolume: string | null;
  readonly unitVolume: string;
  readonly containerType: string;
  readonly regulatoryClassification: string;
  readonly depositSystemStatus: boolean;
  readonly ean: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Retail offer — scraped price point from an external retailer. */
export interface RetailOfferRecord {
  readonly id: number;
  readonly merchant: string;
  readonly country: string;
  readonly productId: number;
  readonly priceCents: number;
  readonly currency: string;
  readonly availability: string;
  readonly sourceUrl: string | null;
  readonly observedAt: Date;
  readonly reliabilityStatus: string;
}

/** Versioned tax rule — never mutated in place. */
export interface TaxRuleRecord {
  readonly id: number;
  readonly taxType: string;
  readonly productCategory: string;
  readonly rate: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly exemptionConditions: unknown;
  readonly calculationFormulaReference: string;
  readonly officialSource: string;
  readonly verificationDate: Date | null;
  readonly versionLabel: string;
  readonly createdAt: Date;
}

/** Transport offer from a carrier. */
export interface TransportOfferRecord {
  readonly id: number;
  readonly carrier: string;
  readonly originCountry: string;
  readonly destinationCountry: string;
  readonly weightMinKg: string | null;
  readonly weightMaxKg: string | null;
  readonly packageTier: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly sellerInvolvementIndicator: boolean;
  readonly observedAt: Date;
  readonly refreshedAt: Date;
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
  readonly audit: IAuditRepository;
}