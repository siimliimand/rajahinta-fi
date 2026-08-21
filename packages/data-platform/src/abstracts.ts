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
import {
  productMaster,
  retailOffers,
  taxRules,
  transportOffers,
  calculationRecords,
  accounts,
  savedBaskets,
} from './schema';

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