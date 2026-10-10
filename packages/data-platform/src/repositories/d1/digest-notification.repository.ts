/**
 * D1 DigestNotificationRepository — the delivery intent log behind the
 * weekly preference digest (task 1.3, change
 * add-onboarding-preferences; design D4/D5). Mirrors the
 * alert-notification contract: the caller (digest cron, task 4.2)
 * writes a PENDING intent row BEFORE dispatch and marks the outcome
 * AFTER, and the (account_id, digest_week) UNIQUE index is both the
 * idempotent-create guard and the crash re-entry read — a re-run sweep
 * whose intent row already exists gets DuplicateDigestIntentError (the
 * "skip" outcome) or finds the row via {@link findByAccountAndWeek}, so
 * a crash mid-delivery can never double-send.
 *
 * Marking is deliberately ONE-SHOT (`AND delivery_status = 'pending'`):
 * an outcome transition is recorded exactly once and never rewritten —
 * a delivered row cannot flip to failed, per the alert-notification
 * precedent that delivery rows are append-only attempt records.
 *
 * The abstract class is co-located with the single concrete
 * implementation (the account-favorite precedent) — there is no pg
 * counterpart for this table, so no abstracts.ts contract exists to
 * extend.
 *
 * @module D1DigestNotificationRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/** Delivery channel — email only; the schema CHECK admits exactly this. */
export type DigestChannel = 'email';

/** Intent-log lifecycle. pending until dispatch resolves, then terminal. */
export type DigestDeliveryStatus = 'pending' | 'delivered' | 'failed';

/** Contract row — camelCase projection of the snake_case D1 row. */
export interface DigestNotificationRecord {
  readonly id: number;
  readonly accountId: number;
  /** ISO week key the digest covers (e.g. '2026-W41'), computed at sweep start. */
  readonly digestWeek: string;
  readonly channel: DigestChannel;
  readonly deliveryStatus: DigestDeliveryStatus;
  readonly createdAt: Date;
  readonly markedAt: Date | null;
}

export interface DigestNotificationIntentInput {
  readonly accountId: number;
  readonly digestWeek: string;
  readonly channel: DigestChannel;
}

/**
 * Thrown by createIntent when an intent row for the (account, week)
 * pair already exists — the migration 0032 UNIQUE index as the
 * idempotency guard (design D5); the caller treats it as SKIP (the
 * sweep already ran for this account-week) rather than a failure.
 */
export class DuplicateDigestIntentError extends Error {
  constructor(readonly accountId: number, readonly digestWeek: string) {
    super(
      `digest intent for account ${accountId} week ${digestWeek} already exists — ` +
        'one intent per (account, digest_week); treat as skip',
    );
    this.name = 'DuplicateDigestIntentError';
  }
}

/** Digest delivery intent contract (design D4/D5), consumed by the digest cron (task 4.2). */
@Injectable()
export abstract class DigestNotificationRepository {
  /**
   * The one intent row for the (account, week) pair, or null — the
   * crash re-entry read: a pending row means a previous run died
   * between intent and mark; a delivered row means the digest went out.
   */
  abstract findByAccountAndWeek(
    accountId: number,
    digestWeek: string,
  ): Promise<DigestNotificationRecord | null>;

  /** Write the PENDING intent row (before dispatch). Created_at is the instant of intent. */
  abstract createIntent(
    input: DigestNotificationIntentInput,
  ): Promise<DigestNotificationRecord>;

  /** Mark delivered — one-shot; null when the row is absent or already left pending. */
  abstract markDelivered(notificationId: number): Promise<DigestNotificationRecord | null>;

  /** Mark failed — one-shot; null when the row is absent or already left pending. */
  abstract markFailed(notificationId: number): Promise<DigestNotificationRecord | null>;
}

/** Raw D1 digest_notifications row. */
interface D1DigestNotificationRow {
  readonly id: number;
  readonly account_id: number;
  readonly digest_week: string;
  readonly channel: string;
  readonly delivery_status: string;
  readonly created_at: string;
  readonly marked_at: string | null;
}

function toContractNotification(row: D1DigestNotificationRow): DigestNotificationRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    digestWeek: row.digest_week,
    channel: row.channel as DigestChannel,
    deliveryStatus: row.delivery_status as DigestDeliveryStatus,
    createdAt: new Date(row.created_at),
    markedAt: row.marked_at === null ? null : new Date(row.marked_at),
  };
}

const NOTIFICATION_COLUMNS = `
  id, account_id, digest_week, channel, delivery_status, created_at, marked_at`;

// delivery_status/created_at come from the column defaults — an intent
// row is born pending at the instant of intent.
const INSERT_INTENT_SQL = `
  INSERT INTO digest_notifications (account_id, digest_week, channel)
  VALUES (?, ?, ?)
  RETURNING ${NOTIFICATION_COLUMNS}`;

// One-shot guard: only a pending row can leave pending, so a retried
// marking can neither flip delivered→failed nor resurrect a failed row.
const MARK_DELIVERED_SQL = `
  UPDATE digest_notifications SET delivery_status = 'delivered', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

const MARK_FAILED_SQL = `
  UPDATE digest_notifications SET delivery_status = 'failed', marked_at = ?
   WHERE id = ? AND delivery_status = 'pending'
  RETURNING ${NOTIFICATION_COLUMNS}`;

// Served by digest_notifications_account_id_digest_week_unique — the
// composite UNIQUE index doubles as the re-entry lookup (design D5).
const FIND_BY_ACCOUNT_AND_WEEK_SQL = `
  SELECT ${NOTIFICATION_COLUMNS} FROM digest_notifications
   WHERE account_id = ? AND digest_week = ?`;

/** Narrow the constraint failure onto this table's pair index — the account-favorite precedent. */
function isUniqueViolationOnDigestPair(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('digest_notifications')
  );
}

@Injectable()
export class D1DigestNotificationRepository extends DigestNotificationRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async findByAccountAndWeek(
    accountId: number,
    digestWeek: string,
  ): Promise<DigestNotificationRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ACCOUNT_AND_WEEK_SQL)
      .bind(accountId, digestWeek)
      .first<D1DigestNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async createIntent(
    input: DigestNotificationIntentInput,
  ): Promise<DigestNotificationRecord> {
    try {
      const row = await this.d1
        .prepare(INSERT_INTENT_SQL)
        .bind(input.accountId, input.digestWeek, input.channel)
        .first<D1DigestNotificationRow>();
      if (!row) {
        throw new Error(
          'digest_notifications INSERT .. RETURNING returned no row',
        );
      }
      return toContractNotification(row);
    } catch (error) {
      if (isUniqueViolationOnDigestPair(error)) {
        throw new DuplicateDigestIntentError(input.accountId, input.digestWeek);
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async markDelivered(notificationId: number): Promise<DigestNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_DELIVERED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1DigestNotificationRow>();
    return row ? toContractNotification(row) : null;
  }

  /** @inheritdoc */
  async markFailed(notificationId: number): Promise<DigestNotificationRecord | null> {
    const row = await this.d1
      .prepare(MARK_FAILED_SQL)
      .bind(new Date().toISOString(), notificationId)
      .first<D1DigestNotificationRow>();
    return row ? toContractNotification(row) : null;
  }
}
