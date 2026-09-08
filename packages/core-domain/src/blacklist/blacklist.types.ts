/**
 * Merchant blacklist domain types — reports, entries, and the
 * published standard.
 *
 * Two independent state machines live in this module:
 *
 * - a **report** machine: every submitted report enters `OPEN` and, if
 *   the evidence survives moderation, becomes `LINKED` to a blacklist
 *   entry at publication time;
 * - an **entry** machine: an entry comes into existence as `PUBLISHED`
 *   (publication is always an explicit operator action — no automatic
 *   path exists), an appeal moves it to `REOPENED` (removing it from
 *   public display immediately), and an operator resolution returns it
 *   to `PUBLISHED` or ends it as `REJECTED`.
 *
 * A merchant's identity is the pair (normalized domain, normalized
 * name) — deterministic and derived, with no registry row of its own.
 *
 * @module BlacklistTypes
 */

// ---------------------------------------------------------------------------
// Report state machine
// ---------------------------------------------------------------------------

/**
 * Moderation state of a single report.
 *
 * - `'OPEN'`:   stored, awaiting moderation. The only state a submitted
 *               report can occupy (spec merchant-blacklist).
 * - `'LINKED'`: consumed as evidence by a published entry. Terminal —
 *               a report may be linked to at most one entry, ever.
 */
export type BlacklistReportStatus = 'OPEN' | 'LINKED';

/** The only state a freshly submitted report can enter. */
export const REPORT_INITIAL_STATUS: BlacklistReportStatus = 'OPEN';

// ---------------------------------------------------------------------------
// Entry state machine
// ---------------------------------------------------------------------------

/**
 * Moderation state of a blacklist entry.
 *
 * - `'PUBLISHED'`: publicly visible; warnings may be attached to
 *                 responses containing this merchant's offers.
 * - `'REOPENED'`: an appeal is pending. Public display stops
 *                 immediately — an entry is only publicly visible while
 *                 it is exactly `PUBLISHED`.
 * - `'REJECTED'`: the appeal succeeded; the entry is closed and never
 *                 displayed again. Terminal.
 */
export type BlacklistEntryStatus = 'PUBLISHED' | 'REOPENED' | 'REJECTED';

/** An entry exists only through operator publication — it is born PUBLISHED. */
export const ENTRY_INITIAL_STATUS: BlacklistEntryStatus = 'PUBLISHED';

/** Operator decision on a reopened entry. */
export type EntryResolution = 'REPUBLISH' | 'REJECT';

// ---------------------------------------------------------------------------
// Merchant identity — (domain, normalized name), no registry row
// ---------------------------------------------------------------------------

/**
 * Normalized merchant identity. Both fields are canonicalized by
 * {@link normalizeMerchantIdentity}; the pair is the identity key used
 * to attach reports, entries, and warnings to the same merchant.
 */
export interface MerchantIdentity {
  /** Lowercased domain, single leading `www.` stripped. */
  readonly domain: string;
  /** Trimmed, casefolded name with internal whitespace collapsed. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Evidence validation
// ---------------------------------------------------------------------------

/** Raw, untrusted report payload as received from the submitter. */
export interface BlacklistReportInput {
  /** Reporter's authenticated account id. */
  readonly reporterAccountId: unknown;
  /** Merchant domain as submitted (pre-normalization). */
  readonly merchantDomain: unknown;
  /** Merchant name as submitted (pre-normalization). */
  readonly merchantName: unknown;
  /** Order reference proving a real transaction. */
  readonly orderReference: unknown;
  /** Summary of the correspondence with the merchant. */
  readonly correspondenceSummary: unknown;
}

/**
 * Validated evidence: trimmed, non-empty strings ready for storage.
 * Returned only when every required field passed validation — a
 * failed validation throws and nothing is stored (spec: incomplete
 * evidence is rejected outright).
 */
export interface ValidatedBlacklistReport {
  readonly merchantIdentity: MerchantIdentity;
  readonly evidence: {
    readonly reporterAccountId: string;
    readonly orderReference: string;
    readonly correspondenceSummary: string;
  };
}

/** Why a report payload was rejected. Checked in this documented order. */
export type BlacklistReportInputErrorReason =
  | 'MISSING_REPORTER_ACCOUNT'
  | 'MISSING_ORDER_REFERENCE'
  | 'MISSING_CORRESPONDENCE_SUMMARY'
  | 'INVALID_MERCHANT_DOMAIN'
  | 'INVALID_MERCHANT_NAME';

/**
 * Structurally invalid report: a missing/blank reporter account,
 * order reference, or correspondence summary, or an unusable merchant
 * domain/name. Rejection means nothing is stored — the caller receives
 * this typed error instead of a partial record.
 */
export class InvalidBlacklistReportError extends Error {
  readonly reason: BlacklistReportInputErrorReason;

  constructor(reason: BlacklistReportInputErrorReason, detail: string) {
    super(`invalid blacklist report (${reason}): ${detail}`);
    this.name = 'InvalidBlacklistReportError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Published standard
// ---------------------------------------------------------------------------

/**
 * Independent confirmed non-delivery reports required to publish an
 * entry. Independence is exact reporter-account distinctness — three
 * reports from two accounts do not satisfy the standard. Pinned by
 * test; changing it changes what the public can be warned about.
 */
export const MIN_INDEPENDENT_NON_DELIVERY_REPORTS = 3;

/** A non-delivery report as considered by the standard. */
export interface NonDeliveryReportEvidence {
  /** Reporter account id — distinctness across these decides independence. */
  readonly reporterAccountId: string;
  /** Whether moderation has confirmed the non-delivery claim. */
  readonly confirmedNonDelivery: boolean;
}

/** Business-registration evidence as considered by the standard. */
export interface BusinessRegistrationEvidence {
  /** Whether the registry check confirmed the registration invalid. */
  readonly confirmedInvalid: boolean;
}

/** Evidence corpus an operator publication attempt is evaluated against. */
export interface PublicationStandardInput {
  readonly nonDeliveryReports: readonly NonDeliveryReportEvidence[];
  readonly businessRegistration: BusinessRegistrationEvidence | null;
}

/** Why the standard was not met (only present when `met` is false). */
export type PublicationStandardFailureReason =
  | 'INSUFFICIENT_INDEPENDENT_NON_DELIVERY_REPORTS'
  | 'NO_EVIDENCE';

/**
 * Discriminated result of the published-standard evaluation. `met`
 * carries the basis that satisfied the standard (non-delivery reports
 * take precedence when both paths hold); `!met` carries the failure
 * reason and the distinct confirmed count for the audit trail.
 */
export type PublicationStandardResult =
  | {
      readonly met: true;
      readonly basis:
        | 'CONFIRMED_NON_DELIVERY_REPORTS'
        | 'CONFIRMED_INVALID_BUSINESS_REGISTRATION';
    }
  | {
      readonly met: false;
      readonly reason: PublicationStandardFailureReason;
      readonly independentConfirmedCount: number;
    };

// ---------------------------------------------------------------------------
// State-transition errors
// ---------------------------------------------------------------------------

/** State-machine actions that can be attempted from a wrong state. */
export type BlacklistTransitionAction = 'LINK_REPORT' | 'APPEAL' | 'RESOLVE';

/**
 * An attempted transition that the state machine does not allow — e.g.
 * appealing an entry that is not PUBLISHED, resolving one that is not
 * REOPENED, or linking an already-LINKED report. Callers must treat
 * this as an invariant violation of the moderation workflow, not a
 * validation nuance: the module refuses rather than coerces.
 */
export class InvalidBlacklistTransitionError extends Error {
  readonly action: BlacklistTransitionAction;
  readonly from: BlacklistReportStatus | BlacklistEntryStatus;

  constructor(
    action: BlacklistTransitionAction,
    from: BlacklistReportStatus | BlacklistEntryStatus,
    detail: string,
  ) {
    super(`invalid blacklist transition (${action} from ${from}): ${detail}`);
    this.name = 'InvalidBlacklistTransitionError';
    this.action = action;
    this.from = from;
  }
}
