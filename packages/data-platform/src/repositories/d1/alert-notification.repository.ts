/**
 * D1 AlertNotificationRepository — the delivery intent log behind
 * crash-safe price-alert emails (task 2.1, change
 * product-roadmap-phases-1-4). The caller (evaluation cron, task 2.2)
 * writes a PENDING intent row BEFORE dispatch and marks the outcome
 * AFTER, so a retried run that sees a row already marked delivered
 * skips the send — a crash mid-delivery can never double-send (spec:
 * crash-safe delivery).
 *
 * Marking is deliberately ONE-SHOT (`AND delivery_status = 'pending'`):
 * an outcome transition is recorded exactly once and never rewritten —
 * a delivered row cannot flip to failed, per the product-data-model
 * spec that notification rows are append-only delivery-attempt records.
 *
 * {@link findLatestDeliveredByAlertId} is the 24-hour cooldown's
 * enforcement read (design R2: cooldown recorded on the notification
 * row, enforced from the last DELIVERED notification) — it must live
 * here because task 2.2 cannot edit repositories.
 *
 * @module D1AlertNotificationRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Delivery channel — email only for MVP (design R2); the CHECK admits exactly this. */
export type AlertChannel = 'email';

/** Intent-log lifecycle. pending until dispatch resolves, then terminal. */
export type AlertDeliveryStatus = 'pending' | 'delivered' | 'failed';

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface AlertNotificationRecord {
  readonly id: number;
  readonly alertId: number;
  readonly observedPriceCents: number;
  readonly channel: AlertChannel;
  readonly deliveryStatus: AlertDeliveryStatus;
  readonly createdAt: Date;
  readonly markedAt: Date | null;
}

export interface AlertNotificationIntentInput {
  readonly alertId: number;
  /** Materialized price that met the threshold — frozen into the intent row. */
  readonly observedPriceCents: number;
  readonly channel: AlertChannel;
}

@Injectable()
export abstract class AlertNotificationRepository {
  /** Write the PENDING intent row (before dispatch). Created_at is the instant of intent. */
  abstract createIntent(
    input: AlertNotificationIntentInput,
  ): Promise<AlertNotificationRecord>;

  /** Mark delivered — one-shot; null when the row is absent or already left pending. */
  abstract markDelivered(notificationId: number): Promise<AlertNotificationRecord | null>;

  /** Mark failed — one-shot; null when the row is absent or already left pending. */
  abstract markFailed(notificationId: number): Promise<AlertNotificationRecord | null>;

  /**
   * Most recent DELIVERED notification for the alert (created_at DESC,
   * id DESC tie-break), or null when none was ever delivered — the
   * 24-hour cooldown is measured from this instant (design R2).
   */
  abstract findLatestDeliveredByAlertId(
    alertId: number,
  ): Promise<AlertNotificationRecord | null>;
}

/** Raw D1 alert_notifications row. */
interface D1AlertNotificationRow {
  readonly id: number;
  readonly alert_id: number;
  readonly observed_price_cents: number;
  readonly channel: string;
  readonly delivery_status: string;
  readonly created_at: string;
  readonly marked_at: string | null;
}

function toContractNotification(row: D1AlertNotificationRow): AlertNotificationRecord {
  return {
    id: row.id,
    alertId: row.alert_id,
    observedPriceCents: row.observed_price_cents,
    channel: row.channel as AlertChannel,
    deliveryStatus: row.delivery_status as AlertDeliveryStatus,
    createdAt: new Date(row.created_at),
    markedAt: row.marked_at === null ? null : new Date(row.marked_at),
  };
}

const NOTIFICATION_COLUMNS = `
  id, alert_id, observed_price_cents, channel, delivery_status, created_at, marked_at`;

// delivery_status/created_at come from the column defaults — an intent
// row is born pending at the instant of intent.
const INSERT_INTENT_SQL = `
  INSERT INTO alert_notifications (alert_id, observed_price_cents, channel)
  VALUES (?, ?, ?)
  RETURNING ${NOTIFICATION_COLUMNS}`;

// One-shot guard: only a pending row can leave pending, so a retried
// marking can neither flip delivered→failed nor resurrect a failed row.
const MARK_DELIVERED_SQL = `
  UPDATE alert_notifications SET delivery_status = 'delivered', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

const MARK_FAILED_SQL = `
  UPDATE alert_notifications SET delivery_status = 'failed', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

// Served by alert_notifications_alert_id_delivery_status_created_at_idx;
// the id tie-break keeps "latest" deterministic when sends share a
// timestamp (the (observedAt, id) DESC change-detection rule).
const FIND_LATEST_DELIVERED_SQL = `
  SELECT ${NOTIFICATION_COLUMNS} FROM alert_notifications
   WHERE alert_id = ? AND delivery_status = 'delivered'
   ORDER BY created_at DESC, id DESC
   LIMIT 1`;

@Injectable()
export class D1AlertNotificationRepository extends AlertNotificationRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async createIntent(
    input: AlertNotificationIntentInput,
  ): Promise<AlertNotificationRecord> {
    const row = await this.d1
      .prepare(INSERT_INTENT_SQL)
      .bind(input.alertId, input.observedPriceCents, input.channel)
      .first<D1AlertNotificationRow>();
    if (!row) {
      throw new Error('alert_notifications INSERT .. RETURNING returned no row');
    }
    return toContractNotification(row);
  }

  /** @inheritdoc */
  async markDelivered(notificationId: number): Promise<AlertNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_DELIVERED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1AlertNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async markFailed(notificationId: number): Promise<AlertNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_FAILED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1AlertNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async findLatestDeliveredByAlertId(
    alertId: number,
  ): Promise<AlertNotificationRecord | null> {
    const row = await this.d1
      .prepare(FIND_LATEST_DELIVERED_SQL)
      .bind(alertId)
      .first<D1AlertNotificationRow>();
    return row ? toContractNotification(row) : null;
  }
}
