/**
 * D1 CorrectionRepository — the durable implementation of the
 * application-api `ICorrectionRepository` port (task 1.2, change
 * durable-corrections-store), backed by the `corrections` table landed
 * in task 1.1 (migration 0040).
 *
 * The port and its CorrectionItem DTO live in application-api
 * (packages/application-api/src/correction/), which data-platform does
 * not depend on — the dependency edge points the other way, and the
 * D1TaxRateRepository precedent (method signatures and result shapes
 * match the reference adapter exactly) applies: the shapes below mirror
 * the application-api port/DTO one-to-one and the Worker composition
 * root assigns this class where `ICorrectionRepository` is expected
 * (module.ts: "swap the in-memory store for DrizzleCorrectionRepository
 * from @rajahinta/data-platform"), so TypeScript's structural check
 * pins the equivalence at that assignment site.
 *
 * Semantics are ported exactly from the reference
 * InMemoryCorrectionRepository
 * (packages/application-api/src/correction/in-memory-correction.repository.ts):
 * `create` stamps status 'open' with null resolution fields, `findAll`
 * returns every row (open AND resolved) newest first, and `resolve`
 * rewrites status/resolution/resolved_at in one UPDATE — a re-resolve
 * rewrites the same values and returns the row (idempotent), an unknown
 * id returns null.
 *
 * CorrectionItem carries ISO-8601 TEXT directly (no ISO → Date boundary
 * conversion like the governance port), so the mapper is a pure
 * snake_case → camelCase rename with the CHECK-pinned union casts.
 *
 * @module D1CorrectionRepository
 */
import { Injectable } from '@nestjs/common';
import type { D1DatabaseLike } from '../../d1/executor';

/**
 * Mirror of the application-api `CorrectionItem` wire DTO
 * (packages/application-api/src/correction/correction.dto.ts) — keep
 * structurally identical.
 */
export interface CorrectionItem {
  /** Unique correction flag identifier. */
  readonly id: number;
  /** The kind of target being flagged. */
  readonly targetType: 'calculation' | 'data_point';
  /** Identifier of the target record. */
  readonly targetId: number;
  /** Human-readable reason supplied at creation time. */
  readonly reason: string;
  /** Current review status. */
  readonly status: 'open' | 'resolved';
  /** ISO-8601 timestamp of flag creation. */
  readonly createdAt: string;
  /** ISO-8601 timestamp of resolution, null while open. */
  readonly resolvedAt: string | null;
  /** Resolution notes recorded when the flag was closed, null while open. */
  readonly resolution: string | null;
}

/**
 * Mirror of the application-api `ICorrectionRepository` port
 * (packages/application-api/src/correction/correction-repository.port.ts)
 * — keep structurally identical.
 */
export interface ICorrectionRepository {
  /** Persist a new correction flag (id is assigned by the repository). */
  create(data: {
    targetType: 'calculation' | 'data_point';
    targetId: number;
    reason: string;
  }): Promise<CorrectionItem>;

  /** Retrieve all correction flags, createdAt descending (newest first). */
  findAll(): Promise<CorrectionItem[]>;

  /**
   * Resolve a correction flag by setting its status to 'resolved'.
   * Returns the updated flag, or null if not found.
   */
  resolve(id: number, resolution: string): Promise<CorrectionItem | null>;
}

/** Raw D1 corrections row (snake_case columns). */
interface D1CorrectionRow {
  readonly id: number;
  readonly target_type: string;
  readonly target_id: number;
  readonly reason: string;
  readonly status: string;
  readonly resolution: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

/** The one mapping point: snake_case TEXT row → wire DTO (ISO stays ISO). */
function toCorrectionItem(row: D1CorrectionRow): CorrectionItem {
  return {
    id: row.id,
    // The migration's CHECK constraints pin both value sets to the
    // DTO unions, so the boundary cast is exhaustive.
    targetType: row.target_type as CorrectionItem['targetType'],
    targetId: row.target_id,
    reason: row.reason,
    status: row.status as CorrectionItem['status'],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
  };
}

const CORRECTION_COLUMNS = `
  id, target_type, target_id, reason, status, resolution, created_at, resolved_at`;

const INSERT_SQL = `
  INSERT INTO corrections (target_type, target_id, reason, created_at)
  VALUES (?, ?, ?, ?)
  RETURNING ${CORRECTION_COLUMNS}`;

// findAll serves the console's full queue view: open AND resolved rows.
// created_at DESC mirrors the reference's newest-first (insertion-order
// reverse); id DESC is the same-instant tiebreak the reverse order gives
// there (later insert first).
const FIND_ALL_SQL = `
  SELECT ${CORRECTION_COLUMNS} FROM corrections
  ORDER BY created_at DESC, id DESC`;

// One UPDATE does the whole transition: status/resolution/resolved_at
// rewrite in place and RETURNING hands back the updated row, so a
// re-resolve of an already-resolved row is an idempotent rewrite and a
// WHERE miss (unknown id) surfaces as a null row.
const RESOLVE_SQL = `
  UPDATE corrections SET
    status = 'resolved',
    resolution = ?,
    resolved_at = ?
  WHERE id = ?
  RETURNING ${CORRECTION_COLUMNS}`;

@Injectable()
export class D1CorrectionRepository implements ICorrectionRepository {
  constructor(private readonly d1: D1DatabaseLike) {}

  /** @inheritdoc */
  async create(data: {
    targetType: 'calculation' | 'data_point';
    targetId: number;
    reason: string;
  }): Promise<CorrectionItem> {
    const row = await this.d1
      .prepare(INSERT_SQL)
      .bind(data.targetType, data.targetId, data.reason, new Date().toISOString())
      .first<D1CorrectionRow>();
    if (!row) {
      throw new Error('corrections INSERT .. RETURNING returned no row');
    }
    return toCorrectionItem(row);
  }

  /** @inheritdoc */
  async findAll(): Promise<CorrectionItem[]> {
    const rows = (
      await this.d1.prepare(FIND_ALL_SQL).all<D1CorrectionRow>()
    ).results;
    return rows.map(toCorrectionItem);
  }

  /** @inheritdoc */
  async resolve(id: number, resolution: string): Promise<CorrectionItem | null> {
    const row = await this.d1
      .prepare(RESOLVE_SQL)
      .bind(resolution, new Date().toISOString(), id)
      .first<D1CorrectionRow>();
    return row ? toCorrectionItem(row) : null;
  }
}
