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
} from '@rajahinta/core-domain';
import type {
  ITransportOfferWritePort,
  TransportOfferWrite,
} from '../../../../packages/data-acquisition/src/interfaces/transport-offer-write.port';
import type { ProductRepository } from '../../../../packages/data-platform/src/abstracts';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';
import { D1TransportOfferRepository } from '../../../../packages/data-platform/src/repositories/d1/transport-offer.repository';
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
