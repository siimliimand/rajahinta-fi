/**
 * Import-VAT service — the VAT subdomain's calculation entrypoint.
 *
 * Pure resolution + arithmetic against the versioned dataset in
 * import-vat.dataset.ts; no repository port yet (the dataset ships with the
 * module — see design D5, alks-feed-and-import-vat). Calculator integration
 * wires this service into the itemised cost lines (task 4.3), where the
 * result joins the structural estimated-total-cost disclaimer already
 * carried by calculation results — no new disclaimer mechanism here.
 *
 * @module ImportVatService
 */
import { Injectable } from '@nestjs/common';
import {
  IMPORT_VAT_DATASET,
  type ImportVatVersion,
  type VatComponentAmounts,
} from './import-vat.dataset';
import {
  calculateImportVat,
  resolveImportVatVersion,
  sumBaseComponents,
  type VatBaseComponentAmount,
} from './import-vat.math';

// ---------------------------------------------------------------------------
// Input / result types
// ---------------------------------------------------------------------------

/** Base component amounts in euro-cents, as supplied by the calculator. */
export interface ImportVatInput {
  readonly retailPriceCents: number;
  readonly transportCents: number;
  readonly alcoholExciseCents: number;
  readonly containerDutyCents: number;
}

/** Result of one import-VAT calculation. Amounts are integer cents. */
export interface ImportVatResult {
  /** VAT amount in euro-cents, rounded half-up. */
  readonly vatCents: number;
  /** Rate percentage that produced the tax (24, 25.5). */
  readonly ratePercent: number;
  /** Dataset version identity that produced the tax. */
  readonly rateVersionId: string;
  /** Base total in euro-cents (sum of the breakdown). */
  readonly baseCents: number;
  /** Each base component named with its own amount, in rule order. */
  readonly baseBreakdown: readonly VatBaseComponentAmount[];
  /** VERIFIED when the resolved version carries a confirmation date. */
  readonly reliability: 'VERIFIED' | 'ESTIMATED';
  /** When the calculation was performed. */
  readonly calculatedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Calculate Finnish import VAT from the versioned dataset.
 *
 * Same reliability convention as the excise engine: a version with a
 * `verificationDate` yields VERIFIED; a version without one (a future
 * unconfirmed entry) yields ESTIMATED — never a silent guess.
 */
@Injectable()
export class ImportVatService {
  /** Resolved dataset — overridable in tests for version-stability pins. */
  private readonly dataset: readonly ImportVatVersion[];

  constructor(dataset: readonly ImportVatVersion[] = IMPORT_VAT_DATASET) {
    this.dataset = dataset;
  }

  /**
   * Calculate import VAT for the given base components.
   *
   * @param input  Base component amounts in euro-cents.
   * @param asOf   Effective-date lookup (defaults to now).
   */
  calculate(input: ImportVatInput, asOf?: Date): ImportVatResult {
    const lookupDate = asOf ?? new Date();
    const version = resolveImportVatVersion(lookupDate, this.dataset);

    const amounts: VatComponentAmounts = {
      retailPrice: input.retailPriceCents,
      transport: input.transportCents,
      alcoholExcise: input.alcoholExciseCents,
      containerDuty: input.containerDutyCents,
    };
    const { breakdown, baseCents } = sumBaseComponents(version.baseComponents, amounts);
    const vatCents = calculateImportVat(baseCents, version.ratePercent);

    return {
      vatCents,
      ratePercent: version.ratePercent,
      rateVersionId: version.versionId,
      baseCents,
      baseBreakdown: breakdown,
      reliability: version.verificationDate !== null ? 'VERIFIED' : 'ESTIMATED',
      calculatedAt: lookupDate,
    };
  }
}
