import { Module, Injectable } from '@nestjs/common';
import {
  pgTable,
  serial,
  varchar,
  numeric,
  timestamp,
  integer,
  jsonb,
  boolean,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Drizzle schema definitions (PostgreSQL 16 + TimescaleDB 2.16)
// ---------------------------------------------------------------------------

/** Product Master — canonical product records. */
export const productMaster = pgTable('product_master', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 512 }).notNull(),
  manufacturer: varchar('manufacturer', { length: 256 }).notNull(),
  brand: varchar('brand', { length: 256 }).notNull(),
  category: varchar('category', { length: 32 }).notNull(),
  alcoholByVolume: numeric('alcohol_by_volume', { precision: 5, scale: 3 }),
  unitVolume: numeric('unit_volume', { precision: 10, scale: 4 }).notNull(),
  containerType: varchar('container_type', { length: 32 }).notNull(),
  regulatoryClassification: varchar('regulatory_classification', { length: 64 }).notNull(),
  depositSystemStatus: boolean('deposit_system_status').default(false).notNull(),
  ean: varchar('ean', { length: 13 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Merchant offers — scraped price points from external retailers. */
export const merchantOffers = pgTable('merchant_offers', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .references(() => productMaster.id)
    .notNull(),
  merchantId: varchar('merchant_id', { length: 128 }).notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  sourceUrl: varchar('source_url', { length: 1024 }),
  reliability: varchar('reliability', { length: 16 }).default('EXACT').notNull(),
  observedAt: timestamp('observed_at').defaultNow().notNull(),
});

/** Versioned tax rules — never overwritten, always appended. */
export const taxRules = pgTable('tax_rules', {
  id: serial('id').primaryKey(),
  taxType: varchar('tax_type', { length: 32 }).notNull(),
  productCategory: varchar('product_category', { length: 32 }).notNull(),
  rate: numeric('rate', { precision: 12, scale: 6 }).notNull(),
  effectiveFrom: timestamp('effective_from').notNull(),
  effectiveTo: timestamp('effective_to'),
  exemptionConditions: jsonb('exemption_conditions'),
  calculationFormulaReference: varchar('calculation_formula_reference', { length: 128 }).notNull(),
  officialSource: varchar('official_source', { length: 512 }).notNull(),
  verificationDate: timestamp('verification_date'),
  versionLabel: varchar('version_label', { length: 64 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Carrier transport offers. */
export const transportOffers = pgTable('transport_offers', {
  id: serial('id').primaryKey(),
  carrier: varchar('carrier', { length: 64 }).notNull(),
  originCountry: varchar('origin_country', { length: 4 }).notNull(),
  destinationCountry: varchar('destination_country', { length: 4 })
    .default('FI')
    .notNull(),
  weightMinKg: numeric('weight_min_kg', { precision: 10, scale: 4 }),
  weightMaxKg: numeric('weight_max_kg', { precision: 10, scale: 4 }),
  packageTier: varchar('package_tier', { length: 32 }).notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  sellerInvolvementIndicator: boolean('seller_involvement_indicator').default(false).notNull(),
  observedAt: timestamp('observed_at').defaultNow().notNull(),
  refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
  reliabilityStatus: varchar('reliability_status', { length: 16 })
    .default('ESTIMATED')
    .notNull(),
});

/** Calculation audit trail — every figure traceable. */
export const calculationAudit = pgTable('calculation_audit', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  inputSnapshot: jsonb('input_snapshot').notNull(),
  resultSnapshot: jsonb('result_snapshot').notNull(),
  rateVersionId: integer('rate_version_id').references(() => taxRules.id),
  disclaimerLanguage: varchar('disclaimer_language', { length: 2 }).notNull(),
  calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Repository abstractions
// ---------------------------------------------------------------------------

@Injectable()
export abstract class ProductRepository {
  abstract findById(id: number): Promise<typeof productMaster.$inferSelect | null>;
  abstract findOffers(productId: number): Promise<typeof merchantOffers.$inferSelect[]>;
}

@Injectable()
export abstract class TaxRateRepository {
  abstract findEffectiveVersion(
    asOf: Date,
  ): Promise<typeof taxRules.$inferSelect | null>;
  abstract findVersionById(
    id: number,
  ): Promise<typeof taxRules.$inferSelect | null>;
}

@Injectable()
export abstract class TransportOfferRepository {
  abstract findByCarrier(carrierId: string): Promise<typeof transportOffers.$inferSelect[]>;
  abstract findActive(): Promise<typeof transportOffers.$inferSelect[]>;
}

@Injectable()
export abstract class AuditRepository {
  abstract recordCalculation(
    entry: typeof calculationAudit.$inferInsert,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Module boundary — pure interfaces for cross-layer contracts
// ---------------------------------------------------------------------------

export type {
  IRepositoryRegistry,
  IProductRepository,
  ITaxRateRepository,
  ITransportOfferRepository,
  IAuditRepository,
  ProductMasterRecord,
  MerchantOfferRecord,
  TaxRuleRecord,
  TransportOfferRecord,
  CalculationAuditEntry,
} from './interfaces/repository-registry.interface';

// ---------------------------------------------------------------------------
// NestJS module
// ---------------------------------------------------------------------------

@Module({
  exports: [ProductRepository, TaxRateRepository, TransportOfferRepository, AuditRepository],
})
export class DataPlatformModule {}