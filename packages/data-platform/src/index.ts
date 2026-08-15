import { Module, Injectable } from '@nestjs/common';
import {
  pgTable,
  serial,
  varchar,
  numeric,
  timestamp,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Drizzle schema definitions (PostgreSQL 16 + TimescaleDB 2.16)
// ---------------------------------------------------------------------------

/** Product master — canonical product records. */
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 512 }).notNull(),
  brand: varchar('brand', { length: 256 }),
  containerType: varchar('container_type', { length: 32 }).notNull(),
  volumeLitres: numeric('volume_litres', { precision: 10, scale: 4 }).notNull(),
  alcoholByVolume: numeric('alcohol_by_volume', { precision: 5, scale: 3 }),
  ean: varchar('ean', { length: 13 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Merchant offers — scraped price points from external retailers. */
export const merchantOffers = pgTable('merchant_offers', {
  id: serial('id').primaryKey(),
  productId: integer('product_id')
    .references(() => products.id)
    .notNull(),
  merchantId: varchar('merchant_id', { length: 128 }).notNull(),
  priceCents: integer('price_cents').notNull(),
  currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
  sourceUrl: varchar('source_url', { length: 1024 }),
  reliability: varchar('reliability', { length: 16 }).default('EXACT').notNull(),
  observedAt: timestamp('observed_at').defaultNow().notNull(),
});

/** Versioned tax rate datasets — never overwritten, always appended. */
export const taxRateVersions = pgTable('tax_rate_versions', {
  id: serial('id').primaryKey(),
  versionLabel: varchar('version_label', { length: 64 }).notNull(),
  effectiveFrom: timestamp('effective_from').notNull(),
  effectiveTo: timestamp('effective_to'),
  confirmedAt: timestamp('confirmed_at'),
  rates: jsonb('rates').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Carrier transport rate offers. */
export const transportRates = pgTable('transport_rates', {
  id: serial('id').primaryKey(),
  carrierId: varchar('carrier_id', { length: 128 }).notNull(),
  originCountry: varchar('origin_country', { length: 4 }).notNull(),
  destinationCountry: varchar('destination_country', { length: 4 })
    .default('FI')
    .notNull(),
  basePriceCents: integer('base_price_cents').notNull(),
  pricePerKgCents: numeric('price_per_kg_cents', { precision: 10, scale: 4 }),
  minWeightKg: numeric('min_weight_kg', { precision: 8, scale: 2 }),
  maxWeightKg: numeric('max_weight_kg', { precision: 8, scale: 2 }),
  effectiveFrom: timestamp('effective_from').notNull(),
  effectiveTo: timestamp('effective_to'),
  reliability: varchar('reliability', { length: 16 }).default('EXACT').notNull(),
  refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
});

/** Calculation audit trail — every figure traceable. */
export const calculationAudit = pgTable('calculation_audit', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 64 }).notNull(),
  inputSnapshot: jsonb('input_snapshot').notNull(),
  resultSnapshot: jsonb('result_snapshot').notNull(),
  rateVersionId: integer('rate_version_id').references(() => taxRateVersions.id),
  disclaimerLanguage: varchar('disclaimer_language', { length: 2 }).notNull(),
  calculatedAt: timestamp('calculated_at').defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Repository abstractions
// ---------------------------------------------------------------------------

@Injectable()
export abstract class ProductRepository {
  abstract findById(id: number): Promise<typeof products.$inferSelect | null>;
  abstract findOffers(productId: number): Promise<typeof merchantOffers.$inferSelect[]>;
}

@Injectable()
export abstract class TaxRateRepository {
  abstract findEffectiveVersion(
    asOf: Date,
  ): Promise<typeof taxRateVersions.$inferSelect | null>;
  abstract findVersionById(
    id: number,
  ): Promise<typeof taxRateVersions.$inferSelect | null>;
}

@Injectable()
export abstract class AuditRepository {
  abstract recordCalculation(
    entry: typeof calculationAudit.$inferInsert,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// NestJS module
// ---------------------------------------------------------------------------

@Module({
  exports: [ProductRepository, TaxRateRepository, AuditRepository],
})
export class DataPlatformModule {}