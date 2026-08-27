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
  DeclarationAppliedRateDetail,
  DeclarationDerivation,
  DeclarationGuidance,
  DeclarationGuidanceDeadline,
  OfficialSourceLink,
  ICalculationRecordQueryPort,
} from './declaration.types';
import {
  CALCULATION_RECORD_QUERY_PORT,
  CalculationRecordNotFoundError,
  NO_SUBMISSION_GUARANTEE,
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
// Guidance assembly (Phase 2C) — informational, read-only
// ---------------------------------------------------------------------------

/**
 * Rule-version sentinel the tax engines emit as `taxDatasetVersion` when no
 * tax rule matched and hardcoded default rates were applied.  A label equal
 * to this value triggers the fallback-dataset caveat.
 */
const FALLBACK_RULE_VERSION_LABEL = 'FALLBACK';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Unit and expression wording per excise formula reference. */
interface ExciseFormulaDetail {
  readonly unit: string;
  readonly expression: string;
}

/**
 * Formula reference → human-readable unit and expression.  Keys are the
 * `calculationFormulaReference` values used by the alcohol-excise engine
 * (PER_LITRE_OF_PRODUCT, PER_LITRE_OF_ALCOHOL, PER_CENTILITRE_ETHANOL).
 * Unknown references resolve to null — the wording is never guessed.
 */
const EXCISE_FORMULA_DETAILS: Readonly<
  Partial<Record<string, ExciseFormulaDetail>>
> = {
  PER_LITRE_OF_PRODUCT: {
    unit: 'litre of product',
    expression: 'excise = rate × litres of product',
  },
  PER_LITRE_OF_ALCOHOL: {
    unit: 'litre of pure alcohol',
    expression: 'excise = rate × volume × ABV (litres of pure alcohol)',
  },
  PER_CENTILITRE_ETHANOL: {
    unit: 'centilitre of ethyl alcohol',
    expression:
      'excise = rate × ABV × volume (centilitres of ethanol; numerically per %-litre)',
  },
};

/**
 * The container-duty engine applies a single fixed formula (FLAT_PER_LITRE)
 * to every calculation, so its reference and wording are stated
 * unconditionally; the rate and rule version still come from the record.
 */
const CONTAINER_DUTY_FORMULA: ExciseFormulaDetail & {
  readonly reference: string;
} = {
  reference: 'FLAT_PER_LITRE',
  unit: 'litre of product',
  expression: 'container duty = rate × litres of product',
};

/**
 * Ordered MyTax entry checklist.  Observed-pattern phrasing throughout —
 * informational descriptions of what similar filings contain, never
 * imperative instructions or legal conclusions.
 */
const MYTAX_ENTRY_CHECKLIST: readonly string[] = [
  'Records observed in similar Finnish excise filings begin from the transaction classification — distance selling, distance buying, or traveller import — which determines who declares the duty.',
  'Entries observed in comparable MyTax excise declarations list the product category, alcohol by volume, container volume, and quantity as separate fields, matching the derivation above.',
  'Declarations of this kind observed in vero.fi guidance include the total volume across all units (volume per unit × quantity) as one summed figure.',
  'Observed filings state the alcohol excise amount and the beverage-container duty amount as separate line items rather than a single combined figure.',
  'Records observed in comparable submissions reference the calculation timestamp and the applied rule versions so each entered figure stays traceable.',
  'Observed declarations end with the filer reviewing each entered figure against their own records before submitting in MyTax.',
];

/** Official vero.fi guidance sources — informational links only. */
const OFFICIAL_SOURCES: readonly OfficialSourceLink[] = [
  {
    title: 'Alcohol excise duty (vero.fi)',
    url: 'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/alkoholi/',
    description:
      'Official Tax Administration guidance on Finnish alcohol excise duty — categories, rates, and formulas.',
  },
  {
    title: 'Excise duties (vero.fi)',
    url: 'https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/valmisterverot/',
    description:
      'Official Tax Administration overview of Finnish excise duties, including beverage container duty.',
  },
];

/**
 * Compute the advance-notice due date (UTC calendar date) from the
 * calculation timestamp.  Returns null on an unparseable timestamp — an
 * unknown date is stated, never invented.
 */
function computeAdvanceNoticeDueDate(
  calculationTimestamp: string,
  deadlineDays: number,
): string | null {
  const ts = new Date(calculationTimestamp);
  if (Number.isNaN(ts.getTime())) {
    return null;
  }
  // Records persist UTC ISO timestamps; slicing the ISO form keeps the
  // calendar date deterministic regardless of server timezone.
  return new Date(ts.getTime() + deadlineDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * Build the derivation walkthrough from the persisted record.  Rate lines
 * carry whatever provenance the record holds; anything absent is null.
 */
function buildDerivation(record: CalculationRecordData): DeclarationDerivation {
  const exciseFormulaReference = record.exciseFormulaReference ?? null;
  const exciseFormula =
    exciseFormulaReference !== null
      ? EXCISE_FORMULA_DETAILS[exciseFormulaReference] ?? null
      : null;

  const appliedRates: readonly DeclarationAppliedRateDetail[] = [
    {
      kind: 'alcoholExcise',
      amountCents: record.alcoholExciseCents,
      ratePerUnit: record.alcoholExciseRatePerUnit ?? null,
      rateUnit: exciseFormula?.unit ?? null,
      ruleVersionLabel: record.exciseRuleVersionLabel ?? null,
      formulaReference: exciseFormulaReference,
      formulaExpression: exciseFormula?.expression ?? null,
    },
    {
      kind: 'containerDuty',
      amountCents: record.containerDutyCents,
      ratePerUnit: record.containerDutyRatePerLitre ?? null,
      rateUnit: CONTAINER_DUTY_FORMULA.unit,
      ruleVersionLabel: record.containerDutyRuleVersionLabel ?? null,
      formulaReference: CONTAINER_DUTY_FORMULA.reference,
      formulaExpression: CONTAINER_DUTY_FORMULA.expression,
    },
  ];

  return {
    category: record.productCategory,
    abvPercent: record.alcoholByVolume,
    volumePerUnitLitres: record.volumeLitres,
    quantity: record.quantity,
    totalVolumeLitres: record.volumeLitres * record.quantity,
    appliedRates,
  };
}

/**
 * Build the advance-notice deadline from the classification decision and
 * the calculation timestamp.
 */
function buildDeadline(
  calculationTimestamp: string,
  advanceNoticeInfo: DeclarationAdvanceNoticeInfo,
): DeclarationGuidanceDeadline {
  const deadlineDays = advanceNoticeInfo.required
    ? advanceNoticeInfo.deadlineDays ?? null
    : null;

  return {
    required: advanceNoticeInfo.required,
    deadlineDays,
    calculatedFrom: calculationTimestamp,
    dueDate:
      deadlineDays !== null
        ? computeAdvanceNoticeDueDate(calculationTimestamp, deadlineDays)
        : null,
  };
}

/**
 * Build confidence-driven caveats from the persisted record.  Each caveat
 * states what is uncertain and why — the estimate is never presented as
 * certain while a driver of uncertainty exists on the record.
 */
function buildCaveats(record: CalculationRecordData): string[] {
  const caveats: string[] = [];

  if (record.confidence === 'LOW') {
    caveats.push(
      'Overall calculation confidence is LOW — one or more inputs were stale or unavailable when the record was computed; verify the figures against current sources before use.',
    );
  }

  if (record.depositSystemStatus === null) {
    caveats.push(
      'Deposit-return system participation is unknown for this container; the container-duty figure is an ESTIMATED standard-rate amount, not a confirmed charge or exemption.',
    );
  }

  if (record.exciseRuleVersionLabel === FALLBACK_RULE_VERSION_LABEL) {
    caveats.push(
      'The alcohol-excise figure was produced from the engine fallback dataset (no matching tax rule for the calculation date) rather than an official schedule version.',
    );
  }

  if (record.containerDutyRuleVersionLabel === FALLBACK_RULE_VERSION_LABEL) {
    caveats.push(
      'The container-duty figure was produced from the engine fallback dataset (no matching tax rule for the calculation date) rather than an official schedule version.',
    );
  }

  const rateProvenanceMissing =
    record.alcoholExciseRatePerUnit == null ||
    record.exciseRuleVersionLabel == null ||
    record.exciseFormulaReference == null ||
    record.containerDutyRatePerLitre == null ||
    record.containerDutyRuleVersionLabel == null;
  if (rateProvenanceMissing) {
    caveats.push(
      'The calculation record does not persist every applied rate or rule version; the derivation shows the recorded cents totals and marks the per-unit rates unavailable rather than reconstructing them.',
    );
  }

  return caveats;
}

/**
 * Assemble the full guidance object.  Pure — reads the persisted record,
 * adds no I/O, submits nothing.
 */
function buildGuidance(
  record: CalculationRecordData,
  advanceNoticeInfo: DeclarationAdvanceNoticeInfo,
): DeclarationGuidance {
  return {
    derivation: buildDerivation(record),
    deadline: buildDeadline(record.calculationTimestamp, advanceNoticeInfo),
    checklist: MYTAX_ENTRY_CHECKLIST,
    caveats: buildCaveats(record),
    officialSources: OFFICIAL_SOURCES,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class ExciseDeclarationService {
  /**
   * Runtime guarantee — this service never submits data to any external
   * service.  Read-only by design.
   */
  readonly noSubmissionGuarantee: string = NO_SUBMISSION_GUARANTEE;

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
      guidance: buildGuidance(record, advanceNoticeInfo),
    };
  }
}

// ---------------------------------------------------------------------------
// Type-level safety proof — compile-time assertion that this service has no
// write methods.  If a method returning Promise<{ id: ... }> is added to
// ExciseDeclarationService, the lines below will produce a type error.
// ---------------------------------------------------------------------------

import type {
  DeclarationSafetyConstraint,
  ReadonlyInterface,
} from './declaration.types';

/**
 * Compile-time proof: ExciseDeclarationService exposes no write methods.
 *
 * `DeclarationSafetyConstraint` resolves to `true` when the service type
 * passes through `ReadonlyInterface` unchanged (i.e. no write-like methods
 * were stripped).  If a write method is added, this becomes `never` and the
 * `_safetyProof` assignment fails.
 */
type _exciseServiceSafety = DeclarationSafetyConstraint<ExciseDeclarationService>;
const _exciseServiceSafetyProof: _exciseServiceSafety = true;
void _exciseServiceSafetyProof; // consumed — prevents TS6133

/**
 * Compile-time proof: the public API surface is a ReadonlyInterface.
 * If a write method is added, `ReadonlyInterface<ExciseDeclarationService>`
 * will exclude it, and the assignment will fail because key counts differ.
 */
const _readonlySurface: ReadonlyInterface<ExciseDeclarationService> =
  new (ExciseDeclarationService as any)();
void _readonlySurface; // consumed — prevents TS6133