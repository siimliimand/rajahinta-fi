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
import type {
  BlacklistEntryStatus,
  BlacklistReportStatus,
  MerchantIdentity,
  OutcomeAccuracyStatistic,
  PriceObservation,
  TransportArrangement,
} from '@rajahinta/core-domain';
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

/**
 * The credential-flow projection of an account row (change
 * email-password-auth): exactly the columns the register/login/verify
 * paths consume, contract-stable across the D1 and pg implementations.
 *
 * `passwordHash` carries the stored PBKDF2 envelope (hashing is the
 * application layer's job — this contract never sees a raw password);
 * null = no credential stored, which the login path treats as a
 * fail-safe 401. `emailVerifiedAt` is null = unverified.
 */
export interface AccountCredentialRecord {
  readonly id: number;
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly tier: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
}

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

  /**
   * Look up an account by email address — the login/credential read
   * (change email-password-auth). The address is normalized to
   * lowercase on write and lookup (uniqueness is the lower(email)
   * unique index, enforced in SQL), so case variants resolve to the
   * same identity. Returns null for unknown addresses — the caller
   * renders the enumeration-uniform response.
   */
  abstract findByEmail(email: string): Promise<AccountCredentialRecord | null>;

  /** Update the lastActiveAt timestamp for a user. */
  abstract updateLastActive(userId: string): Promise<void>;

  /** Delete an account by its external user identifier. */
  abstract delete(userId: string): Promise<void>;

  /** Return all known user IDs — used by retention-policy scans. */
  abstract findAllUserIds(): Promise<string[]>;

  /**
   * Stamp the email-verification instant on the account (change
   * email-password-auth) — the write the emailed single-use token flow
   * performs after consuming a `verify_email` token. This replaces the
   * placeholder-era email-overwrite semantics: the address itself is
   * set at registration, only the verification STATE is written here.
   * Throws when no account exists for the userId: a silent no-op would
   * lose the verification.
   */
  abstract setVerifiedEmail(userId: string, verifiedAt: Date): Promise<void>;

  /**
   * Store the account's password credential envelope (change
   * email-password-auth) — the registration write and the
   * password-reset rehash write. Callers hash first (design D1
   * PBKDF2 envelope); this persists the envelope verbatim and never
   * derives one. Throws when no account exists for the userId.
   */
  abstract setPasswordHash(userId: string, passwordHash: string): Promise<void>;

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

// ---------------------------------------------------------------------------
// Email-token repository abstractions
// ---------------------------------------------------------------------------

/** What a token authorizes — the closed set enforced by the schema CHECK. */
export type EmailTokenPurpose = 'verify_email' | 'password_reset';

/**
 * Persisted email-token row (design D3, change email-password-auth).
 * Timestamps are instants at the contract boundary; only the SHA-256
 * token hash is ever stored or returned — the raw token value exists
 * solely in emailed links and request bodies, above this layer.
 */
export interface EmailTokenRecord {
  readonly id: number;
  readonly accountId: number;
  readonly tokenHash: string;
  readonly purpose: EmailTokenPurpose;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly createdAt: Date;
}

/** Creation input — expiry is caller policy (24 h verify, 1 h reset). */
export interface EmailTokenCreateInput {
  readonly accountId: number;
  /** SHA-256 hex digest of the opaque token — never the raw value. */
  readonly tokenHash: string;
  readonly purpose: EmailTokenPurpose;
  readonly expiresAt: Date;
}

/**
 * Email-token repository — hashed, single-use, purpose-scoped
 * credentials (design D3, change email-password-auth).
 *
 * Lookups are by hash; "active" mirrors the session contract
 * (unconsumed AND unexpired). Consumption sets `usedAt` in the same
 * statement that checks the active predicate, so a replayed or expired
 * token loses: exactly one caller ever sees a token redeem. The
 * invalidation sweep is how a completed flow retires every outstanding
 * same-purpose token of the account.
 */
@Injectable()
export abstract class EmailTokenRepository {
  /** Insert a token from its hash. Returns the persisted row. */
  abstract create(record: EmailTokenCreateInput): Promise<EmailTokenRecord>;

