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

/** Canonical product record. */
export interface ProductRecord {
  readonly id: number;
  readonly name: string;
  readonly brand: string | null;
  readonly containerType: string;
  readonly volumeLitres: string;
  readonly alcoholByVolume: string | null;
  readonly ean: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Merchant offer (scraped price point). */
export interface MerchantOfferRecord {
  readonly id: number;
  readonly productId: number;
  readonly merchantId: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly sourceUrl: string | null;
  readonly reliability: string;
  readonly observedAt: Date;
}

/** Versioned tax rate dataset. */
export interface TaxRateVersionRecord {
  readonly id: number;
  readonly versionLabel: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly confirmedAt: Date | null;
  readonly rates: unknown;
  readonly createdAt: Date;
}

/** Transport rate offer from a carrier. */
export interface TransportRateRecord {
  readonly id: number;
  readonly carrierId: string;
  readonly originCountry: string;
  readonly destinationCountry: string;
  readonly basePriceCents: number;
  readonly pricePerKgCents: string | null;
  readonly minWeightKg: string | null;
  readonly maxWeightKg: string | null;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly reliability: string;
  readonly refreshedAt: Date;
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
  findById(id: number): Promise<ProductRecord | null>;
  findOffers(productId: number): Promise<MerchantOfferRecord[]>;
}

export interface ITaxRateRepository {
  findEffectiveVersion(asOf: Date): Promise<TaxRateVersionRecord | null>;
  findVersionById(id: number): Promise<TaxRateVersionRecord | null>;
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
  readonly audit: IAuditRepository;
}