/**
 * Operator-console API client (task 12.1, change
 * technical-assessment-remediation).
 *
 * The console is its own auth realm: requests carry the operator bearer
 * token (Authorization header) instead of the consumer session cookie.
 * The token lives ONLY in component state — never in a cookie, storage,
 * or the URL — and is provided per request by the caller.
 *
 * @module opsApi
 */

import { apiFetch } from '@/lib/api';
import type {
  CorrectionListResponse,
  OpsAuditListResponse,
  OpsConfirmationListResponse,
  OpsGovernanceListResponse,
  OpsGovernanceMutationResponse,
  OpsTaxReviewResolvedResponse,
} from '@/lib/types';

/** Thrown on non-2xx; carries the API error message when present. */
export class OpsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpsApiError';
    this.status = status;
  }
}

async function opsFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  // The shared low-level client (base URL + trace context); the bearer
  // token replaces the consumer session's credentials flow here.
  const res = await apiFetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `API returned ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (typeof body.message === 'string' && body.message !== '') {
        message = body.message;
      }
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new OpsApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export function listGovernance(token: string): Promise<OpsGovernanceListResponse> {
  return opsFetch<OpsGovernanceListResponse>(token, '/ops/console/governance');
}

export function grantGovernance(
  token: string,
  merchantId: string,
  body: {
    operator: string;
    acquisitionMethod: string;
    sourceUrl: string;
    note?: string;
  },
): Promise<OpsGovernanceMutationResponse> {
  return opsFetch<OpsGovernanceMutationResponse>(
    token,
    `/ops/console/governance/${encodeURIComponent(merchantId)}/grant`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function revokeGovernance(
  token: string,
  merchantId: string,
  body: { operator: string; reason: string },
): Promise<OpsGovernanceMutationResponse> {
  return opsFetch<OpsGovernanceMutationResponse>(
    token,
    `/ops/console/governance/${encodeURIComponent(merchantId)}/revoke`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Dataset-version confirmation
// ---------------------------------------------------------------------------

export function listConfirmations(
  token: string,
): Promise<OpsConfirmationListResponse> {
  return opsFetch<OpsConfirmationListResponse>(token, '/ops/console/confirmations');
}

export function resolveTaxReview(
  token: string,
  reviewId: string,
  resolution: 'approve' | 'reject',
  body: { operator: string; note?: string },
): Promise<OpsTaxReviewResolvedResponse> {
  return opsFetch<OpsTaxReviewResolvedResponse>(
    token,
    `/ops/console/confirmations/tax/${encodeURIComponent(reviewId)}/${resolution}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Correction queue
// ---------------------------------------------------------------------------

export function listCorrections(token: string): Promise<CorrectionListResponse> {
  return opsFetch<CorrectionListResponse>(token, '/ops/console/corrections');
}

export function resolveCorrection(
  token: string,
  correctionId: number,
  body: { operator: string; note?: string },
): Promise<{ id: number; status: string }> {
  return opsFetch<{ id: number; status: string }>(
    token,
    `/ops/console/corrections/${correctionId}/resolve`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export function listAuditTrail(token: string): Promise<OpsAuditListResponse> {
  return opsFetch<OpsAuditListResponse>(token, '/ops/console/audit?limit=25');
}

// ---------------------------------------------------------------------------
// Shop-report moderation + blacklist (task 2.3, change
// trust-and-reach-roadmap) — response types are local to the console API
// module (lib/types.ts is shared surface with other workstreams).
// ---------------------------------------------------------------------------

/** One OPEN report in the review queue, with its evidence. */
export interface OpsReportQueueItem {
  id: number;
  merchantDomain: string;
  merchantNameNormalized: string;
  orderReference: string;
  correspondenceSummary: string;
  reporterAccountId: number;
  status: string;
  linkedEntryId: number | null;
  createdAt: string;
}

export interface OpsReportQueueResponse {
  items: OpsReportQueueItem[];
  total: number;
}

/** One blacklist entry in the console overview / appeal inbox. */
export interface OpsBlacklistEntry {
  id: number;
  merchantDomain: string;
  merchantNameNormalized: string;
  standardMet: string;
  publishedAt: string;
  publishedBy: string;
  status: string;
  appealedAt: string | null;
  appealReason: string | null;
}

export interface OpsBlacklistListResponse {
  items: OpsBlacklistEntry[];
  total: number;
}

export interface OpsPublishEntryResponse extends OpsBlacklistEntry {
  linkedReportIds: number[];
}

export function listReports(token: string): Promise<OpsReportQueueResponse> {
  return opsFetch<OpsReportQueueResponse>(token, '/ops/console/reports');
}

export function linkReport(
  token: string,
  reportId: number,
  body: { operator: string; entryId: number; note?: string },
): Promise<{ id: number; status: string; linkedEntryId: number | null }> {
  return opsFetch(token, `/ops/console/reports/${reportId}/link`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function rejectReport(
  token: string,
  reportId: number,
  body: { operator: string; note?: string },
): Promise<{ id: number; status: string }> {
  return opsFetch(token, `/ops/console/reports/${reportId}/reject`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listBlacklistEntries(
  token: string,
): Promise<OpsBlacklistListResponse> {
  return opsFetch<OpsBlacklistListResponse>(token, '/ops/console/blacklist/entries');
}

export function publishBlacklistEntry(
  token: string,
  body: {
    operator: string;
    merchantDomain: string;
    merchantName: string;
    confirmedReportIds: number[];
    businessRegistrationConfirmed?: boolean;
    note?: string;
  },
): Promise<OpsPublishEntryResponse> {
  return opsFetch<OpsPublishEntryResponse>(token, '/ops/console/blacklist/publish', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function listAppeals(token: string): Promise<OpsBlacklistListResponse> {
  return opsFetch<OpsBlacklistListResponse>(token, '/ops/console/blacklist/appeals');
}

export function recordAppeal(
  token: string,
  entryId: number,
  body: { operator: string; appealReason: string; note?: string },
): Promise<OpsBlacklistEntry> {
  return opsFetch<OpsBlacklistEntry>(token, `/ops/console/blacklist/${entryId}/appeal`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function resolveAppeal(
  token: string,
  entryId: number,
  body: { operator: string; resolution: 'REPUBLISH' | 'REJECT'; note?: string },
): Promise<OpsBlacklistEntry> {
  return opsFetch<OpsBlacklistEntry>(token, `/ops/console/blacklist/${entryId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Newsletter broadcast (task 5.3, change trust-and-reach-roadmap)
// ---------------------------------------------------------------------------

export interface OpsNewsletterBroadcastResponse {
  total: number;
  notified: number;
  failed: number;
  skipped: number;
}

export function notifySubscribers(
  token: string,
  body: { operator: string; subject: string; bodyFi: string; bodyEn: string; note?: string },
): Promise<OpsNewsletterBroadcastResponse> {
  return opsFetch<OpsNewsletterBroadcastResponse>(token, '/ops/console/newsletter/notify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
