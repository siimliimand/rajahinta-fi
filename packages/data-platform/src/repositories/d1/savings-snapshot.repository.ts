/**
 * D1 SavingsSnapshotRepository — the daily insight surface's materialized
 * per-product savings rows (change insight-surfaces, task 1.1), backed by
 * the `savings_snapshots` table (migration 0018). Implements the abstract
 * contract from abstracts.ts.
 *
 * The upsert mirrors the D1 price-history-summary pattern:
 * lookup-then-insert/update with last-write-wins on every computed
 * column, so a job re-run over the same day converges on
 * unique(as_of, product_id) (design D2). Both key columns are NOT NULL,
 * so the NULLS NOT DISTINCT compensation the summaries need is not
 * required here.
 *
 * `tax_dataset_version` is a version_label reference, not an FK — rate
 * versions are append-only rows across the rule tables; the repository
 * stores it verbatim.
 *
 * @module D1SavingsSnapshotRepository
 */
import { Injectable } from '@nestjs/common';
import {
  SavingsSnapshotRepository,
  type SavingsConfidenceGrade,
  type SavingsReliabilityStatus,
  type SavingsSnapshotRecord,
  type SavingsSnapshotUpsertInput,
} from '../../abstracts';
import type { D1DatabaseLike } from '../../d1/executor';

/** Contract row type (canonical shape — identical columns on D1). */
type SnapshotRecord = SavingsSnapshotRecord;

const SNAPSHOT_COLUMNS = `
  id, as_of, product_id, category, best_merchant, best_merchant_country,
  best_price_cents, best_observed_at, alko_reference_cents,
  alko_observed_at, landed_total_cents, landed_reliability, confidence,
  gap_cents, gap_basis_points, tax_dataset_version`;

/** Raw D1 savings_snapshots row. */
interface D1SnapshotRow {
  readonly id: number;
  readonly as_of: string;
  readonly product_id: number;
  readonly category: string;
  readonly best_merchant: string;
  readonly best_merchant_country: string;
  readonly best_price_cents: number;
  readonly best_observed_at: string;
  readonly alko_reference_cents: number | null;
  readonly alko_observed_at: string | null;
  readonly landed_total_cents: number;
  readonly landed_reliability: string;
  readonly confidence: string;
  readonly gap_cents: number;
  readonly gap_basis_points: number;
  readonly tax_dataset_version: string;
}

const RELIABILITIES: readonly SavingsReliabilityStatus[] = [
  'VERIFIED',
  'ESTIMATED',
  'STALE',
  'UNAVAILABLE',
];

const CONFIDENCES: readonly SavingsConfidenceGrade[] = ['HIGH', 'MEDIUM', 'LOW'];

/** Narrow the varchar columns onto their value-set unions — defense in depth. */
function toReliability(value: string): SavingsReliabilityStatus {
  if (!RELIABILITIES.includes(value as SavingsReliabilityStatus)) {
    throw new Error(
      `savings_snapshots.landed_reliability "${value}" is not a known reliability status`,
    );
  }
  return value as SavingsReliabilityStatus;
}

function toConfidence(value: string): SavingsConfidenceGrade {
  if (!CONFIDENCES.includes(value as SavingsConfidenceGrade)) {
    throw new Error(
      `savings_snapshots.confidence "${value}" is not a known confidence grade`,
    );
  }
  return value as SavingsConfidenceGrade;
}

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toContractRecord(row: D1SnapshotRow): SnapshotRecord {
  return {
    id: row.id,
    asOf: row.as_of,
    productId: row.product_id,
    category: row.category,
    bestMerchant: row.best_merchant,
    bestMerchantCountry: row.best_merchant_country,
    bestPriceCents: row.best_price_cents,
    bestObservedAt: new Date(row.best_observed_at),
    alkoReferenceCents: row.alko_reference_cents,
    alkoObservedAt: toDate(row.alko_observed_at),
    landedTotalCents: row.landed_total_cents,
    landedReliability: toReliability(row.landed_reliability),
    confidence: toConfidence(row.confidence),
    gapCents: row.gap_cents,
    gapBasisPoints: row.gap_basis_points,
    taxDatasetVersion: row.tax_dataset_version,
  };
}

/** Key columns — immutable across an upsert (they ARE the key). */
function keyParams(snapshot: SavingsSnapshotUpsertInput): unknown[] {
  return [snapshot.asOf, snapshot.productId];
}

/** Computed columns in both the INSERT's VALUES and the UPDATE's SET order. */
function computedParams(snapshot: SavingsSnapshotUpsertInput): unknown[] {
  return [
    snapshot.category,
    snapshot.bestMerchant,
    snapshot.bestMerchantCountry,
    snapshot.bestPriceCents,
    snapshot.bestObservedAt.toISOString(),
    snapshot.alkoReferenceCents,
    snapshot.alkoObservedAt === null ? null : snapshot.alkoObservedAt.toISOString(),
    snapshot.landedTotalCents,
    snapshot.landedReliability,
    snapshot.confidence,
    snapshot.gapCents,
    snapshot.gapBasisPoints,
    snapshot.taxDatasetVersion,
  ];
}

const LOOKUP_SQL = `
  SELECT id FROM savings_snapshots WHERE as_of = ? AND product_id = ?`;

const INSERT_SQL = `
  INSERT INTO savings_snapshots (
    as_of, product_id, category, best_merchant, best_merchant_country,
    best_price_cents, best_observed_at, alko_reference_cents,
    alko_observed_at, landed_total_cents, landed_reliability, confidence,
    gap_cents, gap_basis_points, tax_dataset_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING id`;

const UPDATE_SQL = `
  UPDATE savings_snapshots SET
    category = ?, best_merchant = ?, best_merchant_country = ?,
    best_price_cents = ?, best_observed_at = ?, alko_reference_cents = ?,
    alko_observed_at = ?, landed_total_cents = ?, landed_reliability = ?,
    confidence = ?, gap_cents = ?, gap_basis_points = ?,
    tax_dataset_version = ?
  WHERE id = ?
  RETURNING id`;

// Latest day = the rows sharing the maximal as_of. One query, no job-side
// pre-read of the max — the read stays consistent with a concurrent write.
const LATEST_DAY_SQL = `
  SELECT ${SNAPSHOT_COLUMNS} FROM savings_snapshots
   WHERE as_of = (SELECT MAX(as_of) FROM savings_snapshots)
   ORDER BY product_id ASC`;

const CATEGORY_RANGE_SQL = `
  SELECT ${SNAPSHOT_COLUMNS} FROM savings_snapshots
   WHERE category = ? AND as_of >= ? AND as_of <= ?
   ORDER BY as_of ASC, product_id ASC`;

@Injectable()
export class D1SavingsSnapshotRepository extends SavingsSnapshotRepository {
  constructor(private readonly d1: D1DatabaseLike) {
    super();
  }

  /**
   * Insert or overwrite one day's snapshot keyed by (asOf, productId).
   * Returns the row id (existing id on conflict — the key columns never
   * change). Last write wins: every computed column is overwritten, the
   * key columns and id are not.
   */
  async upsertSnapshot(
    snapshot: SavingsSnapshotUpsertInput,
  ): Promise<{ id: number }> {
    const existing = await this.d1
      .prepare(LOOKUP_SQL)
      .bind(...keyParams(snapshot))
      .first<{ id: number }>();

    if (existing) {
      const row = await this.d1
        .prepare(UPDATE_SQL)
        .bind(...computedParams(snapshot), existing.id)
        .first<{ id: number }>();
      if (!row) {
        throw new Error('savings_snapshots UPDATE .. RETURNING returned no row');
      }
      return { id: row.id };
    }

    const inserted = await this.d1
      .prepare(INSERT_SQL)
      .bind(...keyParams(snapshot), ...computedParams(snapshot))
      .first<{ id: number }>();
    if (!inserted) {
      throw new Error('savings_snapshots INSERT .. RETURNING returned no row');
    }
    return { id: inserted.id };
  }

  /** @inheritdoc */
  async findLatestDay(): Promise<SnapshotRecord[]> {
    const rows = (
      await this.d1.prepare(LATEST_DAY_SQL).all<D1SnapshotRow>()
    ).results;
    return rows.map(toContractRecord);
  }

  /** @inheritdoc */
  async findByCategoryRange(
    category: string,
    from: string,
    to: string,
  ): Promise<SnapshotRecord[]> {
    const rows = (
      await this.d1
        .prepare(CATEGORY_RANGE_SQL)
        .bind(category, from, to)
        .all<D1SnapshotRow>()
    ).results;
    return rows.map(toContractRecord);
  }
}
