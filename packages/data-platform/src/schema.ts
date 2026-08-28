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
  primaryKey,
  type AnyPgColumn,
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
  /**
   * Retail price in EUR cents — the canonical stored amount. Non-EUR feed
   * prices are converted at ingestion (design D2); a foreign-currency
   * amount never enters this column.
   */
  priceCents: integer('price_cents').notNull(),
  /** Canonical price currency — always 'EUR' after ingestion conversion. */
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  /**
   * Original list price in the source currency's smallest unit, kept for
   * display. Null on rows written before conversion provenance existed
   * (EUR-native feeds may also omit it).
   */
  originalPriceCents: integer('original_price_cents'),
  /** Source-market currency of original_price_cents (ISO 4217). */
  originalCurrency: varchar('original_currency', { length: 3 }),
  /**
   * FX dataset version (fx_rate_datasets.version_label) that produced the
   * conversion — present exactly when the original currency was not EUR.
   */
  fxDatasetVersion: varchar('fx_dataset_version', { length: 64 }),
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
 * Monthly range-partitioned on calculatedAt (task 8.1, change
 * technical-assessment-remediation): anonymous-session rows are pruned
 * after the configured window and whole partitions drop once fully
 * inside the retention horizon. The primary key therefore includes the
 * partition key — (id, calculatedAt).
 *
 * Migration note: replaces the former `calculation_audit` table
 * (removed in this version). The old table had a flat input/output
 * snapshot pattern. The new schema normalises FK references and
 * stores a structured breakdown.
 */
export const calculationRecords = pgTable(
  'calculation_records',
  {
    id: serial('id').notNull(),
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
    /** When calculation was performed — the partition key. */
    calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
  },
  (table) => [
    // Partitioned-table PK must include the partition key.
    primaryKey({ columns: [table.id, table.calculatedAt] }),
    // findBySession lookup order.
    index('calculation_records_session_id_calculated_at_idx').on(
      table.sessionId,
      table.calculatedAt,
    ),
  ],
);

/**
 * Price observations — append-only analytical series for historical intelligence.
 *
 * One row per merchant-offer observation recorded by the price-ingestion
 * background job at quantity=1 baseline. Each row is self-contained
 * (price, transport cost, tax rule versions, landed cost, reliability
 * snapshot) so the aggregation and attribution services consume it
 * without joins across session-scoped data. Rows are never updated or
 * deleted by application code — corrections append new observations.
 *
 * TimescaleDB hypertable partitioned on observedAt (design D4, change
 * technical-assessment-remediation): the append-only, time-indexed,
 * watermark-scanned access pattern is exactly the hypertable model.
 * The primary key includes the partition key — (id, observedAt).
 */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: serial('id').notNull(),
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
    // Hypertable PK must include the partition key (observedAt).
    primaryKey({ columns: [table.id, table.observedAt] }),
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

/**
 * Saved scenarios — named calculator input sets for repeat runs.
 *
 * Each scenario belongs to one account (FK to accounts.id). Unlike
 * savedBaskets (product selections for basket shipping), a scenario stores
 * calculator inputs only: loading one repopulates the calculator and
 * re-runs the calculation against current data — scenario data never
 * serves as a cached result. Data minimization: no personal data beyond
 * the account FK. Deleting an account cascades to its scenarios at the
 * database level (savedBaskets cascades in repository code instead), so
 * the GDPR erasure path cannot leave orphaned scenarios behind even if
 * the repository layer is bypassed.
 *
 * @see design.md Decision 1 — scenarios are a separate table, upsert-by-name.
 */
export const savedScenarios = pgTable(
  'saved_scenarios',
  {
    id: serial('id').primaryKey(),
    /** FK to accounts — the owning user; cascade delete implements the erasure path. */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Human-readable scenario label (user-supplied, unique per account). */
    name: varchar('name', { length: 256 }).notNull(),
    /** JSON object of calculator inputs: {productId, quantity, destination, transportMethod?, transportArrangement?}. */
    inputs: jsonb('inputs').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** When the scenario inputs were last replaced (upsert-by-name refreshes it). */
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Upsert-by-name idempotency key: saving with an existing name targets
    // this constraint's ON CONFLICT (account_id, name) and replaces inputs.
    unique('saved_scenarios_account_id_name_unique').on(
      table.accountId,
      table.name,
    ),
  ],
);

