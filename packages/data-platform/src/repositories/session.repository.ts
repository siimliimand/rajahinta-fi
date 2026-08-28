/**
 * Drizzle SessionRepository — concrete implementation of the abstract
 * SessionRepository class backed by the sessions table.
 *
 * Handles token hashes only; minting raw tokens is the application
 * layer's SessionTokenService job. Rotation is a single transaction so
 * a crash can never leave both old and new tokens valid.
 *
 * @module DrizzleSessionRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  SessionRepository,
  type SessionRecord,
} from '../abstracts';
import { sessions } from '../schema';

/** Unrevoked and unexpired — the only state that authenticates. */
function activePredicate() {
  return and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()));
}

@Injectable()
export class DrizzleSessionRepository extends SessionRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async create(record: typeof sessions.$inferInsert): Promise<SessionRecord> {
    const [row] = await this.db.insert(sessions).values(record).returning();
    return row;
  }

  /** @inheritdoc */
  async findActiveByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), activePredicate()))
      .limit(1);
    return row ?? null;
  }

  /** @inheritdoc */
  async rotate(
    tokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRecord | null> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(sessions)
        .where(and(eq(sessions.tokenHash, tokenHash), activePredicate()))
        .limit(1);
      if (!current) {
        return null;
      }

      // Successor first, then revoke the predecessor — both inside the
      // transaction, so the switch is all-or-nothing.
      const [successor] = await tx
        .insert(sessions)
        .values({
          tokenHash: newTokenHash,
          accountId: current.accountId,
          rotatedFromId: current.id,
          expiresAt,
        })
        .returning();

      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.id, current.id));

      return successor;
    });
  }

  /** @inheritdoc */
  async revokeByTokenHash(tokenHash: string): Promise<boolean> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, tokenHash), activePredicate()))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  /** @inheritdoc */
  async deleteExpiredBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, cutoff))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
