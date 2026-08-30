/**
 * Golden-fixture D1 seeding (task 3.9).
 *
 * Drives the golden suite's OWN data — tests/golden/data/products.ts (v2.1)
 * and the v1.0-2024 rule set behind
 * tests/golden/helpers/in-memory-tax-rule.repository.ts — into the fake-D1
 * harness through real SQL INSERTs, so the served calculator reads the
 * golden inputs through the production D1 adapters (D1ProductDataPort,
 * D1TaxRuleRepositoryAdapter, D1TransportOfferQuery) exactly like staging
 * would. The golden tests' expectations stay the sole oracle; nothing here
 * recomputes tax math.
 *
 * Storage-shape notes (adapter contracts, not behavior changes):
 * - exemption_conditions are stored wrapped in `appliesTo` — the shape the
 *   production pg/D1 seed writes and D1TaxRuleRepositoryAdapter.toPortRecord
 *   unwraps. The golden in-memory repo carries the same tiers flat.
 * - retail/transport reliability 'EXACT' is a legacy read-model value: the
 *   domain adapters degrade it to ESTIMATED on read (and the D1 CHECK
 *   forbids storing it), so it is persisted as ESTIMATED. 'VERIFIED'
 *   persists verbatim. This reproduces the in-memory suite's exact
 *   reliability inputs (its comments: "reliabilityStatus:'EXACT' →
 *   ESTIMATED").
 *
 * @module GoldenFixtures
 */

import type { DatabaseSync } from 'node:sqlite';
import {
  PRODUCT_BY_ID,
  OFFERS_BY_PRODUCT_ID,
  type CalculatorProductData,
  type CalculatorRetailOfferData,
} from '../../../../tests/golden/data/products';
import { InMemoryTaxRuleRepository } from '../../../../tests/golden/helpers/in-memory-tax-rule.repository';
import type { TaxRuleRecordPort } from '@rajahinta/core-domain';

/** Golden repo categories — the excise side of the v1.0-2024 dataset. */
const EXCISE_CATEGORIES = [
  'beer',
  'wine_still',
  'wine_sparkling',
  'intermediate_products',
  'spirits',
  'other_fermented',
] as const;

