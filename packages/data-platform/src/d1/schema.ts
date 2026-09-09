/**
 * Drizzle ORM schema definitions — Cloudflare D1 (SQLite) dialect.
 *
 * Translated 1:1 from the canonical PostgreSQL schema
 * (`packages/data-platform/src/schema.ts`) per design D2 of the
 * `migrate-to-cloudflare` change. Table and column names are identical
 * (snake_case) so the cutover ETL maps rows 1:1.
 *
 * ## NOT translated: `price_observations`
 *
 * The canonical schema has 19 `pgTable` definitions. 18 are translated
 * here. `priceObservations` / `price_observations` is deliberately
 * ABSENT: per design D4 as amended by gate review G1 (see
 * `openspec/changes/migrate-to-cloudflare/design.md`, section "Gate
 * review outcomes"), it lives in R2 as an append-only JSONL log
 * partitioned by date — not in D1. Do not add it to this file.
 *
 * ## Translation rules applied (design D2)
 *
 * - Money stays INTEGER cents (already true in the pg schema).
 * - `timestamp` → TEXT holding ISO-8601 UTC strings
 *   (`YYYY-MM-DDTHH:mm:ss.sssZ`, same shape as `Date.toISOString()`).
 *   Column defaults use the `ISO_8601_NOW` SQL fragment below.
 * - `boolean` → INTEGER via `{ mode: 'boolean' }` (drizzle maps 0/1).
 *   `depositSystemStatus` keeps its tri-state by staying nullable.
 * - Closed value sets documented in the pg schema (no literal pg enums
 *   exist there) → TEXT + CHECK constraints with the exact same values.
 *   Columns whose pg docblock does NOT enumerate values (e.g.
 *   `availability`, `feed_format`, `category`) stay unconstrained TEXT —
 *   inventing value sets here would diverge from the canonical schema.
 * - `jsonb` → TEXT with `{ mode: 'json' }` (drizzle serializes/parses).
 * - `numeric` → REAL (SQLite has no decimal type; see column comments).
 * - `date` → TEXT holding `YYYY-MM-DD` strings.
 * - `serial` → `integer().primaryKey()` (SQLite rowid alias auto-assigns).
 *   The two composite-PK tables cannot use a rowid alias — see their
 *   table comments.
 *
 * pg features with no SQLite equivalent are documented inline at the
 * affected table/column, never silently dropped.
 *
 * @module D1Schema
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/**
 * SQL fragment producing the current UTC instant as ISO-8601 TEXT with
 * millisecond precision — the D1 replacement for pg's `now()` default.
 * Output shape matches `new Date().toISOString()`, so application-side
 * writes and column defaults are lexicographically comparable.
 */
export const ISO_8601_NOW = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** CHECK value set shared by every reliability column (pg docblocks name it "same value set as retail_offers"). */
const RELIABILITY_VALUES = sql`('VERIFIED', 'ESTIMATED', 'STALE', 'UNAVAILABLE')`;

/** CHECK value set for confidence columns (HIGH/MEDIUM/LOW). */
const CONFIDENCE_VALUES = sql`('HIGH', 'MEDIUM', 'LOW')`;

/**
 * Product Master — canonical product records.
 *
 * One row per unique beverage product. Fields are driven by the
 * ingestion pipeline (RawFeedRecord → UpsertProductInput) and the
 * calculation engines that need product attributes for tax/duty lookup.
 */
export const productMaster = sqliteTable(
  'product_master',
  {
    id: integer('id').primaryKey(),
    /** Display name from merchant feed (RawFeedRecord.productName). */
    name: text('name', { length: 512 }).notNull(),
    /** Manufacturer from feed adapter — used for product disambiguation. */
    manufacturer: text('manufacturer', { length: 256 }).notNull(),
    /** Brand from feed adapter — mapped by DataMappingService for upsert matching. */
    brand: text('brand', { length: 256 }).notNull(),
    /** Product category — maps to taxRules.productCategory for excise/duty rule lookup. */
    category: text('category', { length: 32 }).notNull(),
    /** Alcohol by volume (decimal, e.g. 0.047 for 4.7%) — required by excise engine. */
    alcoholByVolume: real('alcohol_by_volume'),
    /** Unit volume in litres — required for per-volume tax formulas (€/litre). */
    unitVolume: real('unit_volume').notNull(),
    /**
     * Container/packaging type — determines container duty treatment.
     * Authoritative value set = the core-domain ContainerType union
     * ('glass' | 'plastic' | 'metal' | 'carton' | 'other') plus the
     * container-duty engine's standard packaging spellings the committed
     * fixtures and real feeds store ('can', 'bottle' — see
     * tests/golden/data/products.ts and
     * core-domain/src/tax/services/container-duty.math.ts). Migration
     * 0002 widened the CHECK accordingly; keep the two in sync.
     */
    containerType: text('container_type', { length: 32 }).notNull(),
    /** Regulatory classification from feed — used for tax classification matching. */
    regulatoryClassification: text('regulatory_classification', { length: 64 }).notNull(),
    /**
     * True if packaging participates in Finnish deposit-return system — checked by container-duty service for exemption.
     * Tri-state: true / false / null (unknown) — nullable INTEGER boolean, per design D2.
     */
    depositSystemStatus: integer('deposit_system_status', { mode: 'boolean' }),
    /** EAN-13 barcode — primary product identification key for upsert matching. */
    ean: text('ean', { length: 13 }),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Task 2.5 (migrate-to-cloudflare), gate-review addition (a): the
    // value set is the core-domain ContainerType union ∪ fixture values
    // (see the containerType column docblock). Migration
    // 0002_product_container_type_check rebuilt the table with this
    // CHECK — this declaration mirrors it 1:1.
    check(
      'product_master_container_type_check',
      sql`${table.containerType} IN ('glass', 'plastic', 'metal', 'carton', 'other', 'can', 'bottle')`,
    ),
  ],
);

/**
 * Retail offers — scraped price points from external retailers.
 *
 * One row per (merchant, product, observedAt) observation. Price history
 * enables trend analysis and freshness-based filtering.
 */
export const retailOffers = sqliteTable(
  'retail_offers',
  {
    id: integer('id').primaryKey(),
    /** Merchant identifier — distinguishes sources (e.g. "alko", "eu-import"). */
    merchant: text('merchant', { length: 128 }).notNull(),
    /** Market/origin country (ISO 3166-1 alpha-2). */
    country: text('country', { length: 4 }).notNull(),
    /** FK to product_master — links offer to canonical product. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /**
     * Retail price in EUR cents — the canonical stored amount. Offers are
     * EUR-only (design D3, change drop-sweden-eur-only-alko-benchmark); a
     * foreign-currency amount never enters this column.
     */
    priceCents: integer('price_cents').notNull(),
    /** Canonical price currency — pinned to 'EUR' (design D3). */
    currency: text('currency', { length: 3 }).default('EUR').notNull(),
    /** Stock status — filters out-of-stock offers from price comparisons. */
    availability: text('availability', { length: 16 }).default('unknown').notNull(),
    /** Provenance link to source product page. */
    sourceUrl: text('source_url', { length: 1024 }),
    /** When price was observed — used for freshness calculations. */
    observedAt: text('observed_at').default(ISO_8601_NOW).notNull(),
    /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — surfaced to user per architecture rule. */
    reliabilityStatus: text('reliability_status', { length: 16 })
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
    check('retail_offers_reliability_status_check', sql`${table.reliabilityStatus} IN ${RELIABILITY_VALUES}`),
  ],
);

/**
 * Versioned tax rules — never overwritten, always appended.
 *
 * Each row represents a rate effective for a time window. Historical rates
 * remain queryable after changes. The calculation engines resolve the
 * correct version by effectiveFrom/effectiveTo date range.
 */
export const taxRules = sqliteTable(
  'tax_rules',
  {
    id: integer('id').primaryKey(),
    /** Tax type discriminator: "excise" (alcohol excise) or "container_duty". */
    taxType: text('tax_type', { length: 32 }).notNull(),
    /** Matches productMaster.category — selects applicable rule for a product. */
    productCategory: text('product_category', { length: 32 }).notNull(),
    /**
     * Rate value (meaning depends on taxType: €/hl/°Plato for excise, €/litre for container).
     * REAL: SQLite has no decimal type; pg numeric(12,6) values are stored
     * as IEEE-754 doubles. Money amounts never live in this column (they
     * stay INTEGER cents per design D2).
     */
    rate: real('rate').notNull(),
    /** Start of rate validity window (inclusive). */
    effectiveFrom: text('effective_from').notNull(),
    /** End of rate validity window (exclusive, null = current/active rate). */
    effectiveTo: text('effective_to'),
    /** JSON exemption rules (e.g. {maxAlcoholByVolume: 0.5}) — evaluated by deposit-checker. */
    exemptionConditions: text('exemption_conditions', { mode: 'json' }),
    /** Math function key — selects the calculation formula in the tax engine. */
    calculationFormulaReference: text('calculation_formula_reference', { length: 128 }).notNull(),
    /** Authoritative publication URL — auditability: "every number is explainable". */
    officialSource: text('official_source', { length: 512 }).notNull(),
    /** When rate was verified against official source — null = unverified/ESTIMATED. */
    verificationDate: text('verification_date'),
    /** Human-readable version label (e.g. "v1.0-2024") — used for audit trail. */
    versionLabel: text('version_label', { length: 64 }).notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    check('tax_rules_tax_type_check', sql`${table.taxType} IN ('excise', 'container_duty')`),
  ],
);

/**
 * Carrier transport offers.
 *
 * One row per (carrier, route, weight-bracket, package-tier) pricing entry.
 * Used by transport-estimation and basket-shipping services to estimate
 * shipping cost for a landed-cost calculation.
 */
export const transportOffers = sqliteTable(
  'transport_offers',
  {
    id: integer('id').primaryKey(),
    /** Carrier identifier (e.g. "matkahuolto", "posti"). */
    carrier: text('carrier', { length: 64 }).notNull(),
    /** Shipping origin country (ISO 3166-1 alpha-2). */
    originCountry: text('origin_country', { length: 4 }).notNull(),
    /** Shipping destination — default "FI" (Finland). */
    destinationCountry: text('destination_country', { length: 4 }).default('FI').notNull(),
    /** Weight bracket lower bound in kg — null = no lower limit. */
    weightMinKg: real('weight_min_kg'),
    /** Weight bracket upper bound in kg — null = no upper limit. */
    weightMaxKg: real('weight_max_kg'),
    /** Package tier (parcel/box/pallet) — matches basket dominant type. */
    packageTier: text('package_tier', { length: 32 }).notNull(),
    /** Shipping cost in smallest currency unit (cents). */
    priceCents: integer('price_cents').notNull(),
    /** Price currency — default EUR for Finnish market. */
    currency: text('currency', { length: 3 }).default('EUR').notNull(),
    /** True if seller pays shipping (affects landed-cost attribution). */
    sellerInvolvementIndicator: integer('seller_involvement_indicator', { mode: 'boolean' })
      .default(false)
      .notNull(),
    /** When rate was observed from carrier. */
    observedAt: text('observed_at').default(ISO_8601_NOW).notNull(),
    /** When carrier rates were last refreshed — separate from observedAt for batch refresh tracking. */
    refreshedAt: text('refreshed_at').default(ISO_8601_NOW).notNull(),
    /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — surfaced to user per architecture rule.
     *  Staleness thresholds per domain: price=24h, transport=7d, classification=30d
     *  (configured in packages/core-domain/src/reliability/reliability.types.ts). */
    reliabilityStatus: text('reliability_status', { length: 16 })
      .default('ESTIMATED')
      .notNull(),
  },
  (table) => [
    // No packageTier CHECK: pg has a plain varchar and the domain treats it
    // as a free string — the calculator matches offers to products by
    // `packageTier === product.containerType`, so real rows carry the
    // container-type vocabulary ('can', 'bottle', …). The CHECK that 0000
    // invented here was dropped by migration 0003 (golden e2e caught it:
    // every real offer was rejected and transport silently degraded to 0).
    check('transport_offers_reliability_status_check', sql`${table.reliabilityStatus} IN ${RELIABILITY_VALUES}`),
  ],
);

