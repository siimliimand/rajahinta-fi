/**
 * D1 FerryPriceRepository — the curated ferry onboard-shop price
 * observations behind the trip responses' display-only observed-prices
 * block (task 2.1, change ferry-onboard-prices), backed by the
 * `ferry_price_observations` table (migration 0034). Co-located
 * abstract + concrete (ferry-offers precedent — a D1-only table with no
 * pg counterpart).
 *
 * DISPLAY-ONLY ARCHITECTURE (binding, spec:
 * trip-feasibility-calculator): these rows never enter any calculation
 * input. Ferry shops do not ship to the door, so an onboard price is
 * not a merchant offer — no retail_offers row, no product_master join,
 * no EAN (schema-level minimization); the trip calculator resolves
 * allowances on its own path and the block meets it only in the
 * response envelope, the same affiliate-neutrality shape ferry_offers
 * uses. The 3.2 byte-identity compliance extension depends on this
 * separation.
 *
 * Publication (why there is no status column): the table contains
 * exactly what the governance-gated curated dataset holds — the monthly
 * curated-rate-refresh cron upserts the transcribed dataset through the
 * source-governance store (an operator key per ferry operator,
 * fail-closed PENDING until granted), and "published rows only" refers
 * to that gate being the publication mechanism. Every stored row is a
 * display-ready curated fact; a lifecycle column would govern nothing.
 *
 * Idempotent upsert (the savings-snapshot pattern): lookup-then-
 * insert/update keyed by UNIQUE (operator, route, label, observed_at).
 * The key columns are the observation identity — a re-observation on a
 * later date is a NEW row (append-only history, the Fransberg
 * curated-dataset precedent) — while a re-run over an unchanged dataset
 * converges and a price/citation correction of the same observation
 * overwrites the computed columns in place. Both key columns are NOT
 * NULL, so no NULLS NOT DISTINCT compensation is needed.
 *
 * Currency is the EUR literal (no column): all three operators price
 * their FI-market shops in euro; price_cents is the EUR minor unit.
 *
 * Ordering: findPublished orders by the unique key (operator, route,
 * label, observed_at) plus the id tiebreak — deterministic regardless
 * of insert order. Reads are narrow by design: the trip block needs
 * all-stored-rows (optionally one route's) and nothing else.
 *
 * @module D1FerryPriceRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row — camelCase projection of the snake_case table row. */
export interface FerryPriceObservationRecord {
  readonly id: number;
  /** Ferry operator key as transcribed (e.g. "tallink", "viking", "eckero"). */
  readonly operator: string;
  /** Human route label from the transcription (e.g. "Helsinki–Tallinn"). */
  readonly route: string;
  /** Display label as printed in the onboard shop. */
  readonly label: string;
  /** EUR minor-unit price. */
  readonly priceCents: number;
  /** The curated revision's observation date. */
  readonly observedAt: Date;
  /** Per-row source citation. */
  readonly citation: string;
  readonly createdAt: Date;
}

/** Input for the ingestion upsert — one curated dataset row. */
export interface FerryPriceUpsertInput {
  readonly operator: string;
  readonly route: string;
  readonly label: string;
  readonly priceCents: number;
  /** Part of the upsert identity — a changed date is a new observation. */
  readonly observedAt: Date;
  readonly citation: string;
}

/** Raw D1 ferry_price_observations row. */
interface D1FerryPriceRow {
  readonly id: number;
  readonly operator: string;
  readonly route: string;
  readonly label: string;
  readonly price_cents: number;
  readonly observed_at: string;
  readonly citation: string;
  readonly created_at: string;
}

function toContract(row: D1FerryPriceRow): FerryPriceObservationRecord {
  return {
    id: row.id,
    operator: row.operator,
    route: row.route,
    label: row.label,
    priceCents: row.price_cents,
    observedAt: new Date(row.observed_at),
    citation: row.citation,
    createdAt: new Date(row.created_at),
  };
}

const COLUMNS =
  'id, operator, route, label, price_cents, observed_at, citation, created_at';

/** Key columns — the observation identity, immutable across an upsert. */
function keyParams(observation: FerryPriceUpsertInput): unknown[] {
  return [
    observation.operator,
    observation.route,
    observation.label,
    observation.observedAt.toISOString(),
  ];
}

/** Computed columns — overwritten on a same-observation re-run. */
function computedParams(observation: FerryPriceUpsertInput): unknown[] {
  return [observation.priceCents, observation.citation];
}

const LOOKUP_SQL = `
  SELECT id FROM ferry_price_observations
   WHERE operator = ? AND route = ? AND label = ? AND observed_at = ?`;

/** Column order follows the key-then-computed bind order below, not the
 * table's declared order — the correspondence is the whole upsert contract. */
const INSERT_SQL = `
  INSERT INTO ferry_price_observations (
    operator, route, label, observed_at, price_cents, citation
  ) VALUES (?, ?, ?, ?, ?, ?)
  RETURNING id`;

const UPDATE_SQL = `
  UPDATE ferry_price_observations SET price_cents = ?, citation = ?
   WHERE id = ?
   RETURNING id`;

const FIND_ALL_SQL = `
  SELECT ${COLUMNS} FROM ferry_price_observations
   ORDER BY operator ASC, route ASC, label ASC, observed_at ASC, id ASC`;

const FIND_BY_ROUTE_SQL = `
  SELECT ${COLUMNS} FROM ferry_price_observations
   WHERE route = ?
   ORDER BY operator ASC, route ASC, label ASC, observed_at ASC, id ASC`;

/**
 * Curated ferry-price contract — the storage boundary the ingestion
 * cron writes through and the trip block reads through. No write path
 * exists for anything the curated dataset did not contain.
 */
@Injectable()
export abstract class FerryPriceRepository {
  /**
   * Insert or overwrite one observation keyed by (operator, route,
   * label, observedAt). Returns the row id (existing id on conflict —
   * the key columns never change). A changed observedAt is a new
   * observation: it lands a new row, prior history stays.
   */
  abstract upsertObservation(
    observation: FerryPriceUpsertInput,
  ): Promise<{ id: number }>;

  /**
   * Stored observations — all of them (ingestion stores only what the
   * governance gate let through), optionally one route's — in the
   * deterministic (operator, route, label, observed_at) order. Empty
   * when nothing has been ingested (the designed empty state, e.g.
   * Viking Line until operator transcription).
   */
  abstract findPublished(route?: string): Promise<FerryPriceObservationRecord[]>;
}

@Injectable()
export class D1FerryPriceRepository extends FerryPriceRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async upsertObservation(
    observation: FerryPriceUpsertInput,
  ): Promise<{ id: number }> {
    const existing = await this.d1
      .prepare(LOOKUP_SQL)
      .bind(...keyParams(observation))
      .first<{ id: number }>();

    if (existing) {
      const row = await this.d1
        .prepare(UPDATE_SQL)
        .bind(...computedParams(observation), existing.id)
        .first<{ id: number }>();
      if (!row) {
        throw new Error(
          'ferry_price_observations UPDATE .. RETURNING returned no row',
        );
      }
      return { id: row.id };
    }

    const inserted = await this.d1
      .prepare(INSERT_SQL)
      .bind(...keyParams(observation), ...computedParams(observation))
      .first<{ id: number }>();
    if (!inserted) {
      throw new Error(
        'ferry_price_observations INSERT .. RETURNING returned no row',
      );
    }
    return { id: inserted.id };
  }

  /** @inheritdoc */
  async findPublished(
    route?: string,
  ): Promise<FerryPriceObservationRecord[]> {
    const rows = route
      ? (
          await this.d1.prepare(FIND_BY_ROUTE_SQL).bind(route).all<D1FerryPriceRow>()
        ).results
      : (await this.d1.prepare(FIND_ALL_SQL).all<D1FerryPriceRow>()).results;
    return rows.map(toContract);
  }
}
