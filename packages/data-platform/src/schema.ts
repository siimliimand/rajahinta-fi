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
  index,
  date,
  unique,
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
  },
  (table) => [
    // Serves the changed-offer detection lookup (latest prior row per
    // merchant+product, ordered by observedAt) run on every ingestion upsert.
    index('retail_offers_merchant_product_id_observed_at_idx').on(
      table.merchant,
      table.productId,
      table.observedAt,
    ),
  ],
);

/**
 * Versioned tax rules — never overwritten, always appended.
 *
 * Each row represents a rate effective for a time window. Historical rates
 * remain queryable after changes. The calculation engines resolve the
 * correct version by effectiveFrom/effectiveTo date range.
 */
export const taxRules = pgTable('tax_rules', {
  id: serial('id').primaryKey(),
  /** Tax type discriminator: "excise" (alcohol excise) or "container_duty". */
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

/**
 * Price observations — append-only analytical series for historical intelligence.
 *
 * One row per merchant-offer observation recorded by the price-ingestion
 * background job at quantity=1 baseline. Each row is self-contained
 * (price, transport cost, tax rule versions, landed cost, reliability
 * snapshot) so the aggregation and attribution services consume it
 * without joins across session-scoped data. Rows are never updated or
 * deleted by application code — corrections append new observations.
 */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: serial('id').primaryKey(),
    /** FK to product_master — links observation to canonical product. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Merchant identifier — distinguishes sources (matches retail_offers.merchant). */
    merchant: varchar('merchant', { length: 128 }).notNull(),
    /** FK to retail_offers — provenance link to the scraped offer this observation was derived from. */
    retailOfferId: integer('retail_offer_id')
      .references(() => retailOffers.id)
      .notNull(),
    /** When the observation was recorded — series time axis. */
    observedAt: timestamp('observed_at').defaultNow().notNull(),
    /** Foreign retail price in smallest currency unit (cents) at observation time. */
    foreignRetailPriceCents: integer('foreign_retail_price_cents').notNull(),
    /** Transport cost in cents used in the quantity=1 landed-cost computation. */
    transportCostCents: integer('transport_cost_cents').notNull(),
    /** FK to transport_offers — which carrier offer was selected. Null when no
     *  applicable offer exists (transport cost 0, reliability UNAVAILABLE). */
    transportOfferId: integer('transport_offer_id').references(
      () => transportOffers.id,
    ),
    /** FK to tax_rules — excise rule version effective at observedAt. Null when
     *  the engine fell back (zero duty, ESTIMATED) — matches calculationRecords. */
    exciseRuleVersionId: integer('excise_rule_version_id').references(
      () => taxRules.id,
    ),
    /** FK to tax_rules — container duty rule version effective at observedAt.
     *  Null when the engine fell back — matches calculationRecords. */
    containerDutyRuleVersionId: integer('container_duty_rule_version_id').references(
      () => taxRules.id,
    ),
    /** Quantity=1 baseline landed cost in cents. */
    landedCostCents: integer('landed_cost_cents').notNull(),
    /** Per-input reliability snapshot keyed by input name (price/transport/classification →
     *  VERIFIED/ESTIMATED/STALE/UNAVAILABLE — ReliabilityStatus in core-domain). */
    inputReliability: jsonb('input_reliability').notNull(),
    /** Result confidence (HIGH/MEDIUM/LOW) — computed by ConfidenceFrameworkService. */
    confidence: varchar('confidence', { length: 6 }).notNull(),
  },
  (table) => [
    index('price_observations_product_id_observed_at_idx').on(
      table.productId,
      table.observedAt,
    ),
    index('price_observations_merchant_product_id_observed_at_idx').on(
      table.merchant,
      table.productId,
      table.observedAt,
    ),
    // Serves the aggregation worker's watermark scan (findProductActivitySince:
    // GROUP BY product_id over observed_at >= watermark). Without a leading
    // observed_at column the 30-minute scan would degrade to a seq scan as
    // the append-only log grows — this keeps it an index-only scan.
    index('price_observations_observed_at_idx').on(table.observedAt),
  ],
);

/**
 * Price history summaries — materialized daily/weekly aggregates for charts.
 *
 * One row per (granularity, periodStart, productId, merchant) bucket, built
 * from priceObservations by the time-series aggregation background job.
 * Serves chart requests so raw observations are never aggregated on the
 * request path. "Price" columns aggregate foreignRetailPriceCents;
 * "landed cost" columns aggregate landedCostCents.
 *
 * Bucketing: daily periodStart is the UTC calendar date of the bucket;
 * weekly periodStart is the Monday opening the ISO 8601 week (UTC), per
 * design decision 3. open = value at the bucket's earliest observation by
 * observedAt; close = value at the latest. avg is the arithmetic mean of
 * the bucket's integer-cent values rounded half-up to the nearest cent
 * (amounts are non-negative, so this equals half-away-from-zero and stays
 * deterministic across job recomputes).
 */
