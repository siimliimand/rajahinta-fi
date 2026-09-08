/**
 * D1 ShareSnapshotRepository — frozen copies of a calculation result
 * behind unguessable public ids (task 1.4, change
 * trust-and-reach-roadmap), backed by the `share_snapshots` table
 * (migration 0016). Implements the abstract contract from abstracts.ts.
 *
 * Write-once: the frozen copy is immutable and self-contained (no
 * account identifiers — there is no account FK and no retention
 * exception), so there is deliberately no update method and no
 * account-scoped read — only create, the public /share/:publicId
 * lookup, and the 12-month hygiene sweep's deleteOlderThan.
 *
 * The public id must be exactly 22 characters: the repository fails
 * fast with a clear error (a generator bug is a caller bug, not a row)
 * and the schema CHECK `length(public_id) = 22` is the backstop. A
 * public-id collision (unique index) is astronomically unlikely and
 * propagates as a raw constraint error — the generator retries with a
 * fresh id above this layer.
 *
 * @module D1ShareSnapshotRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';
import {
  ShareSnapshotRepository,
  type ShareSnapshotCreateInput,
  type ShareSnapshotRecord,
} from '../../abstracts';

/** The schema CHECK pins the documented generator output length. */
const PUBLIC_ID_LENGTH = 22;

/** Raw D1 share_snapshots row. */
interface D1ShareSnapshotRow {
  readonly id: number;
  readonly public_id: string;
  readonly frozen_result: string;
  readonly created_at: string;
}

function toContractSnapshot(row: D1ShareSnapshotRow): ShareSnapshotRecord {
  return {
    id: row.id,
    publicId: row.public_id,
    frozenResult: JSON.parse(row.frozen_result) as unknown,
    createdAt: new Date(row.created_at),
  };
}

const SNAPSHOT_COLUMNS = `id, public_id, frozen_result, created_at`;

const INSERT_SQL = `
  INSERT INTO share_snapshots (public_id, frozen_result)
  VALUES (?, ?)
  RETURNING ${SNAPSHOT_COLUMNS}`;

const FIND_BY_PUBLIC_ID_SQL = `
  SELECT ${SNAPSHOT_COLUMNS} FROM share_snapshots WHERE public_id = ?`;

/** Strictly older than the cutoff — the sweep never eats a same-instant snapshot. */
const DELETE_OLDER_THAN_SQL = `
  DELETE FROM share_snapshots WHERE created_at < ?`;

@Injectable()
export class D1ShareSnapshotRepository extends ShareSnapshotRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: ShareSnapshotCreateInput): Promise<ShareSnapshotRecord> {
    if (input.publicId.length !== PUBLIC_ID_LENGTH) {
      throw new Error(
        `share snapshot public id must be exactly ${PUBLIC_ID_LENGTH} characters, ` +
          `got ${input.publicId.length} — a generator bug, not a snapshot`,
      );
    }
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(input.publicId, JSON.stringify(input.frozenResult))
      .first<D1ShareSnapshotRow>();
    if (!row) {
      throw new Error('share_snapshots INSERT .. RETURNING returned no row');
    }
    return toContractSnapshot(row);
  }

  /** @inheritdoc */
  async findByPublicId(publicId: string): Promise<ShareSnapshotRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_PUBLIC_ID_SQL)
      .bind(publicId)
      .first<D1ShareSnapshotRow>();
    return row ? toContractSnapshot(row) : null;
  }

  /** @inheritdoc */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.d1
      .prepare(DELETE_OLDER_THAN_SQL)
      .bind(cutoff.toISOString())
      .run();
    return Number(result.meta.changes ?? 0);
  }
}