  /**
   * The active (unconsumed, unexpired) token for a (hash, purpose)
   * pair, or null. The purpose is part of the lookup — a token can
   * never authenticate a different flow than it was minted for.
   */
  abstract findActiveByTokenHashAndPurpose(
    tokenHash: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | null>;

  /**
   * Consume the active token for a (hash, purpose) pair: `usedAt` is
   * set in the same statement that checks `usedAt IS NULL AND
   * expiresAt > now`. Returns false when no active token exists
   * (unknown, replayed, expired, or wrong purpose) — replay loses.
   */
  abstract consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
  ): Promise<boolean>;

  /**
   * Mark every outstanding (unconsumed) same-purpose token of the
   * account used — the sweep a confirmed verification or completed
   * reset runs so superseded tokens can never redeem. Returns the
   * number of tokens retired.
   */
  abstract invalidateAllForAccount(
    accountId: number,
    purpose: EmailTokenPurpose,
  ): Promise<number>;
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

// ---------------------------------------------------------------------------
// Trust repositories — shop reports, blacklist entries, calculation
// outcomes (task 1.3, change trust-and-reach-roadmap)
// ---------------------------------------------------------------------------

/**
 * Moderation state of a shop-report row as the schema CHECK admits it
 * (migration 0015: OPEN | LINKED | REJECTED).
 *
 * The core-domain `BlacklistReportStatus` ('OPEN' | 'LINKED') models the
 * published-standard path, where a report survives moderation only by
 * becoming LINKED evidence. The storage layer is one state wider: the
 * ops console can also REJECT a report outright (evidence did not
 * survive review), which the schema records on the row. Union keeps the
 * repository honest about what the column actually holds.
 */
export type ShopReportStatus = BlacklistReportStatus | 'REJECTED';

/** Persisted shop-report row — camelCase projection of the snake_case D1 row. */
export interface ShopReportRecord {
  readonly id: number;
  /** Normalized merchant domain (lowercase host) — half of the identity key. */
  readonly merchantDomain: string;
  /** Merchant name in NORMALIZED form — the other identity half. */
  readonly merchantNameNormalized: string;
  /** Order reference proving a real transaction — mandatory evidence. */
  readonly orderReference: string;
  /** Reporter's digest of the correspondence — mandatory evidence. */
  readonly correspondenceSummary: string;
  readonly reporterAccountId: number;
  readonly status: ShopReportStatus;
  /** Published entry this report backs; null while OPEN/REJECTED. */
  readonly linkedEntryId: number | null;
  readonly createdAt: Date;
}

/** Submission input — every report lands OPEN; moderation moves it. */
export interface ShopReportCreateInput {
  readonly merchantDomain: string;
  readonly merchantNameNormalized: string;
  readonly orderReference: string;
  readonly correspondenceSummary: string;
  readonly reporterAccountId: number;
}

/**
 * Shop-report repository — user-reported non-delivery/counterfeit
 * evidence against foreign merchants, keyed by the derived merchant
 * identity (normalized domain + normalized name — no registry row).
 *
 * Normalization is core-domain's job ({@link MerchantIdentity}); this
 * layer stores and matches the already-normalized values verbatim.
 *
 * State machine (enforced by guarded UPDATEs, so a transition attempted
 * from the wrong state matches no row and returns null rather than
 * coercing): OPEN → LINKED (backs a published entry, terminal) or
 * OPEN → REJECTED (terminal).
 */
@Injectable()
export abstract class ShopReportRepository {
  /** Insert one report as OPEN. Returns the persisted row. */
  abstract create(input: ShopReportCreateInput): Promise<ShopReportRecord>;

  abstract findById(id: number): Promise<ShopReportRecord | null>;

  /** Every report against one merchant identity — evidence accumulation, id ASC. */
  abstract findByMerchantIdentity(
    identity: MerchantIdentity,
  ): Promise<ShopReportRecord[]>;

  /** One account's own reports — the GDPR/erasure-scoped read, id ASC. */
  abstract findByReporterAccountId(
    accountId: number,
  ): Promise<ShopReportRecord[]>;

  /** The OPEN moderation queue, oldest first. */
  abstract findOpen(): Promise<ShopReportRecord[]>;

  /** OPEN → REJECTED (terminal). Null when the report is absent or not OPEN. */
  abstract reject(id: number): Promise<ShopReportRecord | null>;

