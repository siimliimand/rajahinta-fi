/**
 * Worker-side core-domain port adapters over the D1 repositories (task
 * 4.1, design D6) — the composition-root glue the backend provided as
 * `apps/backend/src/adapters/*`, ported onto the D1 repositories of task
 * 2.5. Mappings are 1:1 ports; value-normalization rules (numeric-string
 * parsing, weight estimation, reliability narrowing) are copied verbatim
 * so parity does not drift.
 *
 * @module D1DomainPorts
 */

import type {
  IProductDataPort,
  CalculatorProductData,
  CalculatorRetailOfferData,
  ReliabilityStatus,
  ITransportOfferQuery,
  TransportOffer,
  ICalculationRecordPort,
  ICalculationRecordQueryPort,
  CalculationRecordData,
  CreateCalculationRecordInput,
  IMerchantTermsPort,
  MerchantTerms,
  IBasketCalculationRecordPort,
  CreateBasketCalculationRecordInput,
} from '@rajahinta/core-domain';
import type {
  ITransportOfferWritePort,
  TransportOfferWrite,
} from '../../../../packages/data-acquisition/src/interfaces/transport-offer-write.port';
import type { ProductRepository } from '../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
import { D1CalculationRecordRepository } from '../../../../packages/data-platform/src/repositories/d1/calculation-record.repository';
import { D1MerchantTermsRepository } from '../../../../packages/data-platform/src/repositories/d1/merchant-terms.repository';
import { D1BasketCalculationRecordRepository } from '../../../../packages/data-platform/src/repositories/d1/basket-calculation-record.repository';
import type { TransportOfferRecord } from '../../../../packages/data-platform/src/interfaces/repository-registry.interface';

// ---------------------------------------------------------------------------
// IProductDataPort — calculator read model over the product repository
// ---------------------------------------------------------------------------

/**
 * Parse a numeric value to a float. The contract layer maps REAL columns
 * to numeric text (pg parity), so both strings and numbers arrive here.
 */
