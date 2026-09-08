/**
 * D1 NewsletterNotificationRepository — the delivery intent log behind
 * crash-safe newsletter sends (task 5.3, change
 * trust-and-reach-roadmap, design D4), backed by the
 * `newsletter_notifications` table (migration 0017). The abstract class
 * and concrete implementation are co-located here (the
 * alert-notification.repository precedent; no pg counterpart).
 *
 * The caller (the ops notify-subscribers action) writes a PENDING
 * intent row BEFORE dispatch and marks the outcome AFTER, so a retried
 * action that sees a subscriber already marked delivered skips the
 * send — a crash mid-batch can never double-send (spec
 * content-publication: crash-safe send).
 *
 * Marking is deliberately ONE-SHOT (`AND delivery_status = 'pending'`):
 * an outcome transition is recorded exactly once and never rewritten —
 * a delivered row cannot flip to failed, per the product-data-model
 * spec that notification rows are append-only delivery-attempt records.
 *
 * {@link findLatestDeliveredBySubscriberId} is the redelivery
 * cooldown's enforcement read: a retried action measures from the
 * latest DELIVERED intent per subscriber, so only subscribers whose
 * last delivery is old enough are re-emailed.
 *
 * @module D1NewsletterNotificationRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Delivery channel — email only (the newsletter has no other channel). */
export type NewsletterChannel = 'email';

/** Intent-log lifecycle. pending until dispatch resolves, then terminal. */
export type NewsletterDeliveryStatus = 'pending' | 'delivered' | 'failed';

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface NewsletterNotificationRecord {
  readonly id: number;
  readonly subscriberId: number;
  readonly channel: NewsletterChannel;
  readonly deliveryStatus: NewsletterDeliveryStatus;
  readonly createdAt: Date;
  readonly markedAt: Date | null;
}

export interface NewsletterNotificationIntentInput {
  readonly subscriberId: number;
  readonly channel: NewsletterChannel;
}

@Injectable()
export abstract class NewsletterNotificationRepository {
  /** Write the PENDING intent row (before dispatch). Created_at is the instant of intent. */
  abstract createIntent(
    input: NewsletterNotificationIntentInput,
  ): Promise<NewsletterNotificationRecord>;

  /** Mark delivered — one-shot; null when the row is absent or already left pending. */
  abstract markDelivered(
    notificationId: number,
  ): Promise<NewsletterNotificationRecord | null>;

  /** Mark failed — one-shot; null when the row is absent or already left pending. */
  abstract markFailed(
    notificationId: number,
  ): Promise<NewsletterNotificationRecord | null>;

  /**
   * Most recent DELIVERED intent for the subscriber (created_at DESC,
   * id DESC tie-break), or null when none was ever delivered — the
   * redelivery cooldown is measured from this instant (the alert
   * cooldown's design-R2 rule, applied to the newsletter audience).
   */
  abstract findLatestDeliveredBySubscriberId(
    subscriberId: number,
  ): Promise<NewsletterNotificationRecord | null>;
}

/** Raw D1 newsletter_notifications row. */
interface D1NewsletterNotificationRow {
  readonly id: number;
  readonly subscriber_id: number;
  readonly channel: string;
  readonly delivery_status: string;
  readonly created_at: string;
  readonly marked_at: string | null;
}

function toContractNotification(
  row: D1NewsletterNotificationRow,
): NewsletterNotificationRecord {
  return {
    id: row.id,
    subscriberId: row.subscriber_id,
    channel: row.channel as NewsletterChannel,
    deliveryStatus: row.delivery_status as NewsletterDeliveryStatus,
    createdAt: new Date(row.created_at),
    markedAt: row.marked_at === null ? null : new Date(row.marked_at),
  };
}

const NOTIFICATION_COLUMNS = `
  id, subscriber_id, channel, delivery_status, created_at, marked_at`;

// delivery_status/created_at come from the column defaults — an intent
// row is born pending at the instant of intent.
const INSERT_INTENT_SQL = `
  INSERT INTO newsletter_notifications (subscriber_id, channel)
  VALUES (?, ?)
  RETURNING ${NOTIFICATION_COLUMNS}`;

// One-shot guard: only a pending row can leave pending, so a retried
// marking can neither flip delivered→failed nor resurrect a failed row.
const MARK_DELIVERED_SQL = `
  UPDATE newsletter_notifications SET delivery_status = 'delivered', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

const MARK_FAILED_SQL = `
  UPDATE newsletter_notifications SET delivery_status = 'failed', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

// Served by
// newsletter_notifications_subscriber_id_delivery_status_created_at_idx;
// the id tie-break keeps "latest" deterministic when sends share a
// timestamp (the alert-notification rule).
const FIND_LATEST_DELIVERED_SQL = `
  SELECT ${NOTIFICATION_COLUMNS} FROM newsletter_notifications
   WHERE subscriber_id = ? AND delivery_status = 'delivered'
   ORDER BY created_at DESC, id DESC
   LIMIT 1`;

@Injectable()
export class D1NewsletterNotificationRepository extends NewsletterNotificationRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async createIntent(
    input: NewsletterNotificationIntentInput,
  ): Promise<NewsletterNotificationRecord> {
    const row = await this.d1
      .prepare(INSERT_INTENT_SQL)
      .bind(input.subscriberId, input.channel)
      .first<D1NewsletterNotificationRow>();
    if (!row) {
      throw new Error(
        'newsletter_notifications INSERT .. RETURNING returned no row',
      );
    }
    return toContractNotification(row);
  }

  /** @inheritdoc */
  async markDelivered(
    notificationId: number,
  ): Promise<NewsletterNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_DELIVERED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1NewsletterNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async markFailed(
    notificationId: number,
  ): Promise<NewsletterNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_FAILED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1NewsletterNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async findLatestDeliveredBySubscriberId(
    subscriberId: number,
  ): Promise<NewsletterNotificationRecord | null> {
    const row = await this.d1
      .prepare(FIND_LATEST_DELIVERED_SQL)
      .bind(subscriberId)
      .first<D1NewsletterNotificationRow>();
    return row ? toContractNotification(row) : null;
  }
}