export const priceHistorySummaries = pgTable(
  'price_history_summaries',
  {
    id: serial('id').primaryKey(),
    /** Bucket granularity discriminator: "daily" or "weekly". */
    granularity: varchar('granularity', { length: 16 }).notNull(),
    /** Bucket start anchor (see table docblock for daily/weekly alignment). */
    periodStart: date('period_start').notNull(),
    /** FK to product_master — links summary to canonical product. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Merchant identifier (matches price_observations.merchant). NULL means
     *  the product-wide aggregate across all merchants. */
    merchant: varchar('merchant', { length: 128 }),
    /** Foreign retail price (cents) at the bucket's earliest observation. */
    priceOpenCents: integer('price_open_cents').notNull(),
    /** Foreign retail price (cents) at the bucket's latest observation. */
    priceCloseCents: integer('price_close_cents').notNull(),
    /** Minimum foreign retail price (cents) within the bucket. */
    priceMinCents: integer('price_min_cents').notNull(),
    /** Maximum foreign retail price (cents) within the bucket. */
    priceMaxCents: integer('price_max_cents').notNull(),
    /** Average foreign retail price (cents) — rounding rule in table docblock. */
    priceAvgCents: integer('price_avg_cents').notNull(),
    /** Landed cost (cents) at the bucket's earliest observation. */
    landedCostOpenCents: integer('landed_cost_open_cents').notNull(),
    /** Landed cost (cents) at the bucket's latest observation. */
    landedCostCloseCents: integer('landed_cost_close_cents').notNull(),
    /** Minimum landed cost (cents) within the bucket. */
    landedCostMinCents: integer('landed_cost_min_cents').notNull(),
    /** Maximum landed cost (cents) within the bucket. */
    landedCostMaxCents: integer('landed_cost_max_cents').notNull(),
    /** Average landed cost (cents) — rounding rule in table docblock. */
    landedCostAvgCents: integer('landed_cost_avg_cents').notNull(),
    /** Number of priceObservations rows aggregated into this bucket. */
    observationCount: integer('observation_count').notNull(),
    /** Strictest reliability among the bucket's observations by core-domain
     *  RELIABILITY_ORDER severity (VERIFIED < ESTIMATED < STALE < UNAVAILABLE,
     *  packages/core-domain/src/reliability/reliability.types.ts). */
    strictestReliability: varchar('strictest_reliability', { length: 16 })
      .notNull(),
  },
  (table) => [
    // Idempotency key for the aggregation job's upsert. Postgres treats NULLs
    // as distinct in unique keys by default, which would admit duplicate
    // product-wide rows (merchant NULL) and ON CONFLICT would never match
    // them. Chosen fix: UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+; this
    // stack targets 16) via Drizzle's native .nullsNotDistinct() — unlike a
    // sentinel merchant value it keeps NULL meaning "product-wide" everywhere
    // (no magic value leaking into queries/APIs), and unlike a
    // COALESCE(merchant, '') expression index it is matched directly by
    // ON CONFLICT (granularity, period_start, product_id, merchant).
    unique('price_history_summaries_bucket_key')
      .on(table.granularity, table.periodStart, table.productId, table.merchant)
      .nullsNotDistinct(),
    index('price_history_summaries_granularity_product_id_period_start_idx').on(
      table.granularity,
      table.productId,
      table.periodStart,
    ),
  ],
);

/**
 * Aggregation watermarks — persisted incremental-scan cursors for
 * materialization jobs.
 *
 * One row per consuming job (keyed by job name). The time-series
 * aggregation worker stores the latest observedAt instant whose buckets
 * were fully written; the next run scans only observations at or after
 * that instant. Persisted here — never in worker memory — so a restarted
 * or retried job never re-scans from the beginning and never skips
 * unprocessed observations.
 */
export const aggregationWatermarks = pgTable('aggregation_watermarks', {
  id: serial('id').primaryKey(),
  /** Consuming job name (e.g. the BullMQ queue name). */
  jobName: varchar('job_name', { length: 128 }).unique().notNull(),
  /** Latest observedAt instant known to be fully materialized. */
  watermark: timestamp('watermark').notNull(),
  /** When the watermark last advanced — operational provenance. */
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * User accounts — one row per registered user.
 *
 * Created by the auth/signup flow. Tier controls feature-gate access
 * via the application-api entitlement service. Calculation history is
 * stored separately via savedBaskets and calculationRecords FK.
 */
export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  /** Stable external identifier (from auth provider). */
  userId: varchar('user_id', { length: 128 }).unique().notNull(),
  /** Verified email address — used for account recovery and notifications. */
  email: varchar('email', { length: 320 }).notNull(),
  /** Service tier — gates premium features (FREE or PREMIUM). */
  tier: varchar('tier', { length: 16 }).default('FREE').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
});

/**
 * Saved baskets — user-curated product collections for repeat calculations.
 *
 * Each basket belongs to one account (FK to accounts.id). Items are stored
 * as a JSON array of {productId, productName, quantity} so the basket can
 * be reconstructed without join queries at list time. Navigation is always
 * account → basket, so no FK from items back to productMaster is needed.
 */
export const savedBaskets = pgTable('saved_baskets', {
  id: serial('id').primaryKey(),
  /** FK to accounts — the owning user. */
  accountId: integer('account_id')
    .references(() => accounts.id)
    .notNull(),
  /** Human-readable basket label (user-supplied). */
  name: varchar('name', { length: 256 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** JSON array of BasketItem: [{productId, productName, quantity}]. */
  items: jsonb('items').notNull(),
});