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
} from './schema';

// ---------------------------------------------------------------------------
// Repository abstractions
// ---------------------------------------------------------------------------

@Injectable()
export abstract class ProductRepository {
  abstract findById(id: number): Promise<typeof productMaster.$inferSelect | null>;
  abstract findOffers(productId: number): Promise<typeof retailOffers.$inferSelect[]>;

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