/**
 * Calculation records — every landed-cost result shown to a user.
 *
 * Immutable once written. Enables auditability, correction, and
 * confidence-based ranking. FK references normalised to separate tables
 * (not flat JSON snapshots) for query flexibility.
 *
 * The pg table is monthly range-partitioned on calculatedAt, hence the
 * composite primary key (id, calculatedAt). SQLite has no partitioning;
 * the composite PK is preserved as-is (retention becomes scheduled
 * DELETE per design D4, amended). Consequence of the composite PK:
 * `id` cannot be a rowid alias in SQLite, so it does NOT auto-assign
 * (pg's serial did). The ETL supplies historical ids; the ported insert
 * path must generate ids application-side.
 */
export const calculationRecords = sqliteTable(
  'calculation_records',
  {
    id: integer('id').notNull(),
    /** FK to product_master — the product this calculation is for. */
    productMasterId: integer('product_master_id')
      .references(() => productMaster.id)
      .notNull(),
    /** JSON array of retail_offer_ids — basket may reference multiple offers. */
    retailOfferIds: text('retail_offer_ids', { mode: 'json' }),
    /** FK to transport_offers — the shipping option used. */
    transportOfferId: integer('transport_offer_id').references(() => transportOffers.id),
    /** FK to tax_rules — excise rule version applied (traceability). */
    exciseRuleVersionId: integer('excise_rule_version_id').references(() => taxRules.id),
    /** FK to tax_rules — container duty rule version applied (traceability). */
    containerDutyRuleVersionId: integer('container_duty_rule_version_id').references(() => taxRules.id),
    /** Final landed cost in cents. */
    totalCents: integer('total_cents').notNull(),
    /** Structured cost breakdown (excise, duty, transport components) — "every number is explainable". */
    breakdown: text('breakdown', { mode: 'json' }).notNull(),
    /** Confidence level (HIGH/MEDIUM/LOW) — used by ranking/sorting system. */
    confidence: text('confidence', { length: 6 }).notNull(),
    /** Number of units in the calculation. */
    quantity: integer('quantity').notNull(),
    /** Destination country code (ISO 3166-1 alpha-2). */
    destination: text('destination', { length: 4 }).notNull(),
    /** Structural disclaimer text — required by architecture rule: not a UI-only string. */
    disclaimer: text('disclaimer').notNull(),
    /** Session identifier — groups calculations by user session for audit trail. */
    sessionId: text('session_id', { length: 64 }),
    /** When calculation was performed — the former partition key, kept in the PK. */
    calculatedAt: text('calculated_at').default(ISO_8601_NOW).notNull(),
    /**
     * Display-only Alko benchmark snapshot (JSON text) — written when the
     * calculation had a usable Alko reference, NULL on reference-less and
     * pre-change records (absence is the render-nothing state, never a
     * placeholder).
     */
    alkoBenchmark: text('alko_benchmark', { mode: 'json' }),
  },
  (table) => [
    // Former partitioned-table PK must include the partition key.
    primaryKey({ columns: [table.id, table.calculatedAt] }),
    // findBySession lookup order.
    index('calculation_records_session_id_calculated_at_idx').on(
      table.sessionId,
      table.calculatedAt,
    ),
    check('calculation_records_confidence_check', sql`${table.confidence} IN ${CONFIDENCE_VALUES}`),
  ],
);

