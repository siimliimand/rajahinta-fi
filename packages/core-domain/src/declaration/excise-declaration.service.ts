/**
 * ExciseDeclarationService — read-mostly module that packages a completed
 * calculation into a structured summary for Finnish excise declaration.
 *
 * This service does NOT submit to any external system.  It surfaces the data
 * in a declaration-friendly format so the consumer can review and act on it
 * (e.g. link out to MyTax).
 *
 * @module ExciseDeclarationService
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Disclaimer } from '../calculator/calculator.types';
import type { ClassificationLabel } from '../classification/classification.types';
import type {
  CalculationRecordData,
  DeclarationSummary,
  DeclarationAdvanceNoticeInfo,
  ICalculationRecordQueryPort,
} from './declaration.types';
import {
  CALCULATION_RECORD_QUERY_PORT,
  CalculationRecordNotFoundError,
} from './declaration.types';

// ---------------------------------------------------------------------------
// Advance-notice helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether advance notice to customs is required based on the
 * transaction classification.
 *
 * - `TravellerImport` — advance notice required (4-day deadline).
 * - `DistanceSelling` / `DistanceBuying` — not required for most personal
 *   import scenarios.
 */
function getAdvanceNoticeInfo(
  classification: ClassificationLabel,
): DeclarationAdvanceNoticeInfo {
  switch (classification) {
    case 'TravellerImport':
      return { required: true, deadlineDays: 4 };
    case 'DistanceSelling':
    case 'DistanceBuying':
      return { required: false };
  }
}

/**
 * Map a persisted disclaimer text and language to the canonical Disclaimer
 * structure.  Falls back to the Finnish disclaimer when the record contains
 * an unrecognised language.
 */
function mapDisclaimer(
  text: string,
  language: 'fi' | 'en',
  version: string,
): Disclaimer {
  return { text, language, version };
}

// ---------------------------------------------------------------------------
// MyTax link — informational only
// ---------------------------------------------------------------------------

const MYTAX_LINK = 'https://www.vero.fi/asioi-verkossa/mytax/';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExciseDeclarationService {
  constructor(
    @Inject(CALCULATION_RECORD_QUERY_PORT)
    private readonly recordQuery: ICalculationRecordQueryPort,
  ) {}

  /**
   * Prepare a structured declaration summary from a completed calculation
   * record.
   *
   * @param calculationRecordId — ID of the persisted calculation record.
   * @returns A DeclarationSummary ready for review or export.
   * @throws {CalculationRecordNotFoundError} when the record does not exist.
   */
  async prepareDeclaration(
    calculationRecordId: number,
  ): Promise<DeclarationSummary> {
    const record = await this.recordQuery.findById(calculationRecordId);

    if (record === null) {
      throw new CalculationRecordNotFoundError(calculationRecordId);
    }

    return this.assembleSummary(record);
  }

  // ---------------------------------------------------------------------------
  // Private — assembly
  // ---------------------------------------------------------------------------

  private assembleSummary(record: CalculationRecordData): DeclarationSummary {
    const advanceNoticeInfo = getAdvanceNoticeInfo(record.classification);
    const totalExciseCents = record.alcoholExciseCents + record.containerDutyCents;

    return {
      product: {
        name: record.productName,
        brand: record.productBrand,
        category: record.productCategory,
        abv: record.alcoholByVolume,
        volumeLitres: record.volumeLitres,
      },
      units: record.quantity,
      container: {
        type: record.containerType,
        volumeLitres: record.volumeLitres,
        depositSystemStatus: record.depositSystemStatus,
      },
      transport: {
        carrier: record.transportCarrier,
        origin: record.transportOrigin,
        destination: record.transportDestination,
      },
      estimatedExcise: {
        alcoholExciseCents: record.alcoholExciseCents,
        containerDutyCents: record.containerDutyCents,
        totalCents: totalExciseCents,
        confidence: record.confidence,
      },
      advanceNoticeInfo,
      myTaxLink: MYTAX_LINK,
      declarationDate: record.calculationTimestamp,
      disclaimer: mapDisclaimer(
        record.disclaimerText,
        record.disclaimerLanguage,
        record.disclaimerVersion,
      ),
    };
  }
}