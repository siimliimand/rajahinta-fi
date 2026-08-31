/**
 * G3 vertical slice spike — schema subset translated to SQLite/D1.
 *
 * Translates the pgTables of packages/data-platform/src/schema.ts per the
 * migrate-to-cloudflare conventions (task 2.1 preview):
 *   - money columns → INTEGER cents (already cents on pg, no change)
 *   - pg `numeric` decimals → decimal TEXT (Drizzle's string mapping parity)
 *   - timestamps → ISO-8601 TEXT
 *   - booleans → INTEGER (0/1), tri-state deposit status stays nullable
 *   - enums stay CHECK-constrained-free TEXT in the spike (stub level)
 *
 * Only the tables the calculator endpoint touches are translated — this
 * is a vertical slice, not the full 20-table translation.
 *
 * @module G3SpikeSchema
 */

import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable('products', {
  id: integer('id').primaryKey(),
  /** Display name from merchant feed. */
  name: text('name').notNull(),
  manufacturer: text('manufacturer').notNull(),
  brand: text('brand').notNull(),
  /** Maps to taxRules.productCategory for rule lookup. */
  category: text('category').notNull(),
  /** Decimal string (pg numeric parity), e.g. '0.047'. */
  alcoholByVolume: text('alcohol_by_volume'),
  /** Litres as decimal string. */
  unitVolume: text('unit_volume').notNull(),
  containerType: text('container_type').notNull(),
  regulatoryClassification: text('regulatory_classification').notNull(),
  /** Tri-state: 1 = in deposit system, 0 = not, NULL = unknown. */
  depositSystemStatus: integer('deposit_system_status', { mode: 'boolean' }),
  ean: text('ean'),
  /** ISO-8601 TEXT. */
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const retailOffers = sqliteTable('retail_offers', {
  id: integer('id').primaryKey(),
  merchant: text('merchant').notNull(),
  /** ISO 3166-1 alpha-2. */
  country: text('country').notNull(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id),
  /** EUR cents — canonical amount (design D2). */
  priceCents: integer('price_cents').notNull(),
  /** 'EUR' on conversion-clean offers; anything else must be excluded. */
  currency: text('currency').notNull().default('EUR'),
  originalPriceCents: integer('original_price_cents'),
  originalCurrency: text('original_currency'),
  fxDatasetVersion: text('fx_dataset_version'),
  availability: text('availability').notNull().default('unknown'),
  sourceUrl: text('source_url'),
  /** ISO-8601 TEXT. */
  observedAt: text('observed_at').notNull(),
  reliabilityStatus: text('reliability_status').notNull().default('ESTIMATED'),
});

export const taxRules = sqliteTable('tax_rules', {
  id: integer('id').primaryKey(),
  /** 'excise' | 'container_duty'. */
  taxType: text('tax_type').notNull(),
  productCategory: text('product_category').notNull(),
  /** Decimal string — precision preserved across serialisation (port contract). */
  rate: text('rate').notNull(),
  /** ISO-8601 TEXT validity window, effectiveTo NULL = current. */
  effectiveFrom: text('effective_from').notNull(),
  effectiveTo: text('effective_to'),
  /** JSON text of {minAlcoholByVolume, maxAlcoholByVolume} tiers. */
  exemptionConditions: text('exemption_conditions'),
  calculationFormulaReference: text('calculation_formula_reference').notNull(),
  officialSource: text('official_source').notNull(),
  verificationDate: text('verification_date'),
  versionLabel: text('version_label').notNull(),
  createdAt: text('created_at').notNull(),
});

export const transportOffers = sqliteTable('transport_offers', {
  id: integer('id').primaryKey(),
  carrier: text('carrier').notNull(),
  originCountry: text('origin_country').notNull(),
  destinationCountry: text('destination_country').notNull().default('FI'),
  /** Kg bracket bounds; NULL = open-ended. REAL kg in the spike (candidate
   *  for the decimal-TEXT decision at task 2.1 review). */
  weightMinKg: real('weight_min_kg'),
  weightMaxKg: real('weight_max_kg'),
  packageTier: text('package_tier').notNull(),
  /** Cents. */
  priceCents: integer('price_cents').notNull(),
  currency: text('currency').notNull().default('EUR'),
  sellerInvolvementIndicator: integer('seller_involvement_indicator', {
    mode: 'boolean',
  })
    .notNull()
    .default(false),
  observedAt: text('observed_at').notNull(),
  refreshedAt: text('refreshed_at').notNull(),
  reliabilityStatus: text('reliability_status').notNull().default('ESTIMATED'),
});

export const calculationRecords = sqliteTable('calculation_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productMasterId: integer('product_master_id')
    .notNull()
    .references(() => products.id),
  retailOfferIds: text('retail_offer_ids'), // JSON array
  transportOfferId: integer('transport_offer_id'),
  exciseRuleVersionId: integer('excise_rule_version_id'),
  containerDutyRuleVersionId: integer('container_duty_rule_version_id'),
  totalCents: integer('total_cents').notNull(),
  /** JSON itemized breakdown — "every number is explainable". */
  breakdown: text('breakdown').notNull(),
  confidence: text('confidence').notNull(),
  quantity: integer('quantity').notNull(),
  destination: text('destination').notNull(),
  disclaimer: text('disclaimer').notNull(),
  sessionId: text('session_id'),
  calculatedAt: text('calculated_at').notNull(),
});
