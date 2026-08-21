/**
 * Seed: staging/test data — obviously fake, never used in production.
 *
 * Populates every table with placeholder rows so staging environments
 * have realistic-but-fake data for E2E tests, UI preview, and load
 * testing.  All values are clearly test data — rates are round numbers,
 * merchant IDs carry "TEST" prefixes, product names are Lorem Ipsum.
 *
 * Idempotent: each insert checks for existing rows before writing.
 *
 * @module Seed
 */

import { inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  FORMULA_PER_LITRE_OF_PRODUCT,
  FORMULA_PER_DEGREE_PLATO,
  FORMULA_FLAT_PER_LITRE,
} from '@rajahinta/core-domain';
import {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
} from '../index';
import { SEED_RULES } from './tax-rules.seed';

// ---------------------------------------------------------------------------
// Product seed data
// ---------------------------------------------------------------------------

interface StagingProductSeed {
  name: string;
  manufacturer: string;
  brand: string;
  category: string;
  alcoholByVolume: string;
  unitVolume: string;
  containerType: string;
  regulatoryClassification: string;
  depositSystemStatus: boolean;
  ean: string;
}

const STAGING_BEER: StagingProductSeed = {
  name: 'TEST Beer — Lorem Ipsum Dolor',
  manufacturer: 'Test Brauerei GmbH',
  brand: 'Test Brand',
  category: 'beer',
  alcoholByVolume: '0.047',
  unitVolume: '0.500',
  containerType: 'glass',
  regulatoryClassification: 'BEER_STANDARD',
  depositSystemStatus: true,
  ean: '000000000001',
};

const STAGING_WINE: StagingProductSeed = {
  name: 'TEST Wine — Lorem Ipsum',
  manufacturer: 'Test Vignoble SAS',
  brand: 'Test Brand',
  category: 'wine_still',
  alcoholByVolume: '0.120',
  unitVolume: '0.750',
  containerType: 'glass',
  regulatoryClassification: 'WINE_STILL',
  depositSystemStatus: false,
  ean: '000000000002',
};

const STAGING_PRODUCTS = [STAGING_BEER, STAGING_WINE] as const;

// ---------------------------------------------------------------------------
// Tax rule seed data — clearly fake placeholder rates
// ---------------------------------------------------------------------------

interface StagingTaxRuleSeed {
  taxType: string;
  productCategory: string;
  rate: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  exemptionConditions: Record<string, unknown> | null;
  calculationFormulaReference: string;
  officialSource: string;
  verificationDate: Date;
  versionLabel: string;
}

const STAGING_VERSION = 'v9999-staging';
const STAGING_EFFECTIVE_FROM = new Date('2025-01-01');

const STAGING_BEER_EXCISE: StagingTaxRuleSeed = {
  taxType: 'excise',
  productCategory: 'beer',
  rate: '9.99',
  effectiveFrom: STAGING_EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: { note: 'STAGING — not actual tax rate' },
  calculationFormulaReference: FORMULA_PER_DEGREE_PLATO,
  officialSource: 'staging-internal — placeholder rate for testing',
  verificationDate: new Date('2025-01-01'),
  versionLabel: STAGING_VERSION,
};

const STAGING_WINE_EXCISE: StagingTaxRuleSeed = {
  taxType: 'excise',
  productCategory: 'wine_still',
  rate: '1.23',
  effectiveFrom: STAGING_EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: { note: 'STAGING — not actual tax rate' },
  calculationFormulaReference: FORMULA_PER_LITRE_OF_PRODUCT,
  officialSource: 'staging-internal — placeholder rate for testing',
  verificationDate: new Date('2025-01-01'),
  versionLabel: STAGING_VERSION,
};

const STAGING_CONTAINER_DUTY: StagingTaxRuleSeed = {
  taxType: 'container_duty',
  productCategory: 'all_beverages',
  rate: '0.10',
  effectiveFrom: STAGING_EFFECTIVE_FROM,
  effectiveTo: null,
  exemptionConditions: null,
  calculationFormulaReference: FORMULA_FLAT_PER_LITRE,
  officialSource: 'staging-internal — placeholder rate for testing',
  verificationDate: new Date('2025-01-01'),
  versionLabel: STAGING_VERSION,
};

const STAGING_TAX_RULES = [STAGING_BEER_EXCISE, STAGING_WINE_EXCISE, STAGING_CONTAINER_DUTY] as const;

// ---------------------------------------------------------------------------
// Transport offer seed data — test carriers, obviously fake prices
// ---------------------------------------------------------------------------

