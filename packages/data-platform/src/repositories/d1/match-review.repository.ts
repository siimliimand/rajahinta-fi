/**
 * D1 MatchReviewRepository — the review queue the matching pass writes
 * (task 1.2, change alko-reference-matching-pipeline, design D2/D5),
 * backed by the `match_review` table (migration 0026). Implements the
 * abstract contract from abstracts.ts.
 *
 * Invariants enforced here, on top of the schema's own:
 *
 * - **Idempotent enqueue per pair** — the
 *   `(foreign_product_id, alko_product_id)` unique index is the pair
 *   identity: a new pair inserts, a still-PENDING pair refreshes its
 *   scoring/identity fields in place (updated_at stamped — no ON UPDATE
 *   trigger exists in this schema), and a decided pair is returned
 *   untouched. The outcome lets the matching pass count
 *   created/refreshed/skipped (design D5).
 * - **Decision immutability** — a decided row can never re-enter the
 *   queue (the pair-unique forces the refresh path onto PENDING rows
 *   only) and can never be re-decided: the guarded transitions match
 *   `status = 'PENDING'` and a second decide surfaces
 *   {@link MatchReviewAlreadyDecidedError}, never a silent overwrite.
 * - **Frozen review context** — both sides' name/brand/ABV/volume are
 *   written at enqueue and refreshed only through the PENDING path, so
 *   the reviewer always sees what the scorer saw.
 *
 * @module D1MatchReviewRepository
 */
