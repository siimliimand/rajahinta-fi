/**
 * Drizzle ClickCounterSnapshotRepository — concrete implementation of
 * the abstract ClickCounterSnapshotRepository class backed by the
 * click_counter_snapshots table.
 *
 * @module DrizzleClickCounterSnapshotRepository
 */
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDatabase } from '../db/drizzle.provider';
import {
  ClickCounterSnapshotRepository,
} from '../abstracts';
import { clickCounterSnapshots } from '../schema';

@Injectable()
export class DrizzleClickCounterSnapshotRepository extends ClickCounterSnapshotRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDatabase,
  ) {
    super();
  }

  /** @inheritdoc */
  async appendBatch(
    rows: Omit<typeof clickCounterSnapshots.$inferInsert, 'id'>[],
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }
    const written = await this.db
      .insert(clickCounterSnapshots)
      .values(rows)
      .onConflictDoUpdate({
        // Same capture instant re-run converges — the fresh count wins.
        target: [
          clickCounterSnapshots.merchantId,
          clickCounterSnapshots.url,
          clickCounterSnapshots.capturedAt,
        ],
        set: { clickCount: sql`excluded.click_count` },
      })
      .returning({ id: clickCounterSnapshots.id });
    return written.length;
  }
}