/**
 * Price history summaries — materialized daily/weekly aggregates for charts.
 *
 * One row per (granularity, periodStart, productId, merchant) bucket. In
 * pg these are built from priceObservations; on Cloudflare the raw
 * observations live in R2 (design D4, amended) while summaries still
 * materialize into D1 and remain the long-term analytical record.
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
export const priceHistorySummaries = sqliteTable(
  'price_history_summaries',
  {
    id: integer('id').primaryKey(),
    /** Bucket granularity discriminator: "daily" or "weekly". */
    granularity: text('granularity', { length: 16 }).notNull(),
    /** Bucket start anchor, TEXT 'YYYY-MM-DD' (pg `date`); see table docblock for daily/weekly alignment. */
    periodStart: text('period_start').notNull(),
    /** FK to product_master — links summary to canonical product. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Merchant identifier (matches the R2 observation log's merchant field). NULL means
     *  the product-wide aggregate across all merchants. */
    merchant: text('merchant', { length: 128 }),
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
    /** Number of observations aggregated into this bucket. */
    observationCount: integer('observation_count').notNull(),
    /** Strictest reliability among the bucket's observations by core-domain
     *  RELIABILITY_ORDER severity (VERIFIED < ESTIMATED < STALE < UNAVAILABLE,
     *  packages/core-domain/src/reliability/reliability.types.ts). */
    strictestReliability: text('strictest_reliability', { length: 16 }).notNull(),
  },
  (table) => [
    // Idempotency key for the aggregation job's upsert.
    // pg declares this UNIQUE NULLS NOT DISTINCT (PostgreSQL 15+) so
    // product-wide rows (merchant NULL) are matched by ON CONFLICT. SQLite
    // has no NULLS NOT DISTINCT — NULLs are always distinct — so the plain
    // UNIQUE below does NOT admit upsert semantics for NULL-merchant rows,
    // and an ON CONFLICT target naming `merchant` never matches them. The
    // ported aggregation service must compensate (e.g. COALESCE expression
    // conflict target, or sentinel handling) — the pg schema comment
    // documents why a sentinel merchant value was rejected on pg, and the
    // same reasoning applies here until the port lands.
    unique('price_history_summaries_bucket_key').on(
      table.granularity,
      table.periodStart,
      table.productId,
      table.merchant,
    ),
    index('price_history_summaries_granularity_product_id_period_start_idx').on(
      table.granularity,
      table.productId,
      table.periodStart,
    ),
    check('price_history_summaries_granularity_check', sql`${table.granularity} IN ('daily', 'weekly')`),
    check(
      'price_history_summaries_strictest_reliability_check',
      sql`${table.strictestReliability} IN ${RELIABILITY_VALUES}`,
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
 * that instant. On Cloudflare the same watermark pattern applies to the
 * R2 observation log (design D4, amended). Persisted here — never in
 * worker memory — so a restarted or retried job never re-scans from the
 * beginning and never skips unprocessed observations.
 */
export const aggregationWatermarks = sqliteTable('aggregation_watermarks', {
  id: integer('id').primaryKey(),
  /** Consuming job name (e.g. the Cron/Workflow job identifier). */
  jobName: text('job_name', { length: 128 }).unique().notNull(),
  /** Latest observedAt instant known to be fully materialized. */
  watermark: text('watermark').notNull(),
  /** When the watermark last advanced — operational provenance. */
  updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
});

/**
 * User accounts — one row per registered user.
 *
 * Created by the register flow (change email-password-auth): the email
 * address IS the username, normalized to lowercase by the repositories
 * on write and lookup — the case-insensitive uniqueness below is
 * enforced in SQL, not just application code. Tier controls
 * feature-gate access via the application-api entitlement service.
 * Calculation history is stored separately via savedBaskets and
 * calculationRecords FK.
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey(),
    /** Stable external identifier (issued at registration). */
    userId: text('user_id', { length: 128 }).unique().notNull(),
    /** Login name and contact address, stored lowercase (unique via lower(email)). */
    email: text('email', { length: 320 }).notNull(),
    /**
     * Password credential envelope (PBKDF2-SHA256, design D1 of change
     * email-password-auth) — hashed by the application layer, this
     * column stores only the self-describing envelope string. Nullable:
     * the login path rejects a null/empty hash fail-safe (401), so a
     * credential-less row can never authenticate.
     */
    passwordHash: text('password_hash'),
    /**
     * When email ownership was verified (ISO-8601 TEXT); null =
     * unverified. Set only by the emailed single-use token flow — never
     * self-asserted.
     */
    emailVerifiedAt: text('email_verified_at'),
    /** Service tier — gates premium features (FREE or PREMIUM). */
    tier: text('tier', { length: 16 }).default('FREE').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    lastActiveAt: text('last_active_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    check('accounts_tier_check', sql`${table.tier} IN ('FREE', 'PREMIUM')`),
    // Username === email: uniqueness is case-insensitive and lives in
    // SQL (design D7, change email-password-auth). The expression form
    // matches the repositories' lower(email) lookups — the index serves
    // the login query directly.
    uniqueIndex('accounts_email_lower_idx').on(sql`lower(${table.email})`),
  ],
);

/**
 * Email tokens — single-use, hashed, purpose-scoped credentials for
 * email-ownership verification and password reset (design D3, change
 * email-password-auth).
 *
 * Only the SHA-256 hex digest of the token is stored (the sessions
 * hashing convention); the raw 256-bit base64url value exists solely in
 * emailed links and request bodies, and lookups are by hash. Single-use
 * is enforced in the UPDATE that consumes: `usedAt` is set in the same
 * statement that checks `used_at IS NULL AND expires_at > now`, so a
 * replayed token finds no active row and loses. Expiry horizons (24 h
 * verification, 1 h reset) are the callers' policy — this table stores
 * and compares instants, it does not own them.
 */
export const emailTokens = sqliteTable(
  'email_tokens',
  {
    id: integer('id').primaryKey(),
    /** FK to accounts — the identity the token acts on; cascade delete (GDPR erasure precedent). */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** SHA-256 hex digest of the opaque token — lookup key, never the raw value. */
    tokenHash: text('token_hash', { length: 64 }).notNull(),
    /** What the token authorizes — closed set enforced by CHECK. */
    purpose: text('purpose', { length: 16 }).notNull(),
    /** When the token stops granting anything (exclusive edge). */
    expiresAt: text('expires_at').notNull(),
    /** When the token was consumed — null while still redeemable. */
    usedAt: text('used_at'),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The consume/find lookups address one (hash, purpose) pair; the
    // composite index serves them without a full scan.
    index('email_tokens_token_hash_purpose_idx').on(table.tokenHash, table.purpose),
    // invalidateAllForAccount scans one account's outstanding tokens
    // (the same access shape as sessions_account_id_idx).
    index('email_tokens_account_id_idx').on(table.accountId),
    check(
      'email_tokens_purpose_check',
      sql`${table.purpose} IN ('verify_email', 'password_reset')`,
    ),
  ],
);

/**
 * Saved baskets — user-curated product collections for repeat calculations.
 *
 * Each basket belongs to one account (FK to accounts.id). Items are stored
 * as a JSON array of {productId, productName, quantity} so the basket can
 * be reconstructed without join queries at list time. Navigation is always
 * account → basket, so no FK from items back to productMaster is needed.
 */
export const savedBaskets = sqliteTable('saved_baskets', {
  id: integer('id').primaryKey(),
  /** FK to accounts — the owning user. */
  accountId: integer('account_id')
    .references(() => accounts.id)
    .notNull(),
  /** Human-readable basket label (user-supplied). */
  name: text('name', { length: 256 }).notNull(),
  createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  /** JSON array of BasketItem: [{productId, productName, quantity}]. */
  items: text('items', { mode: 'json' }).notNull(),
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
export const savedScenarios = sqliteTable(
  'saved_scenarios',
  {
    id: integer('id').primaryKey(),
    /** FK to accounts — the owning user; cascade delete implements the erasure path. */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Human-readable scenario label (user-supplied, unique per account). */
    name: text('name', { length: 256 }).notNull(),
    /** JSON object of calculator inputs: {productId, quantity, destination, transportMethod?, transportArrangement?}. */
    inputs: text('inputs', { mode: 'json' }).notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    /** When the scenario inputs were last replaced (upsert-by-name refreshes it). */
    updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
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
 * Price alerts — per-account watchlist alerts on a product (task 2.1,
 * change product-roadmap-phases-1-4; kind column, threshold nullability
 * and per-kind duplicate guard per task 1.2, change
 * trust-and-reach-roadmap, design D5).
 *
 * One row per (account, product, kind): the UNIQUE constraint makes the
 * evaluation cooldown's per-alert scope identical to design R2's
 * per-product-per-account scope — a second alert on the same triple
 * could only produce duplicate emails — while PRICE and TAX_CHANGE
 * watches on one product coexist (the duplicate check is per
 * product+kind). Pausing keeps the configuration while excluding the
 * row from scheduled evaluation; deleting the account row cascades here
 * (GDPR erasure, same guarantee as savedScenarios).
 */
export const priceAlerts = sqliteTable(
  'price_alerts',
  {
    id: integer('id').primaryKey(),
    /** FK to accounts — the owning user; cascade delete implements the erasure path. */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** FK to product_master — the tracked product. Products are never deleted, so no cascade. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /**
     * What triggers the alert: PRICE evaluates the materialized price
     * after ingestion cycles; TAX_CHANGE evaluates on rate-version
     * publication and carries no threshold. Defaults to 'PRICE' —
     * existing rows took the default in migration 0016, preserving
     * exactly the pre-kind behavior.
     */
    kind: text('kind', { length: 16 }).default('PRICE').notNull(),
    /**
     * Notify when the product's materialized price falls to or below
     * this (cents). PRICE alerts carry it; TAX_CHANGE alerts leave it
     * null — a rate-change trigger has no threshold to compare against
     * (spec: "TAX_CHANGE alerts SHALL NOT require a threshold").
     */
    thresholdCents: integer('threshold_cents'),
    /** active = evaluated by the cron; paused = configuration kept, evaluation skipped. */
    status: text('status', { length: 16 }).default('active').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Serves list-by-account (leading column) and the create-time
    // duplicate guard — one alert per (account, product, kind).
    unique('price_alerts_account_id_product_id_kind_unique').on(
      table.accountId,
      table.productId,
      table.kind,
    ),
    // The post-ingestion evaluation cron scans active alerts; the
    // (account_id, product_id, kind) unique index cannot serve that
    // filter.
    index('price_alerts_status_idx').on(table.status),
    // A null threshold is the TAX_CHANGE shape; a present one must be a
    // positive cent amount.
    check(
      'price_alerts_threshold_cents_check',
      sql`${table.thresholdCents} IS NULL OR ${table.thresholdCents} > 0`,
    ),
    check('price_alerts_status_check', sql`${table.status} IN ('active', 'paused')`),
    check('price_alerts_kind_check', sql`${table.kind} IN ('PRICE', 'TAX_CHANGE')`),
  ],
);

/**
 * Alert notifications — the delivery intent log for price alerts
 * (task 2.1, change product-roadmap-phases-1-4).
 *
 * Written BEFORE dispatch and marked AFTER: the pending row is the
 * intent, the outcome marking is the completion record. A retried
 * evaluation run skips a row already marked delivered, so a crash
 * mid-delivery can never double-send (spec: crash-safe delivery).
 * The delivery outcome transition (pending → delivered | failed) plus
 * marked_at is the ONLY update these rows ever receive — the attempt
 * facts (alert, observed price, channel, createdAt) are immutable, per
 * the product-data-model spec: "append-only records of delivery
 * attempts ... never rewritten". Deleting the alert cascades here.
 */
export const alertNotifications = sqliteTable(
  'alert_notifications',
  {
    id: integer('id').primaryKey(),
    /** FK to price_alerts — the alert whose threshold triggered; cascade delete. */
    alertId: integer('alert_id')
      .references(() => priceAlerts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Materialized price (cents) observed when the notification intent was written. */
    observedPriceCents: integer('observed_price_cents').notNull(),
    /** Delivery channel — email only for MVP (design R2); no push in this change. */
    channel: text('channel', { length: 16 }).notNull(),
    /** Intent-log lifecycle: pending until dispatch resolves (delivered | failed). */
    deliveryStatus: text('delivery_status', { length: 16 })
      .default('pending')
      .notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    /** When the outcome was marked — null while the intent is still pending. */
    markedAt: text('marked_at'),
  },
  (table) => [
    // Latest-DELIVERED-notification lookup (alert_id, status) ordered by
    // createdAt — the 24-hour cooldown's enforcement read.
    index('alert_notifications_alert_id_delivery_status_created_at_idx').on(
      table.alertId,
      table.deliveryStatus,
      table.createdAt,
    ),
    check('alert_notifications_channel_check', sql`${table.channel} IN ('email')`),
    check(
      'alert_notifications_delivery_status_check',
      sql`${table.deliveryStatus} IN ('pending', 'delivered', 'failed')`,
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
export const merchantTerms = sqliteTable(
  'merchant_terms',
  {
    id: integer('id').primaryKey(),
    /** Merchant identifier — matches retail_offers.merchant (e.g. "alko", "eu-import"). */
    merchantId: text('merchant_id').unique().notNull(),
    /** Minimum order value in cents to qualify for purchase. Null means no known threshold. */
    minimumOrderValueCents: integer('minimum_order_value_cents'),
    /** Currency of the threshold value (e.g. 'EUR'). */
    currency: text('currency').notNull(),
    /** Link to the page where this term was sourced. */
    sourceUrl: text('source_url'),
    /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — same value set as retail_offers. */
    reliabilityStatus: text('reliability_status', { length: 16 })
      .default('ESTIMATED')
      .notNull(),
    /** When the threshold was observed from the source. */
    observedAt: text('observed_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    check('merchant_terms_reliability_status_check', sql`${table.reliabilityStatus} IN ${RELIABILITY_VALUES}`),
  ],
);

/**
 * Basket calculation records — every basket-optimization result shown to a user.
 *
 * Immutable once written. Mirrors calculationRecords but stores the full
 * multi-product input (inputBasket JSON) and the per-shipment itemized
 * breakdown (shipmentBreakdown JSON) that the single-product table cannot
 * represent. Enables auditability, correction, and confidence-based ranking
 * for the basket-optimizer path.
 *
 * In pg the table was monthly range-partitioned on createdAt alongside
 * calculationRecords, hence the composite primary key (id, createdAt).
 * SQLite has no partitioning; the composite PK is preserved as-is
 * (retention becomes scheduled DELETE per design D4, amended). As with
 * calculationRecords, `id` does NOT auto-assign in SQLite — the ETL
 * supplies historical ids; the ported insert path generates new ones.
 *
 * @see design.md Decision 5 — basketCalculationRecords persistence.
 */
export const basketCalculationRecords = sqliteTable(
  'basket_calculation_records',
  {
    id: integer('id').notNull(),
    /** Session identifier — groups calculations by user session for audit trail. Same domain as calculationRecords.sessionId. */
    sessionId: text('session_id', { length: 64 }),
    /** Destination country code (ISO 3166-1 alpha-2). */
    destination: text('destination').notNull(),
    /** Transport arrangement identifier (e.g. "delivery", "pickup"). */
    transportArrangement: text('transport_arrangement').notNull(),
    /** Input basket snapshot: JSON array of {productId, quantity}. */
    inputBasket: text('input_basket', { mode: 'json' }).notNull(),
    /** Per-shipment itemized breakdown: JSON array of shipment objects with costs. */
    shipmentBreakdown: text('shipment_breakdown', { mode: 'json' }).notNull(),
    /** Total estimated landed cost in cents across all shipments. */
    totalCents: integer('total_cents').notNull(),
    /** Confidence level (HIGH/MEDIUM/LOW) — computed by confidence framework. */
    confidence: text('confidence', { length: 6 }).notNull(),
    /** Structural disclaimer text — required by architecture rule: not a UI-only string. */
    disclaimer: text('disclaimer').notNull(),
    /** When the calculation was performed — the former partition key, kept in the PK. */
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Former partitioned-table PK must include the partition key.
    primaryKey({ columns: [table.id, table.createdAt] }),
    check('basket_calculation_records_confidence_check', sql`${table.confidence} IN ${CONFIDENCE_VALUES}`),
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
export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey(),
    /** SHA-256 hex digest of the opaque token — lookup key for authentication. */
    tokenHash: text('token_hash', { length: 64 }).unique().notNull(),
    /** FK to accounts — the identity this session authenticates. */
    accountId: integer('account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Predecessor session on rotation — audit chain of token replacement. */
    rotatedFromId: integer('rotated_from_id').references(
      (): AnySQLiteColumn => sessions.id,
      { onDelete: 'set null' },
    ),
    /** When the session was issued. */
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    /** When the session stops authenticating, regardless of activity. */
    expiresAt: text('expires_at').notNull(),
    /** When the session was invalidated (rotation or logout) — null = still revocable. */
    revokedAt: text('revoked_at'),
  },
  (table) => [
    // Session-listing and expiry housekeeping scans filter by account
    // first; without this index both degrade to full scans.
    index('sessions_account_id_idx').on(table.accountId),
  ],
);

/**
 * Audit events — append-only audit log (task 4.2, change
 * technical-assessment-remediation).
 *
 * One row per domain AuditEntry: every change to tax-rule datasets,
 * Classification rules or governance state lands here.
 * The domain entry id (UUID) is the primary key — rows are never
 * updated or deleted by application code; there is deliberately no
 * retention path, matching the in-memory contract the tests rely on.
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    /** Domain AuditEntry id (UUID) — identity is assigned at emission, not by storage. */
    id: text('id', { length: 64 }).primaryKey(),
    /** High-liability entity type (e.g. 'tax_rule', 'account'). */
    entityType: text('entity_type', { length: 64 }).notNull(),
    /** Entity-specific identifier (rule id, version label, user id). */
    entityId: text('entity_id', { length: 128 }).notNull(),
    /** What happened: created / updated / deleted / confirmed. */
    action: text('action', { length: 16 }).notNull(),
    /** Who performed the change (user id or system actor). */
    author: text('author', { length: 128 }).notNull(),
    /** Free-text reason for the change. */
    reason: text('reason').notNull(),
    /** When the change occurred — domain timestamp, not insert time. */
    occurredAt: text('occurred_at').notNull(),
    /** Snapshot before the change (JSON), when provided. */
    previousValue: text('previous_value', { mode: 'json' }),
    /** Snapshot after the change (JSON), when provided. */
    newValue: text('new_value', { mode: 'json' }),
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
    check(
      'audit_events_action_check',
      sql`${table.action} IN ('created', 'updated', 'deleted', 'confirmed')`,
    ),
  ],
);

/**
 * Click-counter snapshots — periodic durable captures of the click
 * counters (task 4.3, change technical-assessment-remediation).
 *
 * On Cloudflare the live counters live in ClickCounterDO (design D5);
 * this table is the periodic archive its alarm-driven flush writes,
 * surviving DO data loss. One row per (merchant, url, capture run)
 * holding the cumulative count at capture time. Data minimization:
 * merchant, link, count, instant — no user or session data.
 */
export const clickCounterSnapshots = sqliteTable(
  'click_counter_snapshots',
  {
    id: integer('id').primaryKey(),
    /** Merchant identifier — matches retail_offers.merchant. */
    merchantId: text('merchant_id', { length: 128 }).notNull(),
    /** The outbound link URL the counter aggregates. */
    url: text('url', { length: 1024 }).notNull(),
    /** Cumulative click count for the (merchant, url) at capture time. */
    clickCount: integer('click_count').notNull(),
    /** When the snapshot run captured this row. */
    capturedAt: text('captured_at').default(ISO_8601_NOW).notNull(),
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
export const merchantRegistry = sqliteTable('merchant_registry', {
  id: integer('id').primaryKey(),
  /** Stable merchant identifier — join key for retail_offers.merchant, merchant_terms.merchant_id, and governance records. */
  merchantId: text('merchant_id', { length: 128 }).unique().notNull(),
  /** Human-readable merchant name. */
  name: text('name', { length: 256 }).notNull(),
  /** Merchant market (ISO 3166-1 alpha-2). */
  country: text('country', { length: 4 }).notNull(),
  /** Base URL of the merchant's feed or API endpoint — empty means the adapter is not implemented yet (pipeline skips). */
  feedUrl: text('feed_url').notNull(),
  /** Expected payload format. */
  feedFormat: text('feed_format', { length: 8 }).notNull(),
  /** How often to poll for new data (milliseconds). */
  pollingIntervalMs: integer('polling_interval_ms').notNull(),
  createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  /** When the registry row last changed — onboarding audit trail. */
  updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
});

/**
 * Product physical dimensions — curated packaging facts (task 3.1, change
 * product-roadmap-phases-1-4, design R3).
 *
 * One row per product: weight, height, diameter, and the packaging
 * material, each row carrying source, reliability status, and observedAt —
 * dimensions are externally sourced facts, so provenance is part of every
 * row, not an afterthought. Absence of a row is a normal state (packing
 * results flag the product ESTIMATED and omit it from breakage-risk
 * reasoning); nothing in the system estimates or defaults dimensions to
 * fill gaps. A new observation replaces the previous row (upsert on the
 * product unique key) — the operator console is the update path.
 *
 * `material` is its own closed value set (GLASS/CAN/PLASTIC/OTHER), not
 * the container_type vocabulary of product_master: it classifies the
 * packed packaging for the mixing warning, and the two vocabularies serve
 * different engines.
 */
export const productDimensions = sqliteTable(
  'product_dimensions',
  {
    id: integer('id').primaryKey(),
    /** FK to product_master — the measured product. Products are never deleted, so no cascade. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Measured product weight in grams. */
    weightG: integer('weight_g').notNull(),
    /** Measured product height in millimetres. */
    heightMm: integer('height_mm').notNull(),
    /** Measured product diameter in millimetres (beverage units are cylindrical). */
    diameterMm: integer('diameter_mm').notNull(),
    /** Packaging material of the packed unit — mixing-warning classification. */
    material: text('material', { length: 16 }).notNull(),
    /** Provenance: where the measurement came from (source page, carrier sheet, operator note). */
    source: text('source').notNull(),
    /** Data freshness indicator (VERIFIED/ESTIMATED/STALE/UNAVAILABLE) — same value set as retail_offers. */
    reliabilityStatus: text('reliability_status', { length: 16 })
      .default('ESTIMATED')
      .notNull(),
    /** When the measurement was observed from the source. */
    observedAt: text('observed_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // One row per product: the unique key is the upsert/replace target,
    // and a missing row is the designed "dimensions unknown" state.
    unique('product_dimensions_product_id_unique').on(table.productId),
    check(
      'product_dimensions_material_check',
      sql`${table.material} IN ('GLASS', 'CAN', 'PLASTIC', 'OTHER')`,
    ),
    check('product_dimensions_reliability_status_check', sql`${table.reliabilityStatus} IN ${RELIABILITY_VALUES}`),
    check('product_dimensions_weight_g_check', sql`${table.weightG} > 0`),
    check('product_dimensions_height_mm_check', sql`${table.heightMm} > 0`),
    check('product_dimensions_diameter_mm_check', sql`${table.diameterMm} > 0`),
  ],
);

/**
 * Carrier box types — standard shipping boxes per carrier (task 3.1,
 * change product-roadmap-phases-1-4).
 *
 * The packing module's ONLY source of box geometry (spec:
 * packing-optimization): internal dimensions and maximum weight per
 * standard box name. Curated reference data seeded from the carriers'
 * published packaging specifications — every row records the source page
 * and when the values were taken, mirroring the provenance discipline of
 * the other externally sourced tables. Box selection iterates a carrier's
 * boxes smallest-first; the packing engine owns that ordering, the table
 * does not encode it.
 */
export const carrierBoxTypes = sqliteTable(
  'carrier_box_types',
  {
    id: integer('id').primaryKey(),
    /** Carrier identifier — matches transport_offers.carrier (e.g. "postnord", "dhl"). */
    carrier: text('carrier', { length: 64 }).notNull(),
    /** Carrier's published box name (e.g. "PostNord Box M") — unique per carrier. */
    name: text('name', { length: 128 }).notNull(),
    /** Usable internal height in millimetres. */
    internalHeightMm: integer('internal_height_mm').notNull(),
    /** Usable internal width in millimetres. */
    internalWidthMm: integer('internal_width_mm').notNull(),
    /** Usable internal depth in millimetres. */
    internalDepthMm: integer('internal_depth_mm').notNull(),
    /** Maximum permitted shipment weight in grams. */
    maxWeightG: integer('max_weight_g').notNull(),
    /** Provenance: the carrier page the specification was taken from. */
    source: text('source').notNull(),
    /** When the specification was copied from the carrier's page. */
    observedAt: text('observed_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // One box per (carrier, name) — the seed's idempotent upsert target.
    unique('carrier_box_types_carrier_name_unique').on(table.carrier, table.name),
    check('carrier_box_types_internal_height_mm_check', sql`${table.internalHeightMm} > 0`),
    check('carrier_box_types_internal_width_mm_check', sql`${table.internalWidthMm} > 0`),
    check('carrier_box_types_internal_depth_mm_check', sql`${table.internalDepthMm} > 0`),
    check('carrier_box_types_max_weight_g_check', sql`${table.maxWeightG} > 0`),
  ],
);

/**
 * Consumption norms — versioned expected-consumption reference dataset
 * for the event calculator (task 4.1, change product-roadmap-phases-1-4,
 * design R5). NOT constants: rows are keyed by drinkType × eventProfile
 * inside a version (the set of rows sharing versionLabel, mirroring how
 * an FX dataset versions a set of fx_rates rows), each row carrying an
 * effective window, a NOT NULL source citation, and the
 * PENDING_CONFIRMATION → PUBLISHED lifecycle reused from the FX dataset
 * flow — publication is a human operator's explicit confirmation, never
 * automatic, and rows are append-only (corrections append a version,
 * historical rows stay queryable).
 *
 * The effective window is HALF-OPEN on calendar dates: effective_from ≤
 * event_date < effective_to (null effective_to = open-ended/current) —
 * ISO 'YYYY-MM-DD' TEXT compares chronologically, matching the pg
 * `date` translation rule above.
 *
 * normValuePerGuestPerHour is litres of finished beverage per guest per
 * hour (REAL — a fractional norm is the normal case, e.g. half a glass
 * of wine per hour). drinkType reuses the canonical tax-rule category
 * keys so the calculator's per-type lines feed the landed-cost/tax
 * engines without translation; eventProfile is the MVP simple mode's
 * closed profile set.
 *
 * UNIQUE (drink_type, event_profile, version_label) is the curated
 * seed's idempotent upsert target; UNIQUE already covers the resolution
 * read's key columns. The window CHECK makes an inverted window
 * unrepresentable at rest — the repository enforces the same rule on
 * the way in (defense in depth on a high-liability dataset).
 */
export const consumptionNorms = sqliteTable(
  'consumption_norms',
  {
    id: integer('id').primaryKey(),
    /** Norms version identifier — the set of rows sharing this label is one published dataset the calculator can name. */
    versionLabel: text('version_label', { length: 64 }).notNull(),
    /** Drink type — canonical tax-rule category key (beer, wine_still, wine_sparkling, intermediate_products, other_fermented, spirits). */
    drinkType: text('drink_type', { length: 32 }).notNull(),
    /** Event profile — the MVP simple mode's closed set (casual_gathering, dinner_party, celebration). */
    eventProfile: text('event_profile', { length: 32 }).notNull(),
    /** Expected consumption in litres of finished beverage per guest per hour. */
    normValuePerGuestPerHour: real('norm_value_per_guest_per_hour').notNull(),
    /** Provenance: verifiable source citation — a row without one can never reach PUBLISHED (spec: event-calculator). */
    sourceCitation: text('source_citation').notNull(),
    /** Lifecycle: PENDING_CONFIRMATION until a human publishes; PUBLISHED is terminal. */
    status: text('status', { length: 32 }).default('PENDING_CONFIRMATION').notNull(),
    /** Start of the effective window (inclusive), ISO 'YYYY-MM-DD'. */
    effectiveFrom: text('effective_from').notNull(),
    /** End of the effective window (exclusive, null = open-ended/current). */
    effectiveTo: text('effective_to'),
    /** Operator who published the version — null while unconfirmed (auditability of the manual step). */
    confirmedBy: text('confirmed_by', { length: 128 }),
    /** When the version was published — null while unconfirmed. */
    confirmedAt: text('confirmed_at'),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    unique('consumption_norms_key_version_unique').on(
      table.drinkType,
      table.eventProfile,
      table.versionLabel,
    ),
    check(
      'consumption_norms_status_check',
      sql`${table.status} IN ('PENDING_CONFIRMATION', 'PUBLISHED')`,
    ),
    check(
      'consumption_norms_drink_type_check',
      sql`${table.drinkType} IN ('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')`,
    ),
    check(
      'consumption_norms_event_profile_check',
      sql`${table.eventProfile} IN ('casual_gathering', 'dinner_party', 'celebration')`,
    ),
    check(
      'consumption_norms_norm_value_check',
      sql`${table.normValuePerGuestPerHour} > 0`,
    ),
    check(
      'consumption_norms_window_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Traveller allowance datasets — the versioned dataset of EU personal-use
 * indicative limits behind the trip feasibility calculator (task 5.1,
 * change product-roadmap-phases-1-4, design R7). A dataset VERSION is one
 * row here plus the traveller_allowance_limits rows referencing it, the
 * same dataset+rates shape as fx_rate_datasets/fx_rates. Rows are
 * append-only: a correction appends a new version and the historical rows
 * stay queryable; no code path updates a published version.
 *
 * Every dataset carries a NOT NULL source citation (an allowance dataset
 * without a citation is unrepresentable — spec: product-data-model,
 * "Versioned traveller allowance datasets") and starts
 * PENDING_CONFIRMATION; publication to the terminal PUBLISHED state is
 * the repository's explicit publish call, the same manual
 * dataset-confirmation lifecycle as fx_rate_datasets and
 * consumption_norms — publication is a human operator's explicit
 * confirmation, never automatic (the seed never publishes).
 *
 * The effective window is HALF-OPEN on calendar dates: effective_from ≤
 * travel_date < effective_to (null effective_to = open-ended/current) —
 * ISO 'YYYY-MM-DD' TEXT compares chronologically, matching the pg `date`
 * translation rule above.
 */
export const travellerAllowanceDatasets = sqliteTable(
  'traveller_allowance_datasets',
  {
    id: integer('id').primaryKey(),
    /** Allowance dataset version identifier — named by capped calculation results as provenance. */
    versionLabel: text('version_label', { length: 64 }).notNull(),
    /** Provenance: verifiable official source citation (directive/regulation + URL) for the dataset. */
    sourceCitation: text('source_citation').notNull(),
    /** Lifecycle: PENDING_CONFIRMATION until a human publishes; PUBLISHED is terminal. */
    status: text('status', { length: 32 }).default('PENDING_CONFIRMATION').notNull(),
    /** Start of the effective window (inclusive), ISO 'YYYY-MM-DD'. */
    effectiveFrom: text('effective_from').notNull(),
    /** End of the effective window (exclusive, null = open-ended/current). */
    effectiveTo: text('effective_to'),
    /** Operator who published the version — null while unconfirmed (auditability of the manual step). */
    confirmedBy: text('confirmed_by', { length: 128 }),
    /** When the version was published — null while unconfirmed. */
    confirmedAt: text('confirmed_at'),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    unique('traveller_allowance_datasets_version_label_unique').on(table.versionLabel),
    index('traveller_allowance_datasets_status_effective_idx').on(table.status, table.effectiveFrom),
    check(
      'traveller_allowance_datasets_status_check',
      sql`${table.status} IN ('PENDING_CONFIRMATION', 'PUBLISHED')`,
    ),
    check(
      'traveller_allowance_datasets_window_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Traveller allowance limits — one curated row per product category inside
 * an allowance dataset version, each carrying its own verifiable source
 * citation and effective window (spec: product-data-model, "Versioned
 * traveller allowance datasets"). The category reuses the canonical
 * tax-rule category keys so the trip calculator's per-category caps map
 * onto the landed-cost/tax engines without a translation layer.
 *
 * A cap is a volume (litres of finished beverage), a quantity (units, e.g.
 * sticks), or both — at least one MUST be present (the CHECK makes a cap-less
 * row unrepresentable at rest); the caps the EU defines for alcohol are all
 * volumes, so quantity stays null there. UNIQUE (dataset_id, category) is
 * the curated seed's idempotent upsert target and the per-version identity.
 */
export const travellerAllowanceLimits = sqliteTable(
  'traveller_allowance_limits',
  {
    id: integer('id').primaryKey(),
    /** FK to traveller_allowance_datasets — the version this limit belongs to. */
    datasetId: integer('dataset_id')
      .references(() => travellerAllowanceDatasets.id)
      .notNull(),
    /** Product category — canonical tax-rule category key (beer, wine_still, wine_sparkling, intermediate_products, other_fermented, spirits). */
    category: text('category', { length: 32 }).notNull(),
    /** Volume cap in litres of finished beverage — null when the cap is quantity-only. */
    volumeCapLitres: real('volume_cap_litres'),
    /** Quantity cap in units (e.g. cigarette sticks) — null when the cap is volume-only. */
    quantityCap: integer('quantity_cap'),
    /** Provenance: verifiable official source citation for this limit (rule text + URL). */
    sourceCitation: text('source_citation').notNull(),
    /** Start of the effective window (inclusive), ISO 'YYYY-MM-DD'. */
    effectiveFrom: text('effective_from').notNull(),
    /** End of the effective window (exclusive, null = open-ended/current). */
    effectiveTo: text('effective_to'),
  },
  (table) => [
    unique('traveller_allowance_limits_dataset_category_unique').on(
      table.datasetId,
      table.category,
    ),
    check(
      'traveller_allowance_limits_category_check',
      sql`${table.category} IN ('beer', 'wine_still', 'wine_sparkling', 'intermediate_products', 'other_fermented', 'spirits')`,
    ),
    check(
      'traveller_allowance_limits_cap_present_check',
      sql`${table.volumeCapLitres} IS NOT NULL OR ${table.quantityCap} IS NOT NULL`,
    ),
    check(
      'traveller_allowance_limits_volume_cap_check',
      sql`${table.volumeCapLitres} IS NULL OR ${table.volumeCapLitres} > 0`,
    ),
    check(
      'traveller_allowance_limits_quantity_cap_check',
      sql`${table.quantityCap} IS NULL OR ${table.quantityCap} > 0`,
    ),
    check(
      'traveller_allowance_limits_window_check',
      sql`${table.effectiveTo} IS NULL OR ${table.effectiveTo} > ${table.effectiveFrom}`,
    ),
  ],
);

/**
 * Group order sessions — shareable cost-splitting sessions (task 9.1,
 * change product-roadmap-phases-1-4, design R12).
 *
 * One row per collaborative order being planned. The share token is the
 * join credential: it grants write access to exactly this session and
 * expires — past the expiry edge the link stops being usable (the
 * rejection itself is the API layer's job, task 9.3; this table only
 * carries the edge honestly). Data minimization per R12: the session
 * stores no personal data beyond participant nicknames (on the item
 * rows) and no account data for non-owning participants.
 *
 * Accounting-only boundary (spec: group-order-ledger): NO
 * payment-adjacent columns exist here BY DESIGN — no amounts, no
 * currencies, no settlement state. Item VALUE for the proportional
 * allocation is derived at compute time from product/offer data
 * (tasks 9.2/9.3), never stored on session or item rows, so a payment
 * instrument or an amount is unrepresentable in a group order at the
 * schema level. Deleting the owner account cascades here (GDPR
 * erasure, the savedScenarios guarantee), which cascades onward to the
 * items below.
 */
export const groupOrderSessions = sqliteTable(
  'group_order_sessions',
  {
    id: integer('id').primaryKey(),
    /** FK to accounts — the authenticated creator; the only account reference these tables carry. */
    ownerAccountId: integer('owner_account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** The join credential — lookup key for the share link; unique so it identifies exactly one session. */
    shareToken: text('share_token', { length: 64 }).notNull(),
    /** When the token stops granting access (exclusive edge — at this instant the link is expired). */
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The share link's lookup — one token, one session, by definition.
    unique('group_order_sessions_share_token_unique').on(table.shareToken),
    // Expiry housekeeping scans (session deletion on expiry) filter by
    // the edge alone; the unique index cannot serve that filter.
    index('group_order_sessions_expires_at_idx').on(table.expiresAt),
    // A blank token is a credential-generation bug, not a session.
    check('group_order_sessions_share_token_check', sql`${table.shareToken} <> ''`),
  ],
);

/**
 * Group order items — one participant's line on a shared session
 * (task 9.1, change product-roadmap-phases-1-4, design R12).
 *
 * participantNickname is free text (bounded at 64 chars) and
 * deliberately NOT a user reference: participants join via the share
 * link without creating an account, so the self-chosen nickname is the
 * only participant identity a row carries — anonymity by design, the
 * minimal-personal-data guardrail R12 allows. Content validation
 * beyond the length bound belongs to the API's DTO layer (task 9.3),
 * not to this table.
 *
 * Like its session, an item row carries NO payment-adjacent columns:
 * quantity selects product_master rows and the item's euro value for
 * proportional allocation is computed from offer data at compute time
 * (tasks 9.2/9.3) — never persisted here. Deleting the session
 * cascades (expired/owner-deleted sessions cannot orphan item rows);
 * products are never deleted, so product_id needs no cascade (the
 * priceAlerts precedent).
 */
export const groupOrderItems = sqliteTable(
  'group_order_items',
  {
    id: integer('id').primaryKey(),
    /** FK to group_order_sessions — cascade delete keeps items from outliving their session. */
    sessionId: integer('session_id')
      .references(() => groupOrderSessions.id, { onDelete: 'cascade' })
      .notNull(),
    /** Self-chosen display nickname — the only participant identity; NOT a user reference (see table docblock). */
    participantNickname: text('participant_nickname', { length: 64 }).notNull(),
    /** FK to product_master — the beverage the line selects (value derived from offer data at compute time). */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Number of units the participant takes. */
    quantity: integer('quantity').notNull(),
    /** When the line was added — the deterministic list ordering's leading column. */
    addedAt: text('added_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Items of one session in list order (addedAt, then id for ties) —
    // the ledger's deterministic input.
    index('group_order_items_session_id_added_at_idx').on(table.sessionId, table.addedAt),
    // A zero/negative-quantity line selects nothing — unrepresentable.
    check('group_order_items_quantity_check', sql`${table.quantity} > 0`),
  ],
);

/**
 * Ferry offers — the curated affiliate slot behind the trip feasibility
 * calculator (task 5.3, change product-roadmap-phases-1-4, design R8).
 *
 * One row per curated ferry operator link. Columns are exactly the R8
 * set (operator, route label, url, status) plus the created_at stamp —
 * data minimization forbids optional fields "for later" (no campaign
 * fields, no ranking weight, no price data: an affiliate row that could
 * influence a calculation is unrepresentable by construction, which is
 * what makes the affiliate-neutrality compliance test structurally
 * trivial — the trip route reads this table on a data path that never
 * touches the calculation input).
 *
 * Status lifecycle: rows start DRAFT (operator-console work in
 * progress, invisible to the public trip API) and move to PUBLISHED by
 * the audited console publish action; PUBLISHED is terminal for the
 * status — content comes down by deletion, which the audit trail
 * records. The stored url never leaves the operator console: the
 * public API returns redirector-ready references and the outbound
 * redirect controller serves the click (R8: click tracking reuses the
 * existing redirect controller).
 */
export const ferryOffers = sqliteTable(
  'ferry_offers',
  {
    id: integer('id').primaryKey(),
    /** Ferry operator name as presented on the partner block (e.g. "Viking Line"). */
    operator: text('operator', { length: 128 }).notNull(),
    /** Human route label (e.g. "Helsinki–Tallinn"). */
    routeLabel: text('route_label', { length: 128 }).notNull(),
    /** Outbound link target — console-only; the public surface sees the redirect reference. */
    url: text('url').notNull(),
    /** Lifecycle: DRAFT until the audited console publish action; PUBLISHED is terminal. */
    status: text('status', { length: 16 }).default('DRAFT').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Serves the public block's deterministic (operator, route_label, id)
    // ordering — affiliate data must not influence anything, including
    // its own ordering surprises.
    index('ferry_offers_operator_route_label_idx').on(table.operator, table.routeLabel),
    // The public block reads published rows; the console queue reads drafts.
    index('ferry_offers_status_idx').on(table.status),
    check(
      'ferry_offers_status_check',
      sql`${table.status} IN ('DRAFT', 'PUBLISHED')`,
    ),
    // A blank operator/route/url is a curation bug, not an offer (the
    // group_order_sessions share-token check precedent).
    check('ferry_offers_operator_check', sql`${table.operator} <> ''`),
    check('ferry_offers_route_label_check', sql`${table.routeLabel} <> ''`),
    check('ferry_offers_url_check', sql`${table.url} <> ''`),
  ],
);

/**
 * Producer links — curated sibling-product evidence for the producer
 * dupe finder (task 6.1, change product-roadmap-phases-1-4, design
 * R9, spec: producer-matching).
 *
 * One row per (Alko product, foreign-shop sibling) pair, curated only
 * through the audited operator console or the validated import script.
 * The R9 evidence columns — producer_key, manufacturer, source_url,
 * plus reviewer and reviewed_at — are NOT NULL and non-empty (CHECKs):
 * an unevidenced row is unrepresentable at the schema level.
 *
 * Matching is an EXACT lookup on normalized producer keys — plain
 * indexed equality, no scoring/similarity/fuzzy path exists anywhere
 * in the module (binding spec requirement; the repository normalizes
 * keys on write and lookup via its exported pure rule). No ranking
 * weight, taste profile, or confidence column exists by design — the
 * 6.5 source-level compliance assertion depends on that absence.
 *
 * Status lifecycle follows ferry_offers: DRAFT work in progress →
 * audited one-way publish → PUBLISHED terminal; public reads see only
 * PUBLISHED rows. Product FKs need no cascade — products are never
 * deleted (the priceAlerts precedent) — and a self-link (a product
 * paired with itself) is a curation bug, unrepresentable at rest.
 */
export const producerLinks = sqliteTable(
  'producer_links',
  {
    id: integer('id').primaryKey(),
    /** FK to product_master — the Alko product the link starts from. */
    alkoProductId: integer('alko_product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** FK to product_master — the foreign-shop sibling it evidences. */
    siblingProductId: integer('sibling_product_id')
      .references(() => productMaster.id)
      .notNull(),
    /**
     * Producer key in NORMALIZED form (trim + lowercase + whitespace
     * collapse — the repository's exported rule) — the exact-lookup
     * matching key; the raw form is never persisted.
     */
    producerKey: text('producer_key', { length: 256 }).notNull(),
    /** Manufacturer behind the link — evidence presented with every sibling. */
    manufacturer: text('manufacturer', { length: 256 }).notNull(),
    /** Verifiable source URL for the sibling claim — evidence, not an outbound target. */
    sourceUrl: text('source_url').notNull(),
    /** Operator who reviewed the link — the curation audit face of R9. */
    reviewer: text('reviewer', { length: 128 }).notNull(),
    /** When the review happened — ISO-8601 TEXT (design D2 timestamp rule). */
    reviewedAt: text('reviewed_at').notNull(),
    /** Lifecycle: DRAFT until the audited console publish action; PUBLISHED is terminal. */
    status: text('status', { length: 16 }).default('DRAFT').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The exact lookup's index — equality on the normalized key is the
    // ONLY matching path (spec: no similarity scoring).
    index('producer_links_producer_key_idx').on(table.producerKey),
    // Product-scoped reads (console listing, the dupes endpoint).
    index('producer_links_alko_product_id_idx').on(table.alkoProductId),
    check(
      'producer_links_status_check',
      sql`${table.status} IN ('DRAFT', 'PUBLISHED')`,
    ),
    // A blank evidence/review field is a curation bug, not a link
    // (R9: unevidenced rows are unrepresentable — the ferry_offers
    // non-empty CHECK precedent).
    check('producer_links_producer_key_check', sql`${table.producerKey} <> ''`),
    check('producer_links_manufacturer_check', sql`${table.manufacturer} <> ''`),
    check('producer_links_source_url_check', sql`${table.sourceUrl} <> ''`),
    check('producer_links_reviewer_check', sql`${table.reviewer} <> ''`),
    check('producer_links_reviewed_at_check', sql`${table.reviewedAt} <> ''`),
    // A product is its own trivial sibling — never returnable.
    check(
      'producer_links_self_link_check',
      sql`${table.alkoProductId} <> ${table.siblingProductId}`,
    ),
  ],
);

/**
 * Curated list entries — operator-managed editorial content behind the
 * public curated lists (task 7.1, change product-roadmap-phases-1-4,
 * design R10, spec: curated-lists; first slug "Alkon hylkäämät").
 *
 * One row per entry of a list slug. The slug is the 7.2 public lookup
 * key (bounded, indexed). The target is EITHER a product_master
 * reference OR an external reference — the exactly-one CHECK makes a
 * both-null (points at nothing) and a both-present (ambiguous) entry
 * unrepresentable at rest. rationale, evidence_links (JSON), and
 * reviewer are NOT NULL and non-empty (CHECKs, the producer_links
 * evidence discipline); evidence_links additionally carries a
 * json_valid() CHECK — the STRUCTURE (a non-empty array of labeled
 * http(s) links) is validated by the repository on every write.
 *
 * Status lifecycle deliberately differs from ferry_offers /
 * producer_links (binding spec): entries are "created, updated, and
 * unpublished through the audited operator console" and content
 * changes require no deploys, so a PUBLISHED entry is editable and
 * can be unpublished (PUBLISHED → DRAFT). Every mutation is audited
 * at the console layer, so no code change or deploy is ever needed
 * for content work. updated_at moves on every edit; the product FK
 * needs no cascade (products are never deleted).
 */
export const curatedEntries = sqliteTable(
  'curated_entries',
  {
    id: integer('id').primaryKey(),
    /** Owning list slug in NORMALIZED form (trim + lowercase — the repository's exported rule); the 7.2 public lookup key. */
    listSlug: text('list_slug', { length: 128 }).notNull(),
    /** FK to product_master — the referenced Alko/merchant product (exactly-one target CHECK with externalRef). */
    productId: integer('product_id').references(() => productMaster.id),
    /** External reference for entries without a product_master row (exactly-one target CHECK with productId). */
    externalRef: text('external_ref', { length: 512 }),
    /** Why this entry qualifies for the list — the mandatory editorial justification. */
    rationale: text('rationale').notNull(),
    /** Evidence links (JSON array of {label, url}) — structure validated by the repository on every write. */
    evidenceLinks: text('evidence_links', { mode: 'json' }).notNull(),
    /** Operator who reviewed the entry — the curation audit face of R10. */
    reviewer: text('reviewer', { length: 128 }).notNull(),
    /** Lifecycle: DRAFT until the audited console publish; NOT terminal — the console can edit and unpublish (spec). */
    status: text('status', { length: 16 }).default('DRAFT').notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    /** Moves on every console edit — published content is updatable without deploys (spec). */
    updatedAt: text('updated_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The 7.2 public lookup (published rows of one slug) plus — via the
    // leftmost prefix — the console's per-slug management reads.
    index('curated_entries_list_slug_status_idx').on(table.listSlug, table.status),
    check(
      'curated_entries_status_check',
      sql`${table.status} IN ('DRAFT', 'PUBLISHED')`,
    ),
    // A blank slug/rationale/reviewer is a curation bug, not an entry
    // (the producer_links non-empty CHECK precedent).
    check('curated_entries_list_slug_check', sql`${table.listSlug} <> ''`),
    check('curated_entries_rationale_check', sql`${table.rationale} <> ''`),
    check('curated_entries_reviewer_check', sql`${table.reviewer} <> ''`),
    // Parseable JSON at rest; the repository validates the structure.
    check(
      'curated_entries_evidence_links_check',
      sql`${table.evidenceLinks} <> '' AND json_valid(${table.evidenceLinks})`,
    ),
    // Exactly one target: a NULL/NULL entry points at nothing, a
    // value/value entry is ambiguous — both unrepresentable.
    check(
      'curated_entries_target_check',
      sql`(${table.productId} IS NULL) <> (${table.externalRef} IS NULL)`,
    ),
    check(
      'curated_entries_external_ref_check',
      sql`${table.externalRef} IS NULL OR ${table.externalRef} <> ''`,
    ),
  ],
);

/**
 * Shop reports — user-submitted evidence against a merchant (task 1.1,
 * change trust-and-reach-roadmap, design D2, spec: merchant-blacklist).
 *
 * One row per report. Merchant identity is domain + normalized name —
 * NOT a merchant_registry FK: the reported shops are foreign merchants
 * that are not ingested, so matching has to work without a registry row.
 * The evidence fields (order reference, correspondence summary) are NOT
 * NULL — an unevidenced report is unrepresentable (the producer_links
 * evidence discipline); completeness beyond non-emptiness is the API
 * layer's validation, not this table's.
 *
 * Moderation state machine: OPEN until the audited ops-console action
 * links the report to a published blacklist entry (LINKED) or rejects
 * it (REJECTED) — publication is never automatic (design D2).
 * reporter_account_id cascades on account deletion (GDPR erasure, the
 * price_alerts guarantee): the published entry is the durable public
 * record, not the reporter's evidence rows.
 */
export const shopReports = sqliteTable(
  'shop_reports',
  {
    id: integer('id').primaryKey(),
    /** Merchant domain in normalized form (lowercase host) — half of the merchant identity key. */
    merchantDomain: text('merchant_domain', { length: 256 }).notNull(),
    /** Merchant display name in NORMALIZED form (trim + lowercase + whitespace collapse) — the other identity half. */
    merchantNameNormalized: text('merchant_name_normalized', { length: 256 }).notNull(),
    /** Order reference from the reporter's purchase — mandatory evidence. */
    orderReference: text('order_reference', { length: 128 }).notNull(),
    /** Reporter's digest of the correspondence with the merchant — mandatory evidence. */
    correspondenceSummary: text('correspondence_summary').notNull(),
    /** FK to accounts — the reporter; cascade delete implements the erasure path. */
    reporterAccountId: integer('reporter_account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /** Moderation state: OPEN → LINKED (backs a published entry) or REJECTED. */
    status: text('status', { length: 16 }).default('OPEN').notNull(),
    /** Published blacklist entry this report backs — set by the linking publish action; null while OPEN/REJECTED. */
    linkedEntryId: integer('linked_entry_id').references(
      (): AnySQLiteColumn => blacklistEntries.id,
    ),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The ops review queue reads OPEN reports; the moderation transition
    // is the only mutation these rows ever receive.
    index('shop_reports_status_idx').on(table.status),
    // Evidence accumulation per merchant (the 3+-independent-reports
    // standard) and report↔entry matching resolve by identity.
    index('shop_reports_merchant_domain_merchant_name_normalized_idx').on(
      table.merchantDomain,
      table.merchantNameNormalized,
    ),
    // Account-scoped reads (the reporter's own reports) — SQLite does
    // not index FK columns automatically (the email_tokens_account_id_idx
    // precedent).
    index('shop_reports_reporter_account_id_idx').on(table.reporterAccountId),
    check('shop_reports_status_check', sql`${table.status} IN ('OPEN', 'LINKED', 'REJECTED')`),
    // A blank identity/evidence field is a validation bypass, not a
    // report (the producer_links non-empty CHECK precedent).
    check('shop_reports_merchant_domain_check', sql`${table.merchantDomain} <> ''`),
    check('shop_reports_merchant_name_check', sql`${table.merchantNameNormalized} <> ''`),
    check('shop_reports_order_reference_check', sql`${table.orderReference} <> ''`),
    check('shop_reports_correspondence_check', sql`${table.correspondenceSummary} <> ''`),
  ],
);

/**
 * Blacklist entries — the published merchant warnings (task 1.1, change
 * trust-and-reach-roadmap, design D2, spec: merchant-blacklist).
 *
 * Created only by the audited operator publish action once the
 * accumulated OPEN reports meet the published standard (confirmed
 * non-delivery by 3+ independent reports, or a confirmed invalid
 * business registration). The standard set lives as constants in the
 * core-domain blacklist module, so `standardMet` stays unconstrained
 * TEXT: the module owns the value set, the row only records which
 * standard was met — inventing the enum here would duplicate it.
 *
 * Appeal path: an appeal stamps the appeal fields and moves the entry to
 * REOPENED, which removes it from the public warnings immediately, until
 * an operator republishes (PUBLISHED) or rejects (REJECTED, terminal);
 * every decision is appended to the audit trail, not stored on the row.
 * Entries are governance records and are never deleted (the audit_events
 * posture), so shop_reports.linked_entry_id needs no cascade.
 */
export const blacklistEntries = sqliteTable(
  'blacklist_entries',
  {
    id: integer('id').primaryKey(),
    /** Merchant domain in normalized form — half of the identity key (matches shop_reports.merchant_domain). */
    merchantDomain: text('merchant_domain', { length: 256 }).notNull(),
    /** Merchant name in NORMALIZED form — the other identity half (matches shop_reports.merchant_name_normalized). */
    merchantNameNormalized: text('merchant_name_normalized', { length: 256 }).notNull(),
    /** Which published standard was met — value set owned by the core-domain blacklist module (documented, unconstrained). */
    standardMet: text('standard_met', { length: 64 }).notNull(),
    /** When the operator published the entry. */
    publishedAt: text('published_at').default(ISO_8601_NOW).notNull(),
    /** Operator who published the entry — the manual-step audit face (the consumption_norms confirmed_by precedent). */
    publishedBy: text('published_by', { length: 128 }).notNull(),
    /** Lifecycle: PUBLISHED (public) → REOPENED (appeal, hidden) → PUBLISHED | REJECTED (terminal). */
    status: text('status', { length: 16 }).default('PUBLISHED').notNull(),
    /** When the appeal was filed — null until an appeal moves the entry to REOPENED. */
    appealedAt: text('appealed_at'),
    /** Appeal grounds as submitted — null until an appeal. */
    appealReason: text('appeal_reason'),
  },
  (table) => [
    // The display join resolves warnings for the merchants appearing on
    // a response by identity, filtered to PUBLISHED (REOPENED entries
    // hide immediately — spec: appeal path).
    index('blacklist_entries_merchant_domain_merchant_name_normalized_status_idx').on(
      table.merchantDomain,
      table.merchantNameNormalized,
      table.status,
    ),
    check(
      'blacklist_entries_status_check',
      sql`${table.status} IN ('PUBLISHED', 'REOPENED', 'REJECTED')`,
    ),
    // A blank identity/standard/operator field is a publish-action bug,
    // not an entry (the producer_links non-empty CHECK precedent).
    check('blacklist_entries_merchant_domain_check', sql`${table.merchantDomain} <> ''`),
    check('blacklist_entries_merchant_name_check', sql`${table.merchantNameNormalized} <> ''`),
    check('blacklist_entries_standard_met_check', sql`${table.standardMet} <> ''`),
    check('blacklist_entries_published_by_check', sql`${table.publishedBy} <> ''`),
  ],
);

/**
 * Retention cap for calculation_outcomes in days — 24 months (design
 * D1, change trust-and-reach-roadmap, spec: calculation-outcomes
 * "Retention decoupled from calculation records").
 *
 * calculation_outcomes is deliberately ABSENT from the calculation-record
 * retention sweep's RETENTION_TABLES
 * (src/repositories/d1/calculation-record-retention.ts): that sweep
 * deletes exactly the estimate an outcome froze, so sweeping outcomes
 * with it would silently destroy user-reported data. Outcomes prune by
 * THIS cap in their own scheduled sweep instead (wired by a later task).
 */
export const CALCULATION_OUTCOME_RETENTION_DAYS = 730;

/**
 * Calculation outcomes — user-reported actual totals for a calculation
 * record (task 1.1, change trust-and-reach-roadmap, design D1, spec:
 * calculation-outcomes).
 *
 * At most one outcome per (record, account) — the UNIQUE key IS the
 * duplicate guard behind the API's 409 (the saved_scenarios idempotency
 * precedent). The row freezes what the accuracy statistic needs — a
 * digest of the estimate fields plus both totals — so the "user-reported"
 * accuracy number stays explainable after the record itself is pruned
 * (spec scenario "Estimate pruned, outcome retained"; see
 * CALCULATION_OUTCOME_RETENTION_DAYS for this table's own cap).
 *
 * calculation_record_id is deliberately NOT a FOREIGN KEY: records are
 * sweep-pruned long before outcomes (180-day record cap vs this table's
 * 24-month cap), and a cascade would destroy outcomes while a
 * restrictive FK would break the record sweep's DELETEs — the reference
 * is by convention, resolved read-side.
 */
export const calculationOutcomes = sqliteTable(
  'calculation_outcomes',
  {
    id: integer('id').primaryKey(),
    /** calculation_records.id this outcome reports on — by convention, NOT an FK (see table docblock: record cap < outcome cap). */
    calculationRecordId: integer('calculation_record_id').notNull(),
    /** FK to accounts — the reporter; at most one row per (record, account); cascade delete implements the erasure path. */
    reporterAccountId: integer('reporter_account_id')
      .references(() => accounts.id, { onDelete: 'cascade' })
      .notNull(),
    /**
     * Digest of the estimate fields the outcome freezes (JSON text) —
     * written at report time so the outcome stays explainable once the
     * record is pruned (documented like calculationRecords.alkoBenchmark;
     * absence is unrepresentable — an outcome without its estimate
     * digest could not power the within-margin comparison).
     */
    estimateDigest: text('estimate_digest', { mode: 'json' }).notNull(),
    /** Estimated total in cents, from the frozen estimate — the margin comparison's reference. */
    estimatedTotalCents: integer('estimated_total_cents').notNull(),
    /** Reported actual total in cents — user-reported data, never a calculated value. */
    reportedTotalCents: integer('reported_total_cents').notNull(),
    /** When the outcome was reported — the as-of face of the public accuracy statistic. */
    reportedAt: text('reported_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The duplicate guard: at most one outcome per (record, account) —
    // a second report is a 409 at the API and unrepresentable at rest.
    unique('calculation_outcomes_calculation_record_id_reporter_account_id_unique').on(
      table.calculationRecordId,
      table.reporterAccountId,
    ),
    // Totals are positive cent amounts (spec: submission validation,
    // "positive cents") — a zero/negative is a validation bypass,
    // unrepresentable at rest.
    check('calculation_outcomes_estimated_total_check', sql`${table.estimatedTotalCents} > 0`),
    check('calculation_outcomes_reported_total_check', sql`${table.reportedTotalCents} > 0`),
  ],
);

/**
 * Blog posts — rate-change explainers behind a human publication gate
 * (task 1.2, change trust-and-reach-roadmap, design D3, spec:
 * content-publication).
 *
 * One row per (slug, locale): the draft hook at the manual
 * rate-confirmation point creates FI + EN DRAFT rows summarizing the
 * confirmed version's delta (fail-open — a draft failure never blocks
 * the confirmation), and only an operator action moves a row to
 * PUBLISHED; no auto-publish path exists (the consumption_norms publish
 * lifecycle). rate_dataset_version names the confirmed version in the
 * version_label vocabulary — a label reference, not an FK: versions are
 * append-only rows across the rule tables, not keyed lookups.
 */
export const blogPosts = sqliteTable(
  'blog_posts',
  {
    id: integer('id').primaryKey(),
    /** URL slug — the public lookup half, unique per locale. */
    slug: text('slug', { length: 256 }).notNull(),
    /** Content locale (BCP-47, the [locale] route set — 'fi'/'en' at launch). */
    locale: text('locale', { length: 16 }).notNull(),
    /** Post title. */
    title: text('title', { length: 512 }).notNull(),
    /** Markdown body — must pass the content-policy lint before publication (spec). */
    bodyMarkdown: text('body_markdown').notNull(),
    /** Lifecycle: DRAFT until the audited operator publish; public endpoints return PUBLISHED only. */
    status: text('status', { length: 16 }).default('DRAFT').notNull(),
    /**
     * Content kind (change insight-surfaces, task 1.2): RATE_CHANGE
     * explainers vs GUIDE evergreen content. Additive with the
     * RATE_CHANGE default — pre-kind rows keep their interpretation
     * without a backfill (design D3), and slug uniqueness stays per
     * (slug, locale), untouched by kind.
     */
    kind: text('kind', { length: 16 }).default('RATE_CHANGE').notNull(),
    /** Rate dataset version the post explains (version_label vocabulary) — null for posts without a rate tie-in. */
    rateDatasetVersion: text('rate_dataset_version', { length: 64 }),
    /** When published — null while DRAFT. */
    publishedAt: text('published_at'),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The public blog index reads PUBLISHED rows of one locale (the
    // curated_entries lookup-shape precedent); the unique key covers the
    // slug-page lookup.
    index('blog_posts_locale_status_idx').on(table.locale, table.status),
    unique('blog_posts_slug_locale_unique').on(table.slug, table.locale),
    check('blog_posts_status_check', sql`${table.status} IN ('DRAFT', 'PUBLISHED')`),
    check('blog_posts_kind_check', sql`${table.kind} IN ('RATE_CHANGE', 'GUIDE')`),
    // A blank slug/title is a draft-builder bug, not a post (the
    // producer_links non-empty CHECK precedent).
    check('blog_posts_slug_check', sql`${table.slug} <> ''`),
    check('blog_posts_title_check', sql`${table.title} <> ''`),
  ],
);

/**
 * Savings snapshots — one materialized row per product per as-of day
 * (change insight-surfaces, task 1.1): the day's best foreign offer, the
 * Alko reference, the estimated landed total, and the resulting gap.
 *
 * The daily insight job writes idempotently keyed by
 * unique(as_of, product_id): re-running a day converges, last write wins
 * (design D2 — the price-history-summary bucket-key pattern). Every money
 * amount is INTEGER euro cents and the gap magnitude is INTEGER basis
 * points (1/10 000) — floats never touch money or percentages (design
 * D4). `tax_dataset_version` is a version_label reference, not an FK (the
 * blog rate_dataset_version convention): versions are append-only rows
 * across the rule tables, not keyed lookups. The Alko columns are null
 * when no Alko reference was observed that day — absence is
 * representable, a sentinel zero is not ("every number is explainable").
 */
export const savingsSnapshots = sqliteTable(
  'savings_snapshots',
  {
    id: integer('id').primaryKey(),
    /** Snapshot day, TEXT 'YYYY-MM-DD' — half of the upsert idempotency key. */
    asOf: text('as_of').notNull(),
    /** FK to product_master — the snapshot's canonical product. */
    productId: integer('product_id')
      .references(() => productMaster.id)
      .notNull(),
    /** Product category (matches product_master.category) — the per-category range read's filter. */
    category: text('category', { length: 32 }).notNull(),
    /** Merchant of the day's best foreign offer. */
    bestMerchant: text('best_merchant', { length: 128 }).notNull(),
    /** Country the best offer ships from (ISO 3166-1 alpha-2). */
    bestMerchantCountry: text('best_merchant_country', { length: 2 }).notNull(),
    /** Best foreign offer price for one unit, in euro-cents (design D4). */
    bestPriceCents: integer('best_price_cents').notNull(),
    /** When the best offer was observed (ingestion time, ISO-8601). */
    bestObservedAt: text('best_observed_at').notNull(),
    /** Alko reference price for one unit, in euro-cents — null when not observed that day. */
    alkoReferenceCents: integer('alko_reference_cents'),
    /** When the Alko reference was observed — null with the reference. */
    alkoObservedAt: text('alko_observed_at'),
    /** Estimated landed total (taxes + transport included) for one unit, in euro-cents. */
    landedTotalCents: integer('landed_total_cents').notNull(),
    /** Reliability of the landed-total composition (core-domain ReliabilityStatus value set). */
    landedReliability: text('landed_reliability', { length: 16 }).notNull(),
    /** Aggregate confidence grade of the snapshot (core-domain ConfidenceLevel value set). */
    confidence: text('confidence', { length: 16 }).notNull(),
    /** Best-offer vs Alko-reference gap in euro-cents (sign carries the direction). */
    gapCents: integer('gap_cents').notNull(),
    /** The same gap in INTEGER basis points — the sortable, float-free ranking key (design D4). */
    gapBasisPoints: integer('gap_basis_points').notNull(),
    /** Tax-dataset version the landed total was computed against (version_label vocabulary). */
    taxDatasetVersion: text('tax_dataset_version', { length: 64 }).notNull(),
  },
  (table) => [
    // Idempotency key of the daily insight job's upsert (design D2).
    unique('savings_snapshots_as_of_product_id_unique').on(table.asOf, table.productId),
    // Serves the per-category closed-range read (category + as_of bounds).
    index('savings_snapshots_category_as_of_idx').on(table.category, table.asOf),
    check('savings_snapshots_landed_reliability_check', sql`${table.landedReliability} IN ${RELIABILITY_VALUES}`),
    check('savings_snapshots_confidence_check', sql`${table.confidence} IN ${CONFIDENCE_VALUES}`),
  ],
);

/**
 * Newsletter subscribers — double opt-in consent, independent of
 * accounts and of price-alert consent (task 1.2, change
 * trust-and-reach-roadmap, design D4, spec: content-publication).
 *
 * Different purpose, different audience: no account FK exists — a
 * subscription does not require registration. The row starts PENDING
 * and only the emailed token's confirmation activates it (unconfirmed
 * rows are never mailed — spec); the one-click unsubscribe takes effect
 * immediately. Only the SHA-256 hex digest of the confirmation token is
 * stored (the email_tokens convention); the raw value exists solely in
 * the emailed link. The email is stored lowercase by the repository and
 * uniqueness is case-insensitive in SQL (the accounts_email_lower_idx
 * precedent).
 */
export const newsletterSubscribers = sqliteTable(
  'newsletter_subscribers',
  {
    id: integer('id').primaryKey(),
    /** Subscriber address, stored lowercase (unique via lower(email)). */
    email: text('email', { length: 320 }).notNull(),
    /** Consent lifecycle: PENDING until token confirmation; ACTIVE receives sends; UNSUBSCRIBED is terminal. */
    status: text('status', { length: 16 }).default('PENDING').notNull(),
    /** SHA-256 hex digest of the single-use confirmation token — lookup key, never the raw value. */
    confirmationTokenHash: text('confirmation_token_hash', { length: 64 }).notNull(),
    /** When confirmation happened — null while PENDING. */
    confirmedAt: text('confirmed_at'),
    /** When the one-click unsubscribe happened — null until then. */
    unsubscribedAt: text('unsubscribed_at'),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // Case-insensitive uniqueness in SQL, not just application code —
    // the accounts_email_lower_idx precedent; the expression form
    // serves the subscribe lookup directly.
    uniqueIndex('newsletter_subscribers_email_lower_idx').on(sql`lower(${table.email})`),
    // The ops notify-subscribers action scans ACTIVE rows (the
    // price_alerts_status_idx precedent).
    index('newsletter_subscribers_status_idx').on(table.status),
    check(
      'newsletter_subscribers_status_check',
      sql`${table.status} IN ('PENDING', 'ACTIVE', 'UNSUBSCRIBED')`,
    ),
    // A blank token hash is a subscribe-flow bug, not a subscriber.
    check('newsletter_subscribers_token_hash_check', sql`${table.confirmationTokenHash} <> ''`),
  ],
);

/**
 * Newsletter notification intents — the delivery intent log behind
 * crash-safe ops newsletter sends (task 5.3, change
 * trust-and-reach-roadmap, design D4; the alert_notifications
 * precedent applied to the newsletter audience).
 *
 * The ops notify-subscribers action writes one PENDING intent row per
 * recipient BEFORE dispatch through the email worker and marks the
 * outcome AFTER, so a retried action skips subscribers already marked
 * delivered — a crash mid-batch can never double-send (spec
 * content-publication: crash-safe send). Rows are append-only delivery
 * attempt records: the outcome transition (pending → delivered |
 * failed) plus marked_at is the only update a row ever receives.
 * Deleting the subscriber cascades here — the intent log has no
 * meaning without its recipient.
 */
export const newsletterNotifications = sqliteTable(
  'newsletter_notifications',
  {
    id: integer('id').primaryKey(),
    /** FK to newsletter_subscribers — the intended recipient; cascade delete. */
    subscriberId: integer('subscriber_id')
      .references(() => newsletterSubscribers.id, { onDelete: 'cascade' })
      .notNull(),
    /** Delivery channel — email only (the newsletter has no other channel). */
    channel: text('channel', { length: 16 }).notNull(),
    /** Intent-log lifecycle: pending until dispatch resolves (delivered | failed). */
    deliveryStatus: text('delivery_status', { length: 16 })
      .default('pending')
      .notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
    /** When the outcome was marked — null while the intent is still pending. */
    markedAt: text('marked_at'),
  },
  (table) => [
    // Latest-DELIVERED-intent lookup (subscriber_id, status) ordered by
    // createdAt — the 24-hour redelivery cooldown's enforcement read.
    index('newsletter_notifications_subscriber_id_delivery_status_created_at_idx').on(
      table.subscriberId,
      table.deliveryStatus,
      table.createdAt,
    ),
    check('newsletter_notifications_channel_check', sql`${table.channel} IN ('email')`),
    check(
      'newsletter_notifications_delivery_status_check',
      sql`${table.deliveryStatus} IN ('pending', 'delivered', 'failed')`,
    ),
  ],
);

/**
 * Share snapshots — frozen copies of a calculation result behind a
 * public permalink (task 1.2, change trust-and-reach-roadmap, design
 * D6, spec: share-permalinks).
 *
 * Sharing copies the rendered result into frozen_result under a random
 * public id; later changes to — or pruning of — the original record
 * cannot affect the snapshot. The copy contains no account identifiers,
 * so no account FK exists and no retention exception is needed (a
 * 12-month hygiene sweep applies anyway, owned by the sharing module —
 * not the calculation-record sweep). public_id is the share URL's only
 * identifier: exactly 22 characters, generated and length-checked
 * app-side; the CHECK pins the documented length so a generator bug is
 * unrepresentable at rest.
 */
export const shareSnapshots = sqliteTable(
  'share_snapshots',
  {
    id: integer('id').primaryKey(),
    /** Exactly-22-character random public id — the share URL's sole identifier. */
    publicId: text('public_id', { length: 22 }).notNull(),
    /** The frozen result copy (JSON) — self-contained, no account identifiers; rendered with the structural disclaimer. */
    frozenResult: text('frozen_result', { mode: 'json' }).notNull(),
    createdAt: text('created_at').default(ISO_8601_NOW).notNull(),
  },
  (table) => [
    // The public /share/:publicId lookup — one id, one snapshot.
    unique('share_snapshots_public_id_unique').on(table.publicId),
    // The 12-month hygiene sweep filters by age (the
    // group_order_sessions_expires_at_idx housekeeping precedent).
    index('share_snapshots_created_at_idx').on(table.createdAt),
    check('share_snapshots_public_id_check', sql`length(${table.publicId}) = 22`),
    // Parseable JSON at rest — the share page renders it verbatim (the
    // curated_entries json_valid precedent).
    check(
      'share_snapshots_frozen_result_check',
      sql`${table.frozenResult} <> '' AND json_valid(${table.frozenResult})`,
    ),
  ],
);

/**
 * Aggregate schema object for typing a D1-bound Drizzle instance
 * (`drizzle(env.DB, { schema: d1Schema })`) — the SQLite counterpart of
 * the pg provider's `{ schema }` argument in db/drizzle.provider.ts.
 */
export const d1Schema = {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  priceHistorySummaries,
  aggregationWatermarks,
  accounts,
  savedBaskets,
  savedScenarios,
  priceAlerts,
  alertNotifications,
  merchantTerms,
  basketCalculationRecords,
  sessions,
  auditEvents,
  clickCounterSnapshots,
  merchantRegistry,
  productDimensions,
  carrierBoxTypes,
  consumptionNorms,
  travellerAllowanceDatasets,
  travellerAllowanceLimits,
  groupOrderSessions,
  groupOrderItems,
  ferryOffers,
  producerLinks,
  curatedEntries,
  shopReports,
  blacklistEntries,
  calculationOutcomes,
  blogPosts,
  savingsSnapshots,
  newsletterSubscribers,
  newsletterNotifications,
  shareSnapshots,
  emailTokens,
};
