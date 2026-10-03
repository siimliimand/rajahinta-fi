/**
 * D1 ContactMessageRepository — the operator-read contact intake
 * (task 3.2, change first-impression-pass, design D8), backed by the
 * `contact_messages` table (migration 0024). Implements the abstract
 * contract from abstracts.ts.
 *
 * Write-once rows with no account link: the caller supplies the salted
 * IP hash (this layer never sees a raw address — the email_tokens
 * convention applied to IP forensics) and there is no update path.
 * Reads are the operator's documented wrangler SQL, newest-first on the
 * created_at index — no repository read method exists because no code
 * consumes one. The delete is the retention sweep's bounded batch loop
 * (the D1CalculationRecordRetentionService shape): rowid-subquery
 * DELETEs until a batch comes back short, so at-least-once cron
 * delivery and retries stay idempotent.
 *
 * @module D1ContactMessageRepository
 */
import { Injectable } from '@nestjs/common';
import {
  ContactMessageRepository,
  type ContactMessageInsertInput,
  type ContactMessageRecord,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 contact_messages row. */
interface D1ContactMessageRow {
  readonly id: number;
  readonly message: string;
  readonly topic: string;
  readonly reply_email: string | null;
  readonly locale: string;
  readonly ip_hash: string;
  readonly created_at: string;
}

const CONTACT_TOPICS: readonly ContactMessageRecord['topic'][] = [
  'product_error',
  'store_inquiry',
  'other',
];

/** Narrow the varchar column onto the topic union — defense in depth. */
function toTopic(value: string): ContactMessageRecord['topic'] {
  if (!CONTACT_TOPICS.includes(value as ContactMessageRecord['topic'])) {
    throw new Error(
      `contact_messages.topic "${value}" is not a known intake topic`,
    );
  }
  return value as ContactMessageRecord['topic'];
}

function toContractMessage(row: D1ContactMessageRow): ContactMessageRecord {
  return {
    id: row.id,
    message: row.message,
    topic: toTopic(row.topic),
    replyEmail: row.reply_email,
    locale: row.locale,
    ipHash: row.ip_hash,
    createdAt: new Date(row.created_at),
  };
}

const INSERT_SQL = `
  INSERT INTO contact_messages (message, topic, reply_email, locale, ip_hash)
  VALUES (?, ?, ?, ?, ?)
  RETURNING id, message, topic, reply_email, locale, ip_hash, created_at`;

// DELETE .. LIMIT is not compiled into every SQLite build (D1 included),
// so the batch selects rowids first — the retention-service shape.
const DELETE_BATCH_SQL = `
  DELETE FROM contact_messages
   WHERE rowid IN (
     SELECT rowid FROM contact_messages
      WHERE created_at < ?
      LIMIT ?
   )`;

@Injectable()
export class D1ContactMessageRepository extends ContactMessageRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async insert(
    input: ContactMessageInsertInput,
  ): Promise<ContactMessageRecord> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(
        input.message,
        input.topic,
        input.replyEmail,
        input.locale,
        input.ipHash,
      )
      .first<D1ContactMessageRow>();
    if (!row) {
      throw new Error('contact_messages INSERT .. RETURNING returned no row');
    }
    return toContractMessage(row);
  }

  /** @inheritdoc */
  async deleteCreatedBefore(
    cutoff: Date,
    batchSize: number,
  ): Promise<number> {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
      throw new RangeError(
        `batchSize must be a positive integer, got ${batchSize}`,
      );
    }

    let deleted = 0;
    for (;;) {
      const result = await this.d1
        .prepare(DELETE_BATCH_SQL)
        .bind(cutoff.toISOString(), batchSize)
        .run();
      const changes = Number(result.meta.changes ?? 0);
      deleted += changes;
      // A short batch means the cutoff predicate matched nothing left —
      // each full batch strictly shrinks the table, so this terminates.
      if (changes < batchSize) {
        break;
      }
    }
    return deleted;
  }
}
