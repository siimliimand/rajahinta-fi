/**
 * D1-backed IUpsertRepository — the Worker-side write-port adapter for
 * the ingestion pipeline (task 4.1, design D6).
 *
 * Ports `packages/data-acquisition/src/adapters/upsert-port.adapter.ts`
 * (Drizzle/pg) onto raw D1 SQL over the same canonical tables
 * (`product_master`, `retail_offers` — the D1 schema of task 2.1). The
 * strategy is preserved exactly:
 *
 * - Product upsert: EAN match first (full mutable-field refresh), then
 *   the (name, brand, containerType, unitVolume) compound key (only
 *   stamps updatedAt + fills a missing EAN), then insert.
 * - Offer upsert: append-only insert; `changed` reports first sighting
 *   or price move versus the latest prior (merchant, product) row,
 *   ordered (observedAt, id) descending — the guardrail the per-change
 *   observation hook fires on.
 *
 * pg→D1 translations (design D2): numeric strings → REAL numbers at the
 * binding boundary (D1 returns typed values, no pg-numeric layer),
 * booleans → 0/1, Date → ISO-8601 TEXT.
 *
 * @module D1UpsertRepository
 */

import type {
  IUpsertRepository,
  UpsertProductInput,
  UpsertOfferInput,
  UpsertResult,
  UpsertOfferResult,
} from '../../../../packages/data-acquisition/src/interfaces/upsert-port.interface';
import type { D1DatabaseLike } from '../../../../packages/data-platform/src/d1/executor';

/** pg numeric-string → REAL number (D1 binds numbers, not numeric text). */
function toReal(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Required numeric-string column → REAL with a 0 fallback (never NULL). */
function toRealRequired(value: string | null | undefined): number {
  return toReal(value) ?? 0;
}

/** Tri-state boolean → nullable INTEGER (design D2 boolean rule). */
function toInt(value: boolean | null | undefined): number | null {
  return value === null || value === undefined ? null : value ? 1 : 0;
}

const FIND_BY_EAN_SQL = `SELECT id FROM product_master WHERE ean = ? LIMIT 1`;

const UPDATE_BY_EAN_SQL = `
  UPDATE product_master SET
    name = ?, manufacturer = ?, brand = ?, category = ?, alcohol_by_volume = ?,
    unit_volume = ?, container_type = ?, regulatory_classification = ?,
    deposit_system_status = ?, updated_at = ?
  WHERE id = ?`;

const FIND_BY_COMPOUND_SQL = `
  SELECT id FROM product_master
   WHERE name = ? AND brand = ? AND container_type = ? AND unit_volume = ?
   LIMIT 1`;

const UPDATE_COMPOUND_SQL = `
  UPDATE product_master
     SET updated_at = ?, ean = COALESCE(?, ean)
   WHERE id = ?`;

const INSERT_PRODUCT_SQL = `
  INSERT INTO product_master (
    name, manufacturer, brand, category, alcohol_by_volume, unit_volume,
    container_type, regulatory_classification, deposit_system_status, ean
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;

const LATEST_OFFER_PRICE_SQL = `
  SELECT price_cents FROM retail_offers
   WHERE merchant = ? AND product_id = ?
   ORDER BY observed_at DESC, id DESC
   LIMIT 1`;

const INSERT_OFFER_SQL = `
  INSERT INTO retail_offers (
    merchant, country, product_id, price_cents, currency,
    original_price_cents, original_currency, fx_dataset_version,
    availability, source_url, observed_at, reliability_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;

export class D1UpsertRepository implements IUpsertRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async upsertProduct(input: UpsertProductInput): Promise<UpsertResult> {
    const updatedAt = new Date().toISOString();
    const alcoholByVolume = toReal(input.alcoholByVolume);
    const unitVolume = toRealRequired(input.unitVolume);
    const depositSystemStatus = toInt(input.depositSystemStatus);

    // ---- Tier 1: Match by EAN — refresh every mutable field --------------
    if (input.ean) {
      const byEan = (
        await this.d1.prepare(FIND_BY_EAN_SQL).bind(input.ean).first<{ id: number }>()
      );
      if (byEan !== null) {
        await this.d1
          .prepare(UPDATE_BY_EAN_SQL)
          .bind(
            input.name,
            input.manufacturer,
            input.brand,
            input.category,
            alcoholByVolume,
            unitVolume,
            input.containerType,
            input.regulatoryClassification,
            depositSystemStatus,
            updatedAt,
            byEan.id,
          )
          .run();
        return { productId: byEan.id, created: false };
      }
    }

    // ---- Tier 2: Compound key — stamp updatedAt, fill a missing EAN ------
    const byCompound = await this.d1
      .prepare(FIND_BY_COMPOUND_SQL)
      .bind(input.name, input.brand, input.containerType, unitVolume)
      .first<{ id: number }>();
    if (byCompound !== null) {
      await this.d1
        .prepare(UPDATE_COMPOUND_SQL)
        .bind(updatedAt, input.ean ?? null, byCompound.id)
        .run();
      return { productId: byCompound.id, created: false };
    }

    // ---- Tier 3: Insert ---------------------------------------------------
    const row = await this.d1
      .prepare(INSERT_PRODUCT_SQL)
      .bind(
        input.name,
        input.manufacturer,
        input.brand,
        input.category,
        alcoholByVolume,
        unitVolume,
        input.containerType,
        input.regulatoryClassification,
        depositSystemStatus,
        input.ean ?? null,
      )
      .first<{ id: number }>();
    if (row === null) {
      throw new Error('product_master INSERT .. RETURNING returned no row');
    }
    return { productId: row.id, created: true };
  }

  /** @inheritdoc */
  async upsertOffer(input: UpsertOfferInput): Promise<UpsertOfferResult> {
    // ---- Change detection: latest prior row for (merchant, product) ------
    // First sighting or price move; availability-only flips are not
    // changes (the observation log is a price series).
    const previous = await this.d1
      .prepare(LATEST_OFFER_PRICE_SQL)
      .bind(input.merchant, input.productId)
      .first<{ price_cents: number }>();
    const changed =
      previous === null || previous.price_cents !== input.priceCents;

    const row = await this.d1
      .prepare(INSERT_OFFER_SQL)
      .bind(
        input.merchant,
        input.country,
        input.productId,
        input.priceCents,
        input.currency,
        input.originalPriceCents ?? null,
        input.originalCurrency ?? null,
        input.fxDatasetVersion ?? null,
        input.availability,
        input.sourceUrl ?? null,
        input.observedAt.toISOString(),
        input.reliabilityStatus,
      )
      .first<{ id: number }>();
    if (row === null) {
      throw new Error('retail_offers INSERT .. RETURNING returned no row');
    }
    return { offerId: row.id, changed };
  }
}