  /**
   * OPEN → LINKED, stamping the published entry this report backs
   * (terminal — a report links to at most one entry, ever). Null when
   * the report is absent or not OPEN.
   */
  abstract linkToEntry(
    id: number,
    entryId: number,
  ): Promise<ShopReportRecord | null>;
}

/** Persisted blacklist-entry row — camelCase projection of the snake_case D1 row. */
export interface BlacklistEntryRecord {
  readonly id: number;
  /** Normalized merchant domain — half of the identity key. */
  readonly merchantDomain: string;
  /** Merchant name in NORMALIZED form — the other identity half. */
  readonly merchantNameNormalized: string;
  /** Which published standard was met — value set owned by core-domain. */
  readonly standardMet: string;
  readonly publishedAt: Date;
  /** Operator who published the entry — the manual-step audit face. */
  readonly publishedBy: string;
  readonly status: BlacklistEntryStatus;
  readonly appealedAt: Date | null;
  readonly appealReason: string | null;
}

/** Publication input — an entry is born PUBLISHED or not at all. */
export interface BlacklistEntryPublishInput {
  readonly merchantIdentity: MerchantIdentity;
  readonly standardMet: string;
  readonly publishedBy: string;
}

/** Appeal input — stamped on the row as the entry moves to REOPENED. */
export interface BlacklistEntryAppealInput {
  readonly appealedAt: Date;
  readonly appealReason: string;
}

/**
 * Blacklist-entry repository — the published merchant warnings.
 *
 * Lifecycle (each transition a guarded UPDATE): created PUBLISHED by
 * the explicit operator publish action (no automatic path exists); an
 * appeal moves PUBLISHED → REOPENED (hidden from public display
 * immediately); the operator resolution returns REOPENED → PUBLISHED or
 * ends it REJECTED (terminal). Entries are governance records and are
 * never deleted — there is deliberately no delete method.
 */
@Injectable()
export abstract class BlacklistRepository {
  /** Create the entry PUBLISHED (the only birth state). */
  abstract publish(
    input: BlacklistEntryPublishInput,
  ): Promise<BlacklistEntryRecord>;

  abstract findById(id: number): Promise<BlacklistEntryRecord | null>;

  /**
   * The public display join: PUBLISHED entries for one merchant
   * identity only — REOPENED hide immediately (spec: appeal path),
   * REJECTED never display again.
   */
  abstract findPublishedByIdentity(
    identity: MerchantIdentity,
  ): Promise<BlacklistEntryRecord[]>;

  /** Every entry regardless of status — the ops console view, id ASC. */
  abstract list(): Promise<BlacklistEntryRecord[]>;

  /** PUBLISHED → REOPENED, stamping the appeal. Null when absent or not PUBLISHED. */
  abstract appeal(
    id: number,
    input: BlacklistEntryAppealInput,
  ): Promise<BlacklistEntryRecord | null>;

  /** REOPENED → PUBLISHED (appeal denied). Null when absent or not REOPENED. */
  abstract resolveRepublish(id: number): Promise<BlacklistEntryRecord | null>;

  /** REOPENED → REJECTED (appeal upheld, terminal). Null when absent or not REOPENED. */
  abstract resolveReject(id: number): Promise<BlacklistEntryRecord | null>;
}

/** Persisted calculation-outcome row — camelCase projection of the snake_case D1 row. */
export interface CalculationOutcomeRecord {
  readonly id: number;
  /** calculation_records.id this outcome reports on — by convention, NOT an FK. */
  readonly calculationRecordId: number;
  readonly reporterAccountId: number;
  /** Digest of the frozen estimate fields (JSON-parsed) — keeps the outcome explainable once the record is pruned. */
  readonly estimateDigest: unknown;
  readonly estimatedTotalCents: number;
  readonly reportedTotalCents: number;
  readonly reportedAt: Date;
}

/** Submission input — the duplicate guard is the (record, account) unique index. */
export interface CalculationOutcomeCreateInput {
  readonly calculationRecordId: number;
  readonly reporterAccountId: number;
  readonly estimateDigest: unknown;
  readonly estimatedTotalCents: number;
  readonly reportedTotalCents: number;
}

/** Half-open read period over reportedAt — null bounds are unbounded. */
export interface OutcomeReadPeriod {
  /** Inclusive lower bound on reportedAt; null/absent = no lower bound. */
  readonly from?: Date | null;
  /** Exclusive upper bound on reportedAt; null/absent = no upper bound. */
  readonly to?: Date | null;
}

/**
 * A second outcome for an already-reported (calculation record,
 * account) pair — the (record, account) unique index rejected the
 * insert. The stored outcome is untouched; the API surfaces this as
 * 409 (spec: OUTCOME_ALREADY_EXISTS maps to 409 and must leave the
 * stored outcome untouched).
 */
export class DuplicateOutcomeError extends Error {
  readonly calculationRecordId: number;
  readonly reporterAccountId: number;

