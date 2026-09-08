/**
 * Pure merchant-blacklist domain logic — evidence validation, merchant
 * identity normalization, the published standard, and the report/entry
 * state machines.
 *
 * Every function is deterministic and side-effect free: no storage, no
 * I/O, no clock. Publication itself is an operator action and happens
 * outside this module — what lives here is the gate the operator's
 * action must satisfy ({@link evaluatePublicationStandard}) and the
 * state machines the action moves
 * ({@link linkReportToEntry}, {@link reopenEntry}, {@link resolveEntry}).
 *
 * @module Blacklist
 */

import type {
  BlacklistEntryStatus,
  BlacklistReportInput,
  BlacklistReportInputErrorReason,
  BlacklistReportStatus,
  BusinessRegistrationEvidence,
  EntryResolution,
  MerchantIdentity,
  PublicationStandardInput,
  PublicationStandardResult,
  ValidatedBlacklistReport,
} from './blacklist.types';
import {
  InvalidBlacklistReportError,
  InvalidBlacklistTransitionError,
  MIN_INDEPENDENT_NON_DELIVERY_REPORTS,
} from './blacklist.types';

// ---------------------------------------------------------------------------
// Merchant identity normalization — deterministic, no registry row
// ---------------------------------------------------------------------------

/**
 * Normalize a merchant domain: trim, lowercase, strip a single leading
 * `www.`. Normalization must be deterministic so that reports, entries,
 * and warnings all resolve to the same merchant regardless of how the
 * domain was written — `WWW.Example.com`, ` www.example.com `, and
 * `www.www.example.com` (which keeps its inner `www.`) map to exactly
 * one identity.
 *
 * Throws `INVALID_MERCHANT_DOMAIN` for a blank value or one containing
 * internal whitespace — a merchant without a clean domain cannot form
 * an identity, and storing a malformed one would silently split the
 * merchant in two.
 */
export function normalizeMerchantDomain(domain: unknown): string {
  if (typeof domain !== 'string') {
    throw new InvalidBlacklistReportError(
      'INVALID_MERCHANT_DOMAIN',
      'merchant domain is required',
    );
  }
  const normalized = domain.trim().toLowerCase().replace(/^www\./, '');
  if (normalized.length === 0 || /\s/.test(normalized)) {
    throw new InvalidBlacklistReportError(
      'INVALID_MERCHANT_DOMAIN',
      `domain does not normalize to a usable host: "${domain}"`,
    );
  }
  return normalized;
}

/**
 * Normalize a merchant name: trim, collapse internal whitespace runs
 * to a single space, casefold. The result is a comparison key, not a
 * display name — casing and spacing variations of the same name must
 * collapse to one identity.
 *
 * Throws `INVALID_MERCHANT_NAME` for a blank value: an identity with
 * no name is not an identity.
 */
export function normalizeMerchantName(name: unknown): string {
  if (typeof name !== 'string') {
    throw new InvalidBlacklistReportError(
      'INVALID_MERCHANT_NAME',
      'merchant name is required',
    );
  }
  const normalized = name.trim().replace(/\s+/g, ' ').toLowerCase();
  if (normalized.length === 0) {
    throw new InvalidBlacklistReportError(
      'INVALID_MERCHANT_NAME',
      `name does not normalize to a usable key: "${name}"`,
    );
  }
  return normalized;
}

/**
 * Normalize the full merchant identity — domain plus name. The pair is
 * the merchant: there is deliberately no registry row behind it, so
 * every consumer must pass submitted values through this function
 * before matching, storing, or warning.
 */
export function normalizeMerchantIdentity(
  domain: unknown,
  name: unknown,
): MerchantIdentity {
  return {
    domain: normalizeMerchantDomain(domain),
    name: normalizeMerchantName(name),
  };
}

/**
 * Deterministic composite key for a merchant identity — the join key
 * for attaching reports, entries, and warnings to the same merchant.
 */
export function merchantIdentityKey(identity: MerchantIdentity): string {
  return `${identity.domain}|${identity.name}`;
}

// ---------------------------------------------------------------------------
// Evidence validation
// ---------------------------------------------------------------------------

/**
 * Validate a report payload and normalize its merchant identity.
 *
 * Required evidence (checked in this order, first failure reported):
 *
 * 1. `reporterAccountId` — a non-empty string; reports are bound to
 *    their reporter and independence is defined over account ids.
 * 2. `orderReference` — a non-empty string proving a real transaction.
 * 3. `correspondenceSummary` — a non-empty string documenting the
 *    exchange with the merchant.
 * 4. merchant domain and name — must normalize (see
 *    {@link normalizeMerchantIdentity}).
 *
 * On success the trimmed evidence and normalized identity are returned
 * as the canonical form to store. On failure a typed
 * {@link InvalidBlacklistReportError} is thrown and the caller must not
 * store anything — there is no partial-record path (spec
 * merchant-blacklist: incomplete evidence is rejected outright).
 */
export function validateBlacklistReport(
  input: BlacklistReportInput,
): ValidatedBlacklistReport {
  const reporterAccountId = requireNonEmptyString(
    input.reporterAccountId,
    'MISSING_REPORTER_ACCOUNT',
    'reporter account id is required',
  );
  const orderReference = requireNonEmptyString(
    input.orderReference,
    'MISSING_ORDER_REFERENCE',
    'order reference is required',
  );
  const correspondenceSummary = requireNonEmptyString(
    input.correspondenceSummary,
    'MISSING_CORRESPONDENCE_SUMMARY',
    'correspondence summary is required',
  );

  return {
    merchantIdentity: normalizeMerchantIdentity(
      input.merchantDomain,
      input.merchantName,
    ),
    evidence: { reporterAccountId, orderReference, correspondenceSummary },
  };
}

/** Trim to a non-empty string or throw the given validation reason. */
function requireNonEmptyString(
  value: unknown,
  reason: BlacklistReportInputErrorReason,
  detail: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidBlacklistReportError(reason, detail);
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Published standard
// ---------------------------------------------------------------------------

/**
 * Evaluate the published standard against an evidence corpus. An entry
 * may be published only when the standard is met:
 *
 * - **confirmed non-delivery by 3+ independent reports** —
 *   {@link MIN_INDEPENDENT_NON_DELIVERY_REPORTS} distinct reporter
 *   accounts whose non-delivery claim moderation has confirmed
 *   (`confirmedNonDelivery === true`). Independence is exact account
 *   distinctness: three reports from two accounts do not qualify.
 * - **or a confirmed invalid business registration** — the registry
 *   check itself is performed outside this module; only its confirmed
 *   verdict arrives here.
 *
 * The non-delivery basis is reported when both paths hold. A `met:
 * false` result is a normal outcome (the operator action must be
 * rejected), not an error.
 */
export function evaluatePublicationStandard(
  input: PublicationStandardInput,
): PublicationStandardResult {
  const independentConfirmed = new Set<string>();
  for (const report of input.nonDeliveryReports) {
    if (report.confirmedNonDelivery) {
      independentConfirmed.add(report.reporterAccountId);
    }
  }

  if (independentConfirmed.size >= MIN_INDEPENDENT_NON_DELIVERY_REPORTS) {
    return { met: true, basis: 'CONFIRMED_NON_DELIVERY_REPORTS' };
  }

  if (meetsBusinessRegistrationStandard(input.businessRegistration)) {
    return { met: true, basis: 'CONFIRMED_INVALID_BUSINESS_REGISTRATION' };
  }

  return {
    met: false,
    // No confirmed non-delivery reports at all means there is no
    // evidence base whatsoever (an unconfirmed registration verdict is
    // not evidence); a positive count below the threshold is a report
    // corpus too thin to publish.
    reason:
      independentConfirmed.size === 0
        ? 'NO_EVIDENCE'
        : 'INSUFFICIENT_INDEPENDENT_NON_DELIVERY_REPORTS',
    independentConfirmedCount: independentConfirmed.size,
  };
}

/** The registration path holds only on a confirmed-invalid verdict. */
function meetsBusinessRegistrationStandard(
  registration: BusinessRegistrationEvidence | null,
): boolean {
  return registration !== null && registration.confirmedInvalid;
}

// ---------------------------------------------------------------------------
// Report state machine — OPEN → LINKED
// ---------------------------------------------------------------------------

/**
 * Link a report to a published entry: `OPEN → 'LINKED'`. Linking
 * consumes the report as evidence; a `LINKED` report is terminal and
 * cannot be linked again (one report backs at most one entry).
 * Terminal entry states (`REJECTED`) keep their reports linked — the
 * linkage is historical fact, not visibility.
 */
export function linkReportToEntry(status: BlacklistReportStatus): 'LINKED' {
  if (status !== 'OPEN') {
    throw new InvalidBlacklistTransitionError(
      'LINK_REPORT',
      status,
      'only an OPEN report can be linked to an entry',
    );
  }
  return 'LINKED';
}

// ---------------------------------------------------------------------------
// Entry state machine — PUBLISHED → REOPENED → PUBLISHED | REJECTED
// ---------------------------------------------------------------------------

/**
 * File an appeal against an entry: `PUBLISHED → 'REOPENED'`. The
 * returned state removes the entry from public display immediately
 * (see {@link isEntryPubliclyVisible}); only an operator resolution
 * can end the reopened state.
 */
export function reopenEntry(status: BlacklistEntryStatus): 'REOPENED' {
  if (status !== 'PUBLISHED') {
    throw new InvalidBlacklistTransitionError(
      'APPEAL',
      status,
      'only a PUBLISHED entry can be reopened by an appeal',
    );
  }
  return 'REOPENED';
}

/**
 * Resolve a reopened entry: `REOPENED → 'PUBLISHED'` on REPUBLISH or
 * `REOPENED → 'REJECTED'` on REJECT. Both outcomes require the entry
 * to be exactly `REOPENED` — a PUBLISHED entry needs no resolution and
 * a REJECTED one is terminal.
 */
export function resolveEntry(
  status: BlacklistEntryStatus,
  resolution: EntryResolution,
): BlacklistEntryStatus {
  if (status !== 'REOPENED') {
    throw new InvalidBlacklistTransitionError(
      'RESOLVE',
      status,
      `only a REOPENED entry can be resolved (wanted ${resolution})`,
    );
  }
  return resolution === 'REPUBLISH' ? 'PUBLISHED' : 'REJECTED';
}

/**
 * Whether an entry may currently be shown in public warnings. Exactly
 * `PUBLISHED` is visible — a REOPENED entry disappears from display
 * immediately on appeal, and a REJECTED one never returns.
 */
export function isEntryPubliclyVisible(status: BlacklistEntryStatus): boolean {
  return status === 'PUBLISHED';
}