import { Injectable } from '@nestjs/common';
import {
  MatchReviewAlreadyDecidedError,
  MatchReviewRepository,
  MatchReviewScoreRangeError,
  MissingDecisionAttributionError,
  ReferenceLinkSelfLinkError,
  type MatchReviewDecision,
  type MatchReviewEnqueueInput,
  type MatchReviewEnqueueResult,
  type MatchReviewRecord,
  type MatchReviewStatus,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 match_review row. */
interface D1ReviewRow {
  readonly id: number;
  readonly foreign_product_id: number;
  readonly alko_product_id: number;
  readonly confidence: string;
  readonly match_method: string;
  readonly score: number;
  readonly foreign_name: string;
  readonly foreign_brand: string | null;
  readonly foreign_abv: number | null;
  readonly foreign_volume: number | null;
  readonly alko_name: string;
  readonly alko_brand: string | null;
  readonly alko_abv: number | null;
  readonly alko_volume: number | null;
  readonly status: string;
  readonly decided_by: string | null;
  readonly decided_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const REVIEW_STATUSES: readonly MatchReviewStatus[] = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
];

/** Narrow the varchar column onto its value-set union — defense in depth. */
function toStatus(value: string): MatchReviewStatus {
  if (!REVIEW_STATUSES.includes(value as MatchReviewStatus)) {
    throw new Error(
      `match_review.status "${value}" is not a known review status`,
    );
  }
  return value as MatchReviewStatus;
}

function toContractReview(row: D1ReviewRow): MatchReviewRecord {
  return {
    id: row.id,
    foreignProductId: row.foreign_product_id,
    alkoProductId: row.alko_product_id,
    confidence: row.confidence as MatchReviewRecord['confidence'],
    matchMethod: row.match_method as MatchReviewRecord['matchMethod'],
    score: row.score,
    foreignName: row.foreign_name,
    foreignBrand: row.foreign_brand,
    foreignAbv: row.foreign_abv,
    foreignVolume: row.foreign_volume,
    alkoName: row.alko_name,
    alkoBrand: row.alko_brand,
    alkoAbv: row.alko_abv,
    alkoVolume: row.alko_volume,
    status: toStatus(row.status),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const REVIEW_COLUMNS = `
  id, foreign_product_id, alko_product_id, confidence, match_method, score,
  foreign_name, foreign_brand, foreign_abv, foreign_volume,
  alko_name, alko_brand, alko_abv, alko_volume,
  status, decided_by, decided_at, created_at, updated_at`;

const INSERT_REVIEW_SQL = `
  INSERT INTO match_review (
    foreign_product_id, alko_product_id, confidence, match_method, score,
    foreign_name, foreign_brand, foreign_abv, foreign_volume,
    alko_name, alko_brand, alko_abv, alko_volume
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;

const FIND_BY_PAIR_SQL = `
  SELECT ${REVIEW_COLUMNS} FROM match_review
   WHERE foreign_product_id = ? AND alko_product_id = ?`;

const FIND_BY_ID_SQL = `
  SELECT ${REVIEW_COLUMNS} FROM match_review WHERE id = ?`;

/**
 * Refresh a still-PENDING pair in place: scoring/identity fields only —
 * ids, status, and decision attribution never move here. The status
 * predicate restates the PENDING-only refresh contract in SQL.
 */
const REFRESH_PENDING_SQL = `
  UPDATE match_review SET
    confidence = ?, match_method = ?, score = ?,
    foreign_name = ?, foreign_brand = ?, foreign_abv = ?, foreign_volume = ?,
    alko_name = ?, alko_brand = ?, alko_abv = ?, alko_volume = ?,
    updated_at = ?
   WHERE id = ? AND status = 'PENDING'`;

/** Queue ordering: score desc, then the pair ids ascending (deterministic). */
const LIST_BY_STATUS_SQL = `
  SELECT ${REVIEW_COLUMNS} FROM match_review
   WHERE status = ?
   ORDER BY score DESC, foreign_product_id ASC, alko_product_id ASC`;

/** Guarded transitions — only a PENDING row can be decided. */
const DECIDE_SQL = `
  UPDATE match_review SET
    status = ?, decided_by = ?, decided_at = ?, updated_at = ?
   WHERE id = ? AND status = 'PENDING'
   RETURNING ${REVIEW_COLUMNS}`;

/**
 * The per-pair identity insert — a concurrent enqueue losing the
 * pair-unique race is folded into the refresh/skip path below.
 */
function isUniqueViolationOnReviewPair(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('match_review')
  );
}

/** Scoring + identity subset, in both INSERT and REFRESH bind order. */
function scoringParams(input: MatchReviewEnqueueInput): unknown[] {
  return [
    input.confidence,
    input.matchMethod,
    input.score,
    input.foreignName,
    input.foreignBrand,
    input.foreignAbv,
    input.foreignVolume,
    input.alkoName,
    input.alkoBrand,
    input.alkoAbv,
    input.alkoVolume,
  ];
}

/** Guard rails that fail before any SQL runs. */
function requireQueueablePair(input: MatchReviewEnqueueInput): void {
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
    throw new MatchReviewScoreRangeError(input.score);
  }
  if (input.foreignProductId === input.alkoProductId) {
    throw new ReferenceLinkSelfLinkError(input.foreignProductId);
  }
}

@Injectable()
export class D1MatchReviewRepository extends MatchReviewRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async enqueue(
    input: MatchReviewEnqueueInput,
  ): Promise<MatchReviewEnqueueResult> {
    requireQueueablePair(input);

    let existing = await this.findByPair(
      input.foreignProductId,
      input.alkoProductId,
    );
    if (!existing) {
      try {
        const inserted = await this.d1
          .prepare(INSERT_REVIEW_SQL)
          .bind(
            input.foreignProductId,
            input.alkoProductId,
            ...scoringParams(input),
          )
          .first<{ id: number }>();
        if (!inserted) {
          throw new Error('match_review INSERT .. RETURNING returned no row');
        }
        return { id: inserted.id, outcome: 'created' };
      } catch (error) {
        if (!isUniqueViolationOnReviewPair(error)) {
          throw error;
        }
        // A concurrent enqueue won the pair identity — converge on its
        // row through the same refresh/skip path (never a duplicate).
        const raced = await this.findByPair(
          input.foreignProductId,
          input.alkoProductId,
        );
        if (!raced) {
          throw error;
        }
        existing = raced;
      }
    }

    // Decision immutability: a decided pair is returned untouched.
    if (existing.status !== 'PENDING') {
      return { id: existing.id, outcome: 'skipped' };
    }

    await this.d1
      .prepare(REFRESH_PENDING_SQL)
      .bind(...scoringParams(input), new Date().toISOString(), existing.id)
      .run();
    return { id: existing.id, outcome: 'refreshed' };
  }

  /** @inheritdoc */
  async listByStatus(status: MatchReviewStatus): Promise<MatchReviewRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_BY_STATUS_SQL).bind(status).all<D1ReviewRow>()
    ).results;
    return rows.map(toContractReview);
  }

  /** @inheritdoc */
  async decide(
    id: number,
    decision: MatchReviewDecision,
    decidedBy: string,
  ): Promise<MatchReviewRecord | null> {
    if (decidedBy.trim() === '') {
      throw new MissingDecisionAttributionError('decidedBy is blank');
    }

    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(DECIDE_SQL)
      .bind(decision, decidedBy, now, now, id)
      .first<D1ReviewRow>();
    if (row) {
      return toContractReview(row);
    }
    // No row moved: unknown id → null; decided in the meantime → typed error.
    const existing = await this.findByIdRow(id);
    if (!existing) {
      return null;
    }
    throw new MatchReviewAlreadyDecidedError(id, toStatus(existing.status));
  }

  private async findByPair(
    foreignProductId: number,
    alkoProductId: number,
  ): Promise<MatchReviewRecord | null> {
    const row = await this.d1
      .prepare(FIND_BY_PAIR_SQL)
      .bind(foreignProductId, alkoProductId)
      .first<D1ReviewRow>();
    return row ? toContractReview(row) : null;
  }

  private async findByIdRow(id: number): Promise<D1ReviewRow | null> {
    const row = await this.d1
      .prepare(FIND_BY_ID_SQL)
      .bind(id)
      .first<D1ReviewRow>();
    return row ?? null;
  }
}
