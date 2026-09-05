/**
 * D1 PriceAlertRepository — watchlist threshold alerts (task 2.1, change
 * product-roadmap-phases-1-4). CRUD over `price_alerts` with account
 * scoping on every mutation: an alert id belonging to another account
 * matches no row instead of deleting/updating cross-account (the
 * saved-scenario delete precedent). ISO-8601 TEXT instants convert to
 * Date at the repository boundary (design D2).
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

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface PriceAlertRecord {
  readonly id: number;
  readonly accountId: number;
  readonly productId: number;
  readonly thresholdCents: number;
  readonly status: PriceAlertStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PriceAlertCreateInput {
  readonly accountId: number;
  readonly productId: number;
  readonly thresholdCents: number;
}

/** Partial patch — absent keys keep their current values. */
export interface PriceAlertUpdatePatch {
  readonly thresholdCents?: number;
  readonly status?: PriceAlertStatus;
}

/**
 * Watchlist threshold management contract (spec: price-alerts), shared
 * by the CRUD API (task 2.3) and the evaluation cron (task 2.2).
 */
@Injectable()
export abstract class PriceAlertRepository {
  /** Create an active alert for (account, product). Rejects on the (account, product) unique constraint. */
  abstract create(input: PriceAlertCreateInput): Promise<PriceAlertRecord>;

  /** All of one account's alerts, deterministic order. */
  abstract findByAccountId(accountId: number): Promise<PriceAlertRecord[]>;

  /** Every active alert across accounts — the evaluation cron's scan set. */
  abstract findActive(): Promise<PriceAlertRecord[]>;

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
  readonly threshold_cents: number;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function toContractAlert(row: D1PriceAlertRow): PriceAlertRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    thresholdCents: row.threshold_cents,
    status: row.status as PriceAlertStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const ALERT_COLUMNS = `
  id, account_id, product_id, threshold_cents, status, created_at, updated_at`;

const INSERT_SQL = `
  INSERT INTO price_alerts (account_id, product_id, threshold_cents)
  VALUES (?, ?, ?)
  RETURNING ${ALERT_COLUMNS}`;

const FIND_BY_ACCOUNT_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts WHERE account_id = ? ORDER BY id`;

const FIND_ACTIVE_SQL = `
  SELECT ${ALERT_COLUMNS} FROM price_alerts WHERE status = 'active' ORDER BY id`;

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
  async create(input: PriceAlertCreateInput): Promise<PriceAlertRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(input.accountId, input.productId, input.thresholdCents)
      .first<D1PriceAlertRow>();
    if (!row) {
      throw new Error('price_alerts INSERT .. RETURNING returned no row');
    }
    return toContractAlert(row);
  }

  /** @inheritdoc */
  async findByAccountId(accountId: number): Promise<PriceAlertRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_BY_ACCOUNT_SQL).bind(accountId).all<D1PriceAlertRow>()
    ).results;
    return rows.map(toContractAlert);
  }

  /** @inheritdoc */
  async findActive(): Promise<PriceAlertRecord[]> {
    const rows = (
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
