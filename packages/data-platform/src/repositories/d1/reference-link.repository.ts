/**
 * D1 ReferenceLinkRepository — the terminal product-identity EDGE between
 * the two disjoint product universes (task 1.2, change
 * alko-reference-matching-pipeline, design D1), backed by the
 * `product_reference_links` table (migration 0026). Implements the
 * abstract contract from abstracts.ts.
 *
 * Invariants enforced here, on top of the schema's own:
 *
 * - **Terminal decisions only** — rows are born CONFIRMED (operator
 *   action, attributed) or not at all; the matching pass never writes
 *   this table. Replacement supersedes (`CONFIRMED → SUPERSEDED`,
 *   updated_at stamped explicitly — no ON UPDATE trigger exists in this
 *   schema) and the new link coexists with the old as history.
 * - **One live link per side** — the partial unique indexes
 *   (`WHERE status = 'CONFIRMED'`) refuse a second CONFIRMED link for a
 *   foreign product or an Alko product; the violation is surfaced as
 *   {@link ReferenceLinkConflictError}, never a raw SQLite error.
 *   Superseding the current link is the only legal path to a
 *   replacement.
 * - **Attributed confirmation** — a CONFIRMED link names the operator
 *   and the decision instant (conditional CHECK); a blank attribution is
 *   refused as {@link MissingDecisionAttributionError} before any write.
 * - **Transactional confirm** — promoting a review row creates the link
 *   and flips the review row to CONFIRMED in one `batch()` (one implicit
 *   transaction): a per-side conflict rolls the whole promotion back and
 *   the review row stays PENDING.
 *
 * @module D1ReferenceLinkRepository
 */
import { Injectable } from '@nestjs/common';
import {
  MatchReviewAlreadyDecidedError,
  MissingDecisionAttributionError,
  ReferenceLinkConflictError,
  ReferenceLinkRepository,
  ReferenceLinkSelfLinkError,
  type MatchReviewRecord,
  type MatchReviewStatus,
  type ReferenceLinkCreateInput,
  type ReferenceLinkDecision,
  type ReferenceLinkRecord,
  type ReferenceLinkStatus,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Raw D1 product_reference_links row. */
interface D1LinkRow {
  readonly id: number;
  readonly foreign_product_id: number;
  readonly alko_product_id: number;
  readonly status: string;
  readonly confirmed_by: string | null;
  readonly confirmed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Raw D1 match_review row (the confirm/reject path reads and flips it). */
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

const LINK_STATUSES: readonly ReferenceLinkStatus[] = [
  'CONFIRMED',
  'REJECTED',
  'SUPERSEDED',
];

const REVIEW_STATUSES: readonly MatchReviewStatus[] = [
  'PENDING',
  'CONFIRMED',
  'REJECTED',
];

/** Narrow the varchar columns onto their value-set unions — defense in depth. */
function toLinkStatus(value: string): ReferenceLinkStatus {
  if (!LINK_STATUSES.includes(value as ReferenceLinkStatus)) {
    throw new Error(
      `product_reference_links.status "${value}" is not a known link status`,
    );
  }
  return value as ReferenceLinkStatus;
}

function toReviewStatus(value: string): MatchReviewStatus {
  if (!REVIEW_STATUSES.includes(value as MatchReviewStatus)) {
    throw new Error(
      `match_review.status "${value}" is not a known review status`,
    );
  }
  return value as MatchReviewStatus;
}

function toContractLink(row: D1LinkRow): ReferenceLinkRecord {
  return {
    id: row.id,
    foreignProductId: row.foreign_product_id,
    alkoProductId: row.alko_product_id,
    status: toLinkStatus(row.status),
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at === null ? null : new Date(row.confirmed_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
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
    status: toReviewStatus(row.status),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const LINK_COLUMNS = `
  id, foreign_product_id, alko_product_id, status, confirmed_by,
  confirmed_at, created_at, updated_at`;

const REVIEW_COLUMNS = `
  id, foreign_product_id, alko_product_id, confidence, match_method, score,
  foreign_name, foreign_brand, foreign_abv, foreign_volume,
  alko_name, alko_brand, alko_abv, alko_volume,
  status, decided_by, decided_at, created_at, updated_at`;

const INSERT_LINK_SQL = `
  INSERT INTO product_reference_links (
    foreign_product_id, alko_product_id, status, confirmed_by, confirmed_at
  ) VALUES (?, ?, 'CONFIRMED', ?, ?)
  RETURNING ${LINK_COLUMNS}`;

/** Guarded — only a currently-live link can be superseded (terminal-once). */
const SUPERSEDE_SQL = `
  UPDATE product_reference_links SET status = 'SUPERSEDED', updated_at = ?
   WHERE id = ? AND status = 'CONFIRMED'
   RETURNING ${LINK_COLUMNS}`;

/**
 * The sweep read — the WHERE predicate is exactly what the covering
 * partial unique index admits, so the cron's CONFIRMED scan is
 * index-only, ordered by the index key.
 */
const LIST_CONFIRMED_SQL = `
  SELECT ${LINK_COLUMNS} FROM product_reference_links
   WHERE status = 'CONFIRMED'
   ORDER BY foreign_product_id ASC`;

const INSERT_LINK_PLAIN_SQL = `
  INSERT INTO product_reference_links (
    foreign_product_id, alko_product_id, status, confirmed_by, confirmed_at
  ) VALUES (?, ?, 'CONFIRMED', ?, ?)`;

const FIND_LINK_BY_PAIR_CONFIRMED_SQL = `
  SELECT ${LINK_COLUMNS} FROM product_reference_links
   WHERE foreign_product_id = ? AND status = 'CONFIRMED'`;

/** Guarded — only a PENDING review row can be flipped (decided = immutable). */
const CONFIRM_REVIEW_SQL = `
  UPDATE match_review SET
    status = 'CONFIRMED', decided_by = ?, decided_at = ?, updated_at = ?
   WHERE id = ? AND status = 'PENDING'`;

const REJECT_REVIEW_SQL = `
  UPDATE match_review SET
    status = 'REJECTED', decided_by = ?, decided_at = ?, updated_at = ?
   WHERE id = ? AND status = 'PENDING'
   RETURNING ${REVIEW_COLUMNS}`;

const FIND_REVIEW_BY_ID_SQL = `
  SELECT ${REVIEW_COLUMNS} FROM match_review WHERE id = ?`;

/**
 * The per-side live-link uniqueness (partial unique indexes) — SQLite
 * names the violated column, D1 the same constraint text, so the
 * table+column match is the portable signature.
 */
function isUniqueViolationOnLinkSide(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('UNIQUE constraint failed') &&
    error.message.includes('product_reference_links')
  );
}

/** Guard rails shared by every write path — fail before any SQL runs. */
function requireAttribution(confirmedBy: string): void {
  if (confirmedBy.trim() === '') {
    throw new MissingDecisionAttributionError('confirmedBy is blank');
  }
}

function requireDistinctProducts(foreignProductId: number, alkoProductId: number): void {
  if (foreignProductId === alkoProductId) {
    throw new ReferenceLinkSelfLinkError(foreignProductId);
  }
}

@Injectable()
export class D1ReferenceLinkRepository extends ReferenceLinkRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /** @inheritdoc */
  async create(input: ReferenceLinkCreateInput): Promise<ReferenceLinkRecord> {
    requireAttribution(input.confirmedBy);
    requireDistinctProducts(input.foreignProductId, input.alkoProductId);

    try {
      const row = await this.d1
        .prepare(INSERT_LINK_SQL)
        .bind(
          input.foreignProductId,
          input.alkoProductId,
          input.confirmedBy,
          new Date().toISOString(),
        )
        .first<D1LinkRow>();
      if (!row) {
        throw new Error(
          'product_reference_links INSERT .. RETURNING returned no row',
        );
      }
      return toContractLink(row);
    } catch (error) {
      if (isUniqueViolationOnLinkSide(error)) {
        throw new ReferenceLinkConflictError(
          input.foreignProductId,
          input.alkoProductId,
        );
      }
      throw error;
    }
  }

  /** @inheritdoc */
  async confirm(
    reviewId: number,
    confirmedBy: string,
  ): Promise<ReferenceLinkDecision | null> {
    requireAttribution(confirmedBy);

    // Read BEFORE the write: unknown review → null; decided review → the
    // typed immutability error. The pair-unique index guarantees one
    // review row per pair, so the promotion below targets exactly this row.
    const reviewRow = await this.d1
      .prepare(FIND_REVIEW_BY_ID_SQL)
      .bind(reviewId)
      .first<D1ReviewRow>();
    if (!reviewRow) {
      return null;
    }
    if (reviewRow.status !== 'PENDING') {
      throw new MatchReviewAlreadyDecidedError(
        reviewId,
        toReviewStatus(reviewRow.status),
      );
    }
    requireDistinctProducts(
      reviewRow.foreign_product_id,
      reviewRow.alko_product_id,
    );

    const now = new Date().toISOString();
    try {
      // One batch = one implicit transaction: the link insert and the
      // guarded review flip commit together or not at all. A per-side
      // live-link conflict aborts the batch before the review row moves,
      // so the candidate stays PENDING for a supersede-then-retry.
      const results = await this.d1.batch([
        this.d1
          .prepare(INSERT_LINK_PLAIN_SQL)
          .bind(
            reviewRow.foreign_product_id,
            reviewRow.alko_product_id,
            confirmedBy,
            now,
          ),
        this.d1
          .prepare(CONFIRM_REVIEW_SQL)
          .bind(confirmedBy, now, now, reviewId),
      ]);

      // Only a concurrent decision in the read→batch window could have
      // consumed the PENDING state (single-writer D1 keeps this
      // unreachable in practice); surface it rather than return a
      // half-promoted view.
      const flipped = results[1].meta.changes;
      if (flipped !== 1) {
        const current = await this.readReview(reviewId);
        throw new MatchReviewAlreadyDecidedError(
          reviewId,
          current ? current.status : 'REJECTED',
        );
      }
    } catch (error) {
      if (isUniqueViolationOnLinkSide(error)) {
        throw new ReferenceLinkConflictError(
          reviewRow.foreign_product_id,
          reviewRow.alko_product_id,
        );
      }
      throw error;
    }

    // Read back through the partial-unique guarantee: exactly one live
    // link exists for the foreign side, and it is the one just inserted.
    const linkRow = await this.d1
      .prepare(FIND_LINK_BY_PAIR_CONFIRMED_SQL)
      .bind(reviewRow.foreign_product_id)
      .first<D1LinkRow>();
    const decidedReview = await this.readReview(reviewId);
    if (!linkRow || !decidedReview) {
      throw new Error(
        `confirm of match_review ${reviewId} committed but the read-back found no rows`,
      );
    }
    return { link: toContractLink(linkRow), review: decidedReview };
  }

  /** @inheritdoc */
  async reject(reviewId: number, decidedBy: string): Promise<MatchReviewRecord | null> {
    if (decidedBy.trim() === '') {
      throw new MissingDecisionAttributionError('decidedBy is blank');
    }

    const now = new Date().toISOString();
    const row = await this.d1
      .prepare(REJECT_REVIEW_SQL)
      .bind(decidedBy, now, now, reviewId)
      .first<D1ReviewRow>();
    if (row) {
      return toContractReview(row);
    }
    // No row moved: unknown id → null; decided in the meantime → typed error.
    return this.decidedOrUnknown(reviewId);
  }

  /** @inheritdoc */
  async supersede(linkId: number): Promise<ReferenceLinkRecord | null> {
    const row = await this.d1
      .prepare(SUPERSEDE_SQL)
      .bind(new Date().toISOString(), linkId)
      .first<D1LinkRow>();
    if (row) {
      return toContractLink(row);
    }
    // Null for both unknown and not-CONFIRMED (REJECTED/SUPERSEDED are
    // terminal) — the caller cannot distinguish, and needs not.
    return null;
  }

  /** @inheritdoc */
  async listConfirmed(): Promise<ReferenceLinkRecord[]> {
    const rows = (
      await this.d1.prepare(LIST_CONFIRMED_SQL).all<D1LinkRow>()
    ).results;
    return rows.map(toContractLink);
  }

  /** Contract row or null — the shared read-back. */
  private async readReview(reviewId: number): Promise<MatchReviewRecord | null> {
    const row = await this.d1
      .prepare(FIND_REVIEW_BY_ID_SQL)
      .bind(reviewId)
      .first<D1ReviewRow>();
    return row ? toContractReview(row) : null;
  }

  /**
   * Distinguish "unknown review" (null) from "decided since the guard"
   * (typed error) after a guarded write matched nothing.
   */
  private async decidedOrUnknown(reviewId: number): Promise<MatchReviewRecord | null> {
    const existing = await this.readReview(reviewId);
    if (!existing) {
      return null;
    }
    throw new MatchReviewAlreadyDecidedError(reviewId, existing.status);
  }
}
