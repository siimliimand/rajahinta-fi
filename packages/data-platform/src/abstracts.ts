/**
 * Abstract repository classes.
 *
 * Extracted to their own file so that both the concrete repository
 * implementations and the DataPlatformModule can import them without
 * going through the barrel (index.ts), avoiding circular dependency chains.
 *
 * @module RepositoryAbstractions
 */
import { Injectable } from '@nestjs/common';
import type { PriceObservation } from '@rajahinta/core-domain';
import {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  accounts,
  savedBaskets,
  priceObservations,
  priceHistorySummaries,
  merchantTerms,
  basketCalculationRecords,
} from './schema';

/**
 * Persisted price-observation row (raw schema shape).
 *
 * Read model for the append-only observation log. Carries rule-version
 * FK ids but NOT the domain `versionLabel`: the aggregation worker does
 * not need labels, and the attribution service resolves them through its
 * own tax-rule queries, so range reads stay join-free and index-only.
 */
export type PriceObservationRecord = typeof priceObservations.$inferSelect;

// ---------------------------------------------------------------------------
// Repository abstractions
// ---------------------------------------------------------------------------

@Injectable()
export abstract class ProductRepository {
  /**
   * Search products by name (case-insensitive substring), or list the
   * first `limit` products alphabetically when `query` is null/empty.
   */
  abstract searchByName(
    query: string | null,
    limit: number,
  ): Promise<(typeof productMaster.$inferSelect)[]>;
  abstract findById(id: number): Promise<typeof productMaster.$inferSelect | null>;
  abstract findOffers(productId: number): Promise<typeof retailOffers.$inferSelect[]>;
  abstract findRetailOfferById(id: number): Promise<typeof retailOffers.$inferSelect | null>;

  /** Insert a new product master record. */
  abstract create(
    record: typeof productMaster.$inferInsert,
  ): Promise<typeof productMaster.$inferSelect>;

  /** Insert or update by EAN barcode — product-level idempotency. */
  abstract upsertByEan(
    record: typeof productMaster.$inferInsert,
  ): Promise<typeof productMaster.$inferSelect>;
}

@Injectable()
export abstract class TaxRateRepository {
  abstract findEffectiveVersion(
    asOf: Date,
  ): Promise<typeof taxRules.$inferSelect | null>;
  abstract findVersionById(
    id: number,
  ): Promise<typeof taxRules.$inferSelect | null>;

  /**
   * Return all tax rules for the given type and category whose effectiveness
   * window overlaps {@code [fromDate, toDate)}.
   */
  abstract findHistoryRates(
    taxType: string,
    productCategory: string,
    fromDate: Date,
    toDate: Date,
  ): Promise<typeof taxRules.$inferSelect[]>;
}

@Injectable()
export abstract class TransportOfferRepository {
  abstract findByCarrier(carrierId: string): Promise<typeof transportOffers.$inferSelect[]>;
  abstract findActive(): Promise<typeof transportOffers.$inferSelect[]>;

  /**
   * Find transport offers matching a specific set of criteria for
   * transport estimation.
   */
  abstract findApplicable(
    carrier: string,
    origin: string,
    destination: string,
    weightKg: number,
    packageType: string,
  ): Promise<typeof transportOffers.$inferSelect[]>;
}

@Injectable()
export abstract class CalculationRecordRepository {
  abstract create(
    record: typeof calculationRecords.$inferInsert,
  ): Promise<typeof calculationRecords.$inferSelect>;
  abstract findById(
    id: number,
  ): Promise<typeof calculationRecords.$inferSelect | null>;
  abstract findBySession(
    sessionId: string,
  ): Promise<typeof calculationRecords.$inferSelect[]>;

  /**
   * Return the IDs of calculation records that reference a given entity.
   *
   * Supported entity types: 'product', 'retailOffer', 'transportOffer', 'taxRule'.
   */
  abstract findCalculationRecordIdsByEntity(
    entityType: string,
    entityId: number,
  ): Promise<number[]>;
}

@Injectable()
export abstract class AuditRepository {
  abstract recordCalculation(
    entry: typeof calculationRecords.$inferInsert,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Account repository abstractions
// ---------------------------------------------------------------------------

@Injectable()
export abstract class AccountRepository {
  /** Insert a new account record. */
  abstract create(
    record: typeof accounts.$inferInsert,
  ): Promise<typeof accounts.$inferSelect>;

  /** Look up an account by its primary key (serial id). */
  abstract findById(id: number): Promise<typeof accounts.$inferSelect | null>;

  /** Look up an account by its external user identifier. */
  abstract findByUserId(
    userId: string,
  ): Promise<typeof accounts.$inferSelect | null>;

  /** Update the lastActiveAt timestamp for a user. */
  abstract updateLastActive(userId: string): Promise<void>;

  /** Delete an account by its external user identifier. */
  abstract delete(userId: string): Promise<void>;

  /** Return all known user IDs — used by retention-policy scans. */
  abstract findAllUserIds(): Promise<string[]>;

  /**
   * Irreversibly anonymize an account — replaces identifiers with
   * non-reversible pseudonyms, cascades to saved baskets, and retains
   * the anonymized skeleton row for referential integrity.
   *
   * The pseudonym is a fresh random UUID, NOT derived from the original
   * identifier, so the operation cannot be reversed.
   */
  abstract anonymize(userId: string): Promise<void>;
}

@Injectable()
export abstract class SavedBasketRepository {
  /** Insert a new saved basket record. */
  abstract create(
    record: typeof savedBaskets.$inferInsert,
  ): Promise<typeof savedBaskets.$inferSelect>;

  /** Look up a basket by its primary key. */
  abstract findById(
    id: number,
  ): Promise<typeof savedBaskets.$inferSelect | null>;

  /** Return all baskets for an account (by account db id). */
  abstract findByAccountId(
    accountId: number,
  ): Promise<typeof savedBaskets.$inferSelect[]>;

  /** Return all baskets for a user (by external userId via join). */
  abstract findByUserId(
    userId: string,
  ): Promise<typeof savedBaskets.$inferSelect[]>;

  /** Delete a basket by its primary key. */
  abstract delete(id: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Price-observation repository abstraction
// ---------------------------------------------------------------------------

/**
 * Price-observation repository — the append-only analytical log.
 *
 * The append contract mirrors the core-domain {@link IPriceObservationPort}
 * exactly (insert-only, returns the assigned row id); the concrete Drizzle
 * adapter therefore satisfies that port without a separate mapper. The
 * range-read methods are consumed by the time-series aggregation worker
 * and the tax-change attribution service.
 *
 * Append-only invariant: there are deliberately NO update or delete
 * operations — observation rows are immutable once written, and
 * corrections append new observations rather than editing history.
 *
 * Range semantics: all range reads are half-open intervals
 * {@code [from, to)} on observedAt, matching the aggregation bucket
 * convention (bucketStart inclusive, bucketStart + window exclusive) so a
 * boundary-instant observation is never counted in two buckets.
 */
@Injectable()
export abstract class PriceObservationRepository {
  /**
   * Append one observation row (insert only — never update or delete).
   * Returns the assigned row id.
   */
  abstract append(observation: PriceObservation): Promise<{ id: number }>;

  /**
   * Range read by product over [from, to), optionally filtered by a
   * single merchant. Ordered by (observedAt, id) ascending so
   * consecutive-observation consumers see a stable series order.
   */
  abstract findByProductRange(
    productId: number,
    from: Date,
    to: Date,
    merchant?: string | null,
  ): Promise<PriceObservationRecord[]>;

  /**
   * Range read by merchant offer (merchant + retailOfferId) over
   * [from, to). Ordered by (observedAt, id) ascending.
   */
  abstract findByMerchantOfferRange(
    merchant: string,
    retailOfferId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]>;

  /**
   * Range read by merchant + product over [from, to). Ordered by
   * (observedAt, id) ascending.
   */
  abstract findByMerchantProductRange(
    merchant: string,
    productId: number,
    from: Date,
    to: Date,
  ): Promise<PriceObservationRecord[]>;

  /**
   * Earliest observedAt for a product (optionally merchant-filtered), or
   * null when no observations exist — the API surfaces this as the
   * "earliest available observation date".
   */
  abstract findEarliestObservedAt(
    productId: number,
    merchant?: string | null,
  ): Promise<Date | null>;

  /**
   * Incremental-scan read for the aggregation worker: every product with
   * an observation at or after {@code since}, with that product's
   * earliest and latest observedAt within the scan range. The worker
   * derives the affected daily/weekly buckets from these spans and its
   * next watermark from the maximum lastObservedAt. Ordered by productId
   * ascending for deterministic processing.
   *
   * Inclusive lower bound: observations at exactly {@code since} are
   * returned again — upserts are idempotent, so re-scanning the boundary
   * instant is safe, while skipping it could miss rows appended late
   * with the same observedAt.
   */
  abstract findProductActivitySince(
    since: Date,
  ): Promise<ProductActivitySince[]>;
}

/**
 * Per-product observation span within an incremental scan range.
 */
export interface ProductActivitySince {
  productId: number;
  /** Earliest observedAt for the product within the scan range. */
  firstObservedAt: Date;
  /** Latest observedAt for the product within the scan range. */
  lastObservedAt: Date;
}

// ---------------------------------------------------------------------------
// Price-history-summary repository abstraction
// ---------------------------------------------------------------------------

/**
 * Persisted price-history-summary row (raw schema shape).
 *
 * Read model for the materialized daily/weekly buckets. Serves chart
 * requests so raw observations are never aggregated on the request path.
 */
export type PriceHistorySummaryRecord = typeof priceHistorySummaries.$inferSelect;

/**
 * Upsert input — one fully computed bucket. The aggregation worker
 * computes open/close/min/max/avg for price and landed cost, the
 * observation count, and the strictest reliability before calling
 * {@link PriceHistorySummaryRepository.upsertBucket}.
 */
export type PriceHistorySummaryUpsertInput = typeof priceHistorySummaries.$inferInsert;

/**
 * Price-history-summary repository — materialized daily/weekly aggregates.
 *
 * Written by the time-series aggregation background job (idempotent
 * upsert), read by the historical-data API.
 *
 * ## Upsert idempotency
 *
 * {@link upsertBucket} converges on the bucket unique key
 * {@code (granularity, period_start, product_id, merchant)} — re-running
 * the aggregation job over the same period overwrites the bucket's
 * aggregate columns (last write wins) instead of duplicating rows. The
 * constraint is {@code UNIQUE NULLS NOT DISTINCT}, so the product-wide
 * row (merchant NULL) is matched by the plain column conflict target.
 *
 * ## Range semantics
 *
 * Unlike the observation log's half-open timestamp ranges, summary reads
 * are CLOSED {@code [from, to]} intervals on the date column
 * {@code period_start}: period anchors are whole days, and a chart
 * requested through its last day must include that day's bucket.
 *
 * Merchant filter semantics are binary, never "all rows": omitted (or
 * null) reads ONLY the product-wide rows (merchant IS NULL); a given
 * merchant reads only that merchant's rows. Mixing the two would put
 * multiple points in one period on a single chart series.
 */
@Injectable()
export abstract class PriceHistorySummaryRepository {
  /**
   * Insert or overwrite one bucket row keyed by
   * (granularity, periodStart, productId, merchant). Returns the row id
   * (existing id on conflict — the key columns never change).
   */
  abstract upsertBucket(
    summary: PriceHistorySummaryUpsertInput,
  ): Promise<{ id: number }>;

  /**
   * Range read of one product's summary series at one granularity over
   * the closed [from, to] period-start range (ISO date strings,
   * 'YYYY-MM-DD'). Omitting `merchant` (or passing null) reads the
   * product-wide rows; passing a merchant reads that merchant's rows.
   * Ordered by periodStart ascending, matching the
   * (granularity, product_id, period_start) index.
   */
  abstract findByProductRange(
    productId: number,
    granularity: string,
    from: string,
    to: string,
    merchant?: string | null,
  ): Promise<PriceHistorySummaryRecord[]>;
}

// ---------------------------------------------------------------------------
// Aggregation-watermark repository abstraction
// ---------------------------------------------------------------------------

/**
 * Aggregation-watermark repository — persisted cursors for incremental
 * materialization jobs.
 *
 * The time-series aggregation worker reads its watermark before each scan
 * and saves the advanced watermark only after every summary write of the
 * scan succeeded (write-then-advance; a failed run leaves the cursor
 * untouched so the retry re-scans the same range and the idempotent
 * summary upserts converge).
 */
@Injectable()
export abstract class AggregationWatermarkRepository {
  /**
   * Current watermark for a job, or null when the job has never
   * completed a scan (callers start from the epoch on first run).
   */
  abstract find(jobName: string): Promise<Date | null>;

  /**
   * Persist the watermark for a job (insert or overwrite by job name).
   * Callers must only ever advance the value — never regress it.
   */
  abstract save(jobName: string, watermark: Date): Promise<void>;
}

// ---------------------------------------------------------------------------
// Merchant-terms repository abstraction
// ---------------------------------------------------------------------------

/**
 * Persisted merchant-terms row (raw schema shape).
 *
 * Carries minimum-order threshold data for a merchant. A missing row means
 * no known threshold — never defaulted to zero.
 */
export type MerchantTermsRecord = typeof merchantTerms.$inferSelect;

/**
 * Merchant-terms repository — store-level commercial conditions.
 *
 * Minimum-order thresholds are externally sourced facts that always carry
 * reliability and timestamp provenance. A missing row means no known
 * threshold, not a zero threshold.
 *
 * @see design.md Decision 3 — minimum-order threshold as externally sourced data.
 */
@Injectable()
export abstract class MerchantTermsRepository {
  /**
   * Look up merchant terms by merchant identifier.
   * Returns null when no terms are known for this merchant (no threshold
   * information available — caller should treat as eligible).
   */
  abstract findByMerchant(
    merchantId: string,
  ): Promise<MerchantTermsRecord | null>;

  /**
   * Insert or update merchant terms keyed by merchantId (unique).
   * Returns the upserted row.
   */
  abstract upsert(
    record: typeof merchantTerms.$inferInsert,
  ): Promise<MerchantTermsRecord>;
}

// ---------------------------------------------------------------------------
// Basket-calculation-record repository abstraction
// ---------------------------------------------------------------------------

/**
 * Persisted basket-calculation-record row (raw schema shape).
 *
 * Mirrors calculationRecords but stores the full multi-product input
 * (inputBasket JSON) and per-shipment itemized breakdown that the
 * single-product calculationRecords table cannot represent.
 */
export type BasketCalculationRecord = typeof basketCalculationRecords.$inferSelect;

/**
 * Basket-calculation-record repository — every basket-optimization result
 * shown to a user.
 *
 * Write-once, read-many. Enables auditability, correction, and
 * confidence-based ranking for the basket-optimizer path.
 *
 * @see design.md Decision 5 — basketCalculationRecords persistence.
 */
@Injectable()
export abstract class BasketCalculationRecordRepository {
  /**
   * Persist one basket calculation result (insert only — never update or
   * delete). Returns the full persisted row.
   */
  abstract create(
    record: typeof basketCalculationRecords.$inferInsert,
  ): Promise<BasketCalculationRecord>;

  /**
   * Look up a basket calculation record by its primary key.
   * Returns null when no record exists for this id.
   */
  abstract findById(
    id: number,
  ): Promise<BasketCalculationRecord | null>;
}