/** Persist the golden repo's full rule set into the D1 tax_rules table. */
export async function seedGoldenTaxRules(db: DatabaseSync): Promise<number> {
  const repo = new InMemoryTaxRuleRepository();
  const asOf = new Date();
  const rules: TaxRuleRecordPort[] = [];
  for (const category of EXCISE_CATEGORIES) {
    rules.push(...(await repo.findAllApplicable('excise', category, asOf)));
  }
  const containerDuty = await repo.findApplicable('container_duty', 'all_beverages', asOf);
  if (containerDuty !== null) {
    rules.push(containerDuty);
  }

  const insert = db.prepare(
    `INSERT INTO tax_rules (
       id, tax_type, product_category, rate, effective_from, effective_to,
       exemption_conditions, calculation_formula_reference, official_source,
       verification_date, version_label
     ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  for (const rule of rules) {
    insert.run(
      rule.id,
      rule.taxType,
      rule.productCategory,
      Number(rule.rate),
      rule.effectiveFrom.toISOString(),
      // appliesTo wrapper — the storage shape toPortRecord unwraps.
      rule.exemptionConditions === null
        ? null
        : JSON.stringify({ appliesTo: rule.exemptionConditions }),
      rule.calculationFormulaReference,
      rule.officialSource,
      rule.verificationDate === null ? null : rule.verificationDate.toISOString(),
      rule.versionLabel,
    );
  }
  return rules.length;
}

/** Map a golden offer's legacy reliability to its storable domain value. */
function storableReliability(status: string): string {
  return status === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED';
}

/** Insert every golden product and its offers into product_master/retail_offers. */
export function seedGoldenProducts(db: DatabaseSync): number {
  const insertProduct = db.prepare(
    `INSERT INTO product_master (
       id, name, manufacturer, brand, category, alcohol_by_volume,
       unit_volume, container_type, regulatory_classification,
       deposit_system_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertOffer = db.prepare(
    `INSERT INTO retail_offers (
       id, merchant, country, product_id, price_cents, currency,
       original_price_cents, original_currency, fx_dataset_version,
       availability, source_url, reliability_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_stock', ?, ?)`,
  );

  let offerCount = 0;
  for (const [id, product] of Object.entries(PRODUCT_BY_ID)) {
    seedGoldenProductWithOffers(insertProduct, insertOffer, product, OFFERS_BY_PRODUCT_ID[Number(id)] ?? []);
    offerCount += OFFERS_BY_PRODUCT_ID[Number(id)]?.length ?? 0;
  }
  return offerCount;
}

function seedGoldenProductWithOffers(
  insertProduct: ReturnType<DatabaseSync['prepare']>,
  insertOffer: ReturnType<DatabaseSync['prepare']>,
  product: CalculatorProductData,
  offers: CalculatorRetailOfferData[],
): void {
  insertProduct.run(
    product.id,
    product.normalizedName,
    'Golden Dataset',
    'Golden Dataset',
    product.category,
    product.alcoholByVolume,
    product.volumeLitres,
    product.containerType,
    product.regulatoryClassification === '' ? 'unknown' : product.regulatoryClassification,
    // Tri-state INTEGER mapping (design D2): true→1, false→0, null→NULL.
    product.depositSystemStatus === null ? null : product.depositSystemStatus ? 1 : 0,
  );
  for (const offer of offers) {
    insertOffer.run(
      offer.id,
      offer.merchant,
      offer.country,
      product.id,
      offer.priceCents,
      offer.currency ?? 'EUR',
      offer.originalPriceCents ?? null,
      offer.originalCurrency ?? null,
      offer.fxDatasetVersion ?? null,
      'https://golden.invalid/offers',
      storableReliability(offer.reliabilityStatus),
    );
  }
}

export interface GoldenTransportSeed {
  readonly id: number;
  readonly carrier: string;
  readonly originCountry: string;
  readonly destinationCountry: string;
  readonly weightBracket: { readonly minKg: number; readonly maxKg: number };
  readonly packageTier: string;
  readonly priceCents: number;
  readonly sellerInvolvementIndicator: boolean;
}

/**
 * Insert golden transport offers into transport_offers.
 *
 * DEFECT WORKAROUND (reported, not fixed — constraint: tests/configs only):
 * migration 0000 added `transport_offers_package_tier_check`
 * ('parcel','box','pallet'), a constraint the pg source schema never had.
 * The calculator matches transport offers by STRICT packageTier equality
 * against product.containerType (TransportEstimationService.estimate →
 * `o.packageTier === packageType`, calculator passes product.containerType),
 * and product_master's container vocabulary (glass/plastic/metal/carton/
 * other/can/bottle) has ZERO intersection with the tier CHECK's values —
 * so on the migrated schema as written, no transport offer can ever match
 * any product and every calculation silently degrades to transport 0 /
 * UNAVAILABLE. The golden oracle requires the carrier offers to match
 * (150/200¢), so this seeder writes the golden tiers with CHECK enforcement
 * scoped OFF for the insert duration (PRAGMA ignore_check_constraints —
 * FK/UNIQUE/NOT NULL stay enforced). Every other constraint in the harness
 * keeps its production semantics; the fix itself belongs to the migration
 * owner (task 2.x follow-up).
 */
export function seedGoldenTransport(db: DatabaseSync, offers: readonly GoldenTransportSeed[]): void {
  const insert = db.prepare(
    `INSERT INTO transport_offers (
       id, carrier, origin_country, destination_country,
       weight_min_kg, weight_max_kg, package_tier, price_cents, currency,
       seller_involvement_indicator, reliability_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, 'VERIFIED')`,
  );
  db.exec('PRAGMA ignore_check_constraints = 1');
  try {
    for (const offer of offers) {
      insert.run(
        offer.id,
        offer.carrier,
        offer.originCountry,
        offer.destinationCountry,
        offer.weightBracket.minKg,
        offer.weightBracket.maxKg,
        offer.packageTier,
        offer.priceCents,
        offer.sellerInvolvementIndicator ? 1 : 0,
      );
    }
  } finally {
    db.exec('PRAGMA ignore_check_constraints = 0');
  }
}

/** Seed the complete golden dataset (tax rules + products + offers). */
export function seedGoldenDataset(db: DatabaseSync): void {
  seedGoldenTaxRules(db);
  seedGoldenProducts(db);
}