/**
 * Merchant terms — store-level commercial conditions.
 *
 * One row per merchant carrying minimum-order thresholds and other
 * store-level commercial terms. A missing row means no known threshold
 * (the store is eligible regardless of subtotal). Non-VERIFIED reliability
 * downgrades the basket-optimizer confidence but does not exclude the store.
 *
 * @see design.md Decision 3 — minimum-order threshold as externally sourced data.
 */
export const merchantTerms = pgTable('merchant_terms', {
  id: serial('id').primaryKey(),
  /** Merchant identifier — matches retail_offers.merchant (e.g. "alko", "systembolaget"). */
  merchantId: text('merchant_id').unique().notNull(),
  /** Minimum order value in cents to qualify for purchase. Null means no known threshold. */
  minimumOrderValueCents: integer('minimum_order_value_cents'),
  /** Currency of the threshold value (e.g. 'EUR'). */
  currency: text('currency').notNull(),
  /** Link to the page where this term was sourced. */
  sourceUrl: text('source_url'),
  /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — same value set as retail_offers. */
  reliabilityStatus: varchar('reliability_status', { length: 16 })
    .default('ESTIMATED')
    .notNull(),
  /** When the threshold was observed from the source. */
  observedAt: timestamp('observed_at').defaultNow().notNull(),
});

/**
 * Basket calculation records — every basket-optimization result shown to a user.
 *
 * Immutable once written. Mirrors calculationRecords but stores the full
 * multi-product input (inputBasket JSON) and the per-shipment itemized
 * breakdown (shipmentBreakdown JSON) that the single-product table cannot
 * represent. Enables auditability, correction, and confidence-based ranking
 * for the basket-optimizer path.
 *
 * Monthly range-partitioned on createdAt alongside calculationRecords
 * (task 8.1) — the primary key therefore includes the partition key,
 * (id, createdAt).
 *
 * @see design.md Decision 5 — basketCalculationRecords persistence.
 */
export const basketCalculationRecords = pgTable(
  'basket_calculation_records',
  {
    id: serial('id').notNull(),
    /** Session identifier — groups calculations by user session for audit trail. Same domain as calculationRecords.sessionId. */
    sessionId: varchar('session_id', { length: 64 }),
    /** Destination country code (ISO 3166-1 alpha-2). */
    destination: text('destination').notNull(),
    /** Transport arrangement identifier (e.g. "delivery", "pickup"). */
    transportArrangement: text('transport_arrangement').notNull(),
    /** Input basket snapshot: JSON array of {productId, quantity}. */
    inputBasket: jsonb('input_basket').notNull(),
    /** Per-shipment itemized breakdown: JSON array of shipment objects with costs. */
    shipmentBreakdown: jsonb('shipment_breakdown').notNull(),
    /** Total estimated landed cost in cents across all shipments. */
    totalCents: integer('total_cents').notNull(),
    /** Confidence level (HIGH/MEDIUM/LOW) — computed by confidence framework. */
    confidence: varchar('confidence', { length: 6 }).notNull(),
    /** Structural disclaimer text — required by architecture rule: not a UI-only string. */
    disclaimer: text('disclaimer').notNull(),
    /** When the calculation was performed — the partition key. */
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Partitioned-table PK must include the partition key.
    primaryKey({ columns: [table.id, table.createdAt] }),
  ],
);


/**
 * Versioned FX rate datasets — never overwritten, always appended.
 *
 * Mirrors the tax-rules governance treatment (design D2, change
 * technical-assessment-remediation): each dataset is dated, versioned,
 * and carries source provenance plus an effective window. A dataset is
 * created in PENDING_CONFIRMATION status and only becomes effective
 * through the explicit publishDataset repository call performed by a
 * human operator — never automatically. Historical versions remain
 * queryable after a new version is published.
 */