  constructor(calculationRecordId: number, reporterAccountId: number) {
    super(
      `calculation outcome already exists for record ${calculationRecordId} ` +
        `and account ${reporterAccountId} — at most one outcome per (record, account)`,
    );
    this.name = 'DuplicateOutcomeError';
    this.calculationRecordId = calculationRecordId;
    this.reporterAccountId = reporterAccountId;
  }
}

/**
 * Calculation-outcome repository — user-reported actual totals for
 * shown calculations, at most one per (record, account).
 *
 * Data-layer only: the submission window/ownership validation lives in
 * the core-domain outcomes module; this repository persists validated
 * submissions and serves the read side. The (calculation_record_id,
 * reporter_account_id) unique index IS the duplicate guard — a second
 * report for the same pair is a typed conflict, never an overwrite.
 *
 * Aggregation semantics (spec calculation-outcomes): the within-margin
 * comparison is inclusive at {@link WITHIN_MARGIN_FRACTION} of the
 * estimate; an empty sample yields count 0 and a **null** share — an
 * honest "no data yet", never a fabricated percentage. Period bounds
 * are half-open [from, to) on reportedAt, matching the observation-log
 * bucket convention.
 */
@Injectable()
export abstract class CalculationOutcomeRepository {
  /**
   * Insert one outcome. Rejects with the implementation's typed
   * duplicate-conflict error (D1: {@link DuplicateOutcomeError}) when an
   * outcome for the (record, account) pair already exists — the API
   * surfaces it as 409; the stored row is never overwritten.
   */
  abstract create(
    input: CalculationOutcomeCreateInput,
  ): Promise<CalculationOutcomeRecord>;

  abstract findById(id: number): Promise<CalculationOutcomeRecord | null>;

  /** Outcomes reported for one calculation record, id ASC. */
  abstract findByCalculationRecordId(
    calculationRecordId: number,
  ): Promise<CalculationOutcomeRecord[]>;

  /** One account's own outcomes — the account-scoped read, id ASC. */
  abstract findByReporterAccountId(
    accountId: number,
  ): Promise<CalculationOutcomeRecord[]>;

  /** Stored-outcome count within the period. */
  abstract countByPeriod(period: OutcomeReadPeriod): Promise<number>;

  /**
   * The public accuracy statistic over the period: sample count and
   * within-margin share, with {@code asOf} passed through as the
   * injected computation instant. Empty sample → count 0 and a null
   * share (never a fabricated percentage).
   */
  abstract findAccuracyStatistic(
    period: OutcomeReadPeriod,
    asOf: Date,
  ): Promise<OutcomeAccuracyStatistic>;
}

// ---------------------------------------------------------------------------
// Content / share / newsletter repositories (task 1.4, change
// trust-and-reach-roadmap)
// ---------------------------------------------------------------------------

/** Publication state of a blog post — DRAFT until the operator publish. */
export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';

/**
 * Content kind of a blog post (change insight-surfaces, task 2): the
 * rate-change explainer stream vs evergreen guides. Existing rows keep
 * RATE_CHANGE via the column default — no backfill (design D3).
 */
export type BlogPostKind = 'RATE_CHANGE' | 'GUIDE';

/** Persisted blog-post row — camelCase projection of the snake_case D1 row. */
export interface BlogPostRecord {
  readonly id: number;
  /** URL slug — the public lookup half, unique per locale. */
  readonly slug: string;
  /** Content locale (BCP-47 — 'fi'/'en' at launch). */
  readonly locale: string;
  readonly title: string;
  /** Markdown body — must pass the content-policy lint before publication. */
  readonly bodyMarkdown: string;
  readonly status: BlogPostStatus;
  /** Content kind — RATE_CHANGE explainers vs GUIDE evergreen content. */
  readonly kind: BlogPostKind;
  /** Rate dataset version the post explains (version_label vocabulary); null without a rate tie-in. */
  readonly rateDatasetVersion: string | null;
  /** When published — null while DRAFT. */
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
}

/** Creation input — every post lands DRAFT; publication is explicit. */
export interface BlogPostCreateInput {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly rateDatasetVersion?: string | null;
  /**
   * Content kind — defaults to RATE_CHANGE (the column default, the
   * pre-kind row interpretation), so existing create call sites keep
   * their behavior unchanged.
   */
  readonly kind?: BlogPostKind;
}

/** Editable fields of a DRAFT post. Slug/locale/status are not editable. */
export interface BlogPostDraftPatch {
  readonly title?: string;
  readonly bodyMarkdown?: string;
  readonly rateDatasetVersion?: string | null;
}

/**
 * Blog-post repository — rate-change explainers behind a human
 * publication gate. The draft hook at the manual rate-confirmation
 * point creates DRAFT rows (fail-open); only {@link publish} makes a
 * post public, and the public endpoints read PUBLISHED rows only.
 * One row per (slug, locale) — the unique key.
 */
@Injectable()
export abstract class BlogPostRepository {
  /** Insert one post as DRAFT. Rejects on the (slug, locale) unique key. */
  abstract create(input: BlogPostCreateInput): Promise<BlogPostRecord>;

  abstract findById(id: number): Promise<BlogPostRecord | null>;

  /** The unique-key lookup — one (slug, locale) is one post. */
  abstract findBySlugAndLocale(
    slug: string,
    locale: string,
  ): Promise<BlogPostRecord | null>;

  /**
   * Posts of one locale, id ASC. With {@code status} — only that
   * status (public endpoints pass PUBLISHED); without — every status
   * (the ops console view).
   */
  abstract listByLocale(
    locale: string,
    status?: BlogPostStatus,
  ): Promise<BlogPostRecord[]>;

  /**
   * Posts of one locale filtered to one content kind, id ASC — the blog
   * index lists RATE_CHANGE only, the guides surface lists GUIDE only.
   * With {@code status} — only that status (public endpoints pass
   * PUBLISHED); without — every status (the ops view). Kind never
   * widens a status filter; it only narrows the stream.
   */
  abstract listByLocaleAndKind(
    locale: string,
    kind: BlogPostKind,
    status?: BlogPostStatus,
  ): Promise<BlogPostRecord[]>;

  /**
   * Patch a DRAFT post's editable fields (COALESCE semantics — absent
   * keys keep their values). Null when absent or already PUBLISHED:
   * what the public saw is immutable.
   */
  abstract updateDraft(
    id: number,
    patch: BlogPostDraftPatch,
  ): Promise<BlogPostRecord | null>;

  /** DRAFT → PUBLISHED, stamping publishedAt (default: now). Null when absent or not DRAFT. */
  abstract publish(
    id: number,
    publishedAt?: Date,
  ): Promise<BlogPostRecord | null>;

  /** Remove a post; false when absent. */
  abstract delete(id: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Savings-snapshot repository abstraction
// ---------------------------------------------------------------------------

/**
 * Reliability status of a snapshot's landed total — the exact core-domain
 * ReliabilityStatus value set (packages/core-domain/src/reliability/
 * reliability.types.ts), shared with the column's SQL CHECK.
 */
export type SavingsReliabilityStatus = 'VERIFIED' | 'ESTIMATED' | 'STALE' | 'UNAVAILABLE';

/**
 * Aggregate confidence grade of a snapshot — the exact core-domain
 * ConfidenceLevel value set (packages/core-domain/src/reliability/
 * confidence-framework.types.ts), shared with the column's SQL CHECK.
 */
export type SavingsConfidenceGrade = 'HIGH' | 'MEDIUM' | 'LOW';

/** Persisted savings-snapshot row — camelCase projection of the snake_case D1 row. */
export interface SavingsSnapshotRecord {
  readonly id: number;
  /** Snapshot day, 'YYYY-MM-DD' — half of the upsert idempotency key. */
  readonly asOf: string;
  /** Canonical product the snapshot belongs to. */
  readonly productId: number;
  /** Product category (matches product_master.category). */
  readonly category: string;
  /** Merchant of the day's best foreign offer. */
  readonly bestMerchant: string;
  /** Country the best offer ships from (ISO 3166-1 alpha-2). */
  readonly bestMerchantCountry: string;
  /** Best foreign offer price for one unit, in euro-cents (design D4). */
  readonly bestPriceCents: number;
  /** When the best offer was observed. */
  readonly bestObservedAt: Date;
  /** Alko reference price for one unit, in euro-cents — null when not observed that day. */
  readonly alkoReferenceCents: number | null;
  /** When the Alko reference was observed — null with the reference. */
  readonly alkoObservedAt: Date | null;
  /** Estimated landed total for one unit, in euro-cents. */
  readonly landedTotalCents: number;
  /** Reliability of the landed-total composition. */
  readonly landedReliability: SavingsReliabilityStatus;
  /** Aggregate confidence grade of the snapshot. */
  readonly confidence: SavingsConfidenceGrade;
  /** Best-offer vs Alko-reference gap in euro-cents (sign carries the direction). */
  readonly gapCents: number;
  /** The same gap in INTEGER basis points — the float-free ranking key (design D4). */
  readonly gapBasisPoints: number;
  /** Tax-dataset version the landed total was computed against (version_label vocabulary). */
  readonly taxDatasetVersion: string;
}

/**
 * Upsert input — one fully computed daily snapshot. The daily insight
 * job resolves the day's best offer and Alko reference, computes the
 * landed total and the gap, then calls
 * {@link SavingsSnapshotRepository.upsertSnapshot}.
 */
export interface SavingsSnapshotUpsertInput {
  readonly asOf: string;
  readonly productId: number;
  readonly category: string;
  readonly bestMerchant: string;
  readonly bestMerchantCountry: string;
  readonly bestPriceCents: number;
  readonly bestObservedAt: Date;
  readonly alkoReferenceCents: number | null;
  readonly alkoObservedAt: Date | null;
  readonly landedTotalCents: number;
  readonly landedReliability: SavingsReliabilityStatus;
  readonly confidence: SavingsConfidenceGrade;
  readonly gapCents: number;
  readonly gapBasisPoints: number;
  readonly taxDatasetVersion: string;
}

/**
 * Savings-snapshot repository — one materialized row per product per
 * day, the read model behind the savings insight surface. Written
 * exclusively by the daily insight background job; never on the request
 * path.
 *
 * ## Upsert idempotency (design D2)
 *
 * {@link upsertSnapshot} converges on the key {@code (as_of, product_id)}
 * — re-running a day overwrites the computed columns (last write wins)
 * instead of duplicating rows, mirroring the price-history-summary
 * bucket-key contract.
 */
@Injectable()
export abstract class SavingsSnapshotRepository {
  /**
   * Insert or overwrite one day's snapshot keyed by (asOf, productId).
   * Returns the row id (existing id on conflict — the key columns never
   * change).
   */
  abstract upsertSnapshot(
    snapshot: SavingsSnapshotUpsertInput,
  ): Promise<{ id: number }>;

  /**
   * All snapshots of the most recent asOf day present, product_id
   * ascending. Empty when no snapshot has been written yet.
   */
  abstract findLatestDay(): Promise<SavingsSnapshotRecord[]>;

  /**
   * Closed [from, to] asOf range for one category, asOf then product_id
   * ascending — the per-category insight history read (date bounds are
   * ISO 'YYYY-MM-DD' strings, closed like the summary range reads).
   */
  abstract findByCategoryRange(
    category: string,
    from: string,
    to: string,
  ): Promise<SavingsSnapshotRecord[]>;
}

/** Consent lifecycle of a newsletter subscriber. UNSUBSCRIBED is terminal. */
export type NewsletterSubscriberStatus = 'PENDING' | 'ACTIVE' | 'UNSUBSCRIBED';

/** Persisted newsletter-subscriber row — camelCase projection of the snake_case D1 row. */
export interface NewsletterSubscriberRecord {
  readonly id: number;
  /** Subscriber address, stored lowercase (uniqueness is lower(email) in SQL). */
  readonly email: string;
  readonly status: NewsletterSubscriberStatus;
  /** SHA-256 hex digest of the single-use confirmation token — never the raw value. */
  readonly confirmationTokenHash: string;
  readonly confirmedAt: Date | null;
  readonly unsubscribedAt: Date | null;
  readonly createdAt: Date;
}

/** Subscribe input — the caller hashes the token; this layer never sees raw tokens. */
export interface NewsletterSubscribeInput {
  /** Stored lowercased — case variants of one address are one subscriber. */
  readonly email: string;
  /** SHA-256 hex digest of the confirmation token. */
  readonly confirmationTokenHash: string;
}

/**
 * A subscribe for an address that already exists (case-insensitive, the
 * lower(email) unique index). The API surfaces this as 409 / a friendly
 * "already subscribed"; nothing is overwritten.
 */
export class DuplicateNewsletterSubscriptionError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(
      `newsletter subscription already exists for ${email} ` +
        '(uniqueness is case-insensitive on the address)',
    );
    this.name = 'DuplicateNewsletterSubscriptionError';
    this.email = email;
  }
}

/**
 * Newsletter-subscriber repository — double opt-in consent independent
 * of accounts (no account FK; the email is the only identifier).
 * Rows land PENDING with a token hash; only the emailed token confirms
 * (PENDING → ACTIVE) — unconfirmed rows are never mailed. Lookups by
 * hash; the raw token value exists solely in emailed links, above this
 * layer (the email_tokens convention).
 */
@Injectable()
export abstract class NewsletterSubscriberRepository {
  /**
   * Insert a PENDING subscriber (address lowercased). Rejects with
   * {@link DuplicateNewsletterSubscriptionError} when the address
   * already exists (case-insensitive).
   */
  abstract subscribe(
    input: NewsletterSubscribeInput,
  ): Promise<NewsletterSubscriberRecord>;

