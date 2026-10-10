/**
 * Declaration DTOs — request/response shapes for the excise declaration assistant.
 *
 * @module DeclarationDto
 */

// ---------------------------------------------------------------------------
// Guidance — Phase 2C advanced declaration guidance (informational, read-only)
//
// Mirrors the core-domain DeclarationGuidance shapes structurally (the domain
// package does not export them). The controller returns the domain summary
// wholesale when the flag is on, so TypeScript structural checking in
// DeclarationController proves this mirror matches the domain type.
// ---------------------------------------------------------------------------

/** One applied-duty line of the derivation walkthrough. */
export interface GuidanceAppliedRateDetail {
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

/** Derivation walkthrough — product facts and applied rates behind the totals. */
export interface GuidanceDerivation {
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
  readonly appliedRates: readonly GuidanceAppliedRateDetail[];
}

/** Advance-notice deadline computed from the calculation timestamp. */
export interface GuidanceDeadline {
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
export interface GuidanceOfficialSourceLink {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/**
 * Statutory liability flags under the 1 Sep 2024 joint-liability reform.
 * `null` for records computed before the reform.
 */
export interface GuidanceLiabilityNotice {
  readonly classification: 'DistanceSelling' | 'DistanceBuying' | 'TravellerImport';
  readonly buyerMustFileAdvanceNotice: boolean;
  readonly buyerJointlyLiable: boolean;
  readonly ruleSetVersion: string;
}

// ---------------------------------------------------------------------------
// Dated pre-dispatch checklist — import-filing-assistant Stage 1 (additive)
//
// Structural mirrors of the core-domain shapes (declaration.types.ts): the
// dated checklist, its cited filing steps, the guarantee figure, the
// return-due estimate, and the post-deadline state. The controller returns
// the domain summary wholesale, so the structural check against
// DeclarationSummaryResponse proves this mirror stays aligned with the
// domain types.
// ---------------------------------------------------------------------------

/**
 * Reliability status carried by the guarantee figure. Mirrors the core-domain
 * `ReliabilityStatus` union; the guarantee never asserts `VERIFIED` from the
 * calculation record (see the core-domain guarantee-figure contract).
 */
export type GuidanceReliabilityStatus = 'VERIFIED' | 'STALE' | 'UNAVAILABLE' | 'ESTIMATED';

/** Citation reference for one verified filing-process fact. */
export interface GuidanceFilingProcessCitation {
  /** Change-notes source identifier (e.g. 'S1'). */
  readonly sourceId: string;
  /** Official page title as recorded in the change notes. */
  readonly title: string;
  /** Official page URL (vero.fi). */
  readonly url: string;
}

/** One cited step of the pre-dispatch filing checklist. */
export interface GuidanceFilingStep {
  /** Which verified process fact this step carries. */
  readonly kind:
    | 'noticeAlcohol'
    | 'noticePackaging'
    | 'guarantee'
    | 'referenceNumber'
    | 'carrierHandoff';
  /** Observed-pattern description of the step. */
  readonly description: string;
  /**
   * The user-entered planned date this step is anchored to, or `null` in
   * the undated checklist.
   */
  readonly datedFor: string | null;
  /** Sources the step's fact traces to — never empty on a rendered step. */
  readonly citations: readonly GuidanceFilingProcessCitation[];
}

/**
 * The guarantee (vakuus) to lodge, per the verified rule: equal to the
 * calculated alcohol excise duty (the container duty carries no guarantee).
 * `amountCents` is `null` when {@link available} is `false` — never a
 * substituted number.
 */
export interface GuidanceGuaranteeFigure {
  /** Whether a guarantee figure can be stated for this filing. */
  readonly available: boolean;
  /** Guarantee amount in euro-cents, or `null` when unavailable. */
  readonly amountCents: number | null;
  /** Reliability status of the underlying excise figure. */
  readonly status: GuidanceReliabilityStatus;
}

/**
 * Excise-return estimate anchored to the user-entered planned date: the
 * return is filed and the duties paid by the 12th of the month following
 * the receipt date. Present only in the dated states.
 */
export interface GuidanceReturnDueEstimate {
  /** The user-entered planned date the estimate is anchored to. */
  readonly estimatedArrivalDate: string;
  /** 12th of the month following the estimated arrival date (yyyy-mm-dd). */
  readonly dueDate: string;
  /** Always ESTIMATED — the anchor is user-entered. */
  readonly status: 'ESTIMATED';
  /** Source for the 12th-of-the-following-month rule. */
  readonly citations: readonly GuidanceFilingProcessCitation[];
}

/**
 * Post-deadline state — the user-entered planned date is in the past
 * relative to the filing state. Observed-pattern register: the only
 * consequence named is the officially hedged negligence penalty from the
 * recorded citations.
 */
export interface GuidancePostDeadlineState {
  /** Always true — this object renders only when the date has passed. */
  readonly deadlinePassed: true;
  /** Hedged, citation-bound description of the passed-deadline situation. */
  readonly description: string;
  /** Sources for the passed-deadline guidance (official pages). */
  readonly citations: readonly GuidanceFilingProcessCitation[];
}

/**
 * Dated pre-dispatch checklist — cited filing steps optionally anchored to
 * a user-supplied planned dispatch date. Without a usable date the
 * checklist degrades factually: the same steps and citations render undated
 * (`UNDATED`), with no deadline, no countdown, and no derived dates.
 * The date is a request parameter and is never persisted.
 */
export interface GuidanceDatedChecklist {
  /**
   * `DATED` — usable planned date, today or ahead. `POST_DEADLINE` — the
   * supplied date is in the past relative to the filing state. `UNDATED` —
   * no usable date was supplied.
   */
  readonly state: 'DATED' | 'POST_DEADLINE' | 'UNDATED';
  /** The supplied planned date as accepted (yyyy-mm-dd), or `null`. */
  readonly plannedDate: string | null;
  /**
   * `BEFORE_DISPATCH` when a usable date anchors the checklist; `null` in
   * the undated degradation.
   */
  readonly deadlineSemantics: 'BEFORE_DISPATCH' | null;
  /** Ordered steps; identical text and citations in dated and undated form. */
  readonly steps: readonly GuidanceFilingStep[];
  /** The guarantee to lodge, with availability and reliability status. */
  readonly guarantee: GuidanceGuaranteeFigure;
  /** Excise-return estimate; `null` in the undated degradation. */
  readonly returnDueEstimate: GuidanceReturnDueEstimate | null;
  /** Present only in the `POST_DEADLINE` state; `null` otherwise. */
  readonly postDeadline: GuidancePostDeadlineState | null;
}

/**
 * Advanced declaration guidance (Phase 2C) — informational only: derivation
 * walkthrough, computed advance-notice deadline, ordered MyTax entry
 * checklist, confidence-driven caveats, official vero.fi sources, and the
 * dated pre-dispatch checklist. No submission or pre-fill capability.
 */
export interface DeclarationGuidance {
  readonly derivation: GuidanceDerivation;
  readonly deadline: GuidanceDeadline;
  /** Joint-liability / buyer-obligation flags, or `null` pre-reform. */
  readonly liabilityNotice: GuidanceLiabilityNotice | null;
  readonly checklist: readonly string[];
  readonly caveats: readonly string[];
  readonly officialSources: readonly GuidanceOfficialSourceLink[];
  /**
   * Dated pre-dispatch checklist (import-filing-assistant Stage 1) with the
   * guarantee figure — degrades to the undated checklist when no usable
   * dispatch date is supplied. Informational, read-only.
   */
  readonly datedChecklist: GuidanceDatedChecklist;
}

/** GET /api/v1/declaration/:recordId — response wrapper. */
export interface DeclarationSummaryResponse {
  readonly product: {
    readonly name: string;
    readonly brand: string | null;
    readonly category: string;
    readonly abv: number;
    readonly volumeLitres: number;
  };
  readonly units: number;
  readonly container: {
    readonly type: string;
    readonly volumeLitres: number;
    readonly depositSystemStatus: boolean | null;
  };
  readonly transport: {
    readonly carrier: string | null;
    readonly origin: string | null;
    readonly destination: string | null;
  };
  readonly estimatedExcise: {
    readonly alcoholExciseCents: number;
    readonly containerDutyCents: number;
    readonly totalCents: number;
    readonly confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  readonly advanceNoticeInfo: {
    readonly required: boolean;
    readonly deadlineDays?: number;
  };
  readonly myTaxLink: string;
  readonly declarationDate: string;
  readonly disclaimer: {
    readonly text: string;
    readonly language: 'fi' | 'en';
    readonly version: string;
  };
  /**
   * Advanced guidance (Phase 2C) — informational, read-only.
   *
   * Always present on current responses: the ADVANCED_FEATURES strip gate
   * was removed by decision when the routes were re-hosted (the summary
   * always carries its guidance field). The property stays optional in this
   * wrapper so the type remains honest about the historical flag-off
   * payloads that predate the re-host.
   */
  readonly guidance?: DeclarationGuidance;
}