interface StagingTransportSeed {
  carrier: string;
  originCountry: string;
  destinationCountry: string;
  weightMinKg: string | null;
  weightMaxKg: string | null;
  packageTier: string;
  priceCents: number;
  currency: string;
  sellerInvolvementIndicator: boolean;
}

const STAGING_TRANSPORT_DE: StagingTransportSeed = {
  carrier: 'test-merchant-de',
  originCountry: 'DE',
  destinationCountry: 'FI',
  weightMinKg: '0',
  weightMaxKg: '30',
  packageTier: 'parcel',
  priceCents: 999,
  currency: 'EUR',
  sellerInvolvementIndicator: false,
};

const STAGING_TRANSPORT_SE: StagingTransportSeed = {
  carrier: 'test-merchant-se',
  originCountry: 'SE',
  destinationCountry: 'FI',
  weightMinKg: '0',
  weightMaxKg: '30',
  packageTier: 'parcel',
  priceCents: 499,
  currency: 'EUR',
  sellerInvolvementIndicator: false,
};

const STAGING_TRANSPORT_HEAVY_DE: StagingTransportSeed = {
  carrier: 'test-merchant-de',
  originCountry: 'DE',
  destinationCountry: 'FI',
  weightMinKg: '30',
  weightMaxKg: null,
  packageTier: 'pallet',
  priceCents: 4999,
  currency: 'EUR',
  sellerInvolvementIndicator: false,
};

const STAGING_TRANSPORT_OFFERS = [STAGING_TRANSPORT_DE, STAGING_TRANSPORT_SE, STAGING_TRANSPORT_HEAVY_DE] as const;

// ---------------------------------------------------------------------------
// Retail offer seed data — test price points for test products
// ---------------------------------------------------------------------------

interface StagingOfferSeed {
  merchant: string;
  country: string;
  productIdRef: 'beer' | 'wine';
  priceCents: number;
  currency: string;
  availability: string;
}

const STAGING_OFFER_BEER_DE: StagingOfferSeed = {
  merchant: 'test-merchant-de',
  country: 'DE',
  productIdRef: 'beer',
  priceCents: 149,
  currency: 'EUR',
  availability: 'in_stock',
};

const STAGING_OFFER_BEER_SE: StagingOfferSeed = {
  merchant: 'test-merchant-se',
  country: 'SE',
  productIdRef: 'beer',
  priceCents: 189,
  currency: 'EUR',
  availability: 'in_stock',
};

const STAGING_OFFER_WINE_DE: StagingOfferSeed = {
  merchant: 'test-merchant-de',
  country: 'DE',
  productIdRef: 'wine',
  priceCents: 599,
  currency: 'EUR',
  availability: 'in_stock',
};

const STAGING_OFFER_WINE_SE: StagingOfferSeed = {
  merchant: 'test-merchant-se',
  country: 'SE',
  productIdRef: 'wine',
  priceCents: 749,
  currency: 'EUR',
  availability: 'in_stock',
};

const STAGING_OFFERS = [STAGING_OFFER_BEER_DE, STAGING_OFFER_BEER_SE, STAGING_OFFER_WINE_DE, STAGING_OFFER_WINE_SE] as const;

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

/**
 * Seed staging database with fake/test data.
 *
 * Populates productMaster, taxRules, transportOffers, and retailOffers
 * with placeholder values that are obviously not production — all merchant
 * IDs carry "test-" prefixes, rates are round/obviously-fake numbers.
 *
 * Idempotent — checks for existing rows before inserting:
 * - Products: skip if EAN already exists
 * - Tax rules: skip if versionLabel already exists
 * - Transport offers: skip if (carrier, originCountry, weightMinKg) already exists
 * - Retail offers: skip if (merchant, productId) already exists
 *
 * @param db — A Drizzle (node-postgres) database instance targeting a staging DB.
 */
export async function seedStagingDatabase(
  db: NodePgDatabase,
): Promise<{
  products: { inserted: number; skipped: number };
  taxRules: { inserted: number; skipped: number };
  transportOffers: { inserted: number; skipped: number };
  retailOffers: { inserted: number; skipped: number };
}> {
  // -----------------------------------------------------------------------
  // 1. Products
  // -----------------------------------------------------------------------
  const existingEans = await db
    .select({ ean: productMaster.ean })
    .from(productMaster)
    .where(inArray(productMaster.ean, STAGING_PRODUCTS.map((p) => p.ean)));

  const knownEans = new Set(existingEans.map((r) => r.ean));
  const productsToInsert = STAGING_PRODUCTS.filter((p) => !knownEans.has(p.ean));

  for (const p of productsToInsert) {
    await db.insert(productMaster).values(p);
  }

  // -----------------------------------------------------------------------
  // 2. Tax rules — the OFFICIAL versioned dataset (v1.0-2024 …
  // v3.0-2026, official vero.fi rates) plus clearly-marked staging
  // placeholders that never collide with it (own version label).
  // -----------------------------------------------------------------------
  const allTaxSeed = [...SEED_RULES, ...STAGING_TAX_RULES];
  const existingTaxLabels = await db
    .select({ versionLabel: taxRules.versionLabel })
    .from(taxRules)
    .where(inArray(taxRules.versionLabel, allTaxSeed.map((r) => r.versionLabel)));

  const knownTaxLabels = new Set(existingTaxLabels.map((r) => r.versionLabel));
  const taxRulesToInsert = allTaxSeed.filter((r) => !knownTaxLabels.has(r.versionLabel));

  if (taxRulesToInsert.length > 0) {
    await db.insert(taxRules).values(taxRulesToInsert as typeof taxRules.$inferInsert[]);
  }

  // -----------------------------------------------------------------------
  // 3. Transport offers
  // -----------------------------------------------------------------------
  const existingTransportKeys = await db
    .select({
      carrier: transportOffers.carrier,
      originCountry: transportOffers.originCountry,
      weightMinKg: transportOffers.weightMinKg,
    })
    .from(transportOffers)
    .where(
      inArray(
        transportOffers.carrier,
        STAGING_TRANSPORT_OFFERS.map((t) => t.carrier),
      ),
    );

  const knownTransportKeys = new Set(
    existingTransportKeys.map(
      (r) => `${r.carrier}|${r.originCountry}|${r.weightMinKg}`,
    ),
  );

  const transportToInsert = STAGING_TRANSPORT_OFFERS.filter(
    (t) => !knownTransportKeys.has(`${t.carrier}|${t.originCountry}|${t.weightMinKg}`),
  );

  for (const t of transportToInsert) {
    await db.insert(transportOffers).values(t);
  }

  // -----------------------------------------------------------------------
  // 4. Retail offers (with product FK lookup)
  // -----------------------------------------------------------------------
  // Read back the inserted products to resolve FK references
  const insertedProducts = await db
    .select({ id: productMaster.id, ean: productMaster.ean })
    .from(productMaster)
    .where(inArray(productMaster.ean, STAGING_PRODUCTS.map((p) => p.ean)));

  const productIdByEan = new Map(insertedProducts.map((p) => [p.ean, p.id]));

  const eanForRef: Record<string, string> = {
    beer: STAGING_BEER.ean,
    wine: STAGING_WINE.ean,
  };

  // Check which (merchant, productId) combos already exist
  const existingOfferKeys = await db
    .select({ merchant: retailOffers.merchant, productId: retailOffers.productId })
    .from(retailOffers)
    .where(
      inArray(
        retailOffers.merchant,
        Array.from(new Set(STAGING_OFFERS.map((o) => o.merchant))),
      ),
    );

  const knownOfferKeys = new Set(
    existingOfferKeys.map((r) => `${r.merchant}|${r.productId}`),
  );

  let retailInserted = 0;

  for (const offer of STAGING_OFFERS) {
    const productId = productIdByEan.get(eanForRef[offer.productIdRef]);
    if (productId === undefined) continue;

    const key = `${offer.merchant}|${productId}`;
    if (knownOfferKeys.has(key)) continue;

    await db.insert(retailOffers).values({
      merchant: offer.merchant,
      country: offer.country,
      productId,
      priceCents: offer.priceCents,
      currency: offer.currency,
      availability: offer.availability,
    });
    retailInserted++;
  }

  return {
    products: {
      inserted: productsToInsert.length,
      skipped: STAGING_PRODUCTS.length - productsToInsert.length,
    },
    taxRules: {
      inserted: taxRulesToInsert.length,
      skipped: allTaxSeed.length - taxRulesToInsert.length,
    },
    transportOffers: {
      inserted: transportToInsert.length,
      skipped: STAGING_TRANSPORT_OFFERS.length - transportToInsert.length,
    },
    retailOffers: {
      inserted: retailInserted,
      skipped: STAGING_OFFERS.length - retailInserted,
    },
  };
}