function parseNumeric(value: string | number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Estimate weight in kilograms from volume in litres.
 *
 * Uses a density of 1.0 kg/L as a reasonable approximation for most
 * beverages (water-based). When the product master gains an actual
 * weight field, this estimate should be replaced with the real value.
 */
function estimateWeightKg(volumeLitres: number): number {
  return volumeLitres * 1.0;
}

/**
 * Narrow a persisted reliability string to the domain union.
 *
 * The database column is a free string; rows written before the vocabulary
 * unification may hold legacy values such as 'EXACT'. Unknown or legacy
 * values degrade to ESTIMATED — reliability is never overstated.
 */
function toReliabilityStatus(value: string): ReliabilityStatus {
  return value === 'VERIFIED' || value === 'STALE' || value === 'UNAVAILABLE'
    ? value
    : 'ESTIMATED';
}

/** Calculator product/offers reads over the D1 product repository. */
export class D1ProductDataPort implements IProductDataPort {
  constructor(private readonly repo: ProductRepository) {}

  /** @inheritdoc */
  async findProductById(id: number): Promise<CalculatorProductData | null> {
    const record = await this.repo.findById(id);
    if (record === null) return null;

    const volumeLitres = parseNumeric(record.unitVolume);

    return {
      id: record.id,
      regulatoryClassification: record.regulatoryClassification,
      category: record.category,
      volumeLitres,
      alcoholByVolume:
        record.alcoholByVolume !== null
          ? parseNumeric(record.alcoholByVolume)
          : 0,
      containerType: record.containerType,
      depositSystemStatus: record.depositSystemStatus,
      weightKg: estimateWeightKg(volumeLitres),
      normalizedName: record.name,
    };
  }

  /**
   * @inheritdoc
   *
   * Conversion-state columns (design D2 / task 1.5) pass through so live
   * offers carry their FX provenance: `hasValidEurConversion` excludes
   * offers whose non-EUR original lacks a recorded FX dataset version.
   * Null columns are omitted rather than nulled — "absent" is the
   * read-model state the domain contract expects for unknown provenance.
   */
  async findRetailOffers(productId: number): Promise<CalculatorRetailOfferData[]> {
    const offers = await this.repo.findOffers(productId);

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
// ITransportOfferQuery — TransportEstimationService read port
// ---------------------------------------------------------------------------

function toDomainOffer(row: TransportOfferRecord): TransportOffer {
  return {
    id: row.id,
    carrier: row.carrier,
    originCountry: row.originCountry,
    destinationCountry: row.destinationCountry,
    weightBracket: {
      minKg: row.weightMinKg === null ? null : Number(row.weightMinKg),
      maxKg: row.weightMaxKg === null ? null : Number(row.weightMaxKg),
    },
    packageTier: row.packageTier,
    priceCents: row.priceCents,
    currency: row.currency,
    sellerInvolvementIndicator: row.sellerInvolvementIndicator,
    observedAt: row.observedAt,
    refreshedAt: row.refreshedAt,
    reliabilityStatus: row.reliabilityStatus,
  };
}

/** Transport estimation reads over the D1 transport-offer repository. */
export class D1TransportOfferQuery implements ITransportOfferQuery {
  constructor(private readonly repo: D1TransportOfferRepository) {}

  /** @inheritdoc */
  async findAllActive(): Promise<TransportOffer[]> {
    const rows = await this.repo.findActive();
    return rows.map(toDomainOffer);
  }

  /** @inheritdoc */
  async findByCarrier(carrierId: string): Promise<TransportOffer[]> {
    const rows = await this.repo.findByCarrier(carrierId);
    return rows.map(toDomainOffer);
  }
}

// ---------------------------------------------------------------------------
// ITransportOfferWritePort — carrier-rate refresh append port
// ---------------------------------------------------------------------------

const INSERT_TRANSPORT_OFFER_SQL = `
  INSERT INTO transport_offers (
    carrier, origin_country, destination_country, weight_min_kg,
    weight_max_kg, package_tier, price_cents, currency,
    seller_involvement_indicator, observed_at, refreshed_at,
    reliability_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const NEWEST_OBSERVED_AT_SQL = `
  SELECT MAX(observed_at) AS newest FROM transport_offers`;

/**
 * Append-only carrier-rate writes over `transport_offers` — the D1
 * counterpart of DrizzleTransportOfferWriteAdapter (task 7.4). A changed
 * rate is a new row, never an update; `refreshedAt` tracks the refresh
 * batch while `observedAt` is the carrier's own publication time.
 */
export class D1TransportOfferWritePort implements ITransportOfferWritePort {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async insertOffers(
    offers: readonly TransportOfferWrite[],
  ): Promise<{ inserted: number }> {
    if (offers.length === 0) return { inserted: 0 };

    const refreshedAt = new Date().toISOString();
    // One prepared statement per row: bind semantics on the shared
    // statement instance differ between the real binding and the test
    // shim, and per-row prepare keeps each batch entry's params its own.
    await this.d1.batch(
      offers.map(({ rate, reliabilityStatus }) =>
        this.d1
          .prepare(INSERT_TRANSPORT_OFFER_SQL)
          .bind(
            rate.carrier,
            rate.originCountry,
            rate.destinationCountry,
            rate.weightMinKg,
            rate.weightMaxKg,
            rate.packageTier,
            rate.priceCents,
            rate.currency,
            // Tri-state-free column: boolean → INTEGER (design D2).
            rate.sellerInvolvementIndicator ? 1 : 0,
            rate.observedAt.toISOString(),
            refreshedAt,
            reliabilityStatus,
          ),
      ),
    );
    return { inserted: offers.length };
  }

  /** @inheritdoc */
  async findNewestObservedAt(): Promise<Date | null> {
    const row = await this.d1
      .prepare(NEWEST_OBSERVED_AT_SQL)
      .first<{ newest: string | null }>();
    return row?.newest ? new Date(row.newest) : null;
  }
}

// ---------------------------------------------------------------------------
// ICalculationRecordPort — calculator write-once persistence port
// ---------------------------------------------------------------------------

/**
 * Calculation-record writes over the D1 repository — the D1 counterpart
 * of apps/backend/src/adapters/calculation-record.adapter.ts (task 3.5).
 * The Disclaimer struct is persisted as JSON TEXT exactly like the pg
 * path; the read mapper (and calculation-result.mapper) accept both.
 */
export class D1CalculationRecordPort implements ICalculationRecordPort {
  private readonly repo: D1CalculationRecordRepository;

  constructor(d1: D1DatabaseLike) {
    this.repo = new D1CalculationRecordRepository(d1);
  }

  /** @inheritdoc */
  async create(record: CreateCalculationRecordInput): Promise<{ id: number }> {
    const persisted = await this.repo.create({
      productMasterId: record.productMasterId,
      retailOfferIds: record.retailOfferIds as unknown,
      transportOfferId: record.transportOfferId,
      exciseRuleVersionId: record.exciseRuleVersionId,
      containerDutyRuleVersionId: record.containerDutyRuleVersionId,
      totalCents: record.totalCents,
      breakdown: record.breakdown,
      confidence: record.confidence,
      quantity: record.quantity,
      destination: record.destination,
      disclaimer: JSON.stringify(record.disclaimer),
      sessionId: record.sessionId,
    });
    return { id: persisted.id };
  }
}

// ---------------------------------------------------------------------------
// ICalculationRecordQueryPort — declaration / reports read model
// ---------------------------------------------------------------------------

/** Joined read: calculation record + product master + transport offer. */
const RECORD_QUERY_SQL = `
  SELECT r.id, r.total_cents, r.breakdown, r.confidence, r.quantity,
         r.destination, r.disclaimer, r.calculated_at,
         p.name AS product_name, p.brand AS product_brand,
         p.category AS product_category, p.alcohol_by_volume,
         p.unit_volume, p.container_type, p.deposit_system_status,
         t.carrier AS transport_carrier, t.origin_country AS transport_origin,
         t.destination_country AS transport_destination
    FROM calculation_records r
    JOIN product_master p ON p.id = r.product_master_id
    LEFT JOIN transport_offers t ON t.id = r.transport_offer_id
   WHERE r.id = ?
   ORDER BY r.calculated_at ASC
   LIMIT 1`;

interface RecordQueryRow {
  readonly id: number;
  readonly total_cents: number;
  readonly breakdown: string;
  readonly confidence: string;
  readonly quantity: number;
  readonly destination: string;
  readonly disclaimer: string;
  readonly calculated_at: string;
  readonly product_name: string;
  readonly product_brand: string | null;
  readonly product_category: string;
  readonly alcohol_by_volume: string | null;
  readonly unit_volume: string | null;
  readonly container_type: string;
  readonly deposit_system_status: number | null;
  readonly transport_carrier: string | null;
  readonly transport_origin: string | null;
  readonly transport_destination: string | null;
}

/** Sum the persisted ItemizedCost lines of one category (mapper parity). */
function sumBreakdownCategory(breakdown: unknown, category: string): number {
  if (!Array.isArray(breakdown)) return 0;
  let sum = 0;
  for (const raw of breakdown) {
    if (typeof raw === 'object' && raw !== null) {
      const entry = raw as Record<string, unknown>;
      if (entry.category === category && typeof entry.cents === 'number') {
        sum += entry.cents;
      }
    }
  }
  return sum;
}

/**
 * Parse the persisted Disclaimer JSON — plain-text rows degrade exactly
 * like calculation-result.mapper.parseDisclaimer.
 */
function parseDisclaimer(raw: string): {
  text: string;
  language: 'fi' | 'en';
  version: string;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.text === 'string' &&
      (parsed.language === 'fi' || parsed.language === 'en') &&
      typeof parsed.version === 'string'
    ) {
      return { text: parsed.text, language: parsed.language, version: parsed.version };
    }
  } catch {
    // Not JSON — plain-text degradation below.
  }
  return { text: raw, language: 'fi', version: 'unknown' };
}

/**
 * Declaration/report read model over D1 — joins the record with the
 * product master and transport offer the way the domain contract expects.
 * There is no pg precedent (the phase-1 backend left this port null), so
 * the projections follow the closest established mappings:
 * calculation-result.mapper (breakdown sums, disclaimer parse, numeric
 * parsing) and ProductDataAdapter (ABV/volume conversion).
 *
 * KNOWN DEGRADATION: the transaction classification is not persisted with
 * calculation records (see calculation-result.mapper). The port contract
 * cannot express absence, so the factual `'NotPersisted'` marker from the
 * mapper rides the field — never a fabricated legal label. Consumers are
 * behind the pinned always-403 declaration gate and the default-OFF
 * reports flag in this phase.
 */
export class D1CalculationRecordQueryAdapter implements ICalculationRecordQueryPort {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async findById(id: number): Promise<CalculationRecordData | null> {
    const row = await this.d1.prepare(RECORD_QUERY_SQL).bind(id).first<RecordQueryRow>();
    if (row === null) return null;

    let breakdown: unknown = null;
    try {
      breakdown = JSON.parse(row.breakdown);
    } catch {
      breakdown = null;
    }
    const disclaimer = parseDisclaimer(row.disclaimer);

    return {
      id: row.id,
      productName: row.product_name,
      productBrand: row.product_brand,
      productCategory: row.product_category,
      alcoholByVolume: parseNumeric(row.alcohol_by_volume ?? ''),
      volumeLitres: parseNumeric(row.unit_volume ?? ''),
      containerType: row.container_type,
      depositSystemStatus:
        row.deposit_system_status === null ? null : row.deposit_system_status === 1,
      quantity: row.quantity,
      transportCarrier: row.transport_carrier,
      transportOrigin: row.transport_origin,
      transportDestination: row.transport_destination,
      alcoholExciseCents: sumBreakdownCategory(breakdown, 'alcoholExciseEstimate'),
      containerDutyCents: sumBreakdownCategory(breakdown, 'containerDutyEstimate'),
      totalCents: row.total_cents,
      confidence: row.confidence === 'HIGH' || row.confidence === 'MEDIUM' ? row.confidence : 'LOW',
      classification: 'NotPersisted' as CalculationRecordData['classification'],
      disclaimerText: disclaimer.text,
      disclaimerLanguage: disclaimer.language,
      disclaimerVersion: disclaimer.version,
      calculationTimestamp: new Date(row.calculated_at).toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// IMerchantTermsPort — basket optimizer store-terms read port
// ---------------------------------------------------------------------------

/** Merchant-terms reads over the D1 repository (backend adapter parity). */
export class D1MerchantTermsPort implements IMerchantTermsPort {
  private readonly repo: D1MerchantTermsRepository;

  constructor(d1: D1DatabaseLike) {
    this.repo = new D1MerchantTermsRepository(d1);
  }

  /** @inheritdoc */
  async getTerms(merchantId: string): Promise<MerchantTerms | null> {
    const record = await this.repo.findByMerchant(merchantId);
    if (record === null) return null;

    return {
      merchantId: record.merchantId,
      minimumOrderValueCents: record.minimumOrderValueCents ?? null,
      currency: record.currency,
      reliabilityStatus: toReliabilityStatus(record.reliabilityStatus),
      observedAt: record.observedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// IBasketCalculationRecordPort — basket-optimization write-once audit port
// ---------------------------------------------------------------------------

/**
 * Basket-calculation-record writes over the D1 repository (task 3.6) —
 * the D1 counterpart of apps/backend's BasketCalculationRecordAdapter.
 * JSON payloads are serialized here so the repository's TEXT columns hold
 * canonical JSON (the pg insert accepted drizzle jsonb objects).
 */
export class D1BasketCalculationRecordPort
  implements IBasketCalculationRecordPort
{
  private readonly repo: D1BasketCalculationRecordRepository;

  constructor(d1: D1DatabaseLike) {
    this.repo = new D1BasketCalculationRecordRepository(d1);
  }

  /** @inheritdoc */
  async create(
    record: CreateBasketCalculationRecordInput,
  ): Promise<{ id: number }> {
    const persisted = await this.repo.create({
      sessionId: record.sessionId,
      destination: record.destination,
      transportArrangement: record.transportArrangement,
      inputBasket: record.inputBasket,
      shipmentBreakdown: record.shipmentBreakdown,
      totalCents: record.totalCents,
      confidence: record.confidence,
      disclaimer: JSON.stringify(record.disclaimer),
    });
    return { id: persisted.id };
  }
}
