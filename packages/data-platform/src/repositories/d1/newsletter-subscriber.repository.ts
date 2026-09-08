/**
 * D1 NewsletterSubscriberRepository — double opt-in consent, independent
 * of accounts and of price-alert consent (task 1.4, change
 * trust-and-reach-roadmap), backed by the `newsletter_subscribers`
 * table (migration 0016). Implements the abstract contract from
 * abstracts.ts.
 *
 * Consent discipline: rows land PENDING with the SHA-256 digest of the
 * single-use confirmation token (the email_tokens convention — only the
 * hash is ever stored); only the emailed token confirms
 * (PENDING → ACTIVE, a guarded UPDATE) — unconfirmed rows are never
 * mailed. Unsubscribe is terminal: a second attempt matches no row.
 *
 * Address identity: the repository stores the address lowercased and
 * uniqueness is enforced in SQL on lower(email) (the
 * accounts_email_lower_idx precedent) — case variants of one address
 * are one subscriber, and a duplicate subscribe surfaces as
 * {@link DuplicateNewsletterSubscriptionError} (the API maps it to
 * 409 / a friendly "already subscribed"). The classification inspects
 * the SQLite constraint-violation message — both the real D1 binding
 * and the node:sqlite test harness surface the expression-index
 * violation with the same "UNIQUE constraint failed" text (the exact
 * quoted expression differs between the two, so both spellings are
 * matched).
 *
 * @module D1NewsletterSubscriberRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  DuplicateNewsletterSubscriptionError,
  NewsletterSubscriberRepository,
  type NewsletterSubscribeInput,
  type NewsletterSubscriberRecord,
  type NewsletterSubscriberStatus,
} from '../../abstracts';

const SUBSCRIBER_STATUSES: readonly NewsletterSubscriberStatus[] = [
  'PENDING',
  'ACTIVE',
  'UNSUBSCRIBED',
];

/** Raw D1 newsletter_subscribers row. */
interface D1NewsletterSubscriberRow {
  readonly id: number;
  readonly email: string;
  readonly status: string;
  readonly confirmation_token_hash: string;
  readonly confirmed_at: string | null;
  readonly unsubscribed_at: string | null;
  readonly created_at: string;
}

/** Narrow the varchar column onto the lifecycle union — defense in depth. */
function toStatus(value: string): NewsletterSubscriberStatus {
  if (!SUBSCRIBER_STATUSES.includes(value as NewsletterSubscriberStatus)) {
    throw new Error(
      `newsletter_subscribers.status "${value}" is not a known subscriber consent state`,
    );
  }
  return value as NewsletterSubscriberStatus;
}

function toContractSubscriber(
  row: D1NewsletterSubscriberRow,
): NewsletterSubscriberRecord {
  return {
    id: row.id,
    email: row.email,
    status: toStatus(row.status),
    confirmationTokenHash: row.confirmation_token_hash,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    unsubscribedAt:
      row.unsubscribed_at === null ? null : new Date(row.unsubscribed_at),
    createdAt: new Date(row.created_at),
  };
}

const SUBSCRIBER_COLUMNS = `
  id, email, status, confirmation_token_hash, confirmed_at, unsubscribed_at,
  created_at`;

const INSERT_SQL = `
  INSERT INTO newsletter_subscribers (email, confirmation_token_hash, status)
  VALUES (?, ?, 'PENDING')
  RETURNING ${SUBSCRIBER_COLUMNS}`;

const FIND_BY_ID_SQL = `
  SELECT ${SUBSCRIBER_COLUMNS} FROM newsletter_subscribers WHERE id = ?`;

// The lower(email) expression form resolves through the unique index
// (the index's own expression); the bind is JS-lowercased because the
// stored addresses are lowercase (SQL lower() is ASCII-only, the
// addresses are ASCII — identical result, applied at one layer).
const FIND_BY_EMAIL_SQL = `
  SELECT ${SUBSCRIBER_COLUMNS} FROM newsletter_subscribers
   WHERE lower(email) = lower(?)`;

const FIND_BY_TOKEN_HASH_SQL = `
  SELECT ${SUBSCRIBER_COLUMNS} FROM newsletter_subscribers
   WHERE confirmation_token_hash = ?`;

/** Guarded transitions — only a matching current state can move. */
const CONFIRM_SQL = `
  UPDATE newsletter_subscribers SET status = 'ACTIVE', confirmed_at = ?
   WHERE id = ? AND status = 'PENDING'
  RETURNING ${SUBSCRIBER_COLUMNS}`;

const UNSUBSCRIBE_SQL = `
  UPDATE newsletter_subscribers SET status = 'UNSUBSCRIBED', unsubscribed_at = ?
   WHERE id = ? AND status <> 'UNSUBSCRIBED'
  RETURNING ${SUBSCRIBER_COLUMNS}`;

const FIND_ACTIVE_SQL = `
  SELECT ${SUBSCRIBER_COLUMNS} FROM newsletter_subscribers
   WHERE status = 'ACTIVE'
   ORDER BY id ASC`;

/**
 * The table's only unique constraint is the lower(email) expression
 * index; SQLite names the violated expression rather than the table for
 * expression indexes, so both spellings are matched.
 */
function isUniqueViolationOnEmail(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    (error.message.includes('newsletter_subscribers') ||
      error.message.includes('lower(email)'))
  );
}

@Injectable()
export class D1NewsletterSubscriberRepository extends NewsletterSubscriberRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async subscribe(
    input: NewsletterSubscribeInput,
  ): Promise<NewsletterSubscriberRecord> {
    const email = input.email.toLowerCase();
    try {
      const row = await this.d1
        .prepare(INSERT_SQL)
        .bind(email, input.confirmationTokenHash)
        .first<D1NewsletterSubscriberRow>();
      if (!row) {
        throw new Error(
          'newsletter_subscribers INSERT .. RETURNING returned no row',
        );
      }
      return toContractSubscriber(row);
    } catch (error) {
      if (isUniqueViolationOnEmail(error)) {
        throw new DuplicateNewsletterSubscriptionError(email);
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async findById(id: number): Promise<NewsletterSubscriberRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1NewsletterSubscriberRow>();
    return row ? toContractSubscriber(row) : null;
  }

  /** @inheritdoc */
  async findByEmail(
    email: string,
  ): Promise<NewsletterSubscriberRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_EMAIL_SQL)
      .bind(email)
      .first<D1NewsletterSubscriberRow>();
    return row ? toContractSubscriber(row) : null;
  }

  /** @inheritdoc */
  async findByConfirmationTokenHash(
    tokenHash: string,
  ): Promise<NewsletterSubscriberRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_TOKEN_HASH_SQL)
      .bind(tokenHash)
      .first<D1NewsletterSubscriberRow>();
    return row ? toContractSubscriber(row) : null;
  }

  /** @inheritdoc */
  async confirm(
    id: number,
    confirmedAt: Date,
  ): Promise<NewsletterSubscriberRecord | null> {
    const row = await this.d1
      .prepare(CONFIRM_SQL)
      .bind(confirmedAt.toISOString(), id)
      .first<D1NewsletterSubscriberRow>();
    return row ? toContractSubscriber(row) : null;
  }

  /** @inheritdoc */
  async unsubscribe(
    id: number,
    unsubscribedAt: Date,
  ): Promise<NewsletterSubscriberRecord | null> {
    const row = await this.d1
      .prepare(UNSUBSCRIBE_SQL)
      .bind(unsubscribedAt.toISOString(), id)
      .first<D1NewsletterSubscriberRow>();
    return row ? toContractSubscriber(row) : null;
  }

  /** @inheritdoc */
  async findActive(): Promise<NewsletterSubscriberRecord[]> {
    const rows = (
      await this.d1.prepare(FIND_ACTIVE_SQL).all<D1NewsletterSubscriberRow>()
    ).results;
    return rows.map(toContractSubscriber);
  }
}
