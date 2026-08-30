/**
 * D1 ClickCounterSnapshotRepository — the Cloudflare-side implementation
 * of the abstract {@link ClickCounterSnapshotRepository} contract (task
 * 2.5, change migrate-to-cloudflare), backed by the
 * `click_counter_snapshots` table — the D1 archive the ClickCounterDO
 * alarm flush writes (design D5). Signatures and result shapes match the
 * pg DrizzleClickCounterSnapshotRepository exactly.
 *
 * The batch upsert converges on the (merchant_id, url, captured_at)
 * unique key — a re-run of the same capture instant overwrites the count
 * via `excluded.click_count` instead of duplicating rows. Row ids are
 * rowid-aliased, so SQLite assigns them (pg serial equivalent).
 *
 * @module D1ClickCounterSnapshotRepository
 */
import { Injectable } from '@nestjs/common';
import { ClickCounterSnapshotRepository } from '../../abstracts';
import { clickCounterSnapshots } from '../../schema';
import type { D1DatabaseLike } from '../../d1/executor';

type SnapshotInsert = Omit<typeof clickCounterSnapshots.$inferInsert, 'id'>;

const UPSERT_BATCH_SQL = `
  INSERT INTO click_counter_snapshots (merchant_id, url, click_count, captured_at)
  VALUES `;

const UPSERT_CONFLICT_SQL = `
  ON CONFLICT (merchant_id, url, captured_at) DO UPDATE SET
    click_count = excluded.click_count`;

@Injectable()
export class D1ClickCounterSnapshotRepository extends ClickCounterSnapshotRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Upsert one batch of snapshot rows sharing a capture instant. Returns
   * the number of rows written — inserted or overwritten, exactly the
   * rows the pg RETURNING clause counted.
   */
  async appendBatch(rows: SnapshotInsert[]): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    // One multi-row statement with per-row COALESCE on captured_at so a
    // row relying on the column default gets the current instant, the
    // same value drizzle's timestamp default produced on pg.
    const now = new Date().toISOString();
    const valuesClauses: string[] = [];
    const params: unknown[] = [];
    for (const row of rows) {
      valuesClauses.push('(?, ?, ?, COALESCE(?, ?))');
      params.push(
        row.merchantId,
        row.url,
        row.clickCount,
        row.capturedAt?.toISOString() ?? null,
        now,
      );
    }

    const result = await this.d1
      .prepare(`${UPSERT_BATCH_SQL}${valuesClauses.join(', ')}${UPSERT_CONFLICT_SQL}`)
      .bind(...params)
      .run();
    const changes = result.meta.changes;
    if (typeof changes !== 'number') {
      throw new Error('click_counter_snapshots batch upsert returned no change count');
    }
    return changes;
  }
}
