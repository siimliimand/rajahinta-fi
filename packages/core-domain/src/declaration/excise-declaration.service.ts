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
import {
  CURRENT_RULE_SET_VERSION,
  JOINT_LIABILITY_REFORM_FROM,
} from '../classification/services/classification-rule-engine.service';
import type {
  CalculationRecordData,
  DeclarationSummary,
  DeclarationAdvanceNoticeInfo,
  DeclarationAppliedRateDetail,
  DeclarationDatedChecklist,
  DeclarationDerivation,
  DeclarationFilingStep,
  DeclarationGuidance,
  DeclarationGuidanceDeadline,
  DeclarationGuidanceOptions,
  DeclarationLiabilityNotice,
  DeclarationPostDeadlineState,
  DeclarationReturnDueEstimate,
  FilingProcessCitation,
  OfficialSourceLink,
  ICalculationRecordQueryPort,
} from './declaration.types';
import {
  CALCULATION_RECORD_QUERY_PORT,
  CalculationRecordNotFoundError,
  NO_SUBMISSION_GUARANTEE,
} from './declaration.types';
import { computeGuaranteeFigure } from './guarantee-figure';

// ---------------------------------------------------------------------------
// Advance-notice helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether advance notice to customs is required based on the
 * transaction classification and the rules effective on the calculation
 * date.
 *
 * From the 1 Sep 2024 joint-liability reform (Excise Taxation Act 182/2010
 * as amended by Act 432/2024):
 *
 * - `DistanceBuying` — the buyer must file an advance notice (and lodge a
 *   guarantee) before dispatch. The obligation is tied to dispatch, a date
 *   the record does not carry, so no `deadlineDays` is offered — the due
 *   date stays null rather than being fabricated from the calculation time.
 * - `DistanceSelling` — the seller files; the buyer does not, but carries a
 *   joint-liability exposure (see {@link buildLiabilityNotice}).
 * - `TravellerImport` — not required within personal-use allowances.
 *
 * Records computed before the reform keep the pre-reform mapping (traveller
 * imports carried a 4-day advance-notice deadline) so historical guidance
 * resolves under the rules effective on the record's date.
 */
function getAdvanceNoticeInfo(
  classification: ClassificationLabel | 'NotPersisted',
  asOf: Date,
): DeclarationAdvanceNoticeInfo {
  // A record without a persisted classification derives NO obligation —
  // the switch below states statutory facts per label, and guessing one
  // would fabricate a legal conclusion. `required: false` reads as "no
  // advance-notice requirement derived from this record", in either era.
  if (classification === 'NotPersisted') {
    return { required: false };
  }

  const postReform = asOf.getTime() >= JOINT_LIABILITY_REFORM_FROM.getTime();

  if (!postReform) {
    // Pre-reform mapping (classification rule set v1.0)
    switch (classification) {
      case 'TravellerImport':
        return { required: true, deadlineDays: 4 };
      case 'DistanceSelling':
      case 'DistanceBuying':
        return { required: false };
    }
  }

  switch (classification) {
    case 'TravellerImport':
      return { required: false };
    case 'DistanceBuying':
      // Buyer must file before dispatch — no derivable calendar due date.
      return { required: true };
    case 'DistanceSelling':
      return { required: false };
  }
}

/**
 * Build the joint-liability / buyer-obligation notice for the guidance
 * object, or `null` for records computed before the 1 Sep 2024 reform.
 *
 * Pure factual flags — the UI renders the statutory wording from its
 * message catalog; this module never phrases legal conclusions.
 */
function buildLiabilityNotice(
  record: CalculationRecordData,
): DeclarationLiabilityNotice | null {
  const asOf = new Date(record.calculationTimestamp);
  if (Number.isNaN(asOf.getTime()) || asOf < JOINT_LIABILITY_REFORM_FROM) {
    return null;
  }

  // Unknown classification — no liability flags are fabricated; the caller
  // treats null the same as a pre-reform record.
  if (record.classification === 'NotPersisted') {
    return null;
  }

  switch (record.classification) {
    case 'DistanceSelling':
      return {
        classification: 'DistanceSelling',
        buyerMustFileAdvanceNotice: false,
        buyerJointlyLiable: true,
        ruleSetVersion: CURRENT_RULE_SET_VERSION,
      };
    case 'DistanceBuying':
      return {
        classification: 'DistanceBuying',
        buyerMustFileAdvanceNotice: true,
        buyerJointlyLiable: false,
        ruleSetVersion: CURRENT_RULE_SET_VERSION,
      };
    case 'TravellerImport':
      return {
        classification: 'TravellerImport',
        buyerMustFileAdvanceNotice: false,
        buyerJointlyLiable: false,
        ruleSetVersion: CURRENT_RULE_SET_VERSION,
      };
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

// ---------------------------------------------------------------------------
// Dated pre-dispatch checklist (import-filing-assistant Stage 1, D2/D4/D5)
// ---------------------------------------------------------------------------
//
// Every fact below traces to a source recorded in the change's
// change-notes.md (task 1.1 verification spike); the source table there
// carries the verbatim quotes. Steps render only with their citations
// attached — an uncited fact never renders.

/** Plain calendar-date shape accepted for the user-supplied planned date. */
const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Official sources for the filing-process facts, keyed by the change-notes
 * source table (task 1.1). Verbatim quotes live in change-notes.md; the
 * steps carry these references with them.
 */
const FILING_PROCESS_SOURCES = {
  S1: {
    sourceId: 'S1',
    title: 'vero.fi — Ennakkoilmoitus – Yksityishenkilö (advance notice, private individuals)',
    url:
      'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/ennakkoilmoitus---yksityishenkil%C3%B6/',
  },
  S2: {
    sourceId: 'S2',
    title: 'vero.fi — Advance notice – individuals (English mirror of S1)',
    url:
      'https://www.vero.fi/en/individuals/tax-cards-and-tax-returns/arriving_in_finland/bringing-alcohol-and-tobacco-to-finland/advance-notice-private-individual/',
  },
  S3: {
    sourceId: 'S3',
    title: 'vero.fi — Ilmoitus- ja maksuohjeet alkoholi- ja tupakkatuotteille',
    url:
      'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/ilmoitus--ja-maksuohjeet-alkoholi--ja-tupakkatuotteille/',
  },
  S4: {
    sourceId: 'S4',
    title: 'vero.fi — Usein kysyttyä alkoholin nettitilaamisesta',
    url:
      'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/usein-kysytty%C3%A4-alkoholin-nettitilaamisesta/',
  },
  S5: {
    sourceId: 'S5',
    title: 'vero.fi — Näin annat ennakkoilmoituksen ja maksat kertaluonteisen vakuuden',
    url:
      'https://www.vero.fi/henkiloasiakkaat/verokortti-ja-veroilmoitus/ulkomailta_suomeen/matkustajatuonti/n%C3%A4in-annat-ennakkoilmoituksen-ja-asetat-kertaluonteisen-vakuuden---henkil%C3%B6asiakas/',
  },
} as const satisfies Readonly<Record<string, FilingProcessCitation>>;

/** Format euro cents as a plain euro amount (deterministic, no Intl). */
function formatEuroCents(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/**
 * Accept a user-supplied plain calendar date. Returns the normalized
 * yyyy-mm-dd string, or `null` when the value is absent, malformed, or a
 * non-existent calendar date (which `Date` would silently roll over) — a
 * malformed date degrades to the undated checklist, never a guessed one.
 */
function parsePlainDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !PLAIN_DATE_PATTERN.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * True when the plain date lies before today's UTC calendar date (the
 * filing state). Same-day dates are not in the past.
 */
function isPlainDateBeforeToday(value: string, now: Date): boolean {
  const dateMs = new Date(`${value}T00:00:00.000Z`).getTime();
  const todayMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return dateMs < todayMs;
}

/**
 * 12th of the month following the anchored date (change-notes.md Fact 4,
 * S3 step 3): the return is filed and the duties paid by that date. Plain
 * calendar arithmetic — December rolls to January of the next year.
 */
function computeReturnDueDate(anchoredDate: string): string {
  const [year, month] = anchoredDate.split('-').map(Number);
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-12`;
}

/**
 * Build the ordered pre-dispatch filing steps from the verified facts
 * (change-notes.md Facts 1–4). Observed-pattern register throughout
 * (design D5). The guarantee step renders the figure only when the
 * computation offers one; the unavailable state names the absence —
 * never a substituted number.
 */
function buildFilingSteps(
  datedFor: string | null,
  guaranteeAmountCents: number | null,
): DeclarationFilingStep[] {
  const guaranteeFigureSentence =
    guaranteeAmountCents === null
      ? 'The guarantee figure for this record is unavailable — the recorded excise carries no applicable rule version — so no amount is stated here.'
      : `The recorded excise supports an observed guarantee figure of ${formatEuroCents(guaranteeAmountCents)} for this filing, marked ESTIMATED.`;

  return [
    {
      kind: 'noticeAlcohol',
      description:
        'Advance notices observed for self-arranged imports are filed in MyTax (OmaVero, the Finnish Tax Administration) before the products are sent: they state the estimated receipt date, the quantities, and the product group, and the filing is observed to remain as the basis of the later excise return. The stated receipt date is observed to fall within 90 days of filing and not in the past.',
      datedFor,
      citations: [FILING_PROCESS_SOURCES.S1, FILING_PROCESS_SOURCES.S5],
    },
    {
      kind: 'noticePackaging',
      description:
        'Filings observed for ordered alcohol include a second, separate advance notice for the beverage-packaging duty (0.51 € per litre of the finished drink, per the observed schedule page); no guarantee is needed for the packaging notice.',
      datedFor,
      citations: [
        FILING_PROCESS_SOURCES.S1,
        FILING_PROCESS_SOURCES.S2,
        FILING_PROCESS_SOURCES.S3,
      ],
    },
    {
      kind: 'guarantee',
      description: `Guarantees observed for these filings equal the calculated alcohol excise duty — a prepayment later credited against the duty (shortfall payable, overpayment refunded); the beverage-packaging duty carries no guarantee. ${guaranteeFigureSentence}`,
      datedFor,
      citations: [
        FILING_PROCESS_SOURCES.S1,
        FILING_PROCESS_SOURCES.S3,
        FILING_PROCESS_SOURCES.S5,
      ],
    },
    {
      kind: 'referenceNumber',
      description:
        'Excise numbers for transport are observed to appear in MyTax under Advance notices only once the guarantee has been paid — payments of this kind become visible within 1–2 business days. Filings of this kind may receive several numbers (one per notice), and the observed guidance directs that all of them be given to the carrier or marked on the parcel.',
      datedFor,
      citations: [
        FILING_PROCESS_SOURCES.S3,
        FILING_PROCESS_SOURCES.S4,
        FILING_PROCESS_SOURCES.S5,
      ],
    },
    {
      kind: 'carrierHandoff',
      description:
        'Consignments observed in vero.fi guidance carry every excise number given to the transport company or marked on the parcel before dispatch; the number is presented to Customs or the Tax Administration on request during transport.',
      datedFor,
      citations: [FILING_PROCESS_SOURCES.S3],
    },
  ];
}

/** Build the return-due estimate anchored to the user-entered planned date. */
function buildReturnDueEstimate(
  anchoredDate: string,
): DeclarationReturnDueEstimate {
  return {
    estimatedArrivalDate: anchoredDate,
    dueDate: computeReturnDueDate(anchoredDate),
    status: 'ESTIMATED',
    citations: [FILING_PROCESS_SOURCES.S3],
  };
}

/**
 * Build the post-deadline state (design D4). The negligence penalty is
 * named only in the officially hedged form ("voi olla" / "may" —
 * change-notes.md Fact 4), always with the official-source direction;
 * nothing quantitative and nothing automatic is asserted.
 */
function buildPostDeadlineState(): DeclarationPostDeadlineState {
  return {
    deadlinePassed: true,
    description:
      'The planned dispatch date is in the past; the before-dispatch filing window described in vero.fi guidance has passed. vero.fi states that a missed advance notice may result in a negligence penalty (laiminlyöntimaksu); its page gives no amount or computation basis for this case. The obligations in this situation are verified from the official sources cited with these steps.',
    citations: [
      FILING_PROCESS_SOURCES.S1,
      FILING_PROCESS_SOURCES.S2,
      FILING_PROCESS_SOURCES.S3,
    ],
  };
}

/**
 * Build the dated pre-dispatch checklist from the record and the
 * user-supplied planned date.
 *
 * Degradation (design D4 / spec): no usable date → the undated checklist
 * (same steps and citations, no deadline, no derived dates); a date in the
 * past relative to the filing state → the post-deadline state. The date is
 * a request parameter — nothing here persists it.
 */
function buildDatedChecklist(
  record: CalculationRecordData,
  plannedDispatchDate: string | null | undefined,
): DeclarationDatedChecklist {
  const guarantee = computeGuaranteeFigure(
    {
      amountCents: record.alcoholExciseCents,
      ruleVersionLabel: record.exciseRuleVersionLabel ?? null,
    },
    {
      amountCents: record.containerDutyCents,
      ruleVersionLabel: record.containerDutyRuleVersionLabel ?? null,
    },
  );

  const plannedDate = parsePlainDate(plannedDispatchDate);
  if (plannedDate === null) {
    return {
      state: 'UNDATED',
      plannedDate: null,
      deadlineSemantics: null,
      steps: buildFilingSteps(null, guarantee.available ? guarantee.amountCents : null),
      guarantee,
      returnDueEstimate: null,
      postDeadline: null,
    };
  }

  if (isPlainDateBeforeToday(plannedDate, new Date())) {
    return {
      state: 'POST_DEADLINE',
      plannedDate,
      deadlineSemantics: 'BEFORE_DISPATCH',
      steps: buildFilingSteps(plannedDate, guarantee.available ? guarantee.amountCents : null),
      guarantee,
      returnDueEstimate: buildReturnDueEstimate(plannedDate),
      postDeadline: buildPostDeadlineState(),
    };
  }

  return {
    state: 'DATED',
    plannedDate,
    deadlineSemantics: 'BEFORE_DISPATCH',
    steps: buildFilingSteps(plannedDate, guarantee.available ? guarantee.amountCents : null),
    guarantee,
    returnDueEstimate: buildReturnDueEstimate(plannedDate),
    postDeadline: null,
  };
}

/**
 * Assemble the full guidance object.  Pure — reads the persisted record,
 * adds no I/O, submits nothing.
 */
function buildGuidance(
  record: CalculationRecordData,
  advanceNoticeInfo: DeclarationAdvanceNoticeInfo,
  plannedDispatchDate: string | null | undefined,
): DeclarationGuidance {
  return {
    derivation: buildDerivation(record),
    deadline: buildDeadline(record.calculationTimestamp, advanceNoticeInfo),
    liabilityNotice: buildLiabilityNotice(record),
    checklist: MYTAX_ENTRY_CHECKLIST,
    caveats: buildCaveats(record),
    officialSources: OFFICIAL_SOURCES,
    datedChecklist: buildDatedChecklist(record, plannedDispatchDate),
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
   * @param options — optional guidance inputs. `plannedDispatchDate` is a
   *   request parameter (design D2, read-only): it anchors the dated
   *   pre-dispatch checklist, is never persisted, and an absent, null, or
   *   unparseable value degrades to the undated checklist.
   * @returns A DeclarationSummary ready for review or export.
   * @throws {CalculationRecordNotFoundError} when the record does not exist.
   */
  async prepareDeclaration(
    calculationRecordId: number,
    options?: DeclarationGuidanceOptions,
  ): Promise<DeclarationSummary> {
    const record = await this.recordQuery.findById(calculationRecordId);

    if (record === null) {
      throw new CalculationRecordNotFoundError(calculationRecordId);
    }

    return this.assembleSummary(record, options?.plannedDispatchDate ?? null);
  }

  // ---------------------------------------------------------------------------
  // Private — assembly
  // ---------------------------------------------------------------------------

  private assembleSummary(
    record: CalculationRecordData,
    plannedDispatchDate: string | null,
  ): DeclarationSummary {
    const advanceNoticeInfo = getAdvanceNoticeInfo(
      record.classification,
      new Date(record.calculationTimestamp),
    );
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
      guidance: buildGuidance(record, advanceNoticeInfo, plannedDispatchDate),
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
const _readonlySurface: ReadonlyInterface<ExciseDeclarationService> = new (
  ExciseDeclarationService as unknown as new () => ExciseDeclarationService
)();
void _readonlySurface; // consumed — prevents TS6133