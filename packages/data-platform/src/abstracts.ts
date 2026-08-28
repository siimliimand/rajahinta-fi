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
import type { PriceObservation, TransportArrangement } from '@rajahinta/core-domain';
import {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  accounts,
  savedBaskets,
  savedScenarios,
  priceObservations,
  priceHistorySummaries,
  merchantTerms,
  basketCalculationRecords,
  fxRateDatasets,
  fxRates,
  sessions,
  clickCounterSnapshots,
  merchantRegistry,
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

  /**
   * Ranked search over name, brand, and manufacturer (task 5.1, change
   * technical-assessment-remediation) — pg_trgm similarity ranking with
   * a product-id tiebreaker, backed by the gin_trgm_ops indexes of
   * migration 0016_product_search_pg_trgm.
   *
   * Concrete (not abstract) with a loud default so the many in-memory
   * test doubles extending this class keep compiling; only the Drizzle
   * implementation supports it, matching every real wiring.
   */
  searchRanked(
    _query: string,
    _limit: number,
  ): Promise<(typeof productMaster.$inferSelect)[]> {
    return Promise.reject(
      new Error('searchRanked is not implemented by this repository'),
    );
  }

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
   * Claim an anonymous calculation record for a session account: stamp
   * `session_id` on the record, first claim wins. Returns false when the
   * record does not exist or is already linked to another session — an
   * idempotent no-op for the caller, never a re-assignment.
   */
  abstract linkSession(
    recordId: number,
    sessionId: string,
  ): Promise<boolean>;

  /**
   * Return the session's calculation history as the minimal GDPR-export
   * projection (record identity, timestamp, total, quantity, product
   * name) — chronological by calculatedAt, product name joined from the
   * product master. No breakdown or input data: the export carries only
   * what its consumers render.
   */
  abstract findHistoryEntriesBySession(
    sessionId: string,
  ): Promise<CalculationHistoryEntry[]>;

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

/** Minimal per-calculation entry for the account history / GDPR export. */
export interface CalculationHistoryEntry {
  readonly calculationId: number;
  readonly calculatedAt: Date;
  readonly totalCents: number;
  readonly quantity: number;
  readonly productName: string;
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
   * Persist a verified email on an account (task 2.4 / FIX-E, change
   * technical-assessment-remediation) — the anonymous-upgrade write that
   * replaces the placeholder address on the documented verified-email
   * column. Throws when no account exists for the userId: a silent
   * no-op would lose the verification.
   */
  abstract setVerifiedEmail(userId: string, email: string): Promise<void>;

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
// Session repository abstraction
// ---------------------------------------------------------------------------

/** Persisted session row (raw schema shape — tokenHash only, never a token). */
export type SessionRecord = typeof sessions.$inferSelect;

/**
 * Session repository — server-issued opaque tokens hashed at rest (D3).
 *
 * Stores and resolves SHA-256 token hashes; raw token values never
 * reach this layer. "Active" means unrevoked and unexpired — an active
 * row is the only thing that authenticates, and account identity is
 * always derived from the row (accountId), never asserted by callers.
 */
@Injectable()
export abstract class SessionRepository {
  /** Insert a session for an account from its token hash. */
  abstract create(
    record: typeof sessions.$inferInsert,
  ): Promise<SessionRecord>;

  /** The active (unrevoked, unexpired) session for a token hash, or null. */
  abstract findActiveByTokenHash(
    tokenHash: string,
  ): Promise<SessionRecord | null>;

  /**
   * Atomically replace one session's credential: insert a successor
   * session and revoke the presented one in a single transaction.
   * Returns null when the presented hash has no active session — a
   * rotated or unknown token never mints a new one. The successor
   * carries rotatedFromId linking to the revoked predecessor.
   */
  abstract rotate(
    tokenHash: string,
    newTokenHash: string,
    expiresAt: Date,
  ): Promise<SessionRecord | null>;

  /** Revoke the active session for a token hash. Returns false when none exists. */
  abstract revokeByTokenHash(tokenHash: string): Promise<boolean>;

  /** Delete sessions that expired before the cutoff — data-minimization housekeeping. */
  abstract deleteExpiredBefore(cutoff: Date): Promise<number>;
}

// ---------------------------------------------------------------------------
// Saved-scenario repository abstraction
// ---------------------------------------------------------------------------

/**
 * Calculator inputs persisted in saved_scenarios.inputs.
 *
 * Mirrors the calculator request minus sessionId — a scenario captures
 * only the input state needed to re-run a calculation against current
 * data; it is never a cached result.
 */
export interface SavedScenarioInputs {
  /** Product master ID the calculation ran against. */
  readonly productId: number;
  /** Quantity of units. */
  readonly quantity: number;
  /** Destination country ISO 3166-1 alpha-2 (e.g. "FI"). */
  readonly destination: string;
  /** Optional carrier override for transport estimation. */
  readonly transportMethod?: string;
  /** How transport is arranged (defaults to SELLER_ARRANGED when absent). */
  readonly transportArrangement?: TransportArrangement;
}

/** Persisted saved-scenario row (raw schema shape). */
export type SavedScenarioRecord = typeof savedScenarios.$inferSelect;

/**
 * Saved scenarios — named calculator input sets scoped to an account.
 *
 * The only write path is upsert-by-name: saving with an existing
 * (accountId, name) replaces the inputs — one row per chosen name, no
 * edit history (data minimization). Reads return scenarios with their
 * inputs so the client can repopulate the calculator; any displayed
 * result comes from re-running the calculation against current data.
 *
 * @see design.md Decision 1 — scenarios are a separate table, upsert-by-name.
 */
@Injectable()
export abstract class SavedScenarioRepository {
  /** Return all scenarios for an account (by account db id). */
  abstract findByAccountId(
    accountId: number,
  ): Promise<SavedScenarioRecord[]>;

  /** Return all scenarios for a user (by external userId via join). */
  abstract findByUserId(
    userId: string,
  ): Promise<SavedScenarioRecord[]>;

  /**
   * Insert or replace the inputs of the scenario named {@code name} for
   * the account — conflict target is the (account_id, name) unique
   * constraint; inputs and updatedAt are refreshed, identity columns
   * are not. Returns the upserted row.
   */
  abstract upsert(
    record: typeof savedScenarios.$inferInsert,
  ): Promise<SavedScenarioRecord>;

  /** Delete a scenario by its primary key, scoped to the owning account. */
  abstract delete(accountId: number, id: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// FX-rate repository abstraction
// ---------------------------------------------------------------------------

/** Persisted FX-rate-dataset row (raw schema shape). */
export type FxRateDatasetRecord = typeof fxRateDatasets.$inferSelect;

/** Persisted FX-rate row (raw schema shape — rate is still the pg numeric string). */
export type FxRateRow = typeof fxRates.$inferSelect;

/**
 * A rate resolved for conversion — dataset version plus the coerced rate.
 *
 * `rate` is a number: the repository boundary is where pg numeric
 * strings become numbers for domain consumers (task 3.5).
 */
export interface ResolvedFxRate {
  /** The published dataset version the rate belongs to (provenance). */
  readonly dataset: FxRateDatasetRecord;
  readonly baseCurrency: string;
  readonly quoteCurrency: string;
  /** Units of quote per 1 base, coerced from the stored numeric. */
  readonly rate: number;
}

/**
 * FX-rate repository — versioned, append-only rate datasets (design D2).
 *
 * Lifecycle: datasets are created PENDING_CONFIRMATION by ingestion and
 * become effective ONLY through {@link publishDataset} — a human-only
 * transition; nothing in this repository auto-publishes. Rates are
 * appendable only while the dataset is unconfirmed; a published version
 * is immutable so past conversions stay reproducible.
 *
 * Rate direction: rows are stored in the source's direction (ECB: base
 * EUR). Resolution matches the exact (base, quote) pair — inversion is
 * domain policy, never performed implicitly here.
 */
@Injectable()
export abstract class FxRateRepository {
  /** Insert a new dataset version (PENDING_CONFIRMATION) with its rates. */
  abstract createDataset(
    record: typeof fxRateDatasets.$inferInsert,
    rates: Omit<typeof fxRates.$inferInsert, 'datasetId'>[],
  ): Promise<FxRateDatasetRecord>;

  abstract findDatasetById(
    id: number,
  ): Promise<FxRateDatasetRecord | null>;

  abstract findDatasetByVersionLabel(
    versionLabel: string,
  ): Promise<FxRateDatasetRecord | null>;

  /**
   * Versions still awaiting operator confirmation (the review queue) —
   * oldest first so review tooling surfaces the oldest pending dataset.
   */
  abstract findPendingDatasets(): Promise<FxRateDatasetRecord[]>;

  /** The PUBLISHED dataset whose effective window covers {@code asOf} (most recent wins). */
  abstract findPublishedDatasetEffectiveOn(
    asOf: Date,
  ): Promise<FxRateDatasetRecord | null>;

  /**
   * Publish a dataset — the only PENDING_CONFIRMATION → PUBLISHED
   * transition, recording who confirmed it. Returns null when the
   * dataset does not exist or is already published.
   */
  abstract publishDataset(
    id: number,
    confirmedBy: string,
  ): Promise<FxRateDatasetRecord | null>;

  /** Rates of a dataset version, ordered by (base, quote). */
  abstract findRatesForDataset(
    datasetId: number,
  ): Promise<FxRateRow[]>;

  /**
   * Resolve the conversion rate for a pair from the PUBLISHED dataset
   * effective on {@code asOf}. Null when no published dataset covers
   * the date or the pair is absent — callers reject, never assume 1:1.
   */
  abstract resolveRate(
    baseCurrency: string,
    quoteCurrency: string,
    asOf: Date,
  ): Promise<ResolvedFxRate | null>;
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
// Merchant-registry repository abstraction
// ---------------------------------------------------------------------------

/** Persisted merchant-registry row (raw schema shape). */
export type MerchantRegistryRecord = typeof merchantRegistry.$inferSelect;

/**
 * Merchant registry — database-backed merchant feed configuration (D7).
 *
 * The ingestion source list comes from these rows; permission state
 * does NOT live here — consumers join with governance permission
 * checks (SourceGovernanceService) keyed by the same merchantId before
 * treating a registry row as permitted. The only write path is upsert
 * by merchantId: onboarding or changing a merchant must not require a
 * deployment.
 */
@Injectable()
export abstract class MerchantRegistryRepository {
  /** All registry rows, ordered by merchantId for deterministic scheduling. */
  abstract list(): Promise<MerchantRegistryRecord[]>;

  abstract findByMerchantId(
    merchantId: string,
  ): Promise<MerchantRegistryRecord | null>;

  /** Insert or update the registry row for a merchant (unique merchantId). */
  abstract upsert(
    record: typeof merchantRegistry.$inferInsert,
  ): Promise<MerchantRegistryRecord>;
}

// ---------------------------------------------------------------------------
// Click-counter-snapshot repository abstraction
// ---------------------------------------------------------------------------

/** Persisted click-counter-snapshot row (raw schema shape). */
export type ClickCounterSnapshotRecord = typeof clickCounterSnapshots.$inferSelect;

/**
 * Click-counter snapshots — the durable archive of the Redis click
 * counters (task 4.3).
 *
 * Written periodically by the snapshot service (one row per merchant
 * URL per run, cumulative count), upserted on the
 * (merchantId, url, capturedAt) key so a re-run of the same capture
 * instant converges instead of duplicating.
 */
@Injectable()
export abstract class ClickCounterSnapshotRepository {
  /**
   * Upsert one batch of snapshot rows sharing a capture instant.
   * Returns the number of rows written.
   */
  abstract appendBatch(
    rows: Omit<typeof clickCounterSnapshots.$inferInsert, 'id'>[],
  ): Promise<number>;
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