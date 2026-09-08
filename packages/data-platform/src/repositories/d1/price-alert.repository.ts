/**
 * D1 PriceAlertRepository — watchlist alerts (task 2.1, change
 * product-roadmap-phases-1-4; kind-awareness task 1.4, change
 * trust-and-reach-roadmap). CRUD over `price_alerts` with account
 * scoping on every mutation: an alert id belonging to another account
 * matches no row instead of deleting/updating cross-account (the
 * saved-scenario delete precedent). ISO-8601 TEXT instants convert to
 * Date at the repository boundary (design D2).
 *
 * Alert kinds (task 1.4): PRICE evaluates the materialized price after
 * ingestion cycles and carries the threshold; TAX_CHANGE evaluates on
 * rate-version publication and carries NO threshold (spec: a
 * rate-change trigger has no threshold to compare against). The
 * duplicate guard is per product+kind — the
 * (account_id, product_id, kind) unique index of migration 0016 — so
 * one product may carry a PRICE and a TAX_CHANGE alert for the same
 * account while a same-kind duplicate rejects. Kind is part of the
 * duplicate identity and therefore immutable after creation. The PRICE
 * path is byte-for-byte the pre-kind behavior: kind defaults to PRICE
 * on create and unfiltered lists return every kind.
 *
 * The abstract class is co-located with the single concrete
 * implementation (the merchant-reliability precedent) — there is no pg
 * counterpart for this change's tables, so no abstracts.ts contract
 * exists to extend.
 *
 * @module D1PriceAlertRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Evaluation toggle: active alerts are compared by the cron, paused are kept but skipped. */
export type PriceAlertStatus = 'active' | 'paused';

/**
 * What triggers the alert (migration 0016's closed value set): PRICE is
 * the original threshold watch; TAX_CHANGE fires on rate-version
 * publication with no threshold involved.
 */
export type PriceAlertKind = 'PRICE' | 'TAX_CHANGE';

const ALERT_KINDS: readonly PriceAlertKind[] = ['PRICE', 'TAX_CHANGE'];

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface PriceAlertRecord {
  readonly id: number;
  readonly accountId: number;
  readonly productId: number;
  readonly kind: PriceAlertKind;
  /** PRICE alerts: the comparison threshold. TAX_CHANGE alerts: always null. */
  readonly thresholdCents: number | null;
  readonly status: PriceAlertStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * PRICE-kind creation — the threshold is the comparison reference and
 * is required (a threshold-less PRICE alert could never fire).
 */
export interface PriceAlertCreateInput {
  /** Defaults to 'PRICE'. */
  readonly kind?: 'PRICE';
  readonly accountId: number;
  readonly productId: number;
  readonly thresholdCents: number;
}

/**
 * TAX_CHANGE-kind creation — no threshold (spec: TAX_CHANGE alerts
 * SHALL NOT require a threshold).
 */
export interface TaxChangeAlertCreateInput {
  readonly kind: 'TAX_CHANGE';
  readonly accountId: number;
  readonly productId: number;
  readonly thresholdCents?: undefined;
}

/**
 * Kind-aware creation input. The union keeps the PRICE path's
 * compile-time shape identical to the pre-kind contract (threshold
 * required, kind omitted) while forbidding a threshold on TAX_CHANGE.
 */
export type PriceAlertCreate =
  | PriceAlertCreateInput
  | TaxChangeAlertCreateInput;

/** Partial patch — absent keys keep their current values. */
export interface PriceAlertUpdatePatch {
  readonly thresholdCents?: number;
  readonly status?: PriceAlertStatus;
}

/**
 * Watchlist alert management contract (spec: price-alerts), shared by
 * the CRUD API (task 2.3) and the evaluation crons (task 2.2). Create
 * rejects on the (account, product, kind) unique constraint — the
 * duplicate check is per product+kind. Kind-filtered list overloads
 * serve the per-kind evaluation crons; the unfiltered forms preserve
 * the pre-kind read behavior.
 */
@Injectable()
export abstract class PriceAlertRepository {
  /** Create an active alert for (account, product, kind). Rejects on the per-kind unique constraint. */
  abstract create(input: PriceAlertCreate): Promise<PriceAlertRecord>;

  /** All of one account's alerts (optionally one kind), deterministic order. */
  abstract findByAccountId(accountId: number, kind?: PriceAlertKind): Promise<PriceAlertRecord[]>;

  /** Every active alert across accounts (optionally one kind) — the evaluation crons' scan sets. */
  abstract findActive(kind?: PriceAlertKind): Promise<PriceAlertRecord[]>;

  /** Account-scoped patch of threshold and/or status; null when the alert is absent or foreign. */
  abstract update(
    accountId: number,
    alertId: number,
    patch: PriceAlertUpdatePatch,
  ): Promise<PriceAlertRecord | null>;

  /** Account-scoped pause — keeps the configuration, stops evaluation. */
  abstract pause(accountId: number, alertId: number): Promise<PriceAlertRecord | null>;

  /** Account-scoped delete; false when the alert is absent or foreign. Notifications cascade. */
  abstract delete(accountId: number, alertId: number): Promise<boolean>;
}

/** Raw D1 price_alerts row. */
interface D1PriceAlertRow {
  readonly id: number;
  readonly account_id: number;
  readonly product_id: number;
  readonly kind: string;
  readonly threshold_cents: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Narrow the varchar column onto the kind union — defense in depth. */
function toKind(value: string): PriceAlertKind {
  if (!ALERT_KINDS.includes(value as PriceAlertKind)) {
    throw new Error(
      `price_alerts.kind "${value}" is not a known alert kind`,
    );
  }
  return value as PriceAlertKind;
}

function toContractAlert(row: D1PriceAlertRow): PriceAlertRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    kind: toKind(row.kind),
    thresholdCents: row.threshold_cents,
    status: row.status as PriceAlertStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const ALERT_COLUMNS = `
  id, account_id, product_id, kind, threshold_cents, status, created_at,
  updated_at`;

const INSERT_SQL = `
  INSERT INTO price_alerts (account_id, product_id, kind, threshold_cents)
  VALUES (?, ?, ?, ?)
  RETURNING ${ALERT_COLUMNS}`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts WHERE account_id = ? ORDER BY id`;

const FIND_BY_ACCOUNT_AND_KIND_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts
   WHERE account_id = ? AND kind = ?
   ORDER BY id`;

const FIND_ACTIVE_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts WHERE status = 'active' ORDER BY id`;

const FIND_ACTIVE_BY_KIND_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts
   WHERE status = 'active' AND kind = ?
   ORDER BY id`;

// COALESCE keeps absent patch keys at their current values; the fresh
// updated_at instant mirrors pg's `SET { updatedAt: new Date() }`.
const UPDATE_SQL = `
  UPDATE price_alerts SET
    threshold_cents = COALESCE(?, threshold_cents),
    status = COALESCE(?, status),
    updated_at = ?
  WHERE id = ? AND account_id = ?
  RETURNING ${ALERT_COLUMNS}`;

const DELETE_SQL = `
  DELETE FROM price_alerts WHERE id = ? AND account_id = ?`;

@Injectable()
export class D1PriceAlertRepository extends PriceAlertRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: PriceAlertCreate): Promise<PriceAlertRecord> {
    const kind = input.kind ?? 'PRICE';
    // The compile-time union already forbids a TAX_CHANGE threshold and
    // requires the PRICE one; these guards keep a cast or a JS caller
    // from smuggling one past the type system (a threshold-less PRICE
    // alert could never fire; a threshold on TAX_CHANGE is meaningless).
    const requestedThreshold = (
      input as { thresholdCents?: number | null }
    ).thresholdCents;
    if (kind === 'TAX_CHANGE' && requestedThreshold != null) {
      throw new Error(
        'TAX_CHANGE alerts must not carry a threshold — a rate-change trigger ' +
          'has no threshold to compare against (spec price-alerts)',
      );
    }
    if (kind === 'PRICE' && requestedThreshold == null) {
      throw new Error(
        'PRICE alerts require a positive threshold_cents — without one the ' +
          'alert could never fire',
      );
    }

    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(input.accountId, input.productId, kind, requestedThreshold ?? null)
      .first<D1PriceAlertRow>();
    if (!row) {
      throw new Error('price_alerts INSERT .. RETURNING returned no row');
    }
    return toContractAlert(row);
  }

  /** @inheritdoc */
  async findByAccountId(
    accountId: number,
    kind?: PriceAlertKind,
  ): Promise<PriceAlertRecord[]> {
    const rows = kind
      ? (
          await this.d1
            .prepare(FIND_BY_ACCOUNT_AND_KIND_SQL)
            .bind(accountId, kind)
            .all<D1PriceAlertRow>()
        ).results
      : (
          await this.d1
            .prepare(FIND_BY_ACCOUNT_SQL)
            .bind(accountId)
            .all<D1PriceAlertRow>()
        ).results;
    return rows.map(toContractAlert);
  }

  /** @inheritdoc */
  async findActive(kind?: PriceAlertKind): Promise<PriceAlertRecord[]> {
    const rows = kind
      ? (
          await this.d1
            .prepare(FIND_ACTIVE_BY_KIND_SQL)
            .bind(kind)
            .all<D1PriceAlertRow>()
        ).results
      : (
          await this.d1.prepare(FIND_ACTIVE_SQL).all<D1PriceAlertRow>()
        ).results;
    return rows.map(toContractAlert);
  }

  /** @inheritdoc */
  async update(
    accountId: number,
    alertId: number,
    patch: PriceAlertUpdatePatch,
  ): Promise<PriceAlertRecord | null> {
    const row = await this.d1
      .prepare(UPDATE_SQL)
      .bind(
        patch.thresholdCents ?? null,
        patch.status ?? null,
        new Date().toISOString(),
        alertId,
        accountId,
      )
      .first<D1PriceAlertRow>();
    return row ? toContractAlert(row) : null;
  }

  /** @inheritdoc */
  async pause(accountId: number, alertId: number): Promise<PriceAlertRecord | null> {
    return this.update(accountId, alertId, { status: 'paused' });
  }

  /** @inheritdoc */
  async delete(accountId: number, alertId: number): Promise<boolean> {
    const result = await this.d1.prepare(DELETE_SQL).bind(alertId, accountId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }
}
