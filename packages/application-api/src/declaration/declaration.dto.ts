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
 * Advanced declaration guidance (Phase 2C) — informational only: derivation
 * walkthrough, computed advance-notice deadline, ordered MyTax entry
 * checklist, confidence-driven caveats, and official vero.fi sources. No
 * submission or pre-fill capability.
 */
export interface DeclarationGuidance {
  readonly derivation: GuidanceDerivation;
  readonly deadline: GuidanceDeadline;
  readonly checklist: readonly string[];
  readonly caveats: readonly string[];
  readonly officialSources: readonly GuidanceOfficialSourceLink[];
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
   * Present only when the ADVANCED_FEATURES feature flag is enabled; omitted
   * entirely (never `null`) otherwise, so flag-off responses are
   * byte-compatible with pre-guidance payloads.
   */
  readonly guidance?: DeclarationGuidance;
}