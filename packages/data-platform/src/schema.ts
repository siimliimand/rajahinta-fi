/**
 * Drizzle ORM schema definitions (PostgreSQL 16 + TimescaleDB 2.16).
 *
 * Extracted to its own file so that repositories and the data-platform
 * module can import tables without going through the barrel (index.ts),
 * avoiding circular dependency chains.
 *
 * @module Schema
 */
import {
  pgTable,
  serial,
  varchar,
  numeric,
  timestamp,
  integer,
  jsonb,
  boolean,
  text,
} from 'drizzle-orm/pg-core';

/**
 * Product Master — canonical product records.
 *
 * One row per unique beverage product. Fields are driven by the
 * ingestion pipeline (RawFeedRecord → UpsertProductInput) and the
 * calculation engines that need product attributes for tax/duty lookup.
 */
export const productMaster = pgTable('product_master', {
  id: serial('id').primaryKey(),
  /** Display name from merchant feed (RawFeedRecord.productName). */
  name: varchar('name', { length: 512 }).notNull(),
  /** Manufacturer from feed adapter — used for product disambiguation. */
  manufacturer: varchar('manufacturer', { length: 256 }).notNull(),
  /** Brand from feed adapter — mapped by DataMappingService for upsert matching. */
  brand: varchar('brand', { length: 256 }).notNull(),
  /** Product category — maps to taxRules.productCategory for excise/duty rule lookup. */
  category: varchar('category', { length: 32 }).notNull(),
  /** Alcohol by volume (decimal, e.g. 0.047 for 4.7%) — required by excise engine. */
  alcoholByVolume: numeric('alcohol_by_volume', { precision: 5, scale: 3 }),
  /** Unit volume in litres — required for per-volume tax formulas (€/litre). */
  unitVolume: numeric('unit_volume', { precision: 10, scale: 4 }).notNull(),
  /** Container type (glass/plastic/metal/carton) — determines container duty rate. */
  containerType: varchar('container_type', { length: 32 }).notNull(),
  /** Regulatory classification from feed — used for tax classification matching. */
  regulatoryClassification: varchar('regulatory_classification', { length: 64 }).notNull(),
  /** True if packaging participates in Finnish deposit-return system — checked by container-duty service for exemption. */
  depositSystemStatus: boolean('deposit_system_status'),
  /** EAN-13 barcode — primary product identification key for upsert matching. */
  ean: varchar('ean', { length: 13 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Retail offers — scraped price points from external retailers.
 *
 * One row per (merchant, product, observedAt) observation. Price history
 * enables trend analysis and freshness-based filtering.
 */
export const retailOffers = pgTable('retail_offers', {
  id: serial('id').primaryKey(),
  /** Merchant identifier — distinguishes sources (e.g. "alko", "systembolaget"). */
  merchant: varchar('merchant', { length: 128 }).notNull(),
  /** Market/origin country (ISO 3166-1 alpha-2). */
  country: varchar('country', { length: 4 }).notNull(),
  /** FK to product_master — links offer to canonical product. */
  productId: integer('product_id')
    .references(() => productMaster.id)
    .notNull(),
  /** Retail price in smallest currency unit (cents). */
  priceCents: integer('price_cents').notNull(),
  /** Price currency — default EUR for Finnish market. */
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  /** Stock status — filters out-of-stock offers from price comparisons. */
  availability: varchar('availability', { length: 16 })
    .default('unknown')
    .notNull(),
  /** Provenance link to source product page. */
  sourceUrl: varchar('source_url', { length: 1024 }),
  /** When price was observed — used for freshness calculations. */
  observedAt: timestamp('observed_at').defaultNow().notNull(),
  /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — surfaced to user per architecture rule. */
  reliabilityStatus: varchar('reliability_status', { length: 16 })
    .default('ESTIMATED')
    .notNull(),
});

/**
 * Versioned tax rules — never overwritten, always appended.
 *
 * Each row represents a rate effective for a time window. Historical rates
 * remain queryable after changes. The calculation engines resolve the
 * correct version by effectiveFrom/effectiveTo date range.
 */
export const taxRules = pgTable('tax_rules', {
  id: serial('id').primaryKey(),
  /** Tax type discriminator: "excise_duty" or "container_duty". */
  taxType: varchar('tax_type', { length: 32 }).notNull(),
  /** Matches productMaster.category — selects applicable rule for a product. */
  productCategory: varchar('product_category', { length: 32 }).notNull(),
  /** Rate value (meaning depends on taxType: €/hl/°Plato for excise, €/litre for container). */
  rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
  /** Start of rate validity window (inclusive). */
  effectiveFrom: timestamp('effective_from').notNull(),
  /** End of rate validity window (exclusive, null = current/active rate). */
  effectiveTo: timestamp('effective_to'),
  /** JSON exemption rules (e.g. {maxAlcoholByVolume: 0.5}) — evaluated by deposit-checker. */
  exemptionConditions: jsonb('exemption_conditions'),
  /** Math function key — selects the calculation formula in the tax engine. */
  calculationFormulaReference: varchar('calculation_formula_reference', { length: 128 }).notNull(),
  /** Authoritative publication URL — auditability: "every number is explainable". */
  officialSource: varchar('official_source', { length: 512 }).notNull(),
  /** When rate was verified against official source — null = unverified/ESTIMATED. */
  verificationDate: timestamp('verification_date'),
  /** Human-readable version label (e.g. "v1.0-2024") — used for audit trail. */
  versionLabel: varchar('version_label', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/**
 * Carrier transport offers.
 *
 * One row per (carrier, route, weight-bracket, package-tier) pricing entry.
 * Used by transport-estimation and basket-shipping services to estimate
 * shipping cost for a landed-cost calculation.
 */
export const transportOffers = pgTable('transport_offers', {
  id: serial('id').primaryKey(),
  /** Carrier identifier (e.g. "matkahuolto", "posti"). */
  carrier: varchar('carrier', { length: 64 }).notNull(),
  /** Shipping origin country (ISO 3166-1 alpha-2). */
  originCountry: varchar('origin_country', { length: 4 }).notNull(),
  /** Shipping destination — default "FI" (Finland). */
  destinationCountry: varchar('destination_country', { length: 4 })
    .default('FI')
    .notNull(),
  /** Weight bracket lower bound in kg — null = no lower limit. */
  weightMinKg: numeric('weight_min_kg', { precision: 10, scale: 4 }),
  /** Weight bracket upper bound in kg — null = no upper limit. */
  weightMaxKg: numeric('weight_max_kg', { precision: 10, scale: 4 }),
  /** Package tier (parcel/box/pallet) — matches basket dominant type. */
  packageTier: varchar('package_tier', { length: 32 }).notNull(),
  /** Shipping cost in smallest currency unit (cents). */
  priceCents: integer('price_cents').notNull(),
  /** Price currency — default EUR for Finnish market. */
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  /** True if seller pays shipping (affects landed-cost attribution). */
  sellerInvolvementIndicator: boolean('seller_involvement_indicator').default(false).notNull(),
  /** When rate was observed from carrier. */
  observedAt: timestamp('observed_at').defaultNow().notNull(),
  /** When carrier rates were last refreshed — separate from observedAt for batch refresh tracking. */
  refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
  /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — surfaced to user per architecture rule.
   *  Staleness thresholds per domain: price=24h, transport=7d, classification=30d
   *  (configured in packages/core-domain/src/reliability/reliability.types.ts). */
  reliabilityStatus: varchar('reliability_status', { length: 16 })
    .default('ESTIMATED')
    .notNull(),
});

/**
 * Calculation records — every landed-cost result shown to a user.
 *
 * Immutable once written. Enables auditability, correction, and
 * confidence-based ranking. FK references normalised to separate tables
 * (not flat JSON snapshots) for query flexibility.
 *
 * Migration note: replaces the former `calculation_audit` table
 * (removed in this version). The old table had a flat input/output
 * snapshot pattern. The new schema normalises FK references and
 * stores a structured breakdown.
 */
export const calculationRecords = pgTable('calculation_records', {
  id: serial('id').primaryKey(),
  /** FK to product_master — the product this calculation is for. */
  productMasterId: integer('product_master_id')
    .references(() => productMaster.id)
    .notNull(),
  /** JSON array of retail_offer_ids — basket may reference multiple offers. */
  retailOfferIds: jsonb('retail_offer_ids'),
  /** FK to transport_offers — the shipping option used. */
  transportOfferId: integer('transport_offer_id')
    .references(() => transportOffers.id),
  /** FK to tax_rules — excise rule version applied (traceability). */
  exciseRuleVersionId: integer('excise_rule_version_id')
    .references(() => taxRules.id),
  /** FK to tax_rules — container duty rule version applied (traceability). */
  containerDutyRuleVersionId: integer('container_duty_rule_version_id')
    .references(() => taxRules.id),
  /** Final landed cost in cents. */
  totalCents: integer('total_cents').notNull(),
  /** Structured cost breakdown (excise, duty, transport components) — "every number is explainable". */
  breakdown: jsonb('breakdown').notNull(),
  /** Confidence level (HIGH/MEDIUM/LOW) — used by ranking/sorting system. */
  confidence: varchar('confidence', { length: 6 }).notNull(),
  /** Number of units in the calculation. */
  quantity: integer('quantity').notNull(),
  /** Destination country code (ISO 3166-1 alpha-2). */
  destination: varchar('destination', { length: 4 }).notNull(),
  /** Structural disclaimer text — required by architecture rule: not a UI-only string. */
  disclaimer: text('disclaimer').notNull(),
  /** Session identifier — groups calculations by user session for audit trail. */
  sessionId: varchar('session_id', { length: 64 }),
  /** When calculation was performed. */
  calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
});