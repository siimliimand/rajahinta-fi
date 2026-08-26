/**
 * TaxChangeAttributionService — pure, read-time classification of the steps
 * between consecutive price observations of one (product, merchant) series.
 *
 * Change 2026-08-26-phase2-historical-price-intelligence, Decision 4: the
 * service is a PURE function over immutable stored inputs — the observation
 * series plus the tax-rule effective windows that were in force across it.
 * Attribution is never persisted, because a tax-rule window is finalized
 * only when its successor version lands (possibly with a retroactive
 * `effectiveTo`); recomputing from the windows at read time stays correct
 * after such retroactive closes, while a write-time label would go stale.
 *
 * Fetching the windows is the CALLER's job (the API layer queries
 * `ITaxRuleRepositoryPort.findHistoryRates` for the observation range and
 * passes the rows here). `TaxRuleRecordPort` rows satisfy the window input
 * type structurally, so repository results can be passed through unchanged.
 *
 * Guardrail: every attributed step ships evidence — which inputs moved and
 * the rule versionLabels bounding the step. A classification is a data
 * observation about which inputs moved, never a bare legal conclusion.
 *
 * @module TaxChangeAttributionService
 */

import { Injectable } from '@nestjs/common';
import type { PriceObservation } from '../price-observation.types';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classification of one step (a pair of consecutive observations).
 *
 * `UNCHANGED` covers the degenerate step where no input moved at all (e.g.
 * a re-observation with identical price, transport, and rule versions).
 * Forcing such a step into one of the four informative labels would be
 * wrong; an explicit `UNCHANGED` is honest, mirroring the MIXED philosophy.
 */
export type StepClassification =
  | 'TAX_RULE_CHANGE'
  | 'MERCHANT_PRICE_CHANGE'
  | 'TRANSPORT_CHANGE'
  | 'MIXED'
  | 'UNCHANGED';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * A tax-rule effective window used for boundary detection.
 *
 * Structural subset of `TaxRuleRecordPort`, so repository rows can be passed
 * directly. Window semantics match the repository port exactly: a rule is
 * effective at instant T when `effectiveFrom <= T` AND (`effectiveTo` is
 * null OR `effectiveTo > T`).
 */
export interface TaxRuleEffectiveWindow {
  /** Tax-rule row ID (foreign-key reference into the versioned tax rules). */
  readonly ruleId: number;
  /** Version label of the rule (e.g. "2024-01"). */
  readonly versionLabel: string;
  /** First instant the rule is effective (inclusive). */
  readonly effectiveFrom: Date;
  /** Last instant the rule is effective (exclusive), or null when open-ended. */
  readonly effectiveTo: Date | null;
}

/**
 * Input to {@link TaxChangeAttributionService.attribute}.
 *
 * Contract:
 * - `observations` is one (productId, merchant) series ordered by
 *   `observedAt` ascending (equal timestamps allowed).
 * - The window lists must COVER the full observation range — the caller
 *   fetches them with `findHistoryRates` over `[firstObservedAt,
 *   lastObservedAt]`. A gap in coverage would resolve to `null` labels and
 *   could fabricate a boundary at the edge of the missing span.
 *
 * The windows are authoritative over the observation's own
 * `exciseRuleVersion` / `containerDutyRuleVersion` snapshots: snapshots
 * record what the engine applied at append time and cannot see retroactive
 * window closes, while the window join can.
 */
export interface TaxChangeAttributionInput {
  readonly observations: readonly PriceObservation[];
  /** Excise-rule windows overlapping the observation range. */
  readonly exciseRuleWindows: readonly TaxRuleEffectiveWindow[];
  /** Container-duty-rule windows overlapping the observation range. */
  readonly containerDutyRuleWindows: readonly TaxRuleEffectiveWindow[];
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Which cost inputs of the step changed between the two observations. */
export interface AttributionMovedInputs {
  /** An excise-rule version boundary falls inside the step. */
  readonly exciseRule: boolean;
  /** A container-duty-rule version boundary falls inside the step. */
  readonly containerDutyRule: boolean;
  /** The foreign retail price (euro-cents) differs. */
  readonly merchantPrice: boolean;
  /** The transport cost (euro-cents) differs. */
  readonly transport: boolean;
}

/**
 * The rule versions bounding a crossed version boundary.
 *
 * A label is `null` when no supplied window is effective at that instant
 * (rule coverage gap, or an engine-fallback observation outside any rule).
 */
export interface RuleVersionBoundary {
  /** VersionLabel effective at the earlier observation, or null. */
  readonly fromVersionLabel: string | null;
  /** VersionLabel effective at the later observation, or null. */
  readonly toVersionLabel: string | null;
}

/**
 * One attributed step: the classification plus the inspectable evidence it
 * rests on. `fromObservedAt` / `toObservedAt` bind the step back to its
 * pair of observations in the input series (steps are returned in series
 * order, so step `i` spans observations `i` and `i + 1`).
 */
export interface AttributedStep {
  readonly classification: StepClassification;
  /** Timestamp of the earlier observation in the pair. */
  readonly fromObservedAt: Date;
  /** Timestamp of the later observation in the pair. */
  readonly toObservedAt: Date;
  readonly movedInputs: AttributionMovedInputs;
  /** Excise boundary evidence — null when no excise boundary was crossed. */
  readonly exciseRuleBoundary: RuleVersionBoundary | null;
  /** Container-duty boundary evidence — null when no boundary was crossed. */
  readonly containerDutyRuleBoundary: RuleVersionBoundary | null;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the observation series violates the input contract. */
export class AttributionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttributionInputError';
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Pure step-classification service — stateless, no injected dependencies,
 * no I/O. Registered in HistoryModule and safe to construct directly.
 */
@Injectable()
export class TaxChangeAttributionService {
  /**
   * Classify every step between consecutive observations of one series.
   *
   * Classification counts COST-DRIVER categories, not raw inputs: excise
   * and container-duty boundaries together count as one driver ("tax
   * rules"), so a step where both rule versions changed while the merchant
   * price held is still a `TAX_RULE_CHANGE` — fully tax-driven, not MIXED.
   * `MIXED` means two or more different drivers moved simultaneously.
   *
   * A series with fewer than two observations yields no steps.
   *
   * @throws {AttributionInputError} If observations are not in ascending
   *   observedAt order or do not belong to a single (productId, merchant)
   *   series.
   */
  attribute(input: TaxChangeAttributionInput): readonly AttributedStep[] {
    assertSingleSeries(input.observations);

    const steps: AttributedStep[] = [];
    for (let i = 1; i < input.observations.length; i++) {
      const previous = input.observations[i - 1];
      const next = input.observations[i];
      steps.push(
        attributeStep(previous, next, input.exciseRuleWindows, input.containerDutyRuleWindows),
      );
    }
    return steps;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/** Classify one step from which inputs moved (driver-category counting). */
function attributeStep(
  previous: PriceObservation,
  next: PriceObservation,
  exciseRuleWindows: readonly TaxRuleEffectiveWindow[],
  containerDutyRuleWindows: readonly TaxRuleEffectiveWindow[],
): AttributedStep {
  const exciseRuleBoundary = resolveRuleBoundary(
    exciseRuleWindows,
    previous.observedAt,
    next.observedAt,
  );
  const containerDutyRuleBoundary = resolveRuleBoundary(
    containerDutyRuleWindows,
    previous.observedAt,
    next.observedAt,
  );

  const movedInputs: AttributionMovedInputs = {
    exciseRule: exciseRuleBoundary !== null,
    containerDutyRule: containerDutyRuleBoundary !== null,
    merchantPrice: previous.foreignRetailPriceCents !== next.foreignRetailPriceCents,
    transport: previous.transportCostCents !== next.transportCostCents,
  };

  return {
    classification: classifyMovedInputs(movedInputs),
    fromObservedAt: previous.observedAt,
    toObservedAt: next.observedAt,
    movedInputs,
    exciseRuleBoundary,
    containerDutyRuleBoundary,
  };
}

/** Map moved inputs to a classification via driver-category counting. */
function classifyMovedInputs(moved: AttributionMovedInputs): StepClassification {
  const taxRuleDriver = moved.exciseRule || moved.containerDutyRule;
  const movedDrivers = [taxRuleDriver, moved.merchantPrice, moved.transport].filter(
    (driverMoved) => driverMoved,
  ).length;

  if (movedDrivers === 0) return 'UNCHANGED';
  if (movedDrivers > 1) return 'MIXED';
  if (taxRuleDriver) return 'TAX_RULE_CHANGE';
  if (moved.merchantPrice) return 'MERCHANT_PRICE_CHANGE';
  return 'TRANSPORT_CHANGE';
}

/**
 * Resolve the rule versionLabel effective at each of the two instants and
 * report the boundary when they differ (null transitions included — a
 * version appearing or disappearing is a boundary).
 */
function resolveRuleBoundary(
  windows: readonly TaxRuleEffectiveWindow[],
  fromInstant: Date,
  toInstant: Date,
): RuleVersionBoundary | null {
  const fromVersionLabel = resolveVersionLabelAt(windows, fromInstant);
  const toVersionLabel = resolveVersionLabelAt(windows, toInstant);

  return fromVersionLabel === toVersionLabel
    ? null
    : { fromVersionLabel, toVersionLabel };
}

/**
 * VersionLabel of the window effective at `instant`, using the repository
 * port's semantics (`effectiveFrom <= T < effectiveTo`, null `effectiveTo`
 * open-ended). Overlapping windows (which the versioned rules should never
 * produce for one type+category) resolve to the latest `effectiveFrom`.
 */
function resolveVersionLabelAt(
  windows: readonly TaxRuleEffectiveWindow[],
  instant: Date,
): string | null {
  let effective: TaxRuleEffectiveWindow | null = null;
  for (const window of windows) {
    const coversInstant =
      window.effectiveFrom.getTime() <= instant.getTime() &&
      (window.effectiveTo === null || window.effectiveTo.getTime() > instant.getTime());
    if (coversInstant && (effective === null || window.effectiveFrom > effective.effectiveFrom)) {
      effective = window;
    }
  }
  return effective === null ? null : effective.versionLabel;
}

/** Enforce the single-series contract (ascending order, one product+merchant). */
function assertSingleSeries(observations: readonly PriceObservation[]): void {
  for (let i = 1; i < observations.length; i++) {
    const previous = observations[i - 1];
    const next = observations[i];
    if (previous.observedAt > next.observedAt) {
      throw new AttributionInputError(
        `Observations must be ordered by observedAt ascending: index ${i - 1} ` +
          `(${previous.observedAt.toISOString()}) is after index ${i} ` +
          `(${next.observedAt.toISOString()})`,
      );
    }
    if (previous.productId !== next.productId || previous.merchant !== next.merchant) {
      throw new AttributionInputError(
        `Observations must belong to one (productId, merchant) series: index ${i} ` +
          `differs from index ${i - 1}`,
      );
    }
  }
}
