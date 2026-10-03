/**
 * Contact-message retention cron tests (task 3.2, change
 * first-impression-pass; design D8, spec contact-intake "Retention is
 * bounded") — the 90-day window over the fake-D1 harness, with bounded
 * batch deletes (background-jobs spec: "Retention prunes in bounded
 * batches").
 *
 * @module ContactRetentionCronTest
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import {
  handleContactRetention,
  CONTACT_RETENTION_DAYS,
} from '../contact-retention';
import { openMigratedD1 } from '../../analytics/__tests__/fake-d1';
import { createLogger } from '../../logger';
import type { Env } from '../../env';

const LOG = createLogger('error');

const NOW = new Date('2026-10-01T03:30:00.000Z');
const DAY = 86_400_000;

function createEnv(): { env: Env; db: DatabaseSync } {
  const { db, d1 } = openMigratedD1();
  return { env: { DB: d1 } as unknown as Env, db };
}

function seedMessage(
  db: DatabaseSync,
  id: number,
  createdAt: Date,
): void {
  db.prepare(
    `INSERT INTO contact_messages (id, message, topic, reply_email, locale, ip_hash, created_at)
     VALUES (?, ?, 'other', NULL, 'fi', ?, ?)`,
  ).run(id, `Viesti ${id}`, 'a'.repeat(64), createdAt.toISOString());
}

function rowIds(db: DatabaseSync): number[] {
  return (
    db.prepare('SELECT id FROM contact_messages ORDER BY id').all() as {
      id: number;
    }[]
  ).map((row) => row.id);
}

describe('handleContactRetention', () => {
  it('deletes messages older than 90 days and keeps fresher ones', async () => {
    const { env, db } = createEnv();
    seedMessage(db, 1, new Date(+NOW - 91 * DAY));
    seedMessage(db, 2, new Date(+NOW - 90 * DAY - 60_000));
    seedMessage(db, 3, new Date(+NOW - 89 * DAY));

    const result = await handleContactRetention(env, LOG, { now: NOW });

    expect(result.deleted).toBe(2);
    expect(result.cutoffIso).toBe(new Date(+NOW - 90 * DAY).toISOString());
    expect(rowIds(db)).toEqual([3]);
  });

  it('pins the window at the spec value (90 days), not a var', async () => {
    expect(CONTACT_RETENTION_DAYS).toBe(90);
    const { env, db } = createEnv();
    seedMessage(db, 1, new Date(+NOW - 91 * DAY));

    const result = await handleContactRetention(env, LOG, { now: NOW });

    expect(result.deleted).toBe(1);
  });

  it('deletes in multiple bounded batches when more rows are past the cutoff than one batch allows', async () => {
    const { env, db } = createEnv();
    for (let i = 1; i <= 7; i++) {
      seedMessage(db, i, new Date(+NOW - (100 + i) * DAY));
    }

    const result = await handleContactRetention(env, LOG, {
      now: NOW,
      batchSize: 2,
    });

    expect(result.deleted).toBe(7);
    expect(result.batchSize).toBe(2);
    expect(rowIds(db)).toEqual([]);
  });

  it('is idempotent — a second sweep over a clean table deletes nothing', async () => {
    const { env, db } = createEnv();
    seedMessage(db, 1, new Date(+NOW - 200 * DAY));

    await handleContactRetention(env, LOG, { now: NOW });
    const second = await handleContactRetention(env, LOG, { now: NOW });

    expect(second.deleted).toBe(0);
    expect(rowIds(db)).toEqual([]);
  });
});
