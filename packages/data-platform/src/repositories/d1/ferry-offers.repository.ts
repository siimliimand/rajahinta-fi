/**
 * D1 FerryOffersRepository — the curated affiliate slot behind the trip
 * feasibility calculator (task 5.3, change product-roadmap-phases-1-4,
 * design R8), backed by the `ferry_offers` table. Co-located abstract +
 * concrete (consumption-norms / traveller-allowances precedent — a
 * D1-only table with no pg counterpart).
 *
 * AFFILIATE-NEUTRALITY ARCHITECTURE (binding): this repository is the
 * affiliate data path. The trip API's CALCULATION input never touches
 * it — the route resolves allowances through the traveller-allowances
 * repository and calls the pure module on one path, and lists published
 * offers here on a second, independent path; the two meet only in the
 * response envelope. The table carries no ranking weight, no price, no
 * campaign field (schema-level minimization), so affiliate data cannot
 * influence any computation — the 5.5 byte-identical compliance test is
 * true by construction.
 *
 * Lifecycle (the curated-content discipline of R8/R10, lighter than the
 * dataset tables because a link row is content, not a cited dataset):
 *
 * - **Create** — rows always land DRAFT: operator-console work in
 *   progress is invisible to the public trip API.
 * - **Update** — DRAFT rows only. A PUBLISHED row is immutable
 *   ({@link FerryOfferImmutableError}); corrections delete and re-create
 *   through the audited console, so every state the public ever saw is
 *   fully explained by the audit trail.
 * - **Publish** — the only DRAFT → PUBLISHED transition, the console's
 *   explicit publish action. PUBLISHED is terminal: republish is a
 *   no-op null (consumption-norms publish parity).
 * - **Delete** — any status; how content comes down. The console
 *   records the audit event; this class only removes the row.
 *
 * The stored `url` is console-only data: the public trip API returns
 * redirector-ready references and the outbound redirect controller
 * reads the url at click time (R8). This class never rewrites,
 * normalizes, or validates url contents beyond the schema's non-empty
 * CHECK — content validation belongs to the console DTO layer.
 *
 * Ordering: both list reads order by (operator, routeLabel, id)
 * ascending — deterministic regardless of insert order; affiliate data
 * must not influence anything, including its own ordering surprises.
 *
 * @module D1FerryOffersRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Lifecycle states — DRAFT work in progress, PUBLISHED publicly visible. */
export const FERRY_OFFER_STATUSES = ['DRAFT', 'PUBLISHED'] as const;

export type FerryOfferStatus = (typeof FERRY_OFFER_STATUSES)[number];

/** Contract row — camelCase projection of the snake_case table row. */
export interface FerryOfferRecord {
  readonly id: number;
  /** Ferry operator name as presented on the partner block. */
  readonly operator: string;
  /** Human route label (e.g. "Helsinki–Tallinn"). */
  readonly routeLabel: string;
  /** Outbound link target — console-only data; never serialized to the public API. */
  readonly url: string;
  readonly status: FerryOfferStatus;
  readonly createdAt: Date;
}

/** Input for appending a new offer (always DRAFT — see module docs). */
export interface FerryOfferInsert {
  readonly operator: string;
  readonly routeLabel: string;
  readonly url: string;
}

/** Editable fields of a DRAFT offer. Status and createdAt are not editable. */
export interface FerryOfferUpdate {
  readonly operator?: string;
  readonly routeLabel?: string;
  readonly url?: string;
}

/**
 * Thrown by `update` when the target offer is PUBLISHED — published
 * partner content is immutable (module docs); the console surfaces this
 * as a 409 rather than silently rewriting what the public saw.
 */
export class FerryOfferImmutableError extends Error {
  readonly offerId: number;

  constructor(offerId: number) {
    super(
      `ferry_offers row ${offerId} is PUBLISHED — published partner content is ` +
        'immutable; delete and re-create it through the operator console',
    );
    this.name = 'FerryOfferImmutableError';
    this.offerId = offerId;
  }
}

/** Raw D1 ferry_offers row. */
interface D1FerryOfferRow {
  readonly id: number;
  readonly operator: string;
  readonly route_label: string;
  readonly url: string;
  readonly status: string;
  readonly created_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): FerryOfferStatus {
  if (!(FERRY_OFFER_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `ferry_offers.status "${value}" is not a known ferry-offer lifecycle state`,
    );
  }
  return value as FerryOfferStatus;
}

function toContract(row: D1FerryOfferRow): FerryOfferRecord {
  return {
    id: row.id,
    operator: row.operator,
    routeLabel: row.route_label,
    url: row.url,
    status: toStatus(row.status),
    createdAt: new Date(row.created_at),
  };
}

const COLUMNS = 'id, operator, route_label, url, status, created_at';

const FIND_BY_ID_SQL = `SELECT ${COLUMNS} FROM ferry_offers WHERE id = ?`;

/** Public block: PUBLISHED rows in the deterministic curation order. */
const LIST_PUBLISHED_SQL = `
  SELECT ${COLUMNS} FROM ferry_offers
   WHERE status = 'PUBLISHED'
   ORDER BY operator ASC, route_label ASC, id ASC`;

/** Console view: every row (drafts first in review order), same tie-break. */
const LIST_ALL_SQL = `
  SELECT ${COLUMNS} FROM ferry_offers
   ORDER BY status ASC, operator ASC, route_label ASC, id ASC`;

const INSERT_SQL = `
  INSERT INTO ferry_offers (operator, route_label, url, status)
  VALUES (?, ?, ?, 'DRAFT')
  RETURNING ${COLUMNS}`;

const PUBLISH_SQL = `
  UPDATE ferry_offers SET status = 'PUBLISHED'
   WHERE id = ? AND status = 'DRAFT'
   RETURNING ${COLUMNS}`;

const DELETE_SQL = `DELETE FROM ferry_offers WHERE id = ?`;

/**
 * Curated ferry-offer contract — the affiliate slot's storage boundary.
 * The trip API consumes only {@link listPublished}; the audited operator
 * console consumes the rest.
 */
@Injectable()
export abstract class FerryOffersRepository {
  /** Append a new offer. Always lands DRAFT — never auto-publishes. */
  abstract create(input: FerryOfferInsert): Promise<FerryOfferRecord>;

  /** One offer by id, any status — or null. */
  abstract findById(id: number): Promise<FerryOfferRecord | null>;

  /** Every row (DRAFT + PUBLISHED) — the console listing. */
  abstract listAll(): Promise<FerryOfferRecord[]>;

  /** PUBLISHED rows in curation order — the public trip API's block. */
  abstract listPublished(): Promise<FerryOfferRecord[]>;

  /**
   * Edit a DRAFT offer's content fields. Returns null when the row is
   * unknown; throws {@link FerryOfferImmutableError} when it is
   * PUBLISHED (module docs — delete and re-create instead).
   */
  abstract update(id: number, patch: FerryOfferUpdate): Promise<FerryOfferRecord | null>;

  /**
   * The manual publish transition (operator confirmation path). Returns
   * null when the offer is unknown or not DRAFT (PUBLISHED is terminal —
   * republish is a no-op, consumption-norms parity).
   */
  abstract publish(id: number): Promise<FerryOfferRecord | null>;

  /** Remove an offer (any status). Returns whether a row was removed. */
  abstract remove(id: number): Promise<boolean>;
}

@Injectable()
export class D1FerryOffersRepository extends FerryOffersRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: FerryOfferInsert): Promise<FerryOfferRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(input.operator, input.routeLabel, input.url)
      .first<D1FerryOfferRow>();
    if (!row) {
      throw new Error(
        `ferry_offers insert for "${input.operator}" returned no row`,
      );
    }
    return toContract(row);
  }

  /** @inheritdoc */
  async findById(id: number): Promise<FerryOfferRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1FerryOfferRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async listAll(): Promise<FerryOfferRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_ALL_SQL).all<D1FerryOfferRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async listPublished(): Promise<FerryOfferRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_PUBLISHED_SQL).all<D1FerryOfferRow>()
    ).results;
    return rows.map(toContract);
  }

  /** @inheritdoc */
  async update(id: number, patch: FerryOfferUpdate): Promise<FerryOfferRecord | null> {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }
    if (existing.status === 'PUBLISHED') {
      throw new FerryOfferImmutableError(id);
    }
    const row = await this.d1
      .prepare(
        `UPDATE ferry_offers
            SET operator = ?, route_label = ?, url = ?
          WHERE id = ?
          RETURNING ${COLUMNS}`,
      )
      .bind(
        patch.operator ?? existing.operator,
        patch.routeLabel ?? existing.routeLabel,
        patch.url ?? existing.url,
        id,
      )
      .first<D1FerryOfferRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async publish(id: number): Promise<FerryOfferRecord | null> {
    // Constrained UPDATE: only a DRAFT row flips. Unknown/not-draft both
    // surface as null — the console distinguishes via findById first
    // (consumption-norms confirm parity).
    const row = await this.d1
      .prepare(PUBLISH_SQL)
      .bind(id)
      .first<D1FerryOfferRow>();
    return row ? toContract(row) : null;
  }

  /** @inheritdoc */
  async remove(id: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(id).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
