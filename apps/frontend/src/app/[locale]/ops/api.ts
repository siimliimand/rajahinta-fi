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
  OpsFxDatasetConfirmedResponse,
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

export function confirmFxDataset(
  token: string,
  datasetId: number,
  body: { operator: string; note?: string },
): Promise<OpsFxDatasetConfirmedResponse> {
  return opsFetch<OpsFxDatasetConfirmedResponse>(
    token,
    `/ops/console/confirmations/fx/${datasetId}/confirm`,
    { method: 'POST', body: JSON.stringify(body) },
  );
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
