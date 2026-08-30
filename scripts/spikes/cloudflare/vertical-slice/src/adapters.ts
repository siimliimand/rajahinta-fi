/**
 * G3 vertical slice spike — minimal D1-backed adapters for the ports
 * LandedCostCalculatorService consumes.
 *
 * Mapping parity with the production composition root:
 * - Product/offers follow apps/backend/src/adapters/product-data.adapter.ts
 *   exactly (volume parseFloat, ABV null → 0, weightKg = litres × 1.0,
 *   name → normalizedName, legacy 'EXACT' reliability → ESTIMATED,
 *   null provenance columns omitted rather than nulled).
 * - Tax rules implement ITaxRuleRepositoryPort with the in-memory golden
 *   repository's exact-match-then-taxType-fallback semantics, now
 *   window-filtered on ISO-8601 TEXT comparisons (lexicographic = true
 *   for normalized UTC ISO strings).
 * - Transport offers implement ITransportOfferQuery.
 * - Calculation records implement the write-once port.
 *
 * @module G3SpikeAdapters
 */

import { eq, and, lte, gt, or, isNull, asc } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import {
  products,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
} from './schema.ts';
import {
  TAX_TYPES,
  type IProductDataPort,
  type ICalculationRecordPort,
  type CalculatorProductData,
  type CalculatorRetailOfferData,
  type ITaxRuleRepositoryPort,
  type TaxRuleRecordPort,
  type ITransportOfferQuery,
  type TransportOffer,
  type CreateCalculationRecordInput,
} from './core-domain.ts';

// ---------------------------------------------------------------------------
// Helpers — same numeric mapping as the production adapter
// ---------------------------------------------------------------------------

function parseNumeric(value: string | null): number {
  if (value === null) return 0;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** Water-based density approximation — identical to production. */
function estimateWeightKg(volumeLitres: number): number {
  return volumeLitres * 1.0;
}

/** Narrow a persisted reliability string to the domain union; unknown or
 *  legacy values ('EXACT') degrade to ESTIMATED — never overstated. */
function toReliabilityStatus(value: string): 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE' {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}

// ---------------------------------------------------------------------------
// Product data port
// ---------------------------------------------------------------------------

export class D1ProductDataPort implements IProductDataPort {
  constructor(private readonly db: DrizzleD1Database) {}

  async findProductById(id: number): Promise<CalculatorProductData | null> {
    const [record] = await this.db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    if (record === undefined) return null;

    const volumeLitres = parseNumeric(record.unitVolume);

    return {
      id: record.id,
      regulatoryClassification: record.regulatoryClassification,
      category: record.category,
      volumeLitres,
      alcoholByVolume: parseNumeric(record.alcoholByVolume),
      containerType: record.containerType,
      depositSystemStatus: record.depositSystemStatus,
      weightKg: estimateWeightKg(volumeLitres),
      normalizedName: record.name,
    };
  }

  async findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]> {
    const offers = await this.db
      .select()
      .from(retailOffers)
      .where(eq(retailOffers.productId, productId));

    return offers.map((o) => ({
      id: o.id,
      priceCents: o.priceCents,
      currency: o.currency,
      merchant: o.merchant,
      country: o.country,
      reliabilityStatus: toReliabilityStatus(o.reliabilityStatus),
      ...(o.originalPriceCents !== null
        ? { originalPriceCents: o.originalPriceCents }
        : {}),
      ...(o.originalCurrency !== null
        ? { originalCurrency: o.originalCurrency }
        : {}),
      ...(o.fxDatasetVersion !== null
        ? { fxDatasetVersion: o.fxDatasetVersion }
        : {}),
    }));
  }
}

// ---------------------------------------------------------------------------
// Tax rule port — window-filtered with the golden repo's match semantics
// ---------------------------------------------------------------------------

function rowToPort(r: typeof taxRules.$inferSelect): TaxRuleRecordPort {
  return {
    id: r.id,
    taxType: r.taxType,
    productCategory: r.productCategory,
    rate: r.rate,
    effectiveFrom: new Date(r.effectiveFrom),
    effectiveTo: r.effectiveTo === null ? null : new Date(r.effectiveTo),
    calculationFormulaReference: r.calculationFormulaReference,
    officialSource: r.officialSource,
    verificationDate:
      r.verificationDate === null ? null : new Date(r.verificationDate),
    versionLabel: r.versionLabel,
    exemptionConditions:
      r.exemptionConditions === null
        ? null
        : (JSON.parse(r.exemptionConditions) as {
            minAlcoholByVolume?: number;
            maxAlcoholByVolume?: number;
          }),
  };
}

export class D1TaxRuleRepository implements ITaxRuleRepositoryPort {
  constructor(private readonly db: DrizzleD1Database) {}

  async findApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort | null> {
    const at = asOf.toISOString();
    const rows = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          lte(taxRules.effectiveFrom, at),
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, at)),
        ),
      )
      .orderBy(asc(taxRules.id));

    // Most-specific match first (exact category), then any rule for the
    // taxType — the in-memory golden repository's documented semantics.
    const row = rows.find((r) => r.productCategory === productCategory) ?? rows[0];
    return row === undefined ? null : rowToPort(row);
  }

  async findAllApplicable(
    taxType: string,
    productCategory: string,
    asOf: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const at = asOf.toISOString();
    const rows = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, at),
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, at)),
        ),
      )
      .orderBy(asc(taxRules.id));
    return rows.map(rowToPort);
  }

  async findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<TaxRuleRecordPort[]> {
    const from = fromDate.toISOString();
    const to = toDate.toISOString();
    const rows = await this.db
      .select()
      .from(taxRules)
      .where(
        and(
          eq(taxRules.taxType, taxType),
          eq(taxRules.productCategory, productCategory),
          lte(taxRules.effectiveFrom, to),
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, from)),
        ),
      )
      .orderBy(asc(taxRules.effectiveFrom), asc(taxRules.id));
    return rows.map(rowToPort);
  }

  async findActiveVersionLabels(): Promise<readonly string[]> {
    const now = new Date().toISOString();
    const rows = await this.db
      .selectDistinct({ versionLabel: taxRules.versionLabel })
      .from(taxRules)
      .where(
        and(
          lte(taxRules.effectiveFrom, now),
          or(isNull(taxRules.effectiveTo), gt(taxRules.effectiveTo, now)),
        ),
      )
      .orderBy(asc(taxRules.versionLabel));
    return rows.map((r) => r.versionLabel);
  }
}

// ---------------------------------------------------------------------------
// Transport offer query
// ---------------------------------------------------------------------------

export class D1TransportOfferQuery implements ITransportOfferQuery {
  constructor(private readonly db: DrizzleD1Database) {}

  async findAllActive(): Promise<TransportOffer[]> {
    const rows = await this.db.select().from(transportOffers).orderBy(asc(transportOffers.id));
    return rows.map(rowToTransportOffer);
  }

  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    const rows = await this.db
      .select()
      .from(transportOffers)
      .where(eq(transportOffers.carrier, carrierId))
      .orderBy(asc(transportOffers.id));
    return rows.map(rowToTransportOffer);
  }
}

function rowToTransportOffer(r: typeof transportOffers.$inferSelect): TransportOffer {
  return {
    id: r.id,
    carrier: r.carrier,
    originCountry: r.originCountry,
    destinationCountry: r.destinationCountry,
    weightBracket: { minKg: r.weightMinKg, maxKg: r.weightMaxKg },
    packageTier: r.packageTier,
    priceCents: r.priceCents,
    currency: r.currency,
    sellerInvolvementIndicator: r.sellerInvolvementIndicator,
    observedAt: new Date(r.observedAt),
    refreshedAt: new Date(r.refreshedAt),
    reliabilityStatus: r.reliabilityStatus,
  };
}

// ---------------------------------------------------------------------------
// Calculation record port — write-once
// ---------------------------------------------------------------------------

export class D1CalculationRecordPort implements ICalculationRecordPort {
  constructor(private readonly db: DrizzleD1Database) {}

  async create(record: CreateCalculationRecordInput): Promise<{ id: number }> {
    const [row] = await this.db
      .insert(calculationRecords)
      .values({
        productMasterId: record.productMasterId,
        retailOfferIds: JSON.stringify(record.retailOfferIds),
        transportOfferId: record.transportOfferId,
        exciseRuleVersionId: record.exciseRuleVersionId,
        containerDutyRuleVersionId: record.containerDutyRuleVersionId,
        totalCents: record.totalCents,
        breakdown: JSON.stringify(record.breakdown),
        confidence: record.confidence,
        quantity: record.quantity,
        destination: record.destination,
        // The Disclaimer struct is persisted as JSON text in the spike
        // (the pg column is TEXT NOT NULL as well).
        disclaimer: JSON.stringify(record.disclaimer),
        sessionId: record.sessionId,
        calculatedAt: new Date().toISOString(),
      })
      .returning({ id: calculationRecords.id });
    return { id: row.id };
  }
}
