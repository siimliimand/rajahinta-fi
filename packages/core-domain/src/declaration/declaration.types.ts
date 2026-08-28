/**
 * Declaration Assistant types — output summary and data-access contracts for
 * the ExciseDeclarationService.
 *
 * @module DeclarationTypes
 */

import type { Disclaimer } from '../calculator/calculator.types';
import type { ClassificationLabel } from '../classification/classification.types';
import type { ConfidenceLevel } from '../reliability/confidence-framework.types';

// ---------------------------------------------------------------------------
// Read model — what the query port returns from a persisted calculation record
// ---------------------------------------------------------------------------

/**
 * Data returned by the calculation-record query port.
 *
 * Contains every field the declaration service needs to assemble a
 * DeclarationSummary.  Adapters join the calculation record with the product
 * master and transport offer as needed.
 */
export interface CalculationRecordData {
  readonly id: number;
  readonly productName: string;
  readonly productBrand: string | null;
  readonly productCategory: string;
  readonly alcoholByVolume: number;
  readonly volumeLitres: number;
  readonly containerType: string;
  readonly depositSystemStatus: boolean | null;
  readonly quantity: number;
  readonly transportCarrier: string | null;
  readonly transportOrigin: string | null;
  readonly transportDestination: string | null;
  readonly alcoholExciseCents: number;
  readonly containerDutyCents: number;
  readonly totalCents: number;
  readonly confidence: ConfidenceLevel;
  readonly classification: ClassificationLabel;
  readonly disclaimerText: string;
  readonly disclaimerLanguage: 'fi' | 'en';
  readonly disclaimerVersion: string;
  readonly calculationTimestamp: string;

  // -------------------------------------------------------------------------
  // Guidance provenance (Phase 2C) — optional, additive.
  //
  // These fields carry the applied-rate details the declaration guidance
  // walkthrough needs.  They are optional because the persisted record and
  // its adapter predate the guidance feature; absence is a real state, not a
  // "for later" placeholder — the guidance degrades factually (marks figures
  // unavailable and emits a caveat) instead of reconstructing them.
  // -------------------------------------------------------------------------

  /**
   * Applied alcohol-excise rate per formula unit, exactly as persisted from
   * the tax engine's `rateApplied`.  The unit is defined by
   * {@link exciseFormulaReference}.  Absent/null when the record does not
   * persist it.
   */
  readonly alcoholExciseRatePerUnit?: number | null;

  /**
   * Applied container-duty rate per litre of product, as persisted from the
   * container-duty engine's `ratePerLitre`.  Absent/null when the record
   * does not persist it.
   */
  readonly containerDutyRatePerLitre?: number | null;

  /**
   * Alcohol-excise rule version label applied at calculation time (the tax
   * engine's `taxDatasetVersion`, e.g. '2025.1', or 'FALLBACK' when the
   * engine applied default rates because no rule matched).  Absent/null when
   * not persisted.
   */
  readonly exciseRuleVersionLabel?: string | null;

  /**
   * Container-duty rule version label applied at calculation time
   * ('2025.1', 'FALLBACK', or 'EXEMPTED' for deposit-system exemptions).
   * Absent/null when not persisted.
   */
  readonly containerDutyRuleVersionLabel?: string | null;

  /**
   * Formula reference constant the applied excise rule specifies (the tax
   * engine's `calculationFormulaReference`, e.g. 'PER_LITRE_OF_ALCOHOL').
   * Absent/null when not persisted.
   */
  readonly exciseFormulaReference?: string | null;
}

// ---------------------------------------------------------------------------
// Port — injected by the data-platform layer
// ---------------------------------------------------------------------------

/**
 * Calculation-record query port.
 *
 * Read-only: declaration assistant never persists anything.  The data-platform
 * layer provides an adapter wired to the calculation_records and product_master
 * tables.
 */
export interface ICalculationRecordQueryPort {
  /**
   * Look up a calculation record by its ID.
   * Returns null when the record does not exist.
   */
  findById(id: number): Promise<CalculationRecordData | null>;
}

/** Injection token for ICalculationRecordQueryPort. */
export const CALCULATION_RECORD_QUERY_PORT = 'CALCULATION_RECORD_QUERY_PORT';

// ---------------------------------------------------------------------------
// Output — DeclarationSummary
// ---------------------------------------------------------------------------

/**
 * Product information section of a declaration summary.
 */
export interface DeclarationProduct {
  readonly name: string;
  readonly brand: string | null;
  readonly category: string;
  readonly abv: number;
  readonly volumeLitres: number;
}

/**
 * Container information section of a declaration summary.
 */
export interface DeclarationContainer {
  readonly type: string;
  readonly volumeLitres: number;
  readonly depositSystemStatus: boolean | null;
}

/**
 * Transport information section of a declaration summary.
 */
export interface DeclarationTransport {
  readonly carrier: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
}

/**
 * Estimated excise section of a declaration summary.
 */
export interface DeclarationEstimatedExcise {
  readonly alcoholExciseCents: number;
  readonly containerDutyCents: number;
  readonly totalCents: number;
  readonly confidence: ConfidenceLevel;
}

/**
 * Advance-notice information for customs declarations.
 *
 * Distance-selling transactions normally do not require advance notice.
 * Traveller imports typically do (4-day deadline).
 */
export interface DeclarationAdvanceNoticeInfo {
  readonly required: boolean;
  readonly deadlineDays?: number;
}

// ---------------------------------------------------------------------------
// Guidance — Phase 2C advanced declaration guidance (informational, read-only)
// ---------------------------------------------------------------------------

/**
 * One applied-duty line of the derivation walkthrough.
 *
 * Every figure comes from the persisted calculation record.  Fields the
 * record does not carry are `null` — never reconstructed — so consumers can
 * show what is unknown instead of an invented number.
 */
export interface DeclarationAppliedRateDetail {
  /** Which component of the estimate this line explains. */
  readonly kind: 'alcoholExcise' | 'containerDuty';
  /** Recorded amount for this component in euro-cents. */
  readonly amountCents: number;
  /**
   * Applied rate per {@link rateUnit} exactly as persisted, or `null` when
   * the record does not carry it.
   */
  readonly ratePerUnit: number | null;
  /**
   * Unit the rate is expressed in (derived from the formula reference), or
   * `null` when the formula reference is unknown.
   */
  readonly rateUnit: string | null;
  /**
   * Rule version label applied at calculation time (e.g. '2025.1',
   * 'FALLBACK'), or `null` when not persisted.
   */
  readonly ruleVersionLabel: string | null;
  /**
   * Formula reference constant from the applied tax rule (e.g.
   * 'PER_LITRE_OF_ALCOHOL'), or `null` when not persisted.
   */
  readonly formulaReference: string | null;
  /**
   * Human-readable formula expression, or `null` when the formula reference
   * is unknown or unrecognised.
   */
  readonly formulaExpression: string | null;
}

/**
 * Derivation walkthrough of the excise estimate — the product facts and
 * applied rates behind the recorded cents totals.
 */
export interface DeclarationDerivation {
  /** Product category as persisted (e.g. 'Beer'). */
  readonly category: string;
  /** Alcohol by volume in percent, as persisted (e.g. 4.5). */
  readonly abvPercent: number;
  /** Volume of a single container in litres. */
  readonly volumePerUnitLitres: number;
  /** Number of units in the calculation. */
  readonly quantity: number;
  /** volumePerUnitLitres × quantity — total litres across all units. */
  readonly totalVolumeLitres: number;
  /** Applied-duty lines, alcohol excise first, container duty second. */
  readonly appliedRates: readonly DeclarationAppliedRateDetail[];
}

/**
 * Advance-notice deadline information computed from the calculation
 * timestamp.  Informational only — the assistant never files the notice.
 */
export interface DeclarationGuidanceDeadline {
  /** Whether this classification requires advance notice to customs. */
  readonly required: boolean;
  /** Notice window in days when required, else `null`. */
  readonly deadlineDays: number | null;
  /** Calculation timestamp (ISO 8601) the due date was computed from. */
  readonly calculatedFrom: string;
  /**
   * Advance-notice due date as an ISO calendar date (yyyy-mm-dd, UTC), or
   * `null` when notice is not required or the timestamp cannot be parsed.
   */
  readonly dueDate: string | null;
}

/** A link to an official guidance source. */
export interface OfficialSourceLink {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/**
 * Advanced declaration guidance (Phase 2C).
 *
 * Informational only: derivation walkthrough, computed advance-notice
 * deadline, an ordered MyTax entry checklist phrased as observed patterns
 * (never imperative legal conclusions), confidence-driven caveats, and
 * official vero.fi guidance sources.  Adds no submission or pre-fill
 * capability — the no-submission guarantee is unchanged.
 */
export interface DeclarationGuidance {
  readonly derivation: DeclarationDerivation;
  readonly deadline: DeclarationGuidanceDeadline;
  readonly checklist: readonly string[];
  readonly caveats: readonly string[];
  readonly officialSources: readonly OfficialSourceLink[];
}

/**
 * Structured declaration summary produced by the ExciseDeclarationService.
 *
 * Packages a completed landed-cost calculation into a declaration-friendly
 * format for Finnish customs / MyTax reference.  Read-only — does NOT
 * submit to any external system.
 */
export interface DeclarationSummary {
  readonly product: DeclarationProduct;
  readonly units: number;
  readonly container: DeclarationContainer;
  readonly transport: DeclarationTransport;
  readonly estimatedExcise: DeclarationEstimatedExcise;
  readonly advanceNoticeInfo: DeclarationAdvanceNoticeInfo;
  readonly myTaxLink: string;
  readonly declarationDate: string;
  readonly disclaimer: Disclaimer;
  /** Advanced guidance (Phase 2C) — informational, read-only. */
  readonly guidance: DeclarationGuidance;
}

// ---------------------------------------------------------------------------
// Read-only safety constraints — type-level and runtime
// ---------------------------------------------------------------------------

/**
 * ReadonlyInterface<T> — mapped type that only surfaces methods whose return
 * type is NOT a write-like `Promise<{ id: ... }>` shape.
 *
 * Write-like patterns (create, update, delete, submit, post, save) typically
 * return `Promise<{ id: number }>` or `Promise<{ id: string }>`.  This type
 * excludes them, producing a compile error when the filtered type does not
 * match the original.
 *
 * @example
 * ```typescript
 * type ReadOnly = ReadonlyInterface<MyService>; // write methods stripped
 * const svc: ReadOnly = myService; // compile error if write methods exist
 * ```
 */
export type ReadonlyInterface<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => Promise<{ id: any }>
    ? never
    : K]: T[K];
};

/**
 * DeclarationSafetyConstraint — conditional type that evaluates to `true` when
 * ServiceType contains no write-like methods (those returning
 * `Promise<{ id: number }>` or `Promise<{ id: string }>`), and `never`
 * otherwise.
 *
 * Logic: ALL original keys must survive the ReadonlyInterface filter.
 * If any write method is stripped, `keyof ServiceType` is a strict superset
 * of `keyof ReadonlyInterface<ServiceType>`, and the extends check fails.
 *
 * Use in a type-level assertion adjacent to the service definition:
 *
 * ```typescript
 * // Compile-time proof: ExciseDeclarationService has no write methods
 * type _assertIsSafe = DeclarationSafetyConstraint<ExciseDeclarationService>;
 * const _safetyProof: _assertIsSafe = true;
 * ```
 */
export type DeclarationSafetyConstraint<ServiceType> =
  keyof ServiceType extends keyof ReadonlyInterface<ServiceType>
    ? true
    : never;

/** Runtime guarantee constant — attached to every declaration service/module. */
export const NO_SUBMISSION_GUARANTEE =
  'This module never submits data to any external service' as const;

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the requested calculation record cannot be found.
 */
export class CalculationRecordNotFoundError extends Error {
  readonly calculationRecordId: number;

  constructor(calculationRecordId: number) {
    super(`Calculation record ${calculationRecordId} not found`);
    this.name = 'CalculationRecordNotFoundError';
    this.calculationRecordId = calculationRecordId;
  }
}