export const fxRateDatasets = pgTable('fx_rate_datasets', {
  id: serial('id').primaryKey(),
  /** Human-readable version label (e.g. "ecb-2026-08-28.1") — unique dataset identity for cache invalidation and provenance. */
  versionLabel: varchar('version_label', { length: 64 }).unique().notNull(),
  /** Provenance: source adapter that fetched the payload (e.g. "ecb-reference-rates"). */
  sourceName: varchar('source_name', { length: 128 }).notNull(),
  /** Provenance: link to the source publication the rates were taken from. */
  sourceUrl: varchar('source_url', { length: 512 }),
  /** Date the source published these rates — the "as of" date of the payload. */
  referenceDate: date('reference_date').notNull(),
  /** Lifecycle: PENDING_CONFIRMATION until a human publishes; PUBLISHED is terminal. */
  status: varchar('status', { length: 32 }).default('PENDING_CONFIRMATION').notNull(),
  /** Start of the effective window (inclusive) — conversion uses the dataset effective on the observation date. */
  effectiveFrom: timestamp('effective_from').notNull(),
  /** End of the effective window (exclusive, null = current/active dataset). */
  effectiveTo: timestamp('effective_to'),
  /** Operator who published the dataset — null while unconfirmed (auditability of the manual step). */
  confirmedBy: varchar('confirmed_by', { length: 128 }),
  /** When the dataset was published — null while unconfirmed. */
  confirmedAt: timestamp('confirmed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
/**
 * FX rates — the per-currency-pair rows of a versioned dataset.
 *
 * Append-only alongside its dataset: once the dataset is published the
 * rows are immutable, so a conversion ever made is reproducible. Rates
 * are stored in the source's direction (ECB: base EUR, quote foreign);
 * inversion is a domain-policy decision, never a storage-level one.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: serial('id').primaryKey(),
    /** FK to fx_rate_datasets — the version this rate belongs to. */
    datasetId: integer('dataset_id')
      .references(() => fxRateDatasets.id)
      .notNull(),
    /** Base currency (ISO 4217) — 1 unit of base = rate units of quote. */
    baseCurrency: varchar('base_currency', { length: 3 }).notNull(),
    /** Quote currency (ISO 4217). */
    quoteCurrency: varchar('quote_currency', { length: 3 }).notNull(),
    /** Exchange rate: units of quote currency per 1 unit of base. */
    rate: numeric('rate', { precision: 24, scale: 12 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // One row per currency pair per dataset version — appending the same
    // pair twice for a version is a fetch bug, not a new rate.
    unique('fx_rates_dataset_pair_unique').on(
      table.datasetId,
      table.baseCurrency,
      table.quoteCurrency,
    ),
  ],
);
/**
 * Sessions — server-issued opaque session tokens (design D3, change
 * technical-assessment-remediation).
 *
 * Only the SHA-256 hash of the token is stored; the raw value exists
 * solely in the httpOnly cookie handed to the client. The backend
 * derives the account from the token hash — client-supplied identity
 * headers are never consulted. Rotation replaces the row's validity in
 * one transaction: the old hash is revoked and a successor row links
 * back via rotatedFromId. Data minimization: no IP or user-agent —
 * nothing here is needed to authenticate, and GDPR erasure cascades
 * from the account row.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    /** SHA-256 hex digest of the opaque token — lookup key for authentication. */
    tokenHash: varchar('token_hash', { length: 64 }).unique().notNull(),
    /** FK to accounts — the identity this session authenticates. */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Predecessor session on rotation — audit chain of token replacement. */
    rotatedFromId: integer('rotated_from_id').references(
      (): AnyPgColumn => sessions.id,
      { onDelete: 'set null' },
    ),
    /** When the session was issued. */
    createdAt: timestamp('created_at').defaultNow().notNull(),
    /** When the session stops authenticating, regardless of activity. */
    expiresAt: timestamp('expires_at').notNull(),
    /** When the session was invalidated (rotation or logout) — null = still revocable. */
    revokedAt: timestamp('revoked_at'),
  },
  (table) => [
    // Session-listing and expiry housekeeping scans filter by account
    // first; without this index both degrade to full scans.
    index('sessions_account_id_idx').on(table.accountId),
  ],
);
/**
 * Audit events — append-only PostgreSQL audit log (task 4.2, change
 * technical-assessment-remediation).
 *
 * One row per domain AuditEntry: every change to tax-rule datasets,
 * FX datasets, classification rules, or governance state lands here.
 * The domain entry id (UUID) is the primary key — rows are never
 * updated or deleted by application code; there is deliberately no
 * retention path, matching the in-memory contract the tests rely on.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    /** Domain AuditEntry id (UUID) — identity is assigned at emission, not by storage. */
    id: varchar('id', { length: 64 }).primaryKey(),
    /** High-liability entity type (e.g. 'tax_rule', 'fx_rate_dataset', 'account'). */
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    /** Entity-specific identifier (rule id, version label, user id). */
    entityId: varchar('entity_id', { length: 128 }).notNull(),
    /** What happened: created / updated / deleted / confirmed. */
    action: varchar('action', { length: 16 }).notNull(),
    /** Who performed the change (user id or system actor). */
    author: varchar('author', { length: 128 }).notNull(),
    /** Free-text reason for the change. */
    reason: text('reason').notNull(),
    /** When the change occurred — domain timestamp, not insert time. */
    occurredAt: timestamp('occurred_at').notNull(),
    /** Snapshot before the change (JSON), when provided. */
    previousValue: jsonb('previous_value'),
    /** Snapshot after the change (JSON), when provided. */
    newValue: jsonb('new_value'),
  },
  (table) => [
    // getHistory(entityType, entityId) — the dominant lookup shape.
    index('audit_events_entity_type_entity_id_occurred_at_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    // Date-range filters of the audit query API.
    index('audit_events_occurred_at_idx').on(table.occurredAt),
  ],
);
/**
 * Click-counter snapshots — periodic durable captures of the Redis
 * click counters (task 4.3, change technical-assessment-remediation).
 *
 * Redis holds the live counters (surviving app restarts and shared
 * across replicas); this table is the periodic archive that survives
 * Redis data loss. One row per (merchant, url, capture run) holding
 * the cumulative count at capture time. Data minimization: merchant,
 * link, count, instant — no user or session data.
 */
export const clickCounterSnapshots = pgTable(
  'click_counter_snapshots',
  {
    id: serial('id').primaryKey(),
    /** Merchant identifier — matches retail_offers.merchant. */
    merchantId: varchar('merchant_id', { length: 128 }).notNull(),
    /** The outbound link URL the counter aggregates. */
    url: varchar('url', { length: 1024 }).notNull(),
    /** Cumulative click count for the (merchant, url) at capture time. */
    clickCount: integer('click_count').notNull(),
    /** When the snapshot run captured this row. */
    capturedAt: timestamp('captured_at').defaultNow().notNull(),
  },
  (table) => [
    // Idempotency key for a snapshot run: re-running the capture for the
    // same instant overwrites instead of duplicating rows.
    unique('click_counter_snapshots_merchant_url_captured_at_unique').on(
      table.merchantId,
      table.url,
      table.capturedAt,
    ),
  ],
);
/**
 * Merchant registry — database-backed merchant feed configuration
 * (design D7, task 7.2, change technical-assessment-remediation).
 *
 * Replaces the static merchants.config.ts as the source of the ingestion
 * source list: onboarding or changing a permitted merchant becomes a
 * row upsert, not a deploy. Aligned with the governance records by the
 * shared merchantId key — permission state itself stays in governance
 * (never duplicated here); consumers join registry rows with
 * SourceGovernanceService permission checks before ingesting.
 */
export const merchantRegistry = pgTable('merchant_registry', {
  id: serial('id').primaryKey(),
  /** Stable merchant identifier — join key for retail_offers.merchant, merchant_terms.merchant_id, and governance records. */
  merchantId: varchar('merchant_id', { length: 128 }).unique().notNull(),
  /** Human-readable merchant name. */
  name: varchar('name', { length: 256 }).notNull(),
  /** Merchant market (ISO 3166-1 alpha-2). */
  country: varchar('country', { length: 4 }).notNull(),
  /** Base URL of the merchant's feed or API endpoint — empty means the adapter is not implemented yet (pipeline skips). */
  feedUrl: text('feed_url').notNull(),
  /** Expected payload format. */
  feedFormat: varchar('feed_format', { length: 8 }).notNull(),
  /** How often to poll for new data (milliseconds). */
  pollingIntervalMs: integer('polling_interval_ms').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  /** When the registry row last changed — onboarding audit trail. */
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
