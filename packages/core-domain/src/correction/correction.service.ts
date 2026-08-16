/**
 * Correction service.
 *
 * Provides the ability to flag calculations or data points as potentially
 * incorrect, and to resolve those flags through human review. Every flag
 * preserves an audit trail back to the original data (input snapshots for
 * calculations, entity references for data points).
 *
 * The service delegates persistence to an {@link ICorrectionRepository}
 * adapter wired at the composition root. For calculation flags, it also
 * requires an {@link ICalculationRecordQuery} to capture the input snapshot
 * at flag time.
 *
 * @module CorrectionService
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CORRECTION_REPOSITORY_PORT,
  CORRECTION_CALCULATION_RECORD_QUERY_PORT,
  type ICorrectionRepository,
  type ICorrectionCalculationRecordQuery,
} from './correction-repository.port';
import type { FlaggedItem, FlagTargetType } from './correction.types';

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when attempting to flag a calculation record that does not exist.
 */
export class CalculationNotFoundError extends Error {
  readonly calculationRecordId: number;

  constructor(calculationRecordId: number) {
    super(`Calculation record ${calculationRecordId} not found`);
    this.name = 'CalculationNotFoundError';
    this.calculationRecordId = calculationRecordId;
  }
}

/**
 * Thrown when attempting to resolve a flag that does not exist.
 */
export class FlagNotFoundError extends Error {
  readonly flagId: number;

  constructor(flagId: number) {
    super(`Flagged item ${flagId} not found`);
    this.name = 'FlagNotFoundError';
    this.flagId = flagId;
  }
}

/**
 * Thrown when attempting to resolve a flag that is already resolved.
 */
export class FlagAlreadyResolvedError extends Error {
  readonly flagId: number;
  readonly currentStatus: string;

  constructor(flagId: number, currentStatus: string) {
    super(
      `Flagged item ${flagId} is already ${currentStatus} and cannot be resolved again`,
    );
    this.name = 'FlagAlreadyResolvedError';
    this.flagId = flagId;
    this.currentStatus = currentStatus;
  }
}

@Injectable()
export class CorrectionService {
  private readonly logger = new Logger(CorrectionService.name);

  constructor(
    @Inject(CORRECTION_REPOSITORY_PORT)
    private readonly repository: ICorrectionRepository,

    @Inject(CORRECTION_CALCULATION_RECORD_QUERY_PORT)
    private readonly calculationQuery: ICorrectionCalculationRecordQuery,
  ) {}

  /**
   * Flag a calculation record as potentially incorrect.
   *
   * Looks up the original `CalculationRecord` by ID and captures its full
   * content as the `inputSnapshot` in the flag. This ensures the audit trail
   * is preserved even if the original record is later modified or deleted.
   *
   * @param calculationRecordId — ID of the calculation record to flag.
   * @param reason              — Human-readable explanation.
   * @param flaggedBy           — Who flagged this (user or staff ID).
   * @returns                   — The created FlaggedItem.
   * @throws {CalculationNotFoundError} — If the calculation record does not exist.
   */
  async flagCalculation(
    calculationRecordId: number,
    reason: string,
    flaggedBy: string,
  ): Promise<FlaggedItem> {
    const record = await this.calculationQuery.findById(calculationRecordId);

    if (record === null) {
      throw new CalculationNotFoundError(calculationRecordId);
    }

    const flag = await this.repository.create({
      targetType: 'calculation',
      targetId: calculationRecordId,
      reason,
      flaggedBy,
      inputSnapshot: record,
    });

    this.logger.log(
      `Calculation ${calculationRecordId} flagged by ${flaggedBy}: ${reason}`,
    );

    return flag;
  }

  /**
   * Flag a data point (product, retail offer, transport offer, or tax rule)
   * as potentially incorrect.
   *
   * Unlike `flagCalculation`, data-point flags do not capture a snapshot
   * — the flag links to the original entity by type and ID.
   *
   * @param entityType — Type of entity being flagged.
   * @param entityId   — ID of the entity being flagged.
   * @param reason     — Human-readable explanation.
   * @param flaggedBy  — Who flagged this (user or staff ID).
   * @returns          — The created FlaggedItem.
   */
  async flagDataPoint(
    entityType: Exclude<FlagTargetType, 'calculation'>,
    entityId: number,
    reason: string,
    flaggedBy: string,
  ): Promise<FlaggedItem> {
    const flag = await this.repository.create({
      targetType: entityType,
      targetId: entityId,
      reason,
      flaggedBy,
      inputSnapshot: null,
    });

    this.logger.log(
      `${entityType} ${entityId} flagged by ${flaggedBy}: ${reason}`,
    );

    return flag;
  }

  /**
   * Resolve a flagged item with a decision.
   *
   * Only flags with status `OPEN` can be resolved. Attempting to resolve
   * an already-resolved flag throws {@link FlagAlreadyResolvedError}.
   *
   * @param flagId     — ID of the flag to resolve.
   * @param resolution — `'ACCEPTED'` or `'REJECTED'`.
   * @param resolvedBy — Who resolved this flag.
   * @param note       — Optional note attached at resolution time.
   * @throws {FlagNotFoundError}        — If the flag does not exist.
   * @throws {FlagAlreadyResolvedError} — If the flag is already resolved.
   */
  async resolveFlaggedItem(
    flagId: number,
    resolution: 'ACCEPTED' | 'REJECTED',
    resolvedBy: string,
    note?: string,
  ): Promise<void> {
    const existing = await this.repository.findById(flagId);

    if (existing === null) {
      throw new FlagNotFoundError(flagId);
    }

    if (existing.status !== 'OPEN') {
      throw new FlagAlreadyResolvedError(flagId, existing.status);
    }

    await this.repository.resolve(flagId, {
      status: resolution,
      resolvedBy,
      resolution,
      note: note ?? null,
    });

    this.logger.log(
      `Flag ${flagId} resolved as ${resolution} by ${resolvedBy}`,
    );
  }

  /**
   * List all flagged items that are still OPEN and awaiting review.
   *
   * @returns — Array of open FlaggedItem records, newest first.
   */
  async listOpenFlags(): Promise<FlaggedItem[]> {
    return this.repository.findOpen();
  }
}