  abstract findById(id: number): Promise<NewsletterSubscriberRecord | null>;

  /** Case-insensitive address lookup (resolved in SQL on lower(email)). */
  abstract findByEmail(
    email: string,
  ): Promise<NewsletterSubscriberRecord | null>;

  /** The subscriber a confirmation token hashes to, or null. */
  abstract findByConfirmationTokenHash(
    tokenHash: string,
  ): Promise<NewsletterSubscriberRecord | null>;

  /** PENDING → ACTIVE, stamping confirmedAt. Null when absent or not PENDING. */
  abstract confirm(
    id: number,
    confirmedAt: Date,
  ): Promise<NewsletterSubscriberRecord | null>;

  /** → UNSUBSCRIBED (terminal), stamping unsubscribedAt. Null when already unsubscribed or absent. */
  abstract unsubscribe(
    id: number,
    unsubscribedAt: Date,
  ): Promise<NewsletterSubscriberRecord | null>;

  /** Every ACTIVE subscriber — the ops notify-subscribers scan, id ASC. */
  abstract findActive(): Promise<NewsletterSubscriberRecord[]>;
}

/** Persisted share-snapshot row — camelCase projection of the snake_case D1 row. */
export interface ShareSnapshotRecord {
  readonly id: number;
  /** Exactly-22-character random public id — the share URL's sole identifier. */
  readonly publicId: string;
  /** The frozen result copy (JSON-parsed) — self-contained, no account identifiers. */
  readonly frozenResult: unknown;
  readonly createdAt: Date;
}

/** Creation input — the caller generates the public id and freezes the result. */
export interface ShareSnapshotCreateInput {
  readonly publicId: string;
  readonly frozenResult: unknown;
}

/**
 * Share-snapshot repository — frozen calculation results behind
 * unguessable public ids. Write-once: the copy is immutable and
 * carries no account identifiers, so there is no update and no
 * account-scoped read — only create, public-id lookup, and the
 * 12-month hygiene sweep. A public-id collision (unique index) is
 * astronomically unlikely and propagates as a raw constraint error —
 * the generator retries with a fresh id above this layer.
 */
@Injectable()
export abstract class ShareSnapshotRepository {
  /**
   * Insert one snapshot. The public id must be exactly 22 characters
   * (the schema CHECK is the backstop; this guard fails fast with a
   * clear error) and the frozen result must be JSON-serializable.
   */
  abstract create(input: ShareSnapshotCreateInput): Promise<ShareSnapshotRecord>;

  /** The public share lookup — one id, one snapshot. */
  abstract findByPublicId(publicId: string): Promise<ShareSnapshotRecord | null>;

  /** Delete snapshots created before the cutoff (hygiene sweep). Returns rows removed. */
  abstract deleteOlderThan(cutoff: Date): Promise